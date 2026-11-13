import * as Y from 'yjs';
let database;
const open=()=>database||(database=new Promise((resolve,reject)=>{
  const request=indexedDB.open('codeforge-collaboration-v1',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('documents',{keyPath:'key'});
  request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();database=null;};resolve(request.result);};request.onerror=()=>reject(request.error);request.onblocked=()=>reject(Error('Close older shared editor tabs to enable recovery.'));
}).catch(error=>{database=null;throw error;}));
export const cacheKey=identity=>JSON.stringify([identity.userId,identity.roomId,identity.teamId,identity.problemId,identity.language]);
export async function loadCollaborativeCache(key,doc){
  const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('documents'),request=tx.objectStore('documents').get(key);tx.oncomplete=()=>{try{if(request.result)Y.applyUpdate(doc,new Uint8Array(request.result.update));resolve();}catch{reject(Error('Shared recovery data is invalid. Your text backup is retained.'));}};tx.onerror=tx.onabort=()=>reject(tx.error||Error('Shared recovery read failed'));});
}
export async function saveCollaborativeCache(key,doc){
  const update=Y.encodeStateAsUpdate(doc),db=await open();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('documents','readwrite'),store=tx.objectStore('documents');let failure;
    store.get(key).onsuccess=event=>{
      const merged=new Y.Doc();try{if(event.target.result)Y.applyUpdate(merged,new Uint8Array(event.target.result.update));Y.applyUpdate(merged,update);const state=Y.encodeStateAsUpdate(merged);if(state.byteLength>512*1024)throw Error('Shared recovery cache is too large. Download a text backup.');store.put({key,update:state,updatedAt:Date.now()});}catch(error){failure=error;tx.abort();}finally{merged.destroy();}
    };
    tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(failure||tx.error||Error('Could not save shared recovery data. Your editor text is retained.'));
  });
}
