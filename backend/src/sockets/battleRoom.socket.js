const service=require('../services/battleRoom.service');
const jwt=require('jsonwebtoken');
const {redisClient}=require('../config/redis');
module.exports=(io,socket)=>{
  socket.on('room_integrity_event',async(data,ack)=>{
    try{
      const claims=jwt.verify(socket.token,process.env.JWT_SECRET);
      if(claims.id!==socket.user.id||!redisClient.isReady||await redisClient.get(`blacklist:${socket.token}`))throw Object.assign(Error('Session verification failed'),{status:403});
      const result=await require('../services/roomIntegrity.service').record(claims.id,data);
      if(typeof ack==='function')ack({success:true,...result});
    }catch(error){if(typeof ack==='function')ack({success:false,status:error.status||500,message:error.status?error.message:'Could not record battle event'});}
  });
  socket.on('battle_room_join',async(data,ack)=>{
    const generation=(socket.data.roomGeneration||0)+1;socket.data.roomGeneration=generation;
    try{
      const claims=jwt.verify(socket.token,process.env.JWT_SECRET);
      if(claims.id!==socket.user.id||!redisClient.isReady)throw Error('Session verification unavailable');
      if(await redisClient.get(`blacklist:${socket.token}`))throw Error('Session expired');
      const room=await service.load(data?.roomId);service.requireMember(room,socket.user.id);
      if(socket.data.roomGeneration!==generation)return;
      // A socket follows one team-room view at a time; legacy rooms are untouched.
      for(const channel of socket.rooms)if(channel.startsWith('battle-room:'))socket.leave(channel);
      await socket.join(`battle-room:${room._id}`);
      const state=await service.view(room._id.toString(),socket.user.id);
      if(socket.data.roomGeneration!==generation)return;
      socket.emit('battle_room_state',state);
      io.to(`battle-room:${room._id}`).emit('battle_room_presence',{roomId:room._id.toString()});
      if(typeof ack==='function')ack({success:true,roomId:room._id.toString()});
    }catch(error){if(typeof ack==='function')ack({success:false,message:error.status?error.message:'Room access denied'});}
  });
  socket.on('battle_room_unsubscribe',async data=>{
    socket.data.roomGeneration=(socket.data.roomGeneration||0)+1;
    try{
      const room=await service.load(data?.roomId);service.requireMember(room,socket.user.id);
      const channel=`battle-room:${room._id}`;await socket.leave(channel);
      io.to(channel).emit('battle_room_presence',{roomId:room._id.toString()});
    }catch{/* Leaving a view never grants membership or mutates a roster. */}
  });
  socket.on('disconnecting',()=>{
    for(const channel of socket.rooms)if(channel.startsWith('battle-room:'))socket.to(channel).emit('battle_room_presence',{roomId:channel.slice('battle-room:'.length)});
  });
};
