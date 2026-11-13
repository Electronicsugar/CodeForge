const assert=require('node:assert/strict');
module.exports=async({t,service,Room,users,config,rejected,confirm,mongoose,problem,request,until})=>{
  const create=async(size=4)=>{const room=await service.create(users[0],config(size));return {room,id:String(room._id)};};
  const pair=async()=>{const {room,id}=await create();await service.join(users[1],room.code,'Beta');for(const user of users.slice(0,2))await service.change(id,user,'ready',{ready:true});await confirm(id);return {room,id};};
  await t.test('one member per team can start every format; missing team, lead and confirmation block start',async()=>{
    for(const size of [1,2,3,4]){
      const {room,id}=await create(size);await rejected(service.change(id,users[0],'start'),409);
      await service.join(users[1],room.code,'Beta');
      await rejected(service.change(id,users[0],'lead',{teamId:'Beta',userId:users[0]}),400);
      await rejected(service.change(id,users[0],'lead',{teamId:'Alpha',userId:users[9]}),400);
      await rejected(service.change(id,users[1],'lead',{teamId:'Beta',userId:users[1]}),403);
      assert.equal((await service.view(id,users[0])).canStart,false);
      await confirm(id);assert.equal((await service.view(id,users[0])).canStart,true);
      await service.change(id,users[0],'start');assert.equal((await service.load(id)).status,'in_progress');
    }
  });
  await t.test('lead permissions, departure, membership and readiness invalidation',async()=>{
    const {room,id}=await pair();
    await rejected(service.change(id,users[0],'team-ready',{teamId:'Beta',ready:true}),403);
    await rejected(service.change(id,users[1],'policy',{teamId:'Alpha',policy:'APPROVAL_REQUIRED'}),403);
    await service.change(id,users[1],'ready',{ready:false});assert.equal((await service.load(id)).teams[1].teamReady,true);
    await service.change(id,users[1],'team-ready',{teamId:'Beta',ready:true});
    await service.change(id,users[1],'ready',{ready:true});await confirm(id);
    await service.join(users[2],room.code,'Alpha');let state=await service.load(id);assert.equal(state.teams[0].teamReady,false);assert.equal(state.teams[1].teamReady,true);
    await service.change(id,users[2],'ready',{ready:true});await confirm(id);
    await service.change(id,users[2],'team',{teamId:'Beta'});state=await service.load(id);assert.equal(state.teams.every(team=>!team.teamReady),true);
    await service.change(id,users[1],'leave');state=await service.load(id);assert.equal(state.teams[1].lead,null);assert.equal(state.teams[1].teamReady,false);
    await rejected(service.change(id,users[1],'team-ready',{teamId:'Beta',ready:true}),403);
    await rejected(service.view(id,users[1]),403);
    await service.change(id,users[0],'lead',{teamId:'Beta',userId:users[2]});
    await service.change(id,users[2],'ready',{ready:true});await service.change(id,users[2],'team-ready',{teamId:'Beta',ready:true});
    await service.change(id,users[2],'policy',{teamId:'Beta',policy:'APPROVAL_REQUIRED'});assert.equal((await service.load(id)).teams[1].teamReady,false);
  });
  await t.test('additional personally unready members do not block lead-only start; withdrawal and membership still invalidate',async()=>{
    const {room,id}=await create(4);await service.join(users[1],room.code,'Beta');await service.join(users[2],room.code,'Alpha');await confirm(id);
    let state=await service.view(id,users[0]);assert.equal(state.canStart,true);assert.equal(state.teams.flatMap(team=>team.members).every(member=>!member.ready),true);
    await rejected(service.change(id,users[0],'team-ready',{teamId:'Beta',ready:true}),403);
    await service.change(id,users[1],'team-ready',{teamId:'Beta',ready:false});assert.equal((await service.view(id,users[0])).canStart,false);
    await service.change(id,users[1],'team-ready',{teamId:'Beta',ready:true});await service.join(users[3],room.code,'Alpha');state=await service.view(id,users[0]);assert.equal(state.teams[0].teamReady,false);
    await service.change(id,users[0],'team-ready',{teamId:'Alpha',ready:true});await service.change(id,users[0],'start');assert.equal((await service.load(id)).status,'in_progress');
  });
  await t.test('approval requests remain outsiders, own-team lead decides, rejected decisions retained',async()=>{
    const {room,id}=await pair();await service.change(id,users[0],'policy',{teamId:'Beta',policy:'APPROVAL_REQUIRED'});
    const pending=await service.join(users[2],room.code,'Beta');assert.equal(pending.pending,true);
    await rejected(service.view(id,users[2]),403);await rejected(service.change(id,users[2],'ready',{ready:true}),403);
    const preview=await service.preview(users[2],room.code);assert.equal(preview.request.status,'pending');assert.equal(preview.teams[1].occupied,1);assert.equal(preview.problems,undefined);assert.equal(preview.teams[1].members,undefined);
    await rejected(service.join(users[2],room.code,'Alpha'),409);
    await service.change(id,users[0],'lead',{teamId:'Alpha',userId:users[0]});
    // Alpha lead who is not the host cannot decide Beta admission.
    await service.join(users[3],room.code,'Alpha');await service.change(id,users[0],'lead',{teamId:'Alpha',userId:users[3]});
    await rejected(service.change(id,users[3],'admission',{requestId:pending.requestId,decision:'approved'}),403);
    assert.equal((await service.view(id,users[3])).admissions.length,0);
    await service.change(id,users[1],'admission',{requestId:pending.requestId,decision:'approved'});
    const admitted=await service.load(id);assert.equal(admitted.teams[1].members.length,2);assert.equal(admitted.teams[1].teamReady,false);
    assert.equal(String(admitted.admissions[0].decidedBy),users[1]);assert.ok(admitted.admissions[0].decidedAt);
    await rejected(service.change(id,users[1],'admission',{requestId:pending.requestId,decision:'approved'}),409);
    const another=await service.join(users[4],room.code,'Beta');await service.change(id,users[0],'admission',{requestId:another.requestId,decision:'rejected'});
    assert.equal((await service.preview(users[4],room.code)).request.status,'rejected');await rejected(service.view(id,users[4]),403);
  });
  await t.test('two concurrent admission requests to different teams produce one pending request',async()=>{
    const {room,id}=await pair();for(const team of ['Alpha','Beta'])await service.change(id,users[0],'policy',{teamId:team,policy:'APPROVAL_REQUIRED'});
    const results=await Promise.allSettled(['Alpha','Beta'].map(team=>service.join(users[2],room.code,team)));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal((await service.load(id)).admissions.filter(r=>r.status==='pending').length,1);
  });
  await t.test('concurrent host/lead approvals are single-use and final-slot approvals respect capacity',async()=>{
    const {room,id}=await create(2);await service.join(users[1],room.code,'Beta');await service.change(id,users[0],'lead',{teamId:'Beta',userId:users[1]});await service.change(id,users[0],'policy',{teamId:'Beta',policy:'APPROVAL_REQUIRED'});
    const first=await service.join(users[2],room.code,'Beta'),second=await service.join(users[3],room.code,'Beta');
    const results=await Promise.allSettled([users[0],users[1]].map(user=>service.change(id,user,'admission',{requestId:first.requestId,decision:'approved'})));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    await rejected(service.change(id,users[1],'admission',{requestId:second.requestId,decision:'approved'}),409);
    assert.equal((await service.load(id)).teams[1].members.length,2);
  });
  await t.test('join versus Team Ready serializes membership and a valid lead confirmation',async()=>{
    const {room,id}=await pair();await service.change(id,users[0],'team-ready',{teamId:'Alpha',ready:false});
    await Promise.allSettled([service.join(users[2],room.code,'Alpha'),service.change(id,users[0],'team-ready',{teamId:'Alpha',ready:true})]);
    const state=await service.load(id);assert.equal(state.teams[0].members.length,2);assert.equal(typeof state.teams[0].teamReady,'boolean');
  });
  await t.test('personal unready does not block a confirmed start',async()=>{
    const {id}=await pair();const results=await Promise.allSettled([service.change(id,users[1],'ready',{ready:false}),service.change(id,users[0],'start')]);
    const state=await service.load(id);
    assert.equal(state.status,'in_progress');assert.equal(results[1].status,'fulfilled');assert.equal(state.teams[1].teamReady,true);
  });
  await t.test('configuration versus confirmations and concurrent configurations keep valid atomic snapshots',async()=>{
    const {id}=await pair();await service.change(id,users[0],'team-ready',{teamId:'Alpha',ready:false});
    await Promise.all([service.change(id,users[0],'configure',{duration:20}),service.change(id,users[0],'team-ready',{teamId:'Alpha',ready:true})]);
    let state=await service.load(id);assert.equal(state.duration,20);assert.equal(state.teams[1].teamReady,false);
    await confirm(id);await Promise.all([service.change(id,users[0],'configure',{duration:21}),service.change(id,users[0],'configure',{duration:22})]);
    state=await service.load(id);assert.ok([21,22].includes(state.duration));assert.equal(state.teams.every(team=>!team.teamReady),true);
  });
  await t.test('start expires pending requests and late approvals cannot alter the frozen roster',async()=>{
    const {room,id}=await pair();await service.change(id,users[0],'policy',{teamId:'Beta',policy:'APPROVAL_REQUIRED'});
    const pending=await service.join(users[2],room.code,'Beta');await confirm(id);await service.change(id,users[0],'start');
    await rejected(service.change(id,users[1],'admission',{requestId:pending.requestId,decision:'approved'}),409);
    const state=await service.load(id);assert.equal(state.admissions[0].status,'expired');assert.equal(state.teams[1].members.length,1);
    await rejected(service.join(users[3],room.code,'Alpha'),409);
    const cancelled=await create();await service.change(cancelled.id,users[0],'policy',{teamId:'Beta',policy:'APPROVAL_REQUIRED'});await service.join(users[2],cancelled.room.code,'Beta');await service.change(cancelled.id,users[0],'cancel');assert.equal((await service.load(cancelled.id)).admissions[0].status,'expired');
  });
  await t.test('random/manual selection eligibility, distinctness, difficulty and pre-start secrecy',async()=>{
    const Problem=require('../src/models/Problem'),TestCase=require('../src/models/TestCase');
    const records=[problem];
    for(const [index,difficulty] of ['easy','medium','hard'].entries()){
      const record=await Problem.create({...problem.toObject(),_id:new mongoose.Types.ObjectId(),problemNumber:Date.now()+10+index,title:`Selection ${difficulty} ${Date.now()}`,difficulty});
      await TestCase.create({problem:record._id,input:'21',expectedOutput:'42',createdBy:users[0]});records.push(record);
    }
    const selection=require('../src/services/roomProblemSelection');const availability=await selection.availability();assert.equal(availability.total,4);
    const mixed={...config(4),problemCount:4,difficulties:['easy','medium','easy','hard']};
    const room=await service.create(users[0],mixed),id=String(room._id);assert.equal(new Set(room.problems.map(String)).size,4);
    assert.deepEqual(room.problems.map(id=>records.find(record=>String(record._id)===String(id)).difficulty),mixed.difficulties);
    assert.equal((await service.view(id,users[0])).problems.length,0);
    await service.join(users[1],room.code,'Beta');assert.equal((await service.view(id,users[1])).problems.length,0);
    await rejected(service.selectedProblem(id,users[0],String(problem._id)),409);
    const original=room.problems.map(String);await service.view(id,users[0]);await service.view(id,users[1]);assert.deepEqual((await service.load(id)).problems.map(String),original);
    await rejected(service.create(users[0],{...config(),selectionMode:'MANUAL_SELECTION',problems:[String(problem._id)]}),400);
    await rejected(service.create(users[0],{...config(),problems:[String(problem._id)]}),400);
    await rejected(service.create(users[0],{...config(),problemCount:2,difficulties:['hard','hard']}),400);
    await rejected(service.create(users[0],{...config(),problemCount:5,difficulties:Array(5).fill('easy')}),400);
    await rejected(service.create(users[0],{...config(),difficulties:['unknown']}),400);
    const manual={...config(2,'EXTERNAL_HOST'),problemCount:2,problems:[String(records[3]._id),String(records[0]._id)]};
    const explicit=await service.create(users[0],manual);assert.deepEqual((await service.view(String(explicit._id),users[0])).problems.map(p=>String(p._id)),manual.problems);
    await rejected(service.create(users[0],{...manual,problems:[manual.problems[0],manual.problems[0]]}),400);
    await rejected(service.create(users[0],{...manual,problems:[manual.problems[0],String(new mongoose.Types.ObjectId())]}),400);
    const external=await service.create(users[0],{...config(2,'EXTERNAL_HOST'),selectionMode:'RANDOM_DISTRIBUTION',problems:[],difficulties:['easy']});assert.equal((await service.view(String(external._id),users[0])).problems.length,0);
    for(const user of users.slice(0,2))await service.change(id,user,'ready',{ready:true});await confirm(id);await service.change(id,users[0],'start');
    assert.deepEqual((await service.load(id)).problems.map(String),original);await rejected(service.change(id,users[0],'configure',mixed),409);
  });
  await t.test('room Run uses public tests; hidden-only tests and private judge results never disclose test data',async()=>{
    const Problem=require('../src/models/Problem'),TestCase=require('../src/models/TestCase'),Submission=require('../src/models/Submission');
    const {id}=await pair();await service.change(id,users[0],'start');
    const code='class Solution { public: int doubleIt(int n) { return n*2; } };';
    const chosen=String((await service.load(id)).problems[0]);
    const shared=require('../src/services/collaborativeDocument.service'),started=await service.load(id),document=await shared.store.get(shared.identity(id,started.teams[0]._id,chosen),'');document.doc.getText('source').insert(0,code);const snapshot=await shared.store.flush(document);
    const run=await request('/submissions/run',{roomId:id,problem:chosen,language:'cpp',code,collaborative:true,sourceHash:snapshot.hash});assert.equal(run.status,200);assert.equal((await run.json()).data.status,'accepted');
    const hidden=await Problem.create({...problem.toObject(),_id:new mongoose.Types.ObjectId(),problemNumber:Date.now()+100,title:`Hidden ${Date.now()}`});await TestCase.create({problem:hidden._id,input:'87654321',expectedOutput:'175308642',isHidden:true,createdBy:users[0]});
    const room=await service.create(users[3],{...config(1,'EXTERNAL_HOST'),problems:[String(hidden._id)]}),roomId=String(room._id);
    await service.join(users[0],room.code,'Alpha');await service.join(users[1],room.code,'Beta');for(const user of users.slice(0,2))await service.change(roomId,user,'ready',{ready:true});await confirm(roomId);await service.change(roomId,users[3],'start');
    const hiddenDocument=await shared.store.get(shared.identity(roomId,room.teams[0]._id,hidden._id),'');hiddenDocument.doc.getText('source').insert(0,code);let hiddenSnapshot=await shared.store.flush(hiddenDocument);
    const denied=await request('/submissions/run',{roomId,problem:String(hidden._id),language:'cpp',code,collaborative:true,sourceHash:hiddenSnapshot.hash});assert.equal(denied.status,409);assert.doesNotMatch(JSON.stringify(await denied.json()),/87654321|175308642/);
    hiddenDocument.doc.getText('source').delete(0,hiddenDocument.doc.getText('source').length);hiddenDocument.doc.getText('source').insert(0,'class Solution { public: int doubleIt(int n) { return 0; } };');hiddenSnapshot=await shared.store.flush(hiddenDocument);
    const saved=await require('../src/services/submission.service').createSubmission({roomId,problem:String(hidden._id),language:'cpp',collaborative:true,sourceHash:hiddenSnapshot.hash,idempotencyKey:require('node:crypto').randomUUID()},users[0]);
    await until(async()=>{const state=await Submission.findById(saved._id);return state.status==='wrong_answer';});
    const result=await request(`/submissions/${saved._id}`);assert.equal(result.status,200);const body=await result.json();assert.doesNotMatch(JSON.stringify(body),/87654321|175308642/);assert.match(body.data.error,/hidden test/);
    const judge=await require('../src/services/judge.service').judgeSubmission(saved._id,users[0]);assert.doesNotMatch(JSON.stringify(judge),/87654321|175308642/);
    await rejected(service.selectedProblem(roomId,users[3],String(hidden._id),true),403);
    await Room.updateOne({_id:roomId},{$set:{endTime:new Date(Date.now()-1)}});const ended=await request('/submissions/run',{roomId,problem:String(hidden._id),language:'cpp',code});assert.equal(ended.status,403);
  });
};
