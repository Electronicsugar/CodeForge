const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const path=require('node:path');
const stub=(name,exports)=>{const id=require.resolve(path.join('../src',name));require.cache[id]={id,filename:id,loaded:true,exports};};
let room,notifications;
stub('models/BattleRoom.js',{findOneAndUpdate:(query,update)=>({lean:async()=>{
  if(room.revision!==query.revision||room.status!=='in_progress'||+new Date(room.endTime)<=+query.endTime.$gt)return null;
  for(const [key,value] of Object.entries(update.$set)){let target=room;const parts=key.split('.');for(const part of parts.slice(0,-1))target=target[part];target[parts.at(-1)]=structuredClone(value);}
  room.revision++;return structuredClone(room);
}})});
stub('services/battleRoom.service.js',{
 load:async()=>structuredClone(room),expire:async value=>value,
 membership:(value,user)=>{const team=value.teams.find(team=>team.members.some(member=>member.user===user));return {team,member:team?.members.find(member=>member.user===user)};},
 notify:async(_room,event)=>notifications.push(event)
});
const service=require('../src/services/roomIntegrity.service');
function setup(size=1){notifications=[];room={_id:'room',revision:0,status:'in_progress',endTime:new Date(Date.now()+600000),teams:[{_id:'alpha',members:[{user:'a'},...(size>1?[{user:'teammate'}]:[])]},{_id:'beta',members:[{user:'b'}]}]};}
const event=(type='paste',meta={length:100})=>({roomId:'room',eventId:randomUUID(),type,meta});
test('room warnings persist and UUID retries never count twice',async()=>{setup();const data=event();const one=await service.record('a',data);assert.equal(one.strikes,1);assert.equal(one.message,'A large paste was detected.');const replay=await service.record('a',data);assert.equal(replay.replayed,true);assert.equal(replay.strikes,1);assert.equal(room.revision,1);});
test('copy and small paste are recorded without strikes',async()=>{setup();await service.record('a',event('copy'));await service.record('a',event('paste',{length:10}));assert.equal(room.teams[0].members[0].integrityState.strikes,0);});
test('third strike atomically forfeits the whole team and preserves its roster',async t=>{setup(2);let now=Date.now();t.mock.method(Date,'now',()=>now);for(let i=0;i<3;i++){await service.record('a',event());now+=3000;}assert.equal(room.status,'completed');assert.equal(+new Date(room.endTime),+new Date(room.completedAt));assert.equal(room.winnerTeam,'beta');assert.equal(room.forfeitedTeam,'alpha');assert.equal(room.teams[0].members.length,2);assert.equal(notifications.filter(event=>event==='integrity_forfeit').length,1);assert.equal((await service.record('a',event())).ignored,true);});
test('simultaneous duplicate delivery uses CAS and increments only once',async()=>{setup();const data=event();await Promise.all([service.record('a',data),service.record('a',data)]);assert.equal(room.teams[0].members[0].integrityState.strikes,1);});
test('outsiders, source text and forged identity fields are rejected',async()=>{setup();await assert.rejects(service.record('outsider',event()),error=>error.status===403);await assert.rejects(service.record('a',{...event(),userId:'b'}),error=>error.status===400);await assert.rejects(service.record('a',event('paste',{clipboard:'private'})),error=>error.status===400);});
test('lobby and completed events never award penalties',async()=>{setup();room.status='waiting';assert.equal((await service.record('a',event())).ignored,true);assert.equal(room.revision,0);});
test('monitor configuration issues warnings without forfeiting the room',async t=>{setup();const previous=process.env.ANTICHEAT_MODE;process.env.ANTICHEAT_MODE='monitor';let now=Date.now();t.mock.method(Date,'now',()=>now);try{for(let i=0;i<4;i++){await service.record('a',event());now+=3000;}assert.equal(room.status,'in_progress');assert.equal(service.summary(room.teams[0].members[0].integrityState).maxStrikes,0);}finally{if(previous===undefined)delete process.env.ANTICHEAT_MODE;else process.env.ANTICHEAT_MODE=previous;}});
