const rateLimit=require('express-rate-limit');
const {policy,makeLimiter}=require('./rateLimitPolicy');
const active=policy();
const auth=makeLimiter('authentication',{max:10,windowMs:900000},'auth');
const authBurst=active.development?rateLimit({
  windowMs:active.auth.windowMs,max:Math.max(600,active.auth.max*8),standardHeaders:true,legacyHeaders:false,
  handler:(req,res)=>{const retryAfterSeconds=Math.max(1,Math.ceil((new Date(req.rateLimit.resetTime)-Date.now())/1000));res.set('Retry-After',String(retryAfterSeconds)).status(429).json({success:false,operation:'authentication IP burst',retryAfterSeconds,message:`Too many authentication requests from this network. Try again in ${retryAfterSeconds} seconds.`});},
}):null;
module.exports={
  authLimiter:active.development?[authBurst,auth]:auth,
  submissionLimiter:makeLimiter('submission',{max:5,windowMs:60000},'submission'),
};
