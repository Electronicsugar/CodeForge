require('dotenv').config();
const mongoose=require('mongoose');
const Submission=require('../models/Submission');
(async()=>{
  if(!process.env.MONGO_URI)throw Error('MONGO_URI is required');
  await mongoose.connect(process.env.MONGO_URI);
  await Submission.createIndexes();
  const legacy=await Submission.countDocuments({status:{$in:['pending','running']},enqueueState:{$exists:false}});
  console.log(`Resilience indexes ready. ${legacy} legacy unfinished submissions require manual review; no historical records were changed.`);
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>mongoose.disconnect());
