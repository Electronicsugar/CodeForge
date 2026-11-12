const {test}=require('node:test');
const assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process');
const {randomUUID}=require('node:crypto');
test('isolated API, MongoDB, Redis and Docker judging integration', {timeout:120000}, async t=>{
  assert.match(process.env.MONGO_URI||'',/\/codeforge_resilience_test$/,'Only a disposable test database is allowed');
  process.env.JWT_SECRET='local-integration-test-secret-not-for-production';
  const mongoose=require('mongoose');
  mongoose.set('bufferCommands',false);
  await mongoose.connect(process.env.MONGO_URI,{serverSelectionTimeoutMS:2000});
  const {redisClient,connectRedis}=require('../src/config/redis');
  await connectRedis();
  const Submission=require('../src/models/Submission');
  const Problem=require('../src/models/Problem');
  const TestCase=require('../src/models/TestCase');
  await Submission.init();
  const http=require('node:http');
  const server=http.createServer(require('../src/app'));
  const io=new (require('socket.io').Server)(server);
  require('../src/sockets/socket')(io);
  const worker=require('../src/workers/submission.worker');
  const enqueue=require('../src/services/submissionEnqueue.service');
  const queue=require('../src/queues/submission.queue');
  const {connection}=require('../src/config/queue.config');
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/v1`;
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async(fn)=>{for(let i=0;i<100;i++){const value=await fn();if(value)return value;await pause(200);}throw Error('Timed out waiting for recovery');};
  let token,userId,problem;
  const request=(path,body,key)=>fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{ }),...(key?{'Idempotency-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})});
  try {
    await t.test('registration, login and problem loading work',async()=>{
      const credentials={name:'Resilience Tester',email:`${randomUUID()}@example.com`,password:randomUUID()};
      let response=await request('/auth/register',credentials);assert.equal(response.status,201);
      const registered=await response.json();userId=registered.data._id;
      response=await request('/auth/login',credentials);assert.equal(response.status,200);token=(await response.json()).data.token;
      problem=await Problem.create({problemNumber:Date.now(),title:`Test ${randomUUID()}`,description:'Double an integer',difficulty:'easy',createdBy:userId,functionName:'doubleIt',judgeConfig:{returnType:'int',parameters:[{name:'n',type:'int'}]}});
      await TestCase.create({problem:problem._id,input:'21',expectedOutput:'42',createdBy:userId});
      assert.equal((await request(`/problems/${problem._id}`)).status,200);
    });
    const payload=()=>({problem:problem._id.toString(),language:'cpp',code:'class Solution { public: int doubleIt(int n) { return n * 2; } };'});
    await t.test('concurrent replays and lost acknowledgement create one logical submission; real Docker worker accepts it',async()=>{
      const key=randomUUID();const responses=await Promise.all(Array.from({length:3},()=>request('/submissions',payload(),key)));
      const bodies=await Promise.all(responses.map(r=>r.json()));
      assert.ok(responses.every(r=>r.status===201),JSON.stringify(bodies));
      assert.equal(new Set(bodies.map(b=>b.data.submissionId)).size,1);
      assert.equal(await Submission.countDocuments({user:userId,idempotencyKey:key}),1);
      const id=bodies[0].data.submissionId;
      const terminal=await until(async()=>{const record=await Submission.findById(id);return !['pending','running'].includes(record.status)&&record;});
      assert.equal(terminal.status,'accepted',terminal.error||'Docker execution did not accept the correct answer');
      const replay=await request('/submissions',payload(),key);assert.equal((await replay.json()).data.submissionId,id);
      const mismatch=await request('/submissions',{...payload(),code:'different code'},key);assert.equal(mismatch.status,409);
    });
    await t.test('Redis outage retains a visible dispatch failure and reconciliation recovers it',async()=>{
      const key=randomUUID();
      // Call the service directly while Redis is down: HTTP correctly refuses session verification during this outage.
      execFileSync('docker',['stop','codeforge-resilience-test-redis']);
      await pause(500);
      const service=require('../src/services/submission.service');
      const saved=await service.createSubmission({...payload(),idempotencyKey:key},userId);
      assert.equal(saved.enqueueState,'enqueue_failed');
      assert.equal((await request('/users/me')).status,503);
      execFileSync('docker',['start','codeforge-resilience-test-redis']);
      await until(()=>redisClient.isReady);
      await pause(1500);
      await Submission.updateOne({_id:saved._id},{$set:{nextEnqueueAt:new Date(0)}});
      await enqueue.reconcile();
      const recovered=await until(async()=>{const record=await Submission.findById(saved._id);return record.status==='accepted'&&record;});
      assert.equal(recovered.status,'accepted');
      assert.equal(await Submission.countDocuments({idempotencyKey:key}),1);
    });
    await t.test('socket reconnect reauthenticates, rejoins active battle and rejects outsider',async()=>{
      const Battle=require('../src/models/Battle');
      const opponent=await mongoose.model('User').create({name:'Opponent',email:`${randomUUID()}@example.com`,password:'unused-test-hash'});
      const battle=await Battle.create({player1:{user:userId,initialRating:1200},player2:{user:opponent._id,initialRating:1200},problem:problem._id,status:'in_progress',startTime:new Date()});
      const {io:connect}=require('socket.io-client');
      const socket=connect(`http://127.0.0.1:${server.address().port}`,{auth:{token},transports:['websocket']});
      await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
      const rejoin=()=>new Promise((resolve,reject)=>{
        const timer=setTimeout(()=>reject(Error('Battle rejoin timed out')),3000);
        socket.once('battle_reconnected',data=>{clearTimeout(timer);resolve(data.battle);});
        socket.emit('rejoin_battle',{battleId:battle._id.toString()});
      });
      assert.equal((await rejoin())._id,battle._id.toString());
      const first=socket.id;socket.disconnect();socket.connect();
      await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
      assert.notEqual(socket.id,first);
      assert.equal((await rejoin()).status,'in_progress');socket.disconnect();
      const outsiderToken=require('jsonwebtoken').sign({id:new mongoose.Types.ObjectId().toString()},process.env.JWT_SECRET);
      const outsider=connect(`http://127.0.0.1:${server.address().port}`,{auth:{token:outsiderToken},transports:['websocket']});
      await new Promise((resolve,reject)=>{outsider.once('connect',resolve);outsider.once('connect_error',reject);});
      outsider.emit('rejoin_battle',{battleId:battle._id.toString()});await pause(150);
      assert.equal(io.sockets.sockets.get(outsider.id).rooms.has(`battle:${battle._id}`),false);outsider.disconnect();
    });
  } finally {
    execFileSync('docker',['start','codeforge-resilience-test-redis']);
    await worker.close();await queue.close();connection.disconnect();await enqueue.close();
    await redisClient.quit();io.close();server.close();await mongoose.connection.dropDatabase();await mongoose.disconnect();
  }
});
