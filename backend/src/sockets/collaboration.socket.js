const Y=require('yjs');
const jwt=require('jsonwebtoken');
const rooms=require('../services/battleRoom.service');
const {redisClient}=require('../config/redis');
const User=require('../models/User');
const fail=(status,message)=>Object.assign(new Error(message),{status});
const MAX_UPDATE=512*1024;
const binary=value=>{if(!(Buffer.isBuffer(value)||value instanceof Uint8Array))throw fail(400,'A binary Yjs update is required');if(value.byteLength>MAX_UPDATE)throw fail(413,'Document update is too large');return new Uint8Array(value);};

function createCollaboration(io,{authorize,store=require('../services/collaborativeDocument.service').store,enabled=()=>process.env.BATTLE_COLLABORATION!=='false'}={}){
  const documents=store.entries,budgets=new Map();
  const check=authorize||(async(socket,request)=>{
    const claims=jwt.verify(socket.token,process.env.JWT_SECRET);
    if(claims.id!==socket.user.id||!redisClient.isReady||await redisClient.get(`blacklist:${socket.token}`))throw fail(403,'Session verification failed');
    if(request.language!=='cpp')throw fail(400,'Only C++ documents are supported');
    const {room,access,problem}=await rooms.selectedProblem(request.roomId,claims.id,request.problemId,false);
    if(room.editorMode!=='collaborative')throw fail(409,'This older room retains its private drafts. Create a new room for collaborative editing.');
    if(!access.member)throw fail(403,'Only competitors may access shared source');
    const teamId=String(access.team._id);
    if(request.teamId&&request.teamId!==teamId)throw fail(403,'Document belongs to another team');
    const user=await User.findById(claims.id).select('name').lean();
    if(!user)throw fail(403,'Participant unavailable');
    return {key:JSON.stringify([String(room._id),teamId,String(problem._id),'cpp']),userId:claims.id,name:user.name,teamId,starter:problem.starterCode||'',canWrite:room.status==='in_progress',startTime:room.startTime,endTime:room.endTime};
  });
  function budget(socket,size=0){
    const now=Date.now(),key=socket.user.id;let entry=budgets.get(key);
    if(!entry||now-entry.start>=10000){entry={start:now,count:0,bytes:0};budgets.set(key,entry);}
    if(++entry.count>300||(entry.bytes+=size)>2*1024*1024)throw fail(429,'Collaboration limit reached. Wait ten seconds before reconnecting.');
    if(budgets.size>1000)for(const [id,value] of budgets)if(now-value.start>10000)budgets.delete(id);
  }
  async function broadcast(entry,event,payload,except){
    // Recheck recipients as well as senders: revoked or expired sessions must
    // not continue receiving source through an already subscribed socket.
    await Promise.all([...entry.clients].map(async([id,client])=>{
      if(id===except)return;
      try{const access=await check(client.socket,client.request);if(access.key!==entry.key)throw fail(403,'Membership changed');client.socket.emit(event,payload);}catch{detach(client.socket);client.socket.emit('collab_denied',{message:'Document access ended'});}
    }));
  }
  function detach(socket){
    const subscription=socket.data.collaboration;if(!subscription)return;
    delete socket.data.collaboration;const entry=documents.get(subscription.key);
    if(entry){entry.clients.delete(socket.id);socket.leave(`collab:${entry.key}`);void broadcast(entry,'collab_awareness',{key:entry.key,clientId:subscription.clientId,clock:subscription.clock+1,state:null},socket.id);}
  }
  function register(socket){
    let chain=Promise.resolve();
    const handle=(event,fn)=>socket.on(event,(payload,ack)=>{
      chain=chain.then(async()=>{
        try{if(!enabled())throw fail(409,'Collaborative editor foundation is not enabled');budget(socket,payload?.update?.byteLength||0);const result=await fn(payload||{});if(typeof ack==='function')ack({success:true,...result});}
        catch(error){if(typeof ack==='function')ack({success:false,status:error.status||400,message:error.status?error.message:'Invalid collaboration request'});}
      });
    });
    handle('collab_join',async request=>{
      const access=await check(socket,request);
      if(!Number.isSafeInteger(request.clientId)||request.clientId<0||request.clientId>0xffffffff)throw fail(400,'Invalid Yjs client identity');
      const entry=await store.get(access.key,access.starter);
      if([...entry.clients.values()].some(client=>client.socket.id!==socket.id&&client.clientId===request.clientId))throw fail(409,'Yjs client identity is already in use');
      if(entry.clients.size>=16&&!entry.clients.has(socket.id))throw fail(429,'Too many document connections');
      detach(socket);
      const subscription={key:access.key,clientId:request.clientId,clock:0,state:null,request:{roomId:request.roomId,problemId:request.problemId,language:'cpp',teamId:access.teamId},socket,user:{id:access.userId,name:access.name.slice(0,80),color:'#d99053'}};
      socket.data.collaboration=subscription;entry.clients.set(socket.id,subscription);await socket.join(`collab:${access.key}`);
      return {key:access.key,update:Y.encodeStateAsUpdate(entry.doc),canWrite:access.canWrite!==false,serverTime:Date.now(),startTime:access.startTime,endTime:access.endTime,user:subscription.user,presence:[...entry.clients.values()].filter(client=>client.state).map(client=>({key:entry.key,clientId:client.clientId,clock:client.clock,state:client.state}))};
    });
    const subscribed=async request=>{
      const subscription=socket.data.collaboration;if(!subscription||subscription.key!==request.key)throw fail(403,'Subscribe to this document first');
      const access=await check(socket,subscription.request);if(access.key!==subscription.key||socket.data.collaboration!==subscription)throw fail(403,'Membership changed');
      return {subscription,entry:documents.get(subscription.key),access};
    };
    handle('collab_update',async request=>{
      const {entry,access}=await subscribed(request),update=binary(request.update),candidate=new Y.Doc();
      if(access.canWrite===false)throw fail(403,'Battle completed; shared source is read-only');
      try{
        candidate.getText('source');Y.applyUpdate(candidate,Y.encodeStateAsUpdate(entry.doc));Y.applyUpdate(candidate,update);
        require('../services/collaborativeDocument.service').validate(candidate);
        Y.applyUpdate(entry.doc,update);
      }finally{candidate.destroy();}
      const persisted=await store.schedule(entry);
      await broadcast(entry,'collab_update',{key:entry.key,update:Y.encodeStateAsUpdate(entry.doc)},socket.id);return {hash:persisted.hash,revision:persisted.revision};
    });
    handle('collab_awareness',async request=>{
      const {entry,subscription}=await subscribed(request);
      if(!Number.isSafeInteger(request.clock)||request.clock<0||request.clock>Number.MAX_SAFE_INTEGER-1||request.clock<=subscription.clock)return {};
      const selection=request.state?.selection;
      if(selection&&JSON.stringify(selection).length>2048)throw fail(413,'Cursor state is too large');
      const position=position=>position&&Object.keys(position).every(key=>['type','tname','item','assoc'].includes(key))&&(!position.tname||position.tname==='source')&&['type','item'].every(key=>!position[key]||(Number.isSafeInteger(position[key].client)&&Number.isSafeInteger(position[key].clock)))&&(!position.assoc||Number.isSafeInteger(position.assoc));
      if(selection&&(!position(selection.anchor)||!position(selection.head)))throw fail(400,'Invalid cursor position');
      subscription.clock=request.clock;subscription.state=request.state===null?null:{user:subscription.user,...(selection?{selection}:{})};
      await broadcast(entry,'collab_awareness',{key:entry.key,clientId:subscription.clientId,clock:subscription.clock,state:subscription.state},socket.id);return {};
    });
    handle('collab_leave',async()=>{detach(socket);return {};});
    socket.on('disconnect',()=>detach(socket));
  }
  return {register,documents,close(){budgets.clear();return store.close();}};
}
module.exports={createCollaboration};
