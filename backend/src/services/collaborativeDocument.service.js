const Y=require('yjs');
const {createHash}=require('node:crypto');
const Model=require('../models/CollaborativeDocument');
const failure=(status,message)=>Object.assign(Error(message),{status});
const identity=(room,team,problem,language='cpp')=>JSON.stringify([String(room),String(team),String(problem),language]);
const hash=code=>createHash('sha256').update(code).digest('hex');
const bytes=value=>new Uint8Array(Buffer.isBuffer(value)||value instanceof Uint8Array?value:value.buffer);
function validate(doc){
  if(doc.getText('source').length>50000||Y.encodeStateAsUpdate(doc).byteLength>512*1024)throw failure(413,'Document size limit reached');
  if([...doc.share.keys()].some(key=>key!=='source')||doc.getText('source').toDelta().some(part=>typeof part.insert!=='string'||part.attributes)||doc.store.pendingStructs||doc.store.pendingDs)throw failure(400,'Invalid source document; synchronize before retrying');
}
class DocumentStore{
  constructor({model=Model,delay=150}={}){this.model=model;this.delay=delay;this.entries=new Map();this.loading=new Map();}
  async get(key,starter=''){
    if(this.entries.has(key)){const entry=this.entries.get(key);await this.refresh(entry);return entry;}
    if(this.loading.has(key))return this.loading.get(key);
    const loading=this.load(key,starter).finally(()=>this.loading.delete(key));this.loading.set(key,loading);return loading;
  }
  async load(key,starter){
    if(this.entries.size>=500)throw failure(503,'Active document capacity reached');
    const [room,teamId,problem,language]=JSON.parse(key),seed=new Y.Doc();seed.getText('source').insert(0,starter);validate(seed);
    let stored;
    try{stored=await this.model.findOneAndUpdate({key},{$setOnInsert:{key,room,teamId,problem,language,state:Buffer.from(Y.encodeStateAsUpdate(seed)),hash:hash(starter),revision:0}},{upsert:true,returnDocument:'after'}).lean();}
    catch(error){if(error.code!==11000)throw error;stored=await this.model.findOne({key}).lean();}
    finally{seed.destroy();}
    const doc=new Y.Doc();doc.getText('source');Y.applyUpdate(doc,bytes(stored.state));validate(doc);
    const entry={key,doc,clients:new Map(),generation:0,persistedGeneration:0,revision:stored.revision,persisted:{code:doc.getText('source').toString(),revision:stored.revision,hash:stored.hash,key},saving:null,timer:null,pending:null};
    doc.on('update',()=>{entry.generation++;});this.entries.set(key,entry);return entry;
  }
  schedule(entry){
    if(entry.generation===entry.persistedGeneration&&!entry.saving)return Promise.resolve(entry.persisted);
    if(!entry.pending){
      entry.pending=new Promise((resolve,reject)=>{entry.timer=setTimeout(()=>{entry.timer=null;this.flush(entry).then(resolve,reject);},this.delay);}).finally(()=>{entry.pending=null;});
    }
    return entry.pending;
  }
  async flush(entry){
    if(entry.saving){await entry.saving;if(entry.generation!==entry.persistedGeneration)return this.flush(entry);return entry.persisted;}
    entry.saving=(async()=>{
      let retries=0;
      while(entry.generation!==entry.persistedGeneration){
        const stored=await this.model.findOne({key:entry.key}).lean();if(!stored)throw failure(503,'Stored collaborative document is unavailable');
        // Merge the latest persisted CRDT before CAS: another writer's commit
        // can never be replaced by an older full-state snapshot.
        Y.applyUpdate(entry.doc,bytes(stored.state));validate(entry.doc);
        const generation=entry.generation,state=Y.encodeStateAsUpdate(entry.doc),code=entry.doc.getText('source').toString(),contentHash=hash(code);
        const committed=await this.model.findOneAndUpdate({key:entry.key,revision:stored.revision},{$set:{state:Buffer.from(state),hash:contentHash},$inc:{revision:1}},{returnDocument:'after'}).lean();
        if(!committed){if(++retries>20)throw failure(409,'Document changed concurrently; retry synchronization');continue;}
        retries=0;entry.persistedGeneration=generation;entry.revision=committed.revision;entry.persisted={code,hash:contentHash,revision:committed.revision,key:entry.key};
      }
      return entry.persisted;
    })();
    try{return await entry.saving;}finally{entry.saving=null;}
  }
  async refresh(entry){
    if(entry.saving)await entry.saving;
    const stored=await this.model.findOne({key:entry.key}).lean();
    if(stored&&stored.revision>entry.revision){const clean=entry.generation===entry.persistedGeneration;Y.applyUpdate(entry.doc,bytes(stored.state));entry.revision=stored.revision;validate(entry.doc);if(clean){entry.persistedGeneration=entry.generation;entry.persisted={key:entry.key,code:entry.doc.getText('source').toString(),hash:stored.hash,revision:stored.revision};}}
  }
  async snapshot(key){const entry=await this.get(key);await this.flush(entry);return {...entry.persisted};}
  async exists(key){return this.entries.has(key)||Boolean(await this.model.exists({key}));}
  async close(){await Promise.all([...this.entries.values()].map(entry=>this.flush(entry)));for(const entry of this.entries.values()){if(entry.timer)clearTimeout(entry.timer);entry.doc.destroy();}this.entries.clear();}
}
// Explicit memory fixture for browser protocol tests only. Never selected by an
// environment flag or by the application server.
class MemoryDocumentStore{
  constructor(){this.entries=new Map();}
  async get(key,starter=''){if(!this.entries.has(key)){const doc=new Y.Doc();doc.getText('source').insert(0,starter);this.entries.set(key,{key,doc,clients:new Map(),revision:0});}return this.entries.get(key);}
  async schedule(entry){entry.revision++;return {key:entry.key,hash:hash(entry.doc.getText('source').toString()),revision:entry.revision};}
  async close(){for(const entry of this.entries.values())entry.doc.destroy();this.entries.clear();}
}
const store=new DocumentStore();
async function submissionSnapshot(data,userId){
  const {room,access}=await require('./battleRoom.service').selectedProblem(data.roomId,userId,String(data.problem),true);
  const key=identity(room._id,access.team._id,data.problem,data.language);
  const shared=room.editorMode==='collaborative'||data.collaborative===true||await store.exists(key);
  if(!shared)return null;
  if(typeof data.sourceHash!=='string'||!/^[a-f0-9]{64}$/.test(data.sourceHash))throw failure(400,'Synchronize the shared document before submitting');
  if(!await store.exists(key))throw failure(409,'Open and synchronize the shared document first');
  const snapshot=await store.snapshot(key);
  // Revalidate lifecycle after persistence waits; no new submission may cross
  // the deadline while the database was busy.
  await require('./battleRoom.service').selectedProblem(data.roomId,userId,String(data.problem),true);
  if(snapshot.hash!==data.sourceHash)throw failure(409,'The team document changed. Review the latest code and submit again.');
  return snapshot;
}
module.exports={DocumentStore,MemoryDocumentStore,store,identity,hash,validate,submissionSnapshot};
