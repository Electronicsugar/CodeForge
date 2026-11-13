const rateLimit=require('express-rate-limit');
const {ipKeyGenerator}=require('express-rate-limit');
function policy(env=process.env){
  const development=env.NODE_ENV==='development'&&env.CODEFORGE_DEV_RATE_LIMITS==='true';
  if(env.NODE_ENV==='development'&&env.CODEFORGE_DEV_RATE_LIMITS&&!['true','false'].includes(env.CODEFORGE_DEV_RATE_LIMITS))throw Error('CODEFORGE_DEV_RATE_LIMITS must be true or false');
  const integer=(key,fallback)=>{if(!development||!env[key])return fallback;const value=Number(env[key]);if(!Number.isInteger(value)||value<1||value>3600000)throw Error(`${key} must be an integer between 1 and 3600000`);return value;};
  return {development,auth:{max:integer('DEV_AUTH_MAX',development?120:10),windowMs:integer('DEV_AUTH_WINDOW_MS',development?60000:900000)},room:{max:integer('DEV_ROOM_MAX',development?300:60),windowMs:integer('DEV_ROOM_WINDOW_MS',60000)},submission:{max:integer('DEV_SUBMISSION_MAX',development?30:5),windowMs:integer('DEV_SUBMISSION_WINDOW_MS',60000)}};
}
function makeLimiter(operation,production,group){
  const active=policy();const settings=active.development?active[group]:production;
  return rateLimit({...settings,standardHeaders:true,legacyHeaders:false,
    keyGenerator:active.development?req=>group==='auth'?`${ipKeyGenerator(req.ip)}:${String(req.body?.email||'unknown').trim().toLowerCase()}`:`${req.user.id}:${operation}`:undefined,
    handler:(req,res)=>{
      const retryAfterSeconds=Math.max(1,Math.ceil((new Date(req.rateLimit.resetTime).getTime()-Date.now())/1000));
      res.set('Retry-After',String(retryAfterSeconds)).status(429).json({success:false,operation,retryAfterSeconds,message:`Too many ${operation} attempts. Try again in ${retryAfterSeconds} seconds.`});
    },
  });
}
module.exports={policy,makeLimiter};
