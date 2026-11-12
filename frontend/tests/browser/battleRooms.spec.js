import {test,expect} from '@playwright/test';
const problem=id=>({_id:id,problemNumber:1,title:id==='p1'?'Double a number':'Other problem',difficulty:'easy',description:'Return twice the input',starterCode:'class Solution {\npublic:\n int doubleIt(int n) { return 0; }\n};',examples:[{input:'21',output:'42'}]});
function room(size=1,external=false,started=false){return {_id:'room1',code:'ABCDEFGH',teamSize:size,host:{_id:'user-a',name:'Host A'},hostType:external?'EXTERNAL_HOST':'PARTICIPANT_HOST',duration:15,problemCount:1,problems:[problem('p1')],revision:0,status:started?'in_progress':'waiting',startTime:started?new Date(Date.now()-60000).toISOString():null,endTime:started?new Date(Date.now()+840000).toISOString():null,serverTime:new Date().toISOString(),canStart:false,scoringMode:'deferred',submissions:[],teams:[{_id:'alpha',name:'Alpha',score:0,members:external?[]:[{user:{_id:'user-a',name:'Host A'},ready:false,online:true}]},{_id:'beta',name:'Beta',score:0,members:[]}]};}
async function setup(context,{initial,viewer='user-a'}={}){
  let state=initial||room();let created;
  await context.addInitScript(id=>localStorage.setItem('token',`test.${btoa(JSON.stringify({id}))}.signature`),viewer);
  await context.route('**/health',route=>route.fulfill({json:{status:'ok'}}));
  await context.route('**/src/services/socket.js',route=>route.fulfill({contentType:'text/javascript',body:`
    const listeners=new Map();const socket={connected:true,on(n,h){if(!listeners.has(n))listeners.set(n,new Set());listeners.get(n).add(h);},off(n,h){listeners.get(n)?.delete(h);},emit(){},connect(){for(const h of listeners.get('connect')||[])h();}};
    window.roomTestSocket=socket;export const getSocket=()=>socket;export const disconnectSocket=()=>{};
  `}));
  await context.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname,method=route.request().method();let data;
    if(path.endsWith('/users/me'))data={_id:viewer,name:'Test viewer'};
    else if(path.endsWith('/battles/rooms/limits'))data={maxProblems:20,maxDuration:180};
    else if(path==='/api/v1/battles/rooms'&&method==='GET')data=[state];
    else if(path==='/api/v1/battles/rooms'&&method==='POST'){
      created=route.request().postDataJSON();state={...room(created.teamSize,created.hostType==='EXTERNAL_HOST'),duration:created.duration,problemCount:created.problemCount};data=state;
    }else if(path.endsWith('/battles/rooms/join')){state.teams[1].members=[{user:{_id:viewer,name:'Test viewer'},ready:false}];data=state;}
    else if(path.endsWith('/room1/ready')){for(const team of state.teams)for(const member of team.members)if(member.user._id===viewer)member.ready=route.request().postDataJSON().ready;state.revision++;state.canStart=true;state.status='ready';data=state;}
    else if(path.endsWith('/room1/start')){state={...state,status:'in_progress',revision:state.revision+1,startTime:new Date().toISOString(),endTime:new Date(Date.now()+900000).toISOString(),serverTime:new Date().toISOString()};data=state;}
    else if(path.endsWith('/battles/rooms/room1'))data={...state,serverTime:new Date().toISOString()};
    else if(path.includes('/battles/rooms/room1/problems/'))data=problem(path.split('/').pop());
    else if(path==='/api/v1/problems')data={problems:[problem('p1'),problem('p2')],pagination:{totalPages:1}};
    else data={};
    await route.fulfill({json:{success:true,data}});
  });
  return {get created(){return created;},get state(){return state;}};
}
for(const size of [1,2,3,4])test(`create private ${size}v${size} with independent manual problem selection`,async({context,page})=>{
  const fixture=await setup(context);await page.goto('/battle');
  await page.getByLabel('Format',{exact:true}).selectOption(String(size));
  await page.getByRole('checkbox',{name:'Double a number · easy'}).check();
  await page.getByRole('button',{name:'Create room',exact:true}).click();await expect(page).toHaveURL(/\/battle\/rooms\/room1$/);
  await expect(page.getByRole('heading',{name:`${size}v${size} battle`,exact:true})).toBeVisible();
  await expect(page.getByText('ABCDEFGH',{exact:true})).toBeVisible();expect(fixture.created.problemCount).toBe(1);expect(fixture.created.problems).toEqual(['p1']);
});
test('host readiness/start transitions to a persistent editor; reconnect keeps code and deadline',async({context,page})=>{
  const state=room();state.teams[1].members=[{user:{_id:'user-b',name:'Player B'},ready:true}];
  await setup(context,{initial:state});await page.goto('/battle/rooms/room1');
  await page.getByRole('button',{name:'Mark ready',exact:true}).click();await page.getByRole('button',{name:'Start battle',exact:true}).click();
  const editor=page.getByRole('textbox',{name:'Battle code'});await expect(editor).toHaveValue(problem('p1').starterCode);
  await editor.fill('room-specific draft\n');await expect(page.getByText('Saved locally',{exact:true})).toBeVisible();
  await page.evaluate(()=>window.roomTestSocket.connect());await expect(editor).toHaveValue('room-specific draft\n');
  await page.reload();await expect(editor).toHaveValue('room-specific draft\n');
  await expect(page.getByLabel('Battle countdown')).toHaveText(/14:\d{2}/);
  await expect(page.getByRole('button',{name:'Keep my version'})).toHaveCount(0);
});
test('external host sees monitoring only',async({context,page})=>{
  await setup(context,{initial:room(4,true,true)});await page.goto('/battle/rooms/room1');
  await expect(page.getByText(/Monitoring only/)).toBeVisible();await expect(page.getByRole('textbox',{name:'Battle code'})).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Save configuration'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Submit code'})).toHaveCount(0);
});
test('participant joins another host room by code',async({context,page})=>{
  const initial=room();initial.host={_id:'other-host',name:'Other host'};initial.teams[0].members=[{user:{_id:'other-host',name:'Other host'},ready:false}];
  await setup(context,{initial});await page.goto('/battle');await page.getByLabel('Room code',{exact:true}).fill('ABCDEFGH');await page.getByLabel('Join team',{exact:true}).selectOption('Beta');
  await page.getByRole('button',{name:'Join room',exact:true}).click();await expect(page).toHaveURL(/room1$/);
});
