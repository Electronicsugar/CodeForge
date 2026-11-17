const assert=require('node:assert/strict');
const Y=require('yjs');
const {randomUUID}=require('node:crypto');
module.exports=async({t,mongoose,problem,userId,io,until})=>{
  process.env.BATTLE_COLLABORATION='true';
  const service=require('../src/services/battleRoom.service');
  const users=[];for(let i=0;i<5;i++)users.push(String((await mongoose.model('User').create({name:`Collaborator ${i}`,email:`${randomUUID()}@example.com`,password:'test-only'}))._id));
  const room=await service.create(userId,{teamSize:3,hostType:'EXTERNAL_HOST',duration:15,problemCount:1,selectionMode:'MANUAL_SELECTION',problems:[String(problem._id)]}),roomId=String(room._id);
  for(let i=0;i<4;i++)await service.join(users[i],room.code,i<3?'Alpha':'Beta');
  for(const user of users.slice(0,4))await service.change(roomId,user,'ready',{ready:true});
  for(const [index,user] of [[0,users[0]],[1,users[3]]]){await service.change(roomId,userId,'lead',{teamId:String(room.teams[index]._id),userId:user});await service.change(roomId,user,'team-ready',{teamId:String(room.teams[index]._id),ready:true});}
  await service.change(roomId,userId,'start');
  const peers=[],docs=[];
  const connect=async user=>{const token=require('jsonwebtoken').sign({id:user},process.env.JWT_SECRET),socket=require('socket.io-client').io(`http://127.0.0.1:${io.httpServer.address().port}`,{auth:{token},transports:['websocket'],reconnection:false});await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});peers.push(socket);return socket;};
  const ack=(socket,event,body)=>new Promise((resolve,reject)=>{socket.timeout(4000).emit(event,body,(error,result)=>error?reject(error):resolve(result));});
  const join=async(socket,team=0,doc=new Y.Doc(),language='cpp')=>{docs.push(doc);const response=await ack(socket,'collab_join',{roomId,teamId:String(room.teams[team]._id),problemId:String(problem._id),language,clientId:doc.clientID});assert.equal(response.success,true,response.message);Y.applyUpdate(doc,new Uint8Array(response.update));socket.on('collab_update',packet=>{if(packet.key===response.key)Y.applyUpdate(doc,new Uint8Array(packet.update));});return {socket,doc,key:response.key};};
  const send=client=>ack(client.socket,'collab_update',{key:client.key,update:Y.encodeStateAsUpdate(client.doc)});
  try{
    const a=await join(await connect(users[0])),b=await join(await connect(users[1])),c=await join(await connect(users[2])),beta=await join(await connect(users[3]),1);
    await t.test('three teammates converge after simultaneous CRDT edits; opponent document stays separate',async()=>{
      for(const [client,text] of [[a,'ALPHA-A'],[b,'ALPHA-B'],[c,'ALPHA-C']])client.doc.getText('source').insert(0,text);
      const results=await Promise.all([a,b,c].map(send));assert.ok(results.every(result=>result.success));await until(()=>[a,b,c].every(client=>['ALPHA-A','ALPHA-B','ALPHA-C'].every(text=>client.doc.getText('source').toString().includes(text))));assert.equal(a.doc.getText('source').toString(),c.doc.getText('source').toString());assert.equal(beta.doc.getText('source').toString().includes('ALPHA-'),false);
    });
    await t.test('opponents, outsiders and external hosts cannot read or write another team source',async()=>{
      const response=await ack(beta.socket,'collab_join',{roomId,teamId:String(room.teams[0]._id),problemId:String(problem._id),language:'cpp',clientId:beta.doc.clientID});assert.equal(response.status,403);
      assert.equal((await ack(beta.socket,'collab_update',{key:a.key,update:Y.encodeStateAsUpdate(beta.doc)})).status,403);
      for(const user of [users[4],userId]){const socket=await connect(user);const denied=await ack(socket,'collab_join',{roomId,problemId:String(problem._id),language:'cpp',clientId:123});assert.equal(denied.status,403);assert.equal(denied.update,undefined);assert.equal((await ack(socket,'collab_update',{key:a.key,update:Y.encodeStateAsUpdate(a.doc)})).status,403);}
      assert.equal((await ack(a.socket,'collab_join',{roomId,problemId:String(problem._id),language:'ruby',clientId:a.doc.clientID})).status,400);
      assert.equal((await ack(a.socket,'collab_join',{roomId,problemId:String(new mongoose.Types.ObjectId()),language:'cpp',clientId:a.doc.clientID})).status,403);
    });
    await t.test('awareness is team-only and identities are assigned by the server',async()=>{
      const received=[],opponent=[];b.socket.on('collab_awareness',packet=>received.push(packet));beta.socket.on('collab_awareness',packet=>opponent.push(packet));
      const point=Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(a.doc.getText('source'),1));
      assert.equal((await ack(a.socket,'collab_awareness',{key:a.key,clock:5,state:{user:{name:'Impersonated'},selection:{anchor:point,head:point},clipboard:'must not be stored'}})).success,true);
      await until(()=>received.length);assert.equal(received.at(-1).state.user.name,'Collaborator 0');assert.equal(received.at(-1).state.clipboard,undefined);assert.ok(received.at(-1).state.selection);assert.equal(opponent.length,0);
    });
    await t.test('malformed, oversized and non-source Yjs updates are rejected without mutating source',async()=>{
      assert.equal((await ack(a.socket,'collab_update',{key:a.key,update:Buffer.alloc(512*1024+1)})).status,413);
      assert.equal((await ack(a.socket,'collab_update',{key:a.key,update:Buffer.from([255])})).success,false);
      const attack=new Y.Doc();Y.applyUpdate(attack,Y.encodeStateAsUpdate(a.doc));attack.getMap('private-root').set('x','unsafe');assert.equal((await ack(a.socket,'collab_update',{key:a.key,update:Y.encodeStateAsUpdate(attack)})).success,false);attack.destroy();assert.equal(b.doc.share.has('private-root'),false);
    });
    await t.test('offline changes merge after reconnect without duplicating the starter code',async()=>{
      a.socket.disconnect();a.doc.getText('source').insert(0,'OFFLINE-A');b.doc.getText('source').insert(0,'ONLINE-B');assert.equal((await send(b)).success,true);
      a.socket.connect();await new Promise((resolve,reject)=>{a.socket.once('connect',resolve);a.socket.once('connect_error',reject);});const response=await ack(a.socket,'collab_join',{roomId,problemId:String(problem._id),language:'cpp',clientId:a.doc.clientID});Y.applyUpdate(a.doc,new Uint8Array(response.update));assert.equal((await send(a)).success,true);await until(()=>b.doc.getText('source').toString().includes('OFFLINE-A'));assert.ok(a.doc.getText('source').toString().includes('ONLINE-B'));
    });
    await require('./collaborationCompletion.scenarios.cjs')({t,mongoose,problem,room,users,userId,io,until,a,b,c,send});
    await require('./collaborativeLanguages.scenarios.cjs')({t,mongoose,room,problem,users,join,send,connect,ack,until,io});
    await t.test('revoked recipients stop receiving source and expired rooms reject edits',async()=>{
      const {redisClient}=require('../src/config/redis');const key=`blacklist:${a.socket.auth.token}`;await redisClient.set(key,'1');
      let count=0;a.socket.on('collab_update',()=>count++);b.doc.getText('source').insert(0,'AFTER-REVOCATION');await send(b);assert.equal(count,0);await redisClient.del(key);
      await require('../src/models/BattleRoom').updateOne({_id:roomId},{$set:{endTime:new Date(Date.now()-1)}});assert.equal((await send(b)).status,403);
    });
    await t.test('explicit collaboration disable applies in every environment',async()=>{
      const previous=process.env.NODE_ENV;
      try{process.env.NODE_ENV='production';process.env.BATTLE_COLLABORATION='false';assert.equal((await send(b)).status,409);process.env.NODE_ENV='development';process.env.BATTLE_COLLABORATION='false';assert.equal((await send(b)).status,409);}
      finally{process.env.NODE_ENV=previous;process.env.BATTLE_COLLABORATION='true';}
    });
  }finally{for(const peer of peers)peer.disconnect();for(const doc of docs)doc.destroy();delete process.env.BATTLE_COLLABORATION;}
};
