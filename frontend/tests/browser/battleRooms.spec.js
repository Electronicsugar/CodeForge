import {test,expect} from '@playwright/test';
const problem=id=>({_id:id,problemNumber:1,title:id==='p1'?'Double a number':'Other problem',difficulty:'easy',description:'Given an integer n, return twice its value. Work independently while following your team’s progress.',starterCode:'class Solution {\npublic:\n int doubleIt(int n) { return 0; }\n};',constraints:['-100000 ≤ n ≤ 100000'],examples:[{input:'21',output:'42',explanation:'Twice 21 is 42.'}]});
function room(size=1,external=false,started=false){return {_id:'room1',code:'ABCDEFGH',teamSize:size,host:{_id:'user-a',name:'Host A'},hostType:external?'EXTERNAL_HOST':'PARTICIPANT_HOST',duration:15,problemCount:1,selectionMode:'RANDOM_DISTRIBUTION',difficulties:['easy'],problems:started?[problem('p1')]:[],revision:0,status:started?'in_progress':'waiting',startTime:started?new Date(Date.now()-60000).toISOString():null,endTime:started?new Date(Date.now()+840000).toISOString():null,serverTime:new Date().toISOString(),canStart:false,startReasons:['Beta has no competitors','Alpha has no assigned lead','Beta has no assigned lead'],scoringMode:'deferred',submissions:[],progress:[],admissions:[],teams:[{_id:'alpha',name:'Alpha',lead:null,admissionPolicy:'OPEN',teamReady:false,members:external?[]:[{user:{_id:'user-a',name:'Host A'},ready:false,online:true}]},{_id:'beta',name:'Beta',lead:null,admissionPolicy:'OPEN',teamReady:false,members:[]}]};}
async function setup(context,{initial,viewer='user-a',approval=false,previewError=false,createError=false}={}){
  let state=initial||room();let created,previewCalls=0,createCalls=0,requestStatus=null;
  const preview=()=>({roomId:'room1',code:state.code,teamSize:state.teamSize,status:state.status,canEnter:state.teams.some(team=>team.members.some(m=>m.user._id===viewer)),teams:state.teams.map(item=>({_id:item._id,name:item.name,occupied:item.members.length,capacity:state.teamSize,admissionPolicy:approval?'APPROVAL_REQUIRED':item.admissionPolicy})),request:requestStatus?{_id:'request1',teamId:'beta',status:requestStatus}:null});
  await context.addInitScript(id=>localStorage.setItem('token',`test.${btoa(JSON.stringify({id}))}.signature`),viewer);
  await context.route('**/health',route=>route.fulfill({json:{status:'ok'}}));
  await context.route('**/src/services/socket.js',route=>route.fulfill({contentType:'text/javascript',body:`
    const listeners=new Map();const socket={connected:true,on(n,h){if(!listeners.has(n))listeners.set(n,new Set());listeners.get(n).add(h);},off(n,h){listeners.get(n)?.delete(h);},emit(){},connect(){for(const h of listeners.get('connect')||[])h();}};
    window.roomTestSocket=socket;export const getSocket=()=>socket;export const disconnectSocket=()=>{};
  `}));
  await context.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname,method=route.request().method();let data;
    if(path.endsWith('/users/me'))data={_id:viewer,name:'Test viewer'};
    else if(path.endsWith('/battles/rooms/limits'))data={maxProblems:20,maxDuration:180,availability:{total:8,easy:4,medium:2,hard:2}};
    else if(path==='/api/v1/battles/rooms'&&method==='GET')data=[{...state,isHost:viewer===state.host._id,team:state.teams.find(team=>team.members.some(m=>m.user._id===viewer))?.name}];
    else if(path==='/api/v1/battles/rooms'&&method==='POST'){
      createCalls++;if(createError)return route.fulfill({status:429,json:{success:false,operation:'room creation',retryAfterSeconds:60,message:'Too many room creation attempts. Try again in 60 seconds.'}});
      created=route.request().postDataJSON();state={...room(created.teamSize,created.hostType==='EXTERNAL_HOST'),duration:created.duration,problemCount:created.problemCount,difficulties:created.difficulties,selectionMode:created.selectionMode};data=state;
    }else if(path.endsWith('/battles/rooms/preview')){
      previewCalls++;if(previewError&&previewCalls>2)return route.fulfill({status:429,json:{success:false,message:'Too many room preview attempts. Try again in 60 seconds.'}});data=preview();
    }else if(path.endsWith('/battles/rooms/join')){if(approval){requestStatus='pending';data={pending:true,requestId:'request1'};}else{state.teams[1].members=[{user:{_id:viewer,name:'Test viewer'},ready:false}];data=state;}}
    else if(/\/room1\/(ready|lead|team-ready|policy|admission)$/.test(path)){
      const action=path.split('/').pop(),body=route.request().postDataJSON(),team=state.teams.find(item=>item._id===body.teamId);
      if(action==='ready')for(const item of state.teams)for(const member of item.members)if(member.user._id===viewer){member.ready=body.ready;if(state.teamSize===1)item.teamReady=body.ready;}
      if(action==='lead'){team.lead=body.userId;team.teamReady=false;}
      if(action==='team-ready')team.teamReady=body.ready;
      if(action==='policy'){team.admissionPolicy=body.policy;team.teamReady=false;}
      if(action==='admission')state.admissions=state.admissions.map(request=>request._id===body.requestId?{...request,status:body.decision}:request);
      state.canStart=state.teams.every(item=>item.members.length>0&&(state.teamSize===1?item.members[0].ready:item.lead&&item.teamReady));state.startReasons=state.canStart?[]:['Both teams must confirm readiness'];state.revision++;data=state;
    }else if(path.endsWith('/room1/start')){state={...state,status:'in_progress',problems:[problem('p1')],revision:state.revision+1,startTime:new Date().toISOString(),endTime:new Date(Date.now()+900000).toISOString(),serverTime:new Date().toISOString()};data=state;}
    else if(path.endsWith('/battles/rooms/room1'))data={...state,serverTime:new Date().toISOString()};
    else if(path.includes('/battles/rooms/room1/problems/'))data=problem(path.split('/').pop());
    else if(path==='/api/v1/problems')data={problems:[problem('p1'),problem('p2')],pagination:{totalPages:1}};
    else data={};
    await route.fulfill({json:{success:true,data}});
  });
  return {get created(){return created;},get state(){return state;},get previewCalls(){return previewCalls;},get createCalls(){return createCalls;},approve(){requestStatus='approved';state.teams[1].members=[{user:{_id:viewer,name:'Test viewer'},ready:false}];}};
}

test('room language selector saves independent drafts and restores the selected language after refresh',async({context,page})=>{
  await setup(context,{initial:room(1,false,true)});
  await context.route('**/api/v1/battles/rooms/room1/problems/p1',route=>route.fulfill({json:{success:true,data:{...problem('p1'),starterCodes:{cpp:problem('p1').starterCode,python:'# python room starter',javascript:'// javascript room starter',java:'// java room starter'}}}}));
  await page.goto('/battle/rooms/room1');
  const language=page.getByRole('combobox',{name:'Programming language'}),editor=page.getByRole('textbox',{name:'Battle code'});
  await expect(editor).toHaveValue(problem('p1').starterCode);
  await editor.fill('// saved cpp room');await expect(page.getByText('Saved locally',{exact:true})).toBeVisible();
  await language.selectOption('python');await expect(editor).toHaveValue('# python room starter');
  await editor.fill('print(42)');await expect(page.getByText('Saved locally',{exact:true})).toBeVisible();
  await language.selectOption('javascript');await expect(editor).toHaveValue('// javascript room starter');
  await language.selectOption('cpp');await expect(editor).toHaveValue('// saved cpp room');
  await language.selectOption('python');await expect(editor).toHaveValue('print(42)');
  await page.reload();await expect(language).toHaveValue('python');await expect(editor).toHaveValue('print(42)');
});
for(const size of [1,2,3,4])test(`create private ${size}v${size} with participant random difficulty selection`,async({context,page})=>{
  const fixture=await setup(context);await page.goto('/battle');
  await page.getByRole('button',{name:`${size}v${size} Up to ${size*2} players`,exact:true}).click();
  await expect(page.getByLabel('Search problems')).toHaveCount(0);
  await page.getByRole('button',{name:'Create room',exact:true}).click();await expect(page).toHaveURL(/\/battle\/rooms\/room1$/);
  await expect(page.getByRole('heading',{name:'Prepare for battle'})).toBeVisible();
  await expect(page.getByText('ABCDEFGH',{exact:true})).toBeVisible();expect(fixture.created.teamSize).toBe(size);expect(fixture.created.problems).toEqual([]);expect(fixture.created.difficulties).toEqual(['easy']);
});
test('external host can select manual questions and return to random per-question difficulty',async({context,page})=>{
  const fixture=await setup(context);await page.goto('/battle');await page.getByLabel('Host type',{exact:true}).selectOption('EXTERNAL_HOST');
  await page.getByLabel('Number of problems').fill('2');await page.getByLabel('Question 2 difficulty').selectOption('hard');
  await page.getByLabel('Problem selection').selectOption('MANUAL_SELECTION');await page.getByRole('checkbox',{name:'Double a number · easy'}).check();await page.getByRole('checkbox',{name:'Other problem · easy'}).check();
  await page.getByRole('button',{name:'Create room',exact:true}).click();expect(fixture.created.selectionMode).toBe('MANUAL_SELECTION');expect(fixture.created.problems).toEqual(['p1','p2']);
});
test('incomplete teams assign leads, confirm separately and start; reconnect preserves draft and deadline',async({context,page})=>{
  const state=room(4);state.teams[1]={...state.teams[1],lead:'user-b',teamReady:true,members:[{user:{_id:'user-b',name:'Player B'},ready:true}]};
  await setup(context,{initial:state});await page.goto('/battle/rooms/room1');
  await expect(page.getByRole('button',{name:'Start battle',exact:true})).toBeDisabled();await expect(page.getByText('1 of 4 players')).toHaveCount(2);
  await page.getByLabel('Alpha team lead').selectOption('user-a');await expect(page.getByRole('button',{name:'Confirm Team Ready',exact:true})).toBeEnabled();
  await expect(page.getByRole('button',{name:'Start battle',exact:true})).toBeDisabled();await page.getByRole('button',{name:'Confirm Team Ready',exact:true}).click();await page.getByRole('button',{name:'Start battle',exact:true}).click();
  const editor=page.getByRole('textbox',{name:'Battle code'});await expect(editor).toHaveValue(problem('p1').starterCode);
  await editor.fill('room-specific draft\n');await expect(page.getByText('Saved locally',{exact:true})).toBeVisible();
  await page.evaluate(()=>window.roomTestSocket.connect());await expect(editor).toHaveValue('room-specific draft\n');await page.reload();await expect(editor).toHaveValue('room-specific draft\n');
  await expect(page.getByLabel('Battle countdown')).toHaveText(/14:\d{2}/);await expect(page.getByRole('button',{name:'Keep my version'})).toHaveCount(0);
});
test('external host sees statement, progress and monitoring without competitor editor',async({context,page})=>{
  await setup(context,{initial:room(4,true,true)});await page.goto('/battle/rooms/room1');
  await expect(page.getByRole('heading',{name:'Host monitoring'})).toBeVisible();await expect(page.getByRole('heading',{name:'Double a number'})).toBeVisible();await expect(page.getByRole('textbox',{name:'Battle code'})).toHaveCount(0);await expect(page.getByRole('button',{name:'Submit code'})).toHaveCount(0);
});
test('1v1 host starts using personal readiness with no separate lead controls',async({context,page})=>{const initial=room(1);initial.teams[1].members=[{user:{_id:'user-b',name:'Beta player'},ready:true}];await setup(context,{initial});await page.goto('/battle/rooms/room1');await expect(page.getByLabel('Alpha team lead')).toHaveCount(0);await expect(page.getByRole('button',{name:'Confirm Team Ready'})).toHaveCount(0);await page.getByRole('button',{name:'Mark ready',exact:true}).click();await expect(page.getByRole('button',{name:'Start battle',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Start battle',exact:true}).click();await expect(page.getByRole('heading',{name:'Battle in progress'})).toBeVisible();});
test('participant previews admission rules and joins by code',async({context,page})=>{
  const initial=room();initial.host={_id:'other-host',name:'Other host'};initial.teams[0].members=[{user:initial.host,ready:false}];
  await setup(context,{initial});await page.goto('/battle');await page.getByLabel('Room code',{exact:true}).fill('ABCDEFGH');await page.getByRole('button',{name:'Preview room'}).click();await page.getByLabel('Join team',{exact:true}).selectOption('Beta');
  await page.getByRole('button',{name:'Join room',exact:true}).click();await expect(page).toHaveURL(/room1$/);
});
test('pending applicant waits outside room and enters only after approval',async({context,page})=>{
  const fixture=await setup(context,{approval:true,viewer:'applicant'});await page.goto('/battle');await page.getByLabel('Room code').fill('ABCDEFGH');await page.getByRole('button',{name:'Preview room'}).click();await page.getByLabel('Join team').selectOption('Beta');await page.getByRole('button',{name:'Request to join'}).click();await expect(page.getByText(/Admission pending/)).toBeVisible();await expect(page).toHaveURL(/\/battle$/);fixture.approve();await page.getByRole('button',{name:'Check status'}).click();await expect(page).toHaveURL(/room1$/);
});
test('host can manage per-team policy and decide pending admissions',async({context,page})=>{
  const initial=room(3);initial.admissions=[{_id:'request1',teamId:'beta',user:{_id:'applicant',name:'Alex'},status:'pending'}];await setup(context,{initial});await page.goto('/battle/rooms/room1');
  await page.getByLabel('Alpha admission').selectOption('APPROVAL_REQUIRED');await expect(page.getByLabel('Alpha admission')).toHaveValue('APPROVAL_REQUIRED');
  await page.getByRole('button',{name:'Approve Alex'}).click();await expect(page.getByRole('button',{name:'Approve Alex'})).toHaveCount(0);
});
test('admission cards deduplicate refresh, report decisions and hide unauthorized requests',async({context,page})=>{
  const initial=room(4);initial.admissions=[{_id:'request-a',teamId:'alpha',user:{_id:'applicant-a',name:'Alex'},status:'pending'},{_id:'request-b',teamId:'beta',user:{_id:'applicant-b',name:'Blair'},status:'pending'}];initial.teams[0].lead='user-a';initial.host={_id:'external-host',name:'External host'};
  const fixture=await setup(context,{initial});await page.goto('/battle/rooms/room1');await expect(page.getByRole('region',{name:'Admission notifications'})).toBeVisible();await expect(page.getByRole('article',{name:'Alex admission to Alpha'})).toHaveCount(1);await expect(page.getByRole('button',{name:'Approve Blair'})).toHaveCount(0);
  await page.evaluate(()=>window.roomTestSocket.connect());await expect(page.getByRole('article',{name:'Alex admission to Alpha'})).toHaveCount(1);
  fixture.state.admissions[0].status='rejected';await page.evaluate(()=>window.roomTestSocket.connect());await expect(page.getByRole('article',{name:'Alex admission to Alpha'})).toHaveCount(0);
});
test('admission errors allow retry and a successful decision updates the pending count',async({context,page})=>{
  const initial=room(3);initial.admissions=[{_id:'request1',teamId:'beta',user:{_id:'applicant',name:'Alex'},status:'pending'}];await setup(context,{initial});let attempts=0;
  await page.route('**/room1/admission',async route=>{attempts++;await new Promise(resolve=>setTimeout(resolve,150));if(attempts===1)return route.fulfill({status:400,json:{message:'Decision failed. Retry this request.'}});initial.admissions[0].status='approved';initial.revision++;return route.fulfill({json:{success:true,data:initial}});});
  await page.goto('/battle/rooms/room1');await page.getByRole('button',{name:'Approve Alex'}).click();await expect(page.getByRole('button',{name:'Processing…'})).toBeDisabled();await expect(page.getByRole('alert')).toContainText('Retry this request');await page.getByRole('button',{name:'Approve Alex'}).click();await expect(page.getByText('0 pending',{exact:true})).toBeVisible();await expect(page.getByRole('article',{name:'Alex admission to Beta'})).toContainText('approved');await page.getByRole('button',{name:'Dismiss Alex admission result'}).click();await expect(page.getByRole('region',{name:'Admission notifications'})).toHaveCount(0);expect(attempts).toBe(2);
});
test('429 on create is displayed and never automatically retried',async({context,page})=>{
  const fixture=await setup(context,{createError:true});await page.goto('/battle');await page.getByRole('button',{name:'Create room',exact:true}).click();await expect(page.getByRole('alert')).toContainText('Try again in 60 seconds');await page.waitForTimeout(1200);expect(fixture.createCalls).toBe(1);
});
test('pending-preview 429 stops polling until explicit check',async({context,page})=>{
  const fixture=await setup(context,{approval:true,previewError:true,viewer:'applicant'});await page.clock.install();await page.goto('/battle');await page.getByLabel('Room code').fill('ABCDEFGH');await page.getByRole('button',{name:'Preview room'}).click();await page.getByRole('button',{name:'Request to join'}).click();await expect(page.getByText(/Admission pending/)).toBeVisible();await page.clock.fastForward(11000);await expect(page.getByRole('alert')).toContainText('60 seconds');const count=fixture.previewCalls;await page.clock.fastForward(30000);expect(fixture.previewCalls).toBe(count);
});
test('completed room preserves read-only draft and history, with no invented winner',async({context,page})=>{
  const initial=room(2,false,true);initial.status='completed';initial.endTime=new Date(Date.now()-1000).toISOString();initial.submissions=[{_id:'submission1',user:'user-a',problem:'p1',teamId:'alpha',status:'accepted',createdAt:new Date().toISOString()}];await setup(context,{initial});await page.goto('/battle/rooms/room1');
  await expect(page.getByRole('heading',{name:'Battle completed'})).toBeVisible();await expect(page.getByRole('textbox',{name:'Battle code'})).toHaveAttribute('readonly','');await expect(page.getByRole('button',{name:'Submit code'})).toBeDisabled();await expect(page.getByText(/Time is up/)).toContainText('Scoring is not yet available');await expect(page.getByRole('heading',{name:'Your submission history'})).toBeVisible();
});
test('screens remain usable on mobile with explicit workspace panels',async({context,page})=>{
  await page.setViewportSize({width:390,height:844});await setup(context,{initial:room(4,false,true)});await page.goto('/battle/rooms/room1');await expect(page.getByRole('heading',{name:'Double a number'})).toBeVisible();await page.getByRole('button',{name:'editor',exact:true}).click();await expect(page.getByRole('textbox',{name:'Battle code'})).toBeVisible();await page.getByRole('button',{name:'overview',exact:true}).click();await expect(page.getByRole('heading',{name:'Team progress'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('invalid difficulty availability blocks creation with an inline explanation',async({context,page})=>{
  await setup(context);await page.goto('/battle');await page.getByLabel('Number of problems').fill('3');for(let index=1;index<=3;index++)await page.getByLabel(`Question ${index} difficulty`).selectOption('hard');await expect(page.getByRole('alert')).toContainText('Requested 3 hard; only 2 available');await expect(page.getByRole('button',{name:'Create room',exact:true})).toBeDisabled();
});
test('temporary session unavailability keeps the room draft editable and locally saved',async({context,page})=>{
  await setup(context,{initial:room(2,false,true)});await page.goto('/battle/rooms/room1');const editor=page.getByRole('textbox',{name:'Battle code'});await expect(editor).toHaveValue(problem('p1').starterCode);
  await page.evaluate(()=>window.dispatchEvent(new Event('codeforge-session-unavailable')));await expect(page.getByRole('button',{name:'Submit code'})).toBeDisabled();await expect(editor).toBeEditable();await editor.fill('offline room draft\n');await editor.press('Tab');await expect(editor).toHaveValue('offline room draft\n    ');await expect(page.getByText('Saved locally',{exact:true})).toBeVisible();
});
test('a submission 429 preserves its intent and cooldown across manual recovery and refresh',async({context,page})=>{
  await setup(context,{initial:room(2,false,true)});let requests=0;
  await page.route('**/api/v1/submissions',route=>{requests++;return route.fulfill({status:429,headers:{'Retry-After':'60'},json:{success:false,retryAfterSeconds:60,message:'Too many submission attempts. Try again in 60 seconds.'}});});
  await page.goto('/battle/rooms/room1');const editor=page.getByRole('textbox',{name:'Battle code'});await expect(editor).toHaveValue(problem('p1').starterCode);await editor.fill('preserved throttled code');await page.getByRole('button',{name:'Submit code'}).click();await expect(page.getByRole('alert')).toContainText('60 seconds');await page.getByRole('button',{name:'Recover submission status'}).click();await expect(page.getByRole('alert')).toBeVisible();expect(requests).toBe(1);await page.reload();await expect(editor).toHaveValue('preserved throttled code');await expect(page.getByRole('alert')).toContainText('Submission rate limit');expect(requests).toBe(1);
});
for(const width of [768,1024,1440])test(`lobby and workspace avoid page overflow at ${width}px`,async({context,page})=>{
  await page.setViewportSize({width,height:900});await setup(context,{initial:room(4,false,true)});await page.goto('/battle');await expect(page.getByRole('heading',{name:'Create battle'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.goto('/battle/rooms/room1');await expect(page.getByRole('textbox',{name:'Battle code'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
test('capture the three battle screens for visual review',async({context,page})=>{
  await page.setViewportSize({width:1440,height:1000});const fixture=await setup(context,{initial:room(3)});await page.goto('/battle');await expect(page.getByRole('heading',{name:'Create battle'})).toBeVisible();await page.screenshot({path:'test-results/battle-lobby.png',fullPage:true});
  await page.goto('/battle/rooms/room1');await expect(page.getByRole('heading',{name:'Prepare for battle'})).toBeVisible();await page.screenshot({path:'test-results/battle-waiting.png',fullPage:true});
  Object.assign(fixture.state,room(3,false,true));await page.reload();await expect(page.getByRole('textbox',{name:'Battle code'})).toHaveValue(problem('p1').starterCode);await page.screenshot({path:'test-results/battle-active.png',fullPage:true});
});
