const router=require('express').Router();
const {policy,makeLimiter}=require('../middlewares/rateLimitPolicy');
const service=require('../services/battleRoom.service');
const Room=require('../models/BattleRoom');
const {authMiddleware}=require('../middlewares/auth.middleware');
router.use(authMiddleware);
const attemptLimit=makeLimiter('room action',{windowMs:60000,max:60},'room');
const limit=operation=>policy().development?makeLimiter(operation,{windowMs:60000,max:60},'room'):attemptLimit;
const handle=action=>async(req,res)=>{try{res.json({success:true,data:await action(req)});}catch(error){res.status(error.status||500).json({success:false,message:error.status?error.message:'Room operation temporarily unavailable'});}};
const metricLimit=require('express-rate-limit')({windowMs:60000,limit:120,keyGenerator:req=>req.user.id,standardHeaders:true,legacyHeaders:false,handler:(req,res)=>{const retryAfterSeconds=Math.max(1,Math.ceil((+req.rateLimit.resetTime-Date.now())/1000));res.set('Retry-After',String(retryAfterSeconds)).status(429).json({success:false,operation:'behaviour metrics',retryAfterSeconds,message:`Too many analytics batches. Retry in ${retryAfterSeconds} seconds.`});}});
router.post('/:roomId/behaviour',metricLimit,handle(req=>require('../services/behaviour.service').ingest(req.params.roomId,req.user.id,req.body.windows)));
router.get('/:roomId/behaviour/me',handle(req=>require('../services/behaviour.service').profile(req.params.roomId,req.user.id)));
router.get('/limits',handle(async()=>({...service.limits,availability:await require('../services/roomProblemSelection').availability(),rateLimits:policy()})));
router.get('/',handle(async req=>{
  const rooms=await Room.find({$or:[{host:req.user.id},{'teams.members.user':req.user.id},{'admissions.user':req.user.id}]}).sort({updatedAt:-1}).limit(20).select('_id code status teamSize hostType host teams updatedAt').lean();
  return rooms.map(room=>({_id:room._id,code:room.code,status:room.status,teamSize:room.teamSize,hostType:room.hostType,updatedAt:room.updatedAt,team:room.teams.find(team=>team.members.some(m=>String(m.user)===req.user.id))?.name||null,isHost:String(room.host)===req.user.id}));
}));
router.post('/',limit('room creation'),handle(async req=>{const room=await service.create(req.user.id,req.body);return service.view(room._id.toString(),req.user.id);}));
router.post('/preview',limit('room preview'),handle(req=>service.preview(req.user.id,req.body.code)));
router.post('/join',limit('room joining'),handle(async req=>{const room=await service.join(req.user.id,req.body.code,req.body.teamId);return room.pending?room:service.view(room._id.toString(),req.user.id);}));
router.get('/:roomId',handle(req=>service.view(req.params.roomId,req.user.id)));
router.get('/:roomId/problems/:problemId',handle(async req=>(await service.selectedProblem(req.params.roomId,req.user.id,req.params.problemId)).problem));
for(const operation of ['configure','team','ready','reset-ready','start','cancel','leave','lead','policy','team-ready','admission']){
  router.post(`/:roomId/${operation}`,limit(`room ${operation}`),handle(async req=>{
    const room=await service.change(req.params.roomId,req.user.id,operation,req.body);
    return operation==='leave'?{left:true}:service.view(room._id.toString(),req.user.id);
  }));
}
module.exports=router;
