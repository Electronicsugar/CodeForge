const {randomInt}=require('node:crypto');
const mongoose=require('mongoose');
const Room=require('../models/BattleRoom');
const Problem=require('../models/Problem');
const TestCase=require('../models/TestCase');
const Submission=require('../models/Submission');
const {generateCode}=require('./executor/code-generator');
const {getIO}=require('../sockets/socketManager');
const fail=(status,message)=>Object.assign(new Error(message),{status});
const id=value=>String(value?._id||value);
const beforeStart=room=>['waiting','ready'].includes(room.status);
const limits={maxProblems:Math.max(1,Math.min(50,Number(process.env.BATTLE_MAX_PROBLEMS)||20)),minDuration:1,maxDuration:Math.max(1,Math.min(1440,Number(process.env.BATTLE_MAX_DURATION_MINUTES)||180))};
function membership(room,userId){
  const team=room.teams.find(team=>team.members.some(member=>id(member.user)===id(userId)));
  return {host:id(room.host)===id(userId),team,member:team?.members.find(member=>id(member.user)===id(userId))};
}
function requireMember(room,userId){const access=membership(room,userId);if(!access.host&&!access.member)throw fail(403,'This private room is only visible to its host and members');return access;}
function requireHost(room,userId){if(id(room.host)!==id(userId))throw fail(403,'Only the room host can do this');if(!beforeStart(room))throw fail(409,'Room configuration is locked after start or cancellation');}
function ready(room){return room.teams.length===2&&room.teams.every(team=>team.members.length===room.teamSize&&team.members.every(member=>member.ready))&&room.problems.length===room.problemCount;}
function validId(value){if(typeof value!=='string'||!mongoose.isValidObjectId(value))throw fail(400,'Invalid room, team or problem ID');}
async function validateConfiguration(config){
  if(!Number.isInteger(config.duration)||config.duration<limits.minDuration||config.duration>limits.maxDuration)throw fail(400,`Duration must be ${limits.minDuration}–${limits.maxDuration} minutes`);
  if(!Number.isInteger(config.problemCount)||config.problemCount<1||config.problemCount>limits.maxProblems)throw fail(400,`Select 1–${limits.maxProblems} problems`);
  if(!Array.isArray(config.problems)||config.problems.length!==config.problemCount||new Set(config.problems.map(id)).size!==config.problemCount)throw fail(400,'Selected problem count must match the unique problem IDs');
  config.problems.forEach(value=>validId(id(value)));
  const problems=await Problem.find({_id:{$in:config.problems}}).lean();
  if(problems.length!==config.problemCount)throw fail(400,'One or more selected problems do not exist');
  for(const problem of problems){
    if(!await TestCase.exists({problem:problem._id}))throw fail(400,`${problem.title} has no judge test cases`);
    try{generateCode(problem,'class Solution {};');}catch{throw fail(400,`${problem.title} is not supported by the C++ judge`);}
  }
}
async function load(roomId){validId(roomId);const room=await Room.findById(roomId).lean();if(!room)throw fail(404,'Room not found');return room;}
async function notify(room,event){
  try{
    const io=getIO();const channel=`battle-room:${room._id}`;
    const sockets=await io.in(channel).fetchSockets();
    for(const socket of sockets){const access=membership(room,socket.data?.userId||socket.user?.id);if(!access.host&&!access.member)socket.leave(channel);}
    io.to(channel).emit('battle_room_updated',{roomId:id(room),revision:room.revision,status:room.status,event});
    if(event==='battle_room_created')io.to(`user:${id(room.host)}`).emit('battle_room_updated',{roomId:id(room),revision:room.revision,status:room.status,event});
  }catch{/* HTTP/test bootstrap may not have a socket server. */}
}
async function expire(room){
  if(room.status==='in_progress'&&new Date(room.endTime)<=new Date()){
    const updated=await Room.findOneAndUpdate({_id:room._id,status:'in_progress',endTime:{$lte:new Date()}},{$set:{status:'completed',completedAt:new Date()},$inc:{revision:1}},{returnDocument:'after'}).lean();
    if(updated){await notify(updated,'battle_completed');return updated;}
    return load(id(room));
  }return room;
}
// Every membership/config/readiness/start mutation is a single-document CAS.
// Retrying reevaluates permissions and capacity against the newly committed state.
async function mutate(roomId,userId,action,event){
  for(let attempt=0;attempt<8;attempt++){
    const room=await expire(await load(roomId));requireMember(room,userId);
    const expected=room.revision;await action(room);
    if(beforeStart(room))room.status=ready(room)?'ready':'waiting';
    const fields={teams:room.teams,problems:room.problems,problemCount:room.problemCount,duration:room.duration,status:room.status,startTime:room.startTime,endTime:room.endTime,cancelledAt:room.cancelledAt};
    const updated=await Room.findOneAndUpdate({_id:roomId,revision:expected},{$set:fields,$inc:{revision:1}},{returnDocument:'after',runValidators:true}).lean();
    if(updated){await notify(updated,event);return updated;}
  }throw fail(409,'Room changed concurrently. Refresh and try again');
}
async function create(userId,config){
  if(![1,2,3,4].includes(config.teamSize))throw fail(400,'Team size must be 1, 2, 3 or 4');
  if(!['PARTICIPANT_HOST','EXTERNAL_HOST'].includes(config.hostType))throw fail(400,'Choose a valid host type');
  if(config.hostType==='PARTICIPANT_HOST'&&!['Alpha','Beta'].includes(config.hostTeam))throw fail(400,'Participant host must choose Alpha or Beta');
  await validateConfiguration(config);
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for(let attempt=0;attempt<5;attempt++){
    const code=Array.from({length:8},()=>alphabet[randomInt(alphabet.length)]).join('');
    try{
      const room=(await Room.create({host:userId,hostType:config.hostType,teamSize:config.teamSize,duration:config.duration,problemCount:config.problemCount,problems:config.problems,code,
        teams:['Alpha','Beta'].map(name=>({name,members:config.hostType==='PARTICIPANT_HOST'&&config.hostTeam===name?[{user:userId}]:[]}))})).toObject();
      await notify(room,'battle_room_created');return room;
    }catch(error){if(error.code!==11000)throw error;}
  }throw fail(503,'Could not allocate a room code. Try again');
}
async function join(userId,code,teamId){
  if(typeof code!=='string'||!/^[A-Z2-9]{8}$/.test(code.toUpperCase().trim()))throw fail(400,'Enter an eight-character room code');
  const initial=await Room.findOne({code:code.toUpperCase().trim()}).lean();if(!initial)throw fail(404,'Room not found');
  // Join is the sole operation permitted by knowledge of a private code alone.
  for(let attempt=0;attempt<8;attempt++){
    const room=await load(id(initial));
    if(!beforeStart(room))throw fail(409,'Teams are locked');
    const access=membership(room,userId);
    if(access.host&&room.hostType==='EXTERNAL_HOST')throw fail(403,'External hosts cannot compete in their own room');
    if(access.member)throw fail(409,'You already occupy a team slot');
    const team=room.teams.find(team=>id(team)===teamId||team.name===teamId);
    if(!team)throw fail(400,'Choose Alpha or Beta');
    if(team.members.length>=room.teamSize)throw fail(409,'Team is full');
    team.members.push({user:userId,ready:false,joinedAt:new Date()});
    const updated=await Room.findOneAndUpdate({_id:room._id,revision:room.revision,status:{$in:['waiting','ready']}},{$set:{teams:room.teams,status:'waiting'},$inc:{revision:1}},{returnDocument:'after',runValidators:true}).lean();
    if(updated){await notify(updated,'participant_joined');return updated;}
  }throw fail(409,'Room changed concurrently. Try joining again');
}
async function change(roomId,userId,operation,data={}){
  return mutate(roomId,userId,async room=>{
    const access=membership(room,userId);
    if(operation==='configure'){
      requireHost(room,userId);const config={duration:data.duration??room.duration,problemCount:data.problemCount??room.problemCount,problems:data.problems??room.problems};
      await validateConfiguration(config);Object.assign(room,config);room.teams.forEach(team=>team.members.forEach(member=>{member.ready=false;}));
    }else if(operation==='ready'){
      if(!beforeStart(room))throw fail(409,'Readiness is locked');
      if(!access.member)throw fail(403,'Only a competitor can mark ready');
      if(typeof data.ready!=='boolean')throw fail(400,'Ready must be a boolean');access.member.ready=data.ready;
    }else if(operation==='reset-ready'){
      requireHost(room,userId);room.teams.forEach(team=>team.members.forEach(member=>{member.ready=false;}));
    }else if(operation==='team'){
      if(!beforeStart(room)||!access.member)throw fail(409,'Only a competitor in a waiting room can change teams');
      const target=room.teams.find(team=>id(team)===data.teamId||team.name===data.teamId);
      if(!target)throw fail(400,'Invalid team');if(id(target)===id(access.team))throw fail(409,'Already on this team');
      if(target.members.length>=room.teamSize)throw fail(409,'Team is full');
      access.team.members=access.team.members.filter(member=>id(member.user)!==id(userId));target.members.push({user:userId,ready:false,joinedAt:new Date()});
      room.teams.forEach(team=>team.members.forEach(member=>{member.ready=false;}));
    }else if(operation==='leave'){
      if(!beforeStart(room))throw fail(409,'Team membership is locked after start');
      if(access.host)throw fail(409,'The host must cancel the room rather than leave it');
      room.teams.forEach(team=>{team.members=team.members.filter(member=>id(member.user)!==id(userId));team.members.forEach(member=>{member.ready=false;});});
    }else if(operation==='start'){
      requireHost(room,userId);await validateConfiguration(room);
      if(!ready(room))throw fail(409,'Both teams must be full and every competitor must be ready');
      const now=new Date();room.status='in_progress';room.startTime=now;room.endTime=new Date(now.getTime()+room.duration*60000);
    }else if(operation==='cancel'){
      requireHost(room,userId);room.status='cancelled';room.cancelledAt=new Date();
    }else throw fail(400,'Unknown room operation');
  },{configure:'host_configuration_updated',ready:'participant_ready',team:'team_selected',leave:'participant_left',start:'battle_started',cancel:'battle_cancelled','reset-ready':'participant_ready_reset'}[operation]);
}
async function view(roomId,userId){
  const room=await expire(await load(roomId));const access=requireMember(room,userId);
  const users=await require('../models/User').find({_id:{$in:[room.host,...room.teams.flatMap(team=>team.members.map(member=>member.user))]}}).select('_id name').lean();
  const names=new Map(users.map(user=>[id(user),user.name]));
  let online=new Set();try{online=new Set((await getIO().in(`battle-room:${room._id}`).fetchSockets()).map(socket=>socket.data?.userId||socket.user?.id));}catch{}
  const visible=access.host||!beforeStart(room);
  const problems=visible?await Problem.find({_id:{$in:room.problems}}).select('_id title difficulty tags').lean():[];
  const summaries=await Submission.find({battleRoom:room._id}).sort({createdAt:-1}).limit(100).select('_id user teamId problem status createdAt updatedAt').lean();
  const progress=await Submission.aggregate([{$match:{battleRoom:room._id}},{$group:{_id:{teamId:'$teamId',problem:'$problem'},attempts:{$sum:1},accepted:{$sum:{$cond:[{$eq:['$status','accepted']},1,0]}},lastSubmissionAt:{$max:'$createdAt'}}}]);
  const result={...room,host:{_id:id(room.host),name:names.get(id(room.host))||'Host'},problems:visible?room.problems.map(problem=>problems.find(item=>id(item)===id(problem))).filter(Boolean):[],
    teams:room.teams.map(team=>({...team,members:team.members.map(member=>({...member,online:online.has(id(member.user)),user:{_id:id(member.user),name:names.get(id(member.user))||'Participant'}}))})),
    submissions:summaries,progress:progress.map(item=>({teamId:item._id.teamId,problem:item._id.problem,attempts:item.attempts,solved:item.accepted>0,lastSubmissionAt:item.lastSubmissionAt})),serverTime:new Date(),canStart:beforeStart(room)&&ready(room),scoringMode:'deferred'};
  return result;
}
async function selectedProblem(roomId,userId,problemId,forSubmission=false){
  validId(problemId);const room=await expire(await load(roomId));const access=requireMember(room,userId);
  if(beforeStart(room)||room.status==='cancelled')throw fail(409,'Problems unlock when the battle starts');
  if(forSubmission&&(!access.member||room.status!=='in_progress'))throw fail(403,'Only active competitors may submit');
  if(!room.problems.some(problem=>id(problem)===problemId))throw fail(403,'Problem is not selected for this room');
  const problem=await Problem.findById(problemId).lean();if(!problem)throw fail(404,'Selected problem is unavailable');
  return {room,access,problem};
}
let sweep;
function startExpiry(){if(!sweep){sweep=setInterval(async()=>{try{const rooms=await Room.find({status:'in_progress',endTime:{$lte:new Date()}}).limit(100).lean();for(const room of rooms)await expire(room);}catch(error){console.error('Room expiry:',error.message);}},2000);sweep.unref();}}
function stopExpiry(){clearInterval(sweep);sweep=null;}
module.exports={create,join,change,view,load,expire,requireMember,membership,selectedProblem,validateConfiguration,limits,startExpiry,stopExpiry,notify,id};
