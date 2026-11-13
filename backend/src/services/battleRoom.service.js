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
function startReasons(room){
  const reasons=[];
  for(const team of room.teams){
    if(!team.members.length)reasons.push(`${team.name} has no competitors`);
    if(room.teamSize===1){if(team.members.length!==1||!team.members[0].ready||!team.teamReady)reasons.push(`${team.name} competitor has not marked Ready`);continue;}
    if(!team.lead||!team.members.some(member=>id(member.user)===id(team.lead)))reasons.push(`${team.name} has no assigned lead`);
    if(!team.teamReady)reasons.push(`${team.name} lead has not confirmed Team Ready`);
  }
  if(!room.problems.length||room.problems.length!==room.problemCount)reasons.push('Problem configuration is invalid');
  return reasons;
}
function ready(room){return startReasons(room).length===0;}
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
async function load(roomId){validId(roomId);const room=await Room.findById(roomId).lean();if(!room)throw fail(404,'Room not found');room.admissions||=[];for(const team of room.teams){team.admissionPolicy||='OPEN';team.teamReady??=false;if(room.teamSize===1)team.teamReady=team.members.length===1&&team.members[0].ready;}return room;}
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
    if(updated){await notify(updated,'battle_completed');return load(id(updated));}
    return load(id(room));
  }return room;
}
// Every membership/config/readiness/start mutation is a single-document CAS.
// Retrying reevaluates permissions and capacity against the newly committed state.
async function mutate(roomId,userId,action,event){
  for(let attempt=0;attempt<8;attempt++){
    const room=await expire(await load(roomId));requireMember(room,userId);
    const expected=room.revision;await action(room);if(room.teamSize===1)room.teams.forEach(team=>{team.teamReady=team.members.length===1&&team.members[0].ready;});
    if(beforeStart(room))room.status=ready(room)?'ready':'waiting';
    const fields={teams:room.teams,admissions:room.admissions,selectionMode:room.selectionMode,difficulties:room.difficulties,problems:room.problems,problemCount:room.problemCount,duration:room.duration,status:room.status,startTime:room.startTime,endTime:room.endTime,cancelledAt:room.cancelledAt};
    const updated=await Room.findOneAndUpdate({_id:roomId,revision:expected},{$set:fields,$inc:{revision:1}},{returnDocument:'after',runValidators:true}).lean();
    if(updated){await notify(updated,event);return updated;}
  }throw fail(409,'Room changed concurrently. Refresh and try again');
}
async function create(userId,config){
  if(![1,2,3,4].includes(config.teamSize))throw fail(400,'Team size must be 1, 2, 3 or 4');
  if(!['PARTICIPANT_HOST','EXTERNAL_HOST'].includes(config.hostType))throw fail(400,'Choose a valid host type');
  if(config.hostType==='PARTICIPANT_HOST'&&!['Alpha','Beta'].includes(config.hostTeam))throw fail(400,'Participant host must choose Alpha or Beta');
  if(!Number.isInteger(config.problemCount)||config.problemCount<1||config.problemCount>limits.maxProblems)throw fail(400,'Invalid question count');
  const selected=await require('./roomProblemSelection').select(config,config.hostType);
  await validateConfiguration({...config,...selected});
  for(const policy of Object.values(config.admissionPolicies||{}))if(!['OPEN','APPROVAL_REQUIRED'].includes(policy))throw fail(400,'Invalid admission policy');
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for(let attempt=0;attempt<5;attempt++){
    const code=Array.from({length:8},()=>alphabet[randomInt(alphabet.length)]).join('');
    try{
      const room=(await Room.create({host:userId,hostType:config.hostType,teamSize:config.teamSize,duration:config.duration,problemCount:config.problemCount,...selected,code,
        teams:['Alpha','Beta'].map(name=>({name,admissionPolicy:config.admissionPolicies?.[name]||'OPEN',members:config.hostType==='PARTICIPANT_HOST'&&config.hostTeam===name?[{user:userId}]:[]}))})).toObject();
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
    if(room.admissions.some(request=>id(request.user)===id(userId)&&request.status==='pending'))throw fail(409,'You already have a pending admission request');
    const approval=team.admissionPolicy==='APPROVAL_REQUIRED';
    if(approval){
      if(room.admissions.length>=1000||room.admissions.filter(r=>r.status==='pending').length>=100)throw fail(409,'Room admission request limit reached');
      room.admissions.push({_id:new mongoose.Types.ObjectId(),user:userId,teamId:team._id,createdAt:new Date(),status:'pending'});
    }else {team.members.push({user:userId,ready:false,joinedAt:new Date()});team.teamReady=false;}
    const updated=await Room.findOneAndUpdate({_id:room._id,revision:room.revision,status:{$in:['waiting','ready']}},{$set:{teams:room.teams,admissions:room.admissions,status:ready(room)?'ready':'waiting'},$inc:{revision:1}},{returnDocument:'after',runValidators:true}).lean();
    if(updated){await notify(updated,approval?'admission_requested':'participant_joined');return approval?{pending:true,code:room.code,requestId:id(room.admissions.at(-1)),team:team.name,status:'pending'}:updated;}
  }throw fail(409,'Room changed concurrently. Try joining again');
}
async function change(roomId,userId,operation,data={}){
  return mutate(roomId,userId,async room=>{
    const access=membership(room,userId);
    if(operation==='configure'){
      requireHost(room,userId);
      const selectionChanged=['selectionMode','problemCount','problems','difficulties'].some(key=>Object.hasOwn(data,key));
      const config={duration:data.duration??room.duration,problemCount:data.problemCount??room.problemCount};
      if(selectionChanged){
        const selected=await require('./roomProblemSelection').select({...config,selectionMode:data.selectionMode||room.selectionMode,difficulties:data.difficulties||room.difficulties,problems:data.problems},room.hostType);Object.assign(config,selected);
      }else config.problems=room.problems;
      await validateConfiguration(config);Object.assign(room,config);room.teams.forEach(team=>{team.teamReady=false;if(room.teamSize===1)team.members.forEach(member=>{member.ready=false;});});
    }else if(['lead','policy','team-ready','admission'].includes(operation)){
      if(!beforeStart(room))throw fail(409,'Team management is locked after start');
      const request=operation==='admission'?room.admissions.find(request=>id(request)===data.requestId):null;
      const team=room.teams.find(team=>id(team)===(request?id(request.teamId):data.teamId)||team.name===data.teamId);
      if(!team)throw fail(400,'Invalid team or admission request');
      const lead=id(team.lead)===id(userId);
      if(operation==='lead'){
        requireHost(room,userId);if(!team.members.some(member=>id(member.user)===data.userId))throw fail(400,'Team lead must belong to that team');
        team.lead=data.userId;team.teamReady=false;
      }else if(operation==='policy'){
        if(!access.host&&!lead)throw fail(403,'Only this team lead or the host may change its policy');
        if(!['OPEN','APPROVAL_REQUIRED'].includes(data.policy))throw fail(400,'Invalid admission policy');team.admissionPolicy=data.policy;team.teamReady=false;if(room.teamSize===1)team.members.forEach(member=>{member.ready=false;});
      }else if(operation==='team-ready'){
        if(room.teamSize===1){if(!access.member||id(access.team)!==id(team))throw fail(403,'Only this competitor may mark Ready');}else if(!lead)throw fail(403,'Only this team lead may confirm Team Ready');
        if(typeof data.ready!=='boolean')throw fail(400,'Ready must be a boolean');
        if(data.ready&&!team.members.length)throw fail(409,'A team needs at least one admitted competitor');
        team.teamReady=data.ready;if(room.teamSize===1)team.members[0].ready=data.ready;
      }else {
        if(!access.host&&!lead)throw fail(403,'Only this team lead or the host may decide admission');
        if(request.status!=='pending')throw fail(409,'Request was already decided or expired');
        if(!['approved','rejected'].includes(data.decision))throw fail(400,'Choose approved or rejected');
        if(data.decision==='approved'){
          if(team.members.length>=room.teamSize)throw fail(409,'Team is full');
          if(membership(room,request.user).member)throw fail(409,'User already belongs to a team');
          if(id(request.user)===id(room.host)&&room.hostType==='EXTERNAL_HOST')throw fail(403,'External hosts cannot compete');
          team.members.push({user:request.user,ready:false,joinedAt:new Date()});team.teamReady=false;
        }
        request.status=data.decision;request.decidedBy=userId;request.decidedAt=new Date();
      }
    }else if(operation==='ready'){
      if(!beforeStart(room))throw fail(409,'Readiness is locked');
      if(!access.member)throw fail(403,'Only a competitor can mark ready');
      if(typeof data.ready!=='boolean')throw fail(400,'Ready must be a boolean');access.member.ready=data.ready;
    }else if(operation==='reset-ready'){
      requireHost(room,userId);room.teams.forEach(team=>{team.teamReady=false;team.members.forEach(member=>{member.ready=false;});});
    }else if(operation==='team'){
      if(!beforeStart(room)||!access.member)throw fail(409,'Only a competitor in a waiting room can change teams');
      const target=room.teams.find(team=>id(team)===data.teamId||team.name===data.teamId);
      if(!target)throw fail(400,'Invalid team');if(id(target)===id(access.team))throw fail(409,'Already on this team');
      if(target.members.length>=room.teamSize)throw fail(409,'Team is full');
      if(target.admissionPolicy==='APPROVAL_REQUIRED')throw fail(409,'Leave your current team and request approval to join this team');
      if(id(access.team.lead)===id(userId))access.team.lead=null;
      access.team.members=access.team.members.filter(member=>id(member.user)!==id(userId));target.members.push({user:userId,ready:false,joinedAt:new Date()});
      access.team.teamReady=false;target.teamReady=false;
    }else if(operation==='leave'){
      if(!beforeStart(room))throw fail(409,'Team membership is locked after start');
      if(access.host)throw fail(409,'The host must cancel the room rather than leave it');
      access.team.members=access.team.members.filter(member=>id(member.user)!==id(userId));access.team.teamReady=false;if(id(access.team.lead)===id(userId))access.team.lead=null;
    }else if(operation==='start'){
      if(room.hostType==='PARTICIPANT_HOST'&&room.selectionMode!=='RANDOM_DISTRIBUTION')throw fail(409,'Save random difficulty configuration before starting this older room');
      requireHost(room,userId);await validateConfiguration(room);
      if(!ready(room))throw fail(409,startReasons(room).join('; '));
      const now=new Date();room.status='in_progress';room.startTime=now;room.endTime=new Date(now.getTime()+room.duration*60000);
      room.admissions.forEach(request=>{if(request.status==='pending'){request.status='expired';request.decidedBy=userId;request.decidedAt=now;}});
    }else if(operation==='cancel'){
      requireHost(room,userId);room.status='cancelled';room.cancelledAt=new Date();
      room.admissions.forEach(request=>{if(request.status==='pending'){request.status='expired';request.decidedBy=userId;request.decidedAt=new Date();}});
    }else throw fail(400,'Unknown room operation');
  },{configure:'host_configuration_updated',ready:'participant_ready',team:'team_selected',leave:'participant_left',start:'battle_started',cancel:'battle_cancelled','reset-ready':'participant_ready_reset',lead:'team_lead_assigned',policy:'admission_policy_changed','team-ready':'team_ready_confirmed',admission:'admission_decided'}[operation]);
}
async function view(roomId,userId){
  const room=await expire(await load(roomId));const access=requireMember(room,userId);
  const users=await require('../models/User').find({_id:{$in:[room.host,...room.teams.flatMap(team=>team.members.map(member=>member.user)),...room.admissions.map(r=>r.user)]}}).select('_id name').lean();
  const names=new Map(users.map(user=>[id(user),user.name]));
  let online=new Set();try{online=new Set((await getIO().in(`battle-room:${room._id}`).fetchSockets()).map(socket=>socket.data?.userId||socket.user?.id));}catch{}
  const visible=(!beforeStart(room))||(access.host&&room.hostType==='EXTERNAL_HOST'&&room.selectionMode==='MANUAL_SELECTION');
  const problems=visible?await Problem.find({_id:{$in:room.problems}}).select('_id title difficulty tags').lean():[];
  const summaries=await Submission.find({battleRoom:room._id}).sort({createdAt:-1}).limit(100).select('_id user teamId problem status createdAt updatedAt').lean();
  const progress=await Submission.aggregate([{$match:{battleRoom:room._id}},{$group:{_id:{teamId:'$teamId',problem:'$problem'},attempts:{$sum:1},accepted:{$sum:{$cond:[{$eq:['$status','accepted']},1,0]}},lastSubmissionAt:{$max:'$createdAt'}}}]);
  const result={...room,host:{_id:id(room.host),name:names.get(id(room.host))||'Host'},problems:visible?room.problems.map(problem=>problems.find(item=>id(item)===id(problem))).filter(Boolean):[],
    teams:room.teams.map(team=>({...team,members:team.members.map(member=>({...member,online:online.has(id(member.user)),user:{_id:id(member.user),name:names.get(id(member.user))||'Participant'}}))})),
    admissions:room.admissions.filter(request=>access.host||id(request.user)===id(userId)||room.teams.some(team=>id(team)===id(request.teamId)&&id(team.lead)===id(userId))).map(request=>({...request,user:{_id:id(request.user),name:names.get(id(request.user))||'Applicant'}})),
    submissions:summaries,progress:progress.map(item=>({teamId:item._id.teamId,problem:item._id.problem,attempts:item.attempts,solved:item.accepted>0,lastSubmissionAt:item.lastSubmissionAt})),serverTime:new Date(),startReasons:startReasons(room),canStart:beforeStart(room)&&ready(room),scoringMode:'deferred',collaborationEnabled:room.editorMode==='collaborative'&&process.env.BATTLE_COLLABORATION!=='false'};
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
async function preview(userId,code){
  if(typeof code!=='string'||!/^[A-Z2-9]{8}$/.test(code.trim().toUpperCase()))throw fail(400,'Enter a valid room code');
  const room=await Room.findOne({code:code.trim().toUpperCase()}).lean();if(!room)throw fail(404,'Room not found');
  const request=(room.admissions||[]).filter(request=>id(request.user)===id(userId)).at(-1);
  const access=membership(room,userId);
  return {roomId:id(room),code:room.code,teamSize:room.teamSize,status:room.status,canEnter:access.host||Boolean(access.member),teams:room.teams.map(team=>({_id:id(team),name:team.name,admissionPolicy:team.admissionPolicy||'OPEN',occupied:team.members.length,capacity:room.teamSize})),request:request?{_id:id(request),teamId:id(request.teamId),status:request.status}:null};
}
module.exports={create,join,change,view,load,expire,requireMember,membership,selectedProblem,validateConfiguration,limits,startReasons,preview,startExpiry,stopExpiry,notify,id};
