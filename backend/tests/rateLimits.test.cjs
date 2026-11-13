const {test}=require('node:test');
const assert=require('node:assert/strict');
const express=require('express');
const {policy,makeLimiter}=require('../src/middlewares/rateLimitPolicy');
async function serverFor(app,action){const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));try{await action(`http://127.0.0.1:${server.address().port}`);}finally{await new Promise(resolve=>server.close(resolve));}}
function configured(env,build){const previous={...process.env};Object.assign(process.env,env);try{return build();}finally{for(const key of Object.keys(env))if(previous[key]===undefined)delete process.env[key];else process.env[key]=previous[key];}}
test('production ignores every development override; invalid development values fail closed',()=>{
  assert.deepEqual(policy({NODE_ENV:'production',CODEFORGE_DEV_RATE_LIMITS:'true',DEV_AUTH_MAX:'999999',DEV_ROOM_MAX:'invalid'}),{development:false,auth:{max:10,windowMs:900000},room:{max:60,windowMs:60000},submission:{max:5,windowMs:60000}});
  assert.equal(policy({NODE_ENV:'development',CODEFORGE_DEV_RATE_LIMITS:'false'}).development,false);
  assert.throws(()=>policy({NODE_ENV:'development',CODEFORGE_DEV_RATE_LIMITS:'yes'}));
  assert.throws(()=>policy({NODE_ENV:'development',CODEFORGE_DEV_RATE_LIMITS:'true',DEV_ROOM_MAX:'0'}));
});
test('original shared-IP authentication threshold reproduces 429 on request eleven with retry information',async()=>{
  const app=express();app.use(express.json());
  const shared=configured({NODE_ENV:'production',CODEFORGE_DEV_RATE_LIMITS:'true',DEV_AUTH_MAX:'999999'},()=>makeLimiter('authentication',{max:10,windowMs:900000},'auth'));
  app.post(['/login','/register'],shared,(req,res)=>res.sendStatus(req.body.ok?200:401));
  await serverFor(app,async base=>{for(let i=0;i<10;i++)assert.equal((await fetch(base+(i%2?'/register':'/login'),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:`account${i}@example.com`,ok:i<5})})).status,i<5?200:401);const blocked=await fetch(base+'/login',{method:'POST'});assert.equal(blocked.status,429);const body=await blocked.json();assert.equal(body.operation,'authentication');assert.ok(body.retryAfterSeconds>890);assert.equal(Number(blocked.headers.get('retry-after')),body.retryAfterSeconds);});
});
test('opt-in development isolates users and operations on one IP and keeps finite limits',async()=>{
  const app=express();app.use(express.json(),(req,res,next)=>{req.user={id:req.headers['x-test-user']};next();});
  configured({NODE_ENV:'development',CODEFORGE_DEV_RATE_LIMITS:'true',DEV_ROOM_MAX:'2',DEV_ROOM_WINDOW_MS:'60000'},()=>{for(const op of ['create','join'])app.post('/'+op,makeLimiter('room '+op,{max:60,windowMs:60000},'room'),(req,res)=>res.sendStatus(200));});
  await serverFor(app,async base=>{const send=(op,user)=>fetch(base+'/'+op,{method:'POST',headers:{'x-test-user':user}});for(let i=0;i<2;i++)assert.equal((await send('create','a')).status,200);assert.equal((await send('create','a')).status,429);assert.equal((await send('create','b')).status,200);assert.equal((await send('join','a')).status,200);});
});
test('development authentication is normalized email plus IP, allowing separate local accounts',async()=>{
  const app=express();app.use(express.json());app.post('/login',configured({NODE_ENV:'development',CODEFORGE_DEV_RATE_LIMITS:'true',DEV_AUTH_MAX:'1'},()=>makeLimiter('authentication',{max:10,windowMs:900000},'auth')),(req,res)=>res.sendStatus(200));
  await serverFor(app,async base=>{const send=email=>fetch(base+'/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email})});assert.equal((await send('A@Example.com')).status,200);assert.equal((await send(' a@example.com ')).status,429);assert.equal((await send('b@example.com')).status,200);});
});
