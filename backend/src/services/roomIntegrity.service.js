const Room=require('../models/BattleRoom');
const rooms=require('./battleRoom.service');
const policy=require('./integrity/integrity.policy');
const fail=(status,message)=>Object.assign(Error(message),{status});
const config=()=>policy.config();
function summary(state){const cfg=config();return {strikes:state?.strikes||0,maxStrikes:cfg.mode==='enforce'?cfg.forfeitStrikes:0,mode:cfg.mode,pasteMinChars:cfg.pasteMinChars,tabAwayMinMs:cfg.tabAwayMinMs};}
function validate(data){
  if(data&&Object.keys(data).some(key=>!['roomId','eventId','type','meta'].includes(key)))throw fail(400,'Unexpected integrity event field');
  if(!data||typeof data.roomId!=='string'||typeof data.eventId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(data.eventId)||!policy.EVENT_TYPES.includes(data.type))throw fail(400,'Invalid room integrity event');
  if(data.meta!==undefined&&(!data.meta||typeof data.meta!=='object'||Array.isArray(data.meta)||Object.keys(data.meta).some(key=>!['length','awayMs'].includes(key))))throw fail(400,'Only event lengths and durations are accepted');
  if(JSON.stringify(data).length>2048)throw fail(413,'Integrity event is too large');
}
async function record(userId,data){
  validate(data);
  for(let retry=0;retry<16;retry++){
    const room=await rooms.expire(await rooms.load(data.roomId));
    const access=rooms.membership(room,userId);
    if(!access.member)throw fail(403,'Only room competitors may report integrity events');
    const previous=access.member.integrityState||{...policy.newState(),eventIds:[]};
    if(room.status!=='in_progress')return {...summary(previous),ignored:true};
    if(previous.eventIds?.includes(data.eventId))return {...summary(previous),replayed:true};
    const cfg=config(),now=Date.now();
    const result=policy.applyEvent(previous,{type:data.type,meta:data.meta},now,cfg);
    if(result.rejected)throw fail(429,'Integrity event limit reached');
    const state={...result.state,eventIds:[...(previous.eventIds||[]),data.eventId].slice(-256)};
    const ti=room.teams.findIndex(team=>String(team._id)===String(access.team._id));
    const mi=room.teams[ti].members.findIndex(member=>String(member.user)===String(userId));
    const set={[`teams.${ti}.members.${mi}.integrityState`]:state};
    if(result.action==='forfeit'){
      set.status='completed';set.completedAt=new Date(now);set.endTime=new Date(now);set.endReason='integrity_forfeit';
      set.forfeitedTeam=access.team._id;set.winnerTeam=room.teams.find(team=>String(team._id)!==String(access.team._id))._id;
    }
    const updated=await Room.findOneAndUpdate({_id:room._id,revision:room.revision,status:'in_progress',endTime:{$gt:new Date(now)}},{$set:set,$inc:{revision:1}},{returnDocument:'after'}).lean();
    if(!updated)continue;
    await rooms.notify(updated,result.action==='forfeit'?'integrity_forfeit':'integrity_updated');
    return {...summary(state),action:result.action==='warn'?'none':result.action,reason:result.strike?.reason};
  }
  throw fail(409,'Room changed concurrently; retry the same event');
}
module.exports={record,summary,validate};
