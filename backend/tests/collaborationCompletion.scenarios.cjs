const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
module.exports=async({t,mongoose,problem,room,users,userId,io,until,a,b,send})=>{
  const {DocumentStore,identity}=require('../src/services/collaborativeDocument.service'),Documents=require('../src/models/CollaborativeDocument');
  const roomId=String(room._id),problemId=String(problem._id);
  const base=`http://127.0.0.1:${io.httpServer.address().port}/api/v1`;
  const request=(user,path,body)=>fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:`Bearer ${require('jsonwebtoken').sign({id:user},process.env.JWT_SECRET)}`},...(body?{body:JSON.stringify(body)}:{})});
  let snapshot,submission,payload;
  await t.test('collaborative submission ignores browser source, records a durable immutable server snapshot and judges it',async()=>{
    const text='class Solution { public: int doubleIt(int n) { return n*2; } };';a.doc.getText('source').delete(0,a.doc.getText('source').length);a.doc.getText('source').insert(0,text);snapshot=await send(a);assert.equal(snapshot.success,true);
    payload={roomId,problem:problemId,language:'cpp',collaborative:true,sourceHash:snapshot.hash,code:'untrusted browser code',idempotencyKey:randomUUID()};
    submission=await require('../src/services/submission.service').createSubmission(payload,users[0]);assert.equal(submission.code,text);assert.equal(submission.sourceHash,snapshot.hash);assert.ok(submission.sourceRevision>0);assert.equal(String(submission.teamId),String(room.teams[0]._id));assert.equal(String(submission.user),users[0]);
    await until(async()=>{const record=await mongoose.model('Submission').findById(submission._id);return record.status==='accepted';});
    const run=await request(users[0],'/submissions/run',{...payload,idempotencyKey:undefined});assert.equal(run.status,200);assert.equal((await run.json()).data.status,'accepted');
  });
  await t.test('later teammate edits cannot alter the snapshot; original UUID replays and stale hashes reject new submissions',async()=>{
    await until(()=>b.doc.getText('source').toString().includes('return n*2'));
    b.doc.getText('source').insert(0,'// later teammate edit\n');assert.equal((await send(b)).success,true);
    const replay=await require('../src/services/submission.service').createSubmission(payload,users[0]);assert.equal(String(replay._id),String(submission._id));assert.equal((await mongoose.model('Submission').findById(submission._id)).code,'class Solution { public: int doubleIt(int n) { return n*2; } };');
    await assert.rejects(require('../src/services/submission.service').createSubmission({...payload,idempotencyKey:randomUUID()},users[0]),error=>error.status===409);
    await assert.rejects(require('../src/services/submission.service').createSubmission({roomId,problem:problemId,language:'cpp',code:'bypass',idempotencyKey:randomUUID()},users[0]),error=>error.status===400);
  });
  await t.test('concurrent persistence merges stale snapshots and a fresh backend process recovers committed CRDT state',async()=>{
    const key=identity(roomId,room.teams[0]._id,new mongoose.Types.ObjectId());
    const one=new DocumentStore(),two=new DocumentStore();const first=await one.get(key,'seed'),second=await two.get(key,'ignored starter');
    first.doc.getText('source').insert(0,'WRITER-ONE');second.doc.getText('source').insert(0,'WRITER-TWO');await Promise.all([one.flush(first),two.flush(second)]);
    const fresh=new DocumentStore();const restored=await fresh.snapshot(key);assert.ok(restored.code.includes('WRITER-ONE'));assert.ok(restored.code.includes('WRITER-TWO'));assert.equal(restored.code.match(/seed/g).length,1);
    const script="const m=require('mongoose');m.connect(process.env.MONGO_URI).then(async()=>{const {store}=require('./src/services/collaborativeDocument.service');const result=await store.snapshot(process.env.TEST_DOCUMENT_KEY);process.stdout.write(result.code);await store.close();await m.disconnect();}).catch(e=>{console.error(e.message);process.exit(1);});";
    const recovered=require('node:child_process').execFileSync(process.execPath,['-e',script],{env:{...process.env,TEST_DOCUMENT_KEY:key},encoding:'utf8',timeout:10000});assert.equal(recovered,restored.code);
    await Promise.all([one.close(),two.close(),fresh.close()]);
  });
  await t.test('persistence failure never acknowledges a newer generation and retry retains the pending source',async()=>{
    let fail=false;const model={findOne:query=>Documents.findOne(query),findOneAndUpdate:(...args)=>{if(fail)return {lean:async()=>{throw Error('Simulated persistence outage');}};return Documents.findOneAndUpdate(...args);}};
    const isolated=new DocumentStore({model}),key=identity(roomId,room.teams[0]._id,new mongoose.Types.ObjectId()),entry=await isolated.get(key,'before');entry.doc.getText('source').insert(0,'pending');fail=true;await assert.rejects(isolated.flush(entry));assert.notEqual(entry.generation,entry.persistedGeneration);fail=false;await isolated.flush(entry);assert.equal((await isolated.snapshot(key)).code,'pendingbefore');await isolated.close();
  });
  await t.test('burst updates share one batched persistence commit',async()=>{
    const batched=new DocumentStore({delay:40}),entry=await batched.get(identity(roomId,room.teams[0]._id,new mongoose.Types.ObjectId()),'seed');
    entry.doc.getText('source').insert(0,'A');const first=batched.schedule(entry);entry.doc.getText('source').insert(0,'B');const second=batched.schedule(entry);assert.equal(first,second);await Promise.all([first,second]);assert.equal(entry.revision,1);assert.equal(entry.persisted.code,'BAseed');await batched.close();
  });
  await t.test('pre-existing private rooms retain browser-source submissions and do not expose hidden questions in profiles',async()=>{
    const service=require('../src/services/battleRoom.service'),Room=require('../src/models/BattleRoom');
    const old=await service.create(users[4],{teamSize:1,hostType:'PARTICIPANT_HOST',hostTeam:'Alpha',duration:15,problemCount:1,selectionMode:'RANDOM_DISTRIBUTION',difficulties:['easy']});
    await Room.collection.updateOne({_id:old._id},{$unset:{editorMode:''}});
    assert.equal((await service.view(String(old._id),users[4])).collaborationEnabled,false);assert.deepEqual((await require('../src/services/behaviour.service').profile(String(old._id),users[4])).problems,[]);
    await service.join(users[3],old.code,'Beta');for(const [team,user] of [['Alpha',users[4]],['Beta',users[3]]]){await service.change(String(old._id),user,'ready',{ready:true});await service.change(String(old._id),users[4],'lead',{teamId:team,userId:user});await service.change(String(old._id),user,'team-ready',{teamId:team,ready:true});}await service.change(String(old._id),users[4],'start');
    const result=await require('../src/services/submission.service').createSubmission({roomId:String(old._id),problem:String(old.problems[0]),language:'cpp',code:'class Solution { public: int doubleIt(int n) { return n*2; } };',idempotencyKey:randomUUID()},users[4]);assert.equal(result.sourceHash,undefined);assert.ok(result.code.includes('return n*2'));await until(async()=>{const value=await mongoose.model('Submission').findById(result._id);return value.status==='accepted';});
  });
  const metrics=require('../src/services/behaviour.service');let window;
  await t.test('aggregate windows batch idempotently, derive identity and keep monotonic data under concurrent uploads',async()=>{
    const now=Date.now();window={problemId,language:'cpp',sessionId:randomUUID(),minute:Math.floor(now/60000)*60000,sequence:1,firstEditAt:now,metrics:{keyboardChars:6,keyboardEvents:6,keyboardActiveMs:2500,activeMs:2500,visibleMs:3000,contributionChars:106,insertedChars:106,editEvents:7,pasteEvents:1,pasteChars:100,largeInsertions:1,largeInsertedChars:100,cadence2:5}};
    await metrics.ingest(roomId,users[0],[window]);await metrics.ingest(roomId,users[0],[window]);
    await Promise.all([metrics.ingest(roomId,users[0],[{...window,sequence:2,metrics:{...window.metrics,keyboardChars:8,insertedChars:108}}]),metrics.ingest(roomId,users[0],[{...window,sequence:3,metrics:{...window.metrics,keyboardChars:10,insertedChars:110}}])]);
    const rows=await require('../src/models/BehaviourWindow').find({room:roomId,user:users[0]}).lean();assert.equal(rows.length,1);assert.equal(rows[0].metrics.keyboardChars,10);assert.equal(String(rows[0].teamId),String(room.teams[0]._id));assert.equal(rows[0].language,'cpp');assert.ok(rows[0].expiresAt>new Date());
    const profile=await metrics.profile(roomId,users[0]);assert.equal(profile.overall.metrics.pasteEvents,1);assert.equal(profile.overall.estimatedCPM,240);assert.equal(profile.problems[0].firstSubmissionAt!==null,true);assert.ok(profile.problems[0].firstAcceptedAt);assert.ok(profile.problems[0].firstRunAt);
  });
  await t.test('profiles are self-only; outsider/host and forged identities cannot read another private profile',async()=>{
    assert.equal((await request(userId,`/battles/rooms/${roomId}/behaviour/me`)).status,403);
    const own=await request(users[1],`/battles/rooms/${roomId}/behaviour/me?userId=${users[0]}`);assert.equal(own.status,200);const body=(await own.json()).data;assert.equal(String(body.participant._id),users[1]);assert.equal(body.overall.estimatedCPM,null);assert.equal(body.overall.metrics.keyboardChars,0);
    const forged=await request(users[1],`/battles/rooms/${roomId}/behaviour`,{userId:users[0],teamId:String(room.teams[1]._id),windows:[{...window,sessionId:randomUUID()}]});assert.equal(forged.status,200);const row=await require('../src/models/BehaviourWindow').findOne({room:roomId,user:users[1]});assert.equal(String(row.teamId),String(room.teams[0]._id));
    await assert.rejects(metrics.ingest(roomId,users[0],[{...window,sessionId:randomUUID(),code:'must never be stored'}]),error=>error.status===400);
    await assert.rejects(metrics.ingest(roomId,users[0],[{...window,sessionId:randomUUID(),metrics:{clipboard:'private'}}]),error=>error.status===400);
    await assert.rejects(metrics.ingest(roomId,users[0],[{...window,sessionId:randomUUID(),metrics:{activeMs:60001}}]),error=>error.status===400);
    await assert.rejects(metrics.ingest(roomId,users[0],[{...window,problemId:String(new mongoose.Types.ObjectId())}]),error=>error.status===403);
  });
  await t.test('metric TTL indexes exist and expired aggregates are excluded even before the TTL sweep',async()=>{
    const Window=require('../src/models/BehaviourWindow');assert.ok((await Window.collection.indexes()).some(index=>index.key.expiresAt===1&&index.expireAfterSeconds===0));await Window.updateMany({room:roomId,user:users[0]},{$set:{expiresAt:new Date(Date.now()-1000)}});assert.equal((await metrics.profile(roomId,users[0])).overall.metrics.keyboardChars,0);
  });
};
