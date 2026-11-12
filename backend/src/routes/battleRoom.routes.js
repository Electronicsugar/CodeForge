const router=require('express').Router();
const rateLimit=require('express-rate-limit');
const service=require('../services/battleRoom.service');
const Room=require('../models/BattleRoom');
const {authMiddleware}=require('../middlewares/auth.middleware');
router.use(authMiddleware);
const attemptLimit=rateLimit({windowMs:60000,max:60,standardHeaders:true,legacyHeaders:false});
const handle=action=>async(req,res)=>{try{res.json({success:true,data:await action(req)});}catch(error){res.status(error.status||500).json({success:false,message:error.status?error.message:'Room operation temporarily unavailable'});}};
router.get('/limits',handle(()=>service.limits));
router.get('/',handle(async req=>{
  const rooms=await Room.find({$or:[{host:req.user.id},{'teams.members.user':req.user.id}]}).sort({updatedAt:-1}).limit(20).select('_id code status teamSize hostType updatedAt').lean();
  return rooms;
}));
router.post('/',attemptLimit,handle(async req=>{const room=await service.create(req.user.id,req.body);return service.view(room._id.toString(),req.user.id);}));
router.post('/join',attemptLimit,handle(async req=>{const room=await service.join(req.user.id,req.body.code,req.body.teamId);return service.view(room._id.toString(),req.user.id);}));
router.get('/:roomId',handle(req=>service.view(req.params.roomId,req.user.id)));
router.get('/:roomId/problems/:problemId',handle(async req=>(await service.selectedProblem(req.params.roomId,req.user.id,req.params.problemId)).problem));
for(const operation of ['configure','team','ready','reset-ready','start','cancel','leave']){
  router.post(`/:roomId/${operation}`,attemptLimit,handle(async req=>{
    const room=await service.change(req.params.roomId,req.user.id,operation,req.body);
    return operation==='leave'?{left:true}:service.view(room._id.toString(),req.user.id);
  }));
}
module.exports=router;
