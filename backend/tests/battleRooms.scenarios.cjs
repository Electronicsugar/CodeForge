const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
module.exports=async({t,mongoose,problem,userId,request,until,io})=>{
  const service=require('../src/services/battleRoom.service');
  const Room=require('../src/models/BattleRoom'),Submission=require('../src/models/Submission');
  await Room.init();
  const users=[userId];
  for(let index=1;index<11;index++)users.push((await mongoose.model('User').create({name:`Room user ${index}`,email:`${randomUUID()}@example.com`,password:'test-only'}))._id.toString());
  const config=(size=1,type='PARTICIPANT_HOST')=>({teamSize:size,hostType:type,hostTeam:'Alpha',duration:15,problemCount:1,selectionMode:type==='EXTERNAL_HOST'?'MANUAL_SELECTION':'RANDOM_DISTRIBUTION',difficulties:['easy'],...(type==='EXTERNAL_HOST'?{problems:[problem._id.toString()]}:{})});
  const confirm=async(roomId)=>{const room=await service.load(roomId);for(const team of room.teams){await service.change(roomId,users[0]===String(room.host)?users[0]:String(room.host),'lead',{teamId:String(team._id),userId:String(team.members[0].user)});await service.change(roomId,String(team.members[0].user),'team-ready',{teamId:String(team._id),ready:true});}};
  const rejected=async(operation,status)=>assert.rejects(operation,error=>error.status===status);
  await t.test('1v1 personal Ready alone mirrors team readiness and permits start without assigned leads',async()=>{
    const room=await service.create(users[0],config(1)),roomId=String(room._id);await service.join(users[1],room.code,'Beta');await service.change(roomId,users[0],'ready',{ready:true});assert.equal((await service.view(roomId,users[0])).canStart,false);await service.change(roomId,users[1],'ready',{ready:true});let state=await service.view(roomId,users[0]);assert.equal(state.canStart,true);assert.ok(state.teams.every(team=>!team.lead&&team.teamReady));await service.change(roomId,users[1],'ready',{ready:false});assert.equal((await service.view(roomId,users[0])).canStart,false);await service.change(roomId,users[1],'ready',{ready:true});await service.change(roomId,users[0],'start');assert.equal((await service.load(roomId)).status,'in_progress');
  });
  for(const size of [1,2,3,4])await t.test(`${size}v${size}: full roster, participant host slot, readiness and atomic start`,async()=>{
    const room=await service.create(users[0],config(size));
    assert.equal(room.teams[0].members.length,1);assert.equal(room.problemCount,1);assert.equal(room.teamSize,size);
    for(let index=1;index<size;index++)await service.join(users[index],room.code,'Alpha');
    for(let index=size;index<size*2;index++)await service.join(users[index],room.code,'Beta');
    await rejected(service.join(users[9],room.code,'Alpha'),409);
    await rejected(service.change(room._id.toString(),users[0],'start'),409);
    for(let index=0;index<size*2;index++)await service.change(room._id.toString(),users[index],'ready',{ready:true});
    await confirm(room._id.toString());
    const state=await service.view(room._id.toString(),users[0]);assert.equal(state.status,'ready');assert.equal(state.canStart,true);
    const results=await Promise.allSettled([service.change(room._id.toString(),users[0],'start'),service.change(room._id.toString(),users[0],'start')]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    const started=await service.view(room._id.toString(),users[size]);assert.equal(started.status,'in_progress');
    assert.equal(new Date(started.endTime)-new Date(started.startTime),15*60000);
    assert.equal((await service.view(room._id.toString(),users[0])).endTime.getTime(),started.endTime.getTime());
    await rejected(service.change(room._id.toString(),users[0],'configure',{duration:30}),409);
    await rejected(service.change(room._id.toString(),users[1],'team',{teamId:'Beta'}),409);
    const access=await service.selectedProblem(room._id.toString(),users[0],problem._id.toString(),true);assert.ok(access.access.member);
  });
  await t.test('external host is not a competitor; permissions lock after start; new scoring is deferred',async()=>{
    const room=await service.create(users[0],config(1,'EXTERNAL_HOST')),roomId=room._id.toString();
    assert.equal(room.teams.flatMap(t=>t.members).length,0);
    await rejected(service.join(users[0],room.code,'Alpha'),403);
    await service.join(users[1],room.code,'Alpha');await service.join(users[2],room.code,'Beta');
    await rejected(service.change(roomId,users[1],'configure',{duration:20}),403);
    await rejected(service.change(roomId,users[1],'start'),403);
    await rejected(service.change(roomId,users[0],'ready',{ready:true}),403);
    await service.change(roomId,users[1],'ready',{ready:true});await service.change(roomId,users[2],'ready',{ready:true});
    await service.change(roomId,users[0],'reset-ready');assert.equal((await service.view(roomId,users[0])).canStart,false);
    await service.change(roomId,users[1],'ready',{ready:true});await service.change(roomId,users[2],'ready',{ready:true});
    await confirm(roomId);await service.change(roomId,users[0],'start');await rejected(service.change(roomId,users[0],'configure',{duration:5}),409);
    await rejected(service.selectedProblem(roomId,users[0],problem._id.toString(),true),403);
    const submit=require('../src/services/submission.service').createSubmission;
    await rejected(submit({roomId,problem:problem._id.toString(),language:'cpp',code:'class Solution {};',idempotencyKey:randomUUID()},users[0]),403);
    const payload={roomId,problem:problem._id.toString(),language:'cpp',code:'class Solution { public: int doubleIt(int n) { return n*2; } };',idempotencyKey:randomUUID()};
    const shared=require('../src/services/collaborativeDocument.service');const document=await shared.store.get(shared.identity(roomId,room.teams[0]._id,problem._id),'');document.doc.getText('source').insert(0,payload.code);const snapshot=await shared.store.flush(document);payload.collaborative=true;payload.sourceHash=snapshot.hash;
    const submission=await submit(payload,users[1]);assert.equal(submission.user.toString(),users[1]);assert.equal(submission.teamId.toString(),room.teams[0]._id.toString());assert.equal(submission.battle,null);
    const replay=await submit(payload,users[1]);assert.equal(replay._id.toString(),submission._id.toString());
    await until(async()=>{const current=await Submission.findById(submission._id);return current.status==='accepted';});
    const observed=await service.view(roomId,users[0]);assert.equal(observed.status,'in_progress');assert.equal(observed.teams[0].score,0);
    assert.equal(observed.submissions[0].status,'accepted');assert.equal(JSON.stringify(observed).includes(payload.code),false);
  });
  await t.test('simultaneous last-slot joins and duplicate cross-team joins are atomic',async()=>{
    const room=await service.create(users[0],config(1)),roomId=room._id.toString();
    const results=await Promise.allSettled([service.join(users[1],room.code,'Beta'),service.join(users[2],room.code,'Beta')]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await service.load(roomId)).teams[1].members.length,1);
    await rejected(service.join(users[0],room.code,'Beta'),409);
    const large=await service.create(users[0],config(4));
    const duplicates=await Promise.allSettled([service.join(users[1],large.code,'Alpha'),service.join(users[1],large.code,'Beta')]);
    assert.equal(duplicates.filter(r=>r.status==='fulfilled').length,1);
    assert.equal((await service.load(large._id.toString())).teams.flatMap(t=>t.members).filter(m=>m.user.toString()===users[1]).length,1);
  });
  await t.test('private HTTP/socket state, problem selection and team document boundary reject outsiders',async()=>{
    const room=await service.create(users[1],config(1)),roomId=room._id.toString();
    assert.equal((await request(`/battles/rooms/${roomId}`)).status,403);
    await rejected(service.view(roomId,users[9]),403);
    await rejected(service.selectedProblem(roomId,users[1],problem._id.toString()),409);
    const peer=require('socket.io-client').io(`http://127.0.0.1:${io.httpServer.address().port}`,{auth:{token:require('jsonwebtoken').sign({id:users[9]},process.env.JWT_SECRET)},transports:['websocket']});
    await new Promise((resolve,reject)=>{peer.once('connect',resolve);peer.once('connect_error',reject);});
    const response=await new Promise(resolve=>peer.emit('battle_room_join',{roomId},resolve));assert.equal(response.success,false);peer.disconnect();
    await service.join(users[0],room.code,'Beta');await service.change(roomId,users[1],'ready',{ready:true});await service.change(roomId,users[0],'ready',{ready:true});await confirm(roomId);await service.change(roomId,users[1],'start');
    const joinedPeer=require('socket.io-client').io(`http://127.0.0.1:${io.httpServer.address().port}`,{auth:{token:require('jsonwebtoken').sign({id:users[0]},process.env.JWT_SECRET)},transports:['websocket']});
    await new Promise((resolve,reject)=>{joinedPeer.once('connect',resolve);joinedPeer.once('connect_error',reject);});
    const subscribe=()=>new Promise(resolve=>joinedPeer.emit('battle_room_join',{roomId},resolve));
    assert.equal((await subscribe()).success,true);const first=joinedPeer.id;joinedPeer.disconnect();joinedPeer.connect();
    await new Promise((resolve,reject)=>{joinedPeer.once('connect',resolve);joinedPeer.once('connect_error',reject);});
    assert.notEqual(first,joinedPeer.id);assert.equal((await subscribe()).success,true);
    assert.equal((await service.load(roomId)).teams[1].members.length,1);joinedPeer.disconnect();
    await rejected(service.selectedProblem(roomId,users[0],new mongoose.Types.ObjectId().toString(),true),403);
    const owned=await service.selectedProblem(roomId,users[0],problem._id.toString(),true);assert.equal(owned.access.team.name,'Beta');
  });
  await t.test('problem count, unknown/ineligible IDs and invalid configuration are rejected; codes unique',async()=>{
    await rejected(service.create(users[0],{...config(),difficulties:[]}),400);
    await rejected(service.create(users[0],{...config(),problemCount:2,problems:[problem._id.toString(),problem._id.toString()]}),400);
    await rejected(service.create(users[0],{...config(),problems:[new mongoose.Types.ObjectId().toString()]}),400);
    await rejected(service.create(users[0],{...config(),duration:0}),400);
    await rejected(service.create(users[0],{...config(),teamSize:5}),400);
    const unavailable=await require('../src/models/Problem').create({...problem.toObject(),_id:new mongoose.Types.ObjectId(),problemNumber:Date.now()+1,title:`No tests ${randomUUID()}`});
    await rejected(service.create(users[0],{...config(),problems:[unavailable._id.toString()]}),400);
    const room=await service.create(users[0],config());
    await assert.rejects(Room.create({...room,_id:new mongoose.Types.ObjectId()}),error=>error.code===11000);
  });
  await t.test('authenticated room HTTP routes do not trust spoofed host/member IDs',async()=>{
    const response=await request('/battles/rooms',{...config(2),host:users[8]});assert.equal(response.status,200);
    const room=(await response.json()).data;assert.equal(room.host._id,users[0]);
    const marked=await request(`/battles/rooms/${room._id}/ready`,{ready:true,userId:users[8]});assert.equal(marked.status,200);
    assert.equal((await marked.json()).data.teams[0].members[0].ready,true);
    assert.equal((await request(`/battles/rooms/${room._id}/start`,{})).status,409);
    assert.equal((await request('/battles/rooms/join',{code:room.code,teamId:'Beta'})).status,409);
    assert.equal((await request(`/battles/rooms/${room._id}`)).status,200);
  });
  await t.test('configuration/start race cannot change a started room',async()=>{
    const room=await service.create(users[0],config()),roomId=room._id.toString();await service.join(users[1],room.code,'Beta');
    for(const user of users.slice(0,2))await service.change(roomId,user,'ready',{ready:true});
    await confirm(roomId);
    const attempts=await Promise.allSettled([service.change(roomId,users[0],'start'),service.change(roomId,users[0],'configure',{duration:30})]);
    const final=await service.load(roomId);
    if(final.status==='in_progress'){assert.equal(final.duration,15);assert.equal(attempts[1].status,'rejected');}
    else {assert.equal(final.duration,30);assert.equal(final.status,'waiting');assert.equal(attempts[0].status,'rejected');}
  });
  await t.test('leave, cancel, ready invalidation and timer completion do not change historical battles',async()=>{
    const room=await service.create(users[0],config()),roomId=room._id.toString();
    await service.join(users[1],room.code,'Beta');await service.change(roomId,users[0],'ready',{ready:true});await service.change(roomId,users[1],'ready',{ready:true});
    await service.change(roomId,users[0],'configure',{duration:2});assert.equal((await service.view(roomId,users[0])).status,'waiting');
    await service.change(roomId,users[1],'leave');await rejected(service.view(roomId,users[1]),403);
    await service.change(roomId,users[0],'cancel');await rejected(service.change(roomId,users[0],'start'),409);
    const timed=await service.create(users[0],config());await service.join(users[1],timed.code,'Beta');
    for(const user of users.slice(0,2))await service.change(timed._id.toString(),user,'ready',{ready:true});await confirm(timed._id.toString());await service.change(timed._id.toString(),users[0],'start');
    await Room.updateOne({_id:timed._id},{$set:{endTime:new Date(Date.now()-1)}});
    service.startExpiry();await until(async()=>{const current=await Room.findById(timed._id);return current.status==='completed';});service.stopExpiry();
    const ended=await service.view(timed._id.toString(),users[0]);assert.equal(ended.status,'completed');assert.ok(ended.completedAt);
  });
  await require('./battleExperience.scenarios.cjs')({t,service,Room,users,config,rejected,confirm,mongoose,problem,request,until});
  await t.test('independent random room configurations vary over a larger eligible catalogue and keep persisted order',async()=>{
    for(let index=0;index<12;index++){const record=await mongoose.model('Problem').create({...problem.toObject(),_id:new mongoose.Types.ObjectId(),problemNumber:Date.now()+10000+index,title:`Random fixture ${randomUUID()}`,difficulty:'easy'});await mongoose.model('TestCase').create({problem:record._id,input:'21',expectedOutput:'42',createdBy:users[0]});}
    const orders=new Set(),first=new Set();for(let index=0;index<30;index++){const room=await service.create(users[0],{...config(2),problemCount:2,difficulties:['easy','easy']});const ids=room.problems.map(String);assert.equal(new Set(ids).size,2);orders.add(ids.join(','));first.add(ids[0]);await service.view(String(room._id),users[0]);assert.deepEqual((await service.load(String(room._id))).problems.map(String),ids);}assert.ok(first.size>1);assert.ok(orders.size>1);
  });
  await t.test('development HTTP: repeated formats and separate JWT accounts on one IP remain independent',async()=>{
    const base=`http://127.0.0.1:${io.httpServer.address().port}/api/v1/battles/rooms`;
    const call=async(user,path,body)=>fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',Authorization:`Bearer ${require('jsonwebtoken').sign({id:user},process.env.JWT_SECRET)}`},...(body?{body:JSON.stringify(body)}:{})});
    const limits=await (await call(users[0],'/limits')).json();assert.equal(limits.data.rateLimits.development,true);assert.equal(limits.data.rateLimits.room.max,300);
    for(let round=0;round<3;round++)for(const size of [1,2,3,4]){
      const response=await call(users[0],'',config(size));assert.equal(response.status,200);const room=(await response.json()).data;
      for(let index=1;index<size*2;index++){
        const joined=await call(users[index],'/join',{code:room.code,teamId:index<size?'Alpha':'Beta'});assert.equal(joined.status,200);
        assert.equal((await call(users[index],`/${room._id}/ready`,{ready:true})).status,200);
        assert.equal((await call(users[index],`/${room._id}/policy`,{teamId:'Alpha',policy:'OPEN'})).status,403);
      }
      assert.equal((await call(users[0],`/${room._id}/cancel`,{})).status,200);
    }
    assert.equal((await call(users[0],'/limits')).status,200);
  });
};
