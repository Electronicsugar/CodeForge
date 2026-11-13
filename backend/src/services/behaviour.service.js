const Windows=require('../models/BehaviourWindow');
const Actions=require('../models/BehaviourAction');
const Submission=require('../models/Submission');
const rooms=require('./battleRoom.service');
const {identity}=require('./collaborativeDocument.service');
const fields=Windows.metricFields,retentionMs=30*86400000;
const fail=(status,message)=>Object.assign(Error(message),{status});
async function access(roomId,user){const room=await rooms.expire(await rooms.load(roomId)),member=rooms.membership(room,user);if(!member.member)throw fail(403,'Behavioural profiles are private to their participant');return {room,team:member.team};}
function validateWindow(window,room){
  if(!window||Object.keys(window).some(key=>!['problemId','language','sessionId','minute','sequence','metrics','firstEditAt','lastEditAt','firstPasteAt','lastPasteAt'].includes(key)))throw fail(400,'Only aggregate editor metrics are accepted');
  if(window.language!=='cpp'||!room.problems.some(problem=>String(problem)===window.problemId))throw fail(403,'Metrics must belong to a selected room problem');
  if(typeof window.sessionId!=='string'||!/^[a-zA-Z0-9-]{16,80}$/.test(window.sessionId)||!Number.isSafeInteger(window.sequence)||window.sequence<1||window.sequence>1000000)throw fail(400,'Invalid metric window identity');
  const start=+new Date(room.startTime),end=+new Date(room.endTime);
  if(!start||!end||!Number.isSafeInteger(window.minute)||window.minute%60000!==0||window.minute<Math.floor(start/60000)*60000||window.minute>Math.floor(Math.min(Date.now()+10000,end)/60000)*60000)throw fail(400,'Metric window falls outside this battle');
  if(!window.metrics||typeof window.metrics!=='object'||Array.isArray(window.metrics)||Object.keys(window.metrics).some(key=>!fields.includes(key)))throw fail(400,'Invalid metric fields');
  const metrics={};for(const key of fields){const value=window.metrics[key]??0;if(!Number.isSafeInteger(value)||value<0||value>2000000)throw fail(400,'Invalid aggregate metric');metrics[key]=value;}
  for(const key of ['activeMs','keyboardActiveMs','visibleMs'])if(metrics[key]>60000)throw fail(400,'Duration exceeds its one-minute window');
  if(metrics.keyboardChars+metrics.pasteChars>metrics.insertedChars||metrics.largeInsertedChars>metrics.insertedChars||metrics.contributionChars>metrics.insertedChars+metrics.deletedChars||metrics.keyboardEvents+metrics.undoEvents+metrics.redoEvents+metrics.toolEvents+metrics.programmaticEvents>metrics.editEvents)throw fail(400,'Aggregate edit counts are inconsistent');
  const dates={};for(const key of ['firstEditAt','lastEditAt','firstPasteAt','lastPasteAt'])if(window[key]!==undefined&&window[key]!==null){const value=Number(window[key]);if(!Number.isFinite(value)||value<window.minute||value>=window.minute+60000||value<start-5000||value>end+5000)throw fail(400,'Invalid activity timestamp');dates[key]=new Date(Math.min(end,Math.max(start,value)));}
  return {metrics,dates};
}
async function ingest(roomId,user,windows){
  if(!Array.isArray(windows)||windows.length<1||windows.length>24||Buffer.byteLength(JSON.stringify(windows))>48000)throw fail(413,'Send at most 24 bounded aggregate windows');
  const {room,team}=await access(roomId,user);if(!room.endTime||Date.now()>+new Date(room.endTime)+86400000)throw fail(409,'The metrics upload period has ended');
  const prepared=windows.map(window=>({window,...validateWindow(window,room)}));
  for(const {window,metrics,dates} of prepared){
    const key={user,documentKey:identity(room._id,team._id,window.problemId),sessionId:window.sessionId,minute:window.minute};
    let saved=false;
    for(let retry=0;retry<8;retry++){
      const existing=await Windows.findOne(key).lean();if(existing&&existing.sequence>=window.sequence){saved=true;break;}
      if(existing&&fields.some(field=>metrics[field]<(existing.metrics[field]||0)))throw fail(409,'Cumulative metrics cannot decrease');
      if(!existing&&await Windows.countDocuments({room:room._id,user})>=10000)throw fail(429,'Battle analytics storage limit reached');
      try{
        const result=await Windows.findOneAndUpdate({...key,...(existing?{sequence:existing.sequence}:{sequence:{$exists:false}})},{$set:{room:room._id,teamId:team._id,problem:window.problemId,language:'cpp',sequence:window.sequence,metrics,...dates,expiresAt:new Date(+new Date(room.endTime)+retentionMs)}},{upsert:!existing,returnDocument:'after'}).lean();
        if(result){saved=true;break;}
      }catch(error){if(error.code!==11000)throw error;}
    }
    if(!saved)throw fail(409,'Metrics changed concurrently. Retry this aggregate window.');
  }
  return {accepted:windows.length,retentionDays:30};
}
async function recordRun(roomId,user,problem){
  const {room}=await access(roomId,user);const now=new Date();
  if(room.editorMode!=='collaborative')return;
  const query={room:roomId,user,problem},update={$min:{firstRunAt:now},$setOnInsert:{expiresAt:new Date(+new Date(room.endTime)+retentionMs)}};
  try{await Actions.updateOne(query,update,{upsert:true});}catch(error){if(error.code!==11000)throw error;await Actions.updateOne(query,{$min:{firstRunAt:now}});}
}
function total(rows){const metrics=Object.fromEntries(fields.map(key=>[key,0]));for(const row of rows)for(const key of fields)metrics[key]+=row.metrics?.[key]||0;return metrics;}
function summarize(rows){
  const metrics=total(rows),enough=metrics.keyboardEvents>=5&&metrics.keyboardActiveMs>=2000;
  const estimatedCPM=enough?Math.round(metrics.keyboardChars*60000/metrics.keyboardActiveMs):null;
  const first=key=>{const values=rows.map(row=>row[key]&&+new Date(row[key])).filter(Boolean);return values.length?new Date(Math.min(...values)).toISOString():null;};
  return {metrics,estimatedCPM,estimatedWPM:estimatedCPM===null?null:Math.round(estimatedCPM/5),typingData:enough?'estimated':'insufficient',pasteOriginProportion:metrics.keyboardChars+metrics.pasteChars?metrics.pasteChars/(metrics.keyboardChars+metrics.pasteChars):null,cadence:fields.filter(key=>key.startsWith('cadence')).map(key=>metrics[key]),firstEditAt:first('firstEditAt'),firstPasteAt:first('firstPasteAt')};
}
async function profile(roomId,user){
  const {room,team}=await access(roomId,user),now=new Date();
  const rows=await Windows.find({room:room._id,user,expiresAt:{$gt:now}}).sort({minute:1}).limit(10000).lean();
  const participant=await require('../models/User').findById(user).select('_id name').lean();
  const overall=summarize(rows);
  if(!room.startTime)return {participant,team:team.name,roomId,battleDurationMs:room.duration*60000,retentionDays:30,overall,problems:[],timeline:[],contributionEstimate:null};
  const submissions=await Submission.find({battleRoom:room._id,user}).select('problem status createdAt updatedAt acceptedAt').lean();
  const runs=await Actions.find({room:room._id,user,expiresAt:{$gt:now}}).lean();
  const problems=await require('../models/Problem').find({_id:{$in:room.problems}}).select('_id title difficulty').lean();
  const timelineMap=new Map();for(const row of rows){if(!timelineMap.has(row.minute))timelineMap.set(row.minute,[]);timelineMap.get(row.minute).push(row);}
  const timeline=[...timelineMap].map(([minute,items])=>({minute,...summarize(items)}));
  const teamTotal=await Windows.aggregate([{$match:{room:room._id,teamId:team._id,expiresAt:{$gt:now}}},{$group:{_id:null,characters:{$sum:'$metrics.contributionChars'}}}]);
  return {participant,team:team.name,roomId,battleDurationMs:Math.max(0,+new Date(room.endTime)-+new Date(room.startTime)),startTime:room.startTime,endTime:room.endTime,retentionDays:30,overall,timeline,contributionEstimate:teamTotal[0]?.characters?overall.metrics.contributionChars/teamTotal[0].characters:null,
    problems:problems.map(problem=>{const own=rows.filter(row=>String(row.problem)===String(problem._id)),attempts=submissions.filter(sub=>String(sub.problem)===String(problem._id)),accepted=attempts.filter(sub=>sub.status==='accepted');const minimum=(items,field)=>items.length?new Date(Math.min(...items.map(item=>+new Date(item[field])))).toISOString():null;return {...problem,...summarize(own),firstRunAt:runs.find(run=>String(run.problem)===String(problem._id))?.firstRunAt||null,firstSubmissionAt:minimum(attempts,'createdAt'),firstAcceptedAt:minimum(accepted.map(record=>({...record,acceptanceTime:record.acceptedAt||record.updatedAt})),'acceptanceTime'),submissionCount:attempts.length};})};
}
module.exports={ingest,profile,recordRun,summarize,validateWindow,fields};
