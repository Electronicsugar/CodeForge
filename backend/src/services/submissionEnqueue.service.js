const {Queue} = require('bullmq');
const IORedis = require('ioredis');
const Submission = require('../models/Submission');
// Producer failures must be bounded; the existing worker connection remains unchanged.
const connection = new IORedis(process.env.REDIS_URL || 'redis://localhost:6379', {
    maxRetriesPerRequest:1, enableOfflineQueue:false, connectTimeout:2000,
});
connection.on('error',()=>{});
const queue = new Queue('submission-queue',{connection});
const jobId = id => `submission-${id}`;
async function bounded(request) {
    let timer;
    try { return await Promise.race([request,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Queue timeout')),3000);})]); }
    finally {clearTimeout(timer);}
}
async function enqueue(submission) {
    if (submission.status !== 'pending') return submission;
    const id = submission._id.toString();
    try {
        if(connection.status!=='ready')throw new Error('Queue unavailable');
        await bounded(queue.add('judge-submission',{
            submissionId:id,userId:submission.user.toString(),battleId:submission.battle?.toString() || null,
        },{jobId:jobId(id),attempts:3,backoff:{type:'exponential',delay:1000},removeOnComplete:{age:3600},removeOnFail:{age:86400}}));
        await Submission.updateOne({_id:id,status:'pending'},{$set:{enqueueState:'queued',enqueueError:null},$inc:{enqueueAttempts:1}});
        submission.enqueueState='queued';submission.enqueueError=null;
    } catch {
        await Submission.updateOne({_id:id,status:'pending'},{$set:{enqueueState:'enqueue_failed',enqueueError:'Queue unavailable. Automatic recovery is limited to five attempts; contact the maintainer if it persists.',nextEnqueueAt:new Date(Date.now()+15000)},$inc:{enqueueAttempts:1}});
        submission.enqueueState='enqueue_failed';submission.enqueueError='Queue unavailable; recovery pending';
    }
    return submission;
}
let timer, busy=false;
async function reconcile() {
    if(busy || Submission.db.readyState!==1 || connection.status!=='ready')return;
    busy=true;
    try {
        const records=await Submission.find({status:'pending',enqueueState:{$in:['waiting','enqueue_failed']},enqueueAttempts:{$lt:5},$or:[{nextEnqueueAt:{$lte:new Date()}},{nextEnqueueAt:{$exists:false}}]}).limit(20);
        for(const record of records)await enqueue(record);
        // Also repair a crash after enqueueing, or jobs lost by Redis, without rejudging final records.
        const queued=await Submission.find({status:{$in:['pending','running']},enqueueState:'queued',updatedAt:{$lt:new Date(Date.now()-60000)}}).limit(20);
        for(const record of queued) {
            const job=await bounded(queue.getJob(jobId(record._id)));
            if(!job && record.status==='pending')await enqueue(record);
            else if(!job || await job.getState()==='failed')await Submission.updateOne({_id:record._id,status:{$in:['pending','running']}},{$set:{enqueueState:'enqueue_failed',enqueueAttempts:5,enqueueError:'Judging job failed or was lost. Check submission history; this submission was not resubmitted.'}});
        }
    } finally {busy=false;}
}
function start(){if(!timer){timer=setInterval(()=>reconcile().catch(error=>console.error('Submission recovery:',error.message)),15000);timer.unref();}}
async function close(){clearInterval(timer);timer=null;await queue.close();connection.disconnect();}
module.exports={enqueue,reconcile,start,close,jobId};
