const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const Y=require('yjs');

module.exports=async({t,mongoose,room,problem,users,join,send,connect,ack,until,io})=>{
  const roomId=String(room._id),problemId=String(problem._id);
  const sources={
    python:'class Solution:\n    def doubleIt(self, n):\n        return n * 2',
    javascript:'class Solution { doubleIt(n) { return n * 2; } }',
    java:'class Solution { public int doubleIt(int n) { return n * 2; } }'
  };
  const languageDocs=[];
  for(const [language,code] of Object.entries(sources)){
    await t.test(`${language} collaborative document converges, persists and submits an immutable authoritative snapshot`,async()=>{
      const a=await join(await connect(users[0]),0,new Y.Doc(),language);
      const b=await join(await connect(users[1]),0,new Y.Doc(),language);
      const expectedKey=JSON.stringify([roomId,String(room.teams[0]._id),problemId,language]);
      assert.equal(a.key,expectedKey);assert.equal(b.key,a.key);
      assert.ok(a.doc.getText('source').toString().includes('doubleIt'),'starter is generated for selected language');
      a.doc.getText('source').delete(0,a.doc.getText('source').length);
      a.doc.getText('source').insert(0,code);
      const snapshot=await send(a);assert.equal(snapshot.success,true,snapshot.message);
      await until(()=>b.doc.getText('source').toString()===code);
      for(const previous of languageDocs)assert.notEqual(previous.key,a.key);
      const body={roomId,problem:problemId,language,collaborative:true,sourceHash:snapshot.hash,code:'untrusted browser text',idempotencyKey:randomUUID()};
      const submission=await require('../src/services/submission.service').createSubmission(body,users[0]);
      assert.equal(submission.code,code);assert.equal(submission.language,language);assert.equal(submission.documentKey,a.key);
      await until(async()=>{const result=await mongoose.model('Submission').findById(submission._id);return result.status==='accepted';});
      const run=await fetch(`http://127.0.0.1:${io.httpServer.address().port}/api/v1/submissions/run`,{
        method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${a.socket.auth.token}`},body:JSON.stringify(body)
      });
      assert.equal(run.status,200);assert.equal((await run.json()).data.status,'accepted');
      const replay=await require('../src/services/submission.service').createSubmission(body,users[0]);
      assert.equal(String(replay._id),String(submission._id));
      const restored=new (require('../src/services/collaborativeDocument.service').DocumentStore)();
      try{const entry=await restored.get(a.key);assert.equal(entry.doc.getText('source').toString(),code);}finally{await restored.close();}
      b.doc.getText('source').insert(0,language==='python'?'# teammate edit\n':'// teammate edit\n');
      assert.equal((await send(b)).success,true);
      assert.equal((await mongoose.model('Submission').findById(submission._id)).code,code);
      await assert.rejects(require('../src/services/submission.service').createSubmission({...body,idempotencyKey:randomUUID()},users[0]),error=>error.status===409);
      const opponent=await connect(users[3]);
      assert.equal((await ack(opponent,'collab_join',{roomId,teamId:String(room.teams[0]._id),problemId,language,clientId:new Y.Doc().clientID})).status,403);
      languageDocs.push(a);
    });
  }
  await t.test('analytics use a different durable document identity for every language',async()=>{
    const service=require('../src/services/behaviour.service');
    const now=Date.now(),sessionId=randomUUID(),minute=Math.floor(now/60000)*60000;
    await service.ingest(roomId,users[1],Object.keys(sources).map(language=>({problemId,language,sessionId,minute,sequence:1,metrics:{pasteEvents:1,pasteChars:10,insertedChars:10}})));
    const rows=await mongoose.model('BehaviourWindow').find({room:roomId,user:users[1],sessionId}).lean();
    assert.equal(rows.length,3);assert.equal(new Set(rows.map(row=>row.documentKey)).size,3);
    for(const row of rows)assert.equal(JSON.parse(row.documentKey)[3],row.language);
  });
};
