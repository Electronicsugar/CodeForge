const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const Y=require('yjs');
module.exports=async({t,mongoose,problem,userId,io})=>{
  const rooms=require('../src/services/battleRoom.service');
  const peers=[];
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const ack=(socket,event,data)=>new Promise((resolve,reject)=>socket.timeout(5000).emit(event,data,(error,value)=>error?reject(error):resolve(value)));
  async function create(size){
    const users=[];for(let index=0;index<size*2;index++)users.push(String((await mongoose.model('User').create({name:'Integrity participant',email:`${randomUUID()}@example.com`,password:'test-only'}))._id));
    const room=await rooms.create(userId,{teamSize:size,hostType:'EXTERNAL_HOST',duration:15,problemCount:1,selectionMode:'MANUAL_SELECTION',problems:[String(problem._id)]});
    for(let index=0;index<users.length;index++)await rooms.join(users[index],room.code,index<size?'Alpha':'Beta');
    if(size===1)for(const user of users)await rooms.change(String(room._id),user,'ready',{ready:true});
    else for(const [index,user] of [[0,users[0]],[1,users[size]]]){await rooms.change(String(room._id),userId,'lead',{teamId:String(room.teams[index]._id),userId:user});await rooms.change(String(room._id),user,'team-ready',{teamId:String(room.teams[index]._id),ready:true});}
    await rooms.change(String(room._id),userId,'start');return {room,users};
  }
  async function connect(user,roomId){
    const token=require('jsonwebtoken').sign({id:user},process.env.JWT_SECRET);
    const socket=require('socket.io-client').io(`http://127.0.0.1:${io.httpServer.address().port}`,{auth:{token},transports:['websocket'],reconnection:false});
    peers.push(socket);await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
    if(roomId)assert.equal((await ack(socket,'battle_room_join',{roomId})).success,true);return socket;
  }
  try{
    for(const size of [1,2])await t.test(`${size}v${size} room warnings persist and third strike forfeits the entire team with server-side editor/submission closure`,async()=>{
      const {room,users}=await create(size),roomId=String(room._id),actor=await connect(users[0],roomId),beta=await connect(users[size],roomId),host=await connect(userId,roomId);
      const event=(type='paste',meta={length:100})=>({roomId,eventId:randomUUID(),type,meta});
      assert.equal((await ack(host,'room_integrity_event',event())).status,403);
      const outsider=await connect(String((await mongoose.model('User').create({name:'Outsider',email:`${randomUUID()}@example.com`,password:'test-only'}))._id));
      assert.equal((await ack(outsider,'room_integrity_event',event())).status,403);
      assert.equal((await ack(actor,'room_integrity_event',{...event(),userId:users[size]})).status,400);
      assert.equal((await ack(actor,'room_integrity_event',event('paste',{clipboard:'must not persist'}))).status,400);
      const doc=new Y.Doc();
      try{
        const joined=await ack(actor,'collab_join',{roomId,problemId:String(problem._id),language:'cpp',clientId:doc.clientID});assert.equal(joined.success,true);Y.applyUpdate(doc,new Uint8Array(joined.update));
        let first;
        if(size===1){first=event();assert.equal((await ack(actor,'room_integrity_event',first)).strikes,1);assert.equal((await ack(actor,'room_integrity_event',first)).strikes,1);}
        else{
          await ack(actor,'room_integrity_event',event('window_blur',{}));await ack(actor,'room_integrity_event',event('tab_hidden',{}));await pause(3100);
          await ack(actor,'room_integrity_event',event('window_focus',{}));assert.equal((await ack(actor,'room_integrity_event',event('tab_visible',{}))).strikes,1);
        }
        assert.equal((await rooms.view(roomId,users[0])).integrity.strikes,1);
        const privateView=await rooms.view(roomId,users[size]);assert.equal(privateView.integrity.strikes,0);assert.ok(privateView.teams.every(team=>team.members.every(member=>member.integrityState===undefined)));assert.equal((await rooms.view(roomId,userId)).integrity,undefined);
        delete require.cache[require.resolve('../src/services/roomIntegrity.service')];
        assert.equal((await rooms.view(roomId,users[0])).integrity.strikes,1);
        await pause(2600);assert.equal((await ack(actor,'room_integrity_event',event())).strikes,2);
        await pause(2600);const final=await ack(actor,'room_integrity_event',event());assert.equal(final.action,'forfeit');assert.equal(final.strikes,3);
        const finished=await rooms.load(roomId);assert.equal(finished.status,'completed');assert.equal(String(finished.winnerTeam),String(room.teams[1]._id));assert.equal(String(finished.forfeitedTeam),String(room.teams[0]._id));assert.equal(finished.teams[0].members.length,size);
        assert.equal((await ack(actor,'collab_update',{key:joined.key,update:Y.encodeStateAsUpdate(doc)})).status,403);
        await assert.rejects(require('../src/services/submission.service').createSubmission({roomId,problem:String(problem._id),language:'cpp',code:'blocked',idempotencyKey:randomUUID()},users[0]),error=>error.status===403);
        if(size>1)await assert.rejects(rooms.selectedProblem(roomId,users[1],String(problem._id),true),error=>error.status===403);
        assert.equal((await ack(beta,'room_integrity_event',event())).ignored,true);
      }finally{doc.destroy();}
    });
  }finally{for(const socket of peers)socket.disconnect();}
};
