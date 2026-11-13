import {test,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
const require=createRequire(new URL('../../../backend/package.json',import.meta.url));
const {Server}=require('socket.io');
const {createCollaboration}=require('./src/sockets/collaboration.socket');
let server,io,collaboration,url;const readOnlyProblems=new Set();
test.beforeAll(async()=>{
  server=createServer();io=new Server(server,{cors:{origin:'*'}});
  collaboration=createCollaboration(io,{store:new (require('./src/services/collaborativeDocument.service').MemoryDocumentStore)(),enabled:()=>true,authorize:async(socket,request)=>{
    const teamId=socket.user.id==='beta'?'beta':'alpha';if(request.teamId!==teamId)throw Object.assign(Error('Other team'),{status:403});return {key:JSON.stringify([request.roomId,teamId,request.problemId,request.language]),teamId,userId:socket.user.id,name:socket.user.id,starter:'// shared starter\n',canWrite:!readOnlyProblems.has(request.problemId)};
  }});
  // Test-only session fixture. Production JWT/Redis authorization is exercised
  // separately by collaboration.scenarios.cjs on the real application server.
  io.on('connection',socket=>{socket.user={id:JSON.parse(Buffer.from(socket.handshake.auth.token.split('.')[1],'base64').toString()).id};collaboration.register(socket);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));url=`http://127.0.0.1:${server.address().port}`;
});
test.afterAll(async()=>{await collaboration.close();await new Promise(resolve=>io.close(resolve));});
async function open(browser,userId,options={}){
  const metrics=[];
  const context=await browser.newContext();await context.addInitScript(id=>localStorage.setItem('token',`test.${btoa(JSON.stringify({id}))}.signature`),userId);
  await context.route('**/api/v1/users/me',route=>route.fulfill({json:{data:{_id:userId,name:userId}}}));await context.route('**/api/v1/battles/rooms/*/behaviour',route=>{metrics.push(...route.request().postDataJSON().windows);return route.fulfill({json:{success:true,data:{accepted:1}}});});await context.route('**/health',route=>route.fulfill({json:{status:'ok'}}));
  await context.route('**/src/services/socket.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('http://localhost:3000',url)});});
  const page=await context.newPage();await page.goto('/login');await page.evaluate(async identity=>{if(identity.backup){const {writeDraft,draftKey}=await import('/src/services/draftStorage.js');await writeDraft(draftKey({userId:identity.userId,context:`battle-collaborative-team:${identity.teamId||'alpha'}`,battleId:'room',problemId:identity.problemId||'problem1',language:'cpp'}),identity.backup,0,'test-backup');}const {mount}=await import('/tests/browser/collaborationHarness.jsx');mount(identity);},{userId,...options});await expect(page.getByRole('textbox',{name:'Shared battle code'})).toBeVisible({timeout:25000});return {context,page,metrics};
}
const code=page=>page.evaluate(()=>window.collaborationCode);
test('Monaco typing synchronizes three teammates and displays collaborator presence/cursors',async({browser})=>{
  const a=await open(browser,'one'),b=await open(browser,'two'),c=await open(browser,'three');
  try{
    await a.page.getByRole('textbox',{name:'Shared battle code'}).focus();await a.page.keyboard.press('Control+Home');await a.page.keyboard.type('// from-one\n');
    await expect.poll(()=>code(b.page)).toContain('from-one');await expect.poll(()=>code(c.page)).toContain('from-one');
    await Promise.all([b.page.evaluate(()=>window.collaborationProvider.doc.getText('source').insert(0,'// from-two\n')),c.page.evaluate(()=>window.collaborationProvider.doc.getText('source').insert(0,'// from-three\n'))]);
    await expect.poll(()=>code(a.page)).toContain('from-two');await expect.poll(()=>code(a.page)).toContain('from-three');await expect.poll(()=>code(c.page)).toEqual(await code(a.page));await expect(a.page.getByText('two, three',{exact:true})).toBeVisible();
    await expect.poll(()=>b.page.locator('[class*="yRemoteSelectionHead-"]').count()).toBeGreaterThan(0);
  }finally{await Promise.all([a.context.close(),b.context.close(),c.context.close()]);}
});
test('problem/team identities stay separate and refresh restores the live shared document',async({browser})=>{
  const a=await open(browser,'one',{problemId:'isolated'}),b=await open(browser,'beta',{teamId:'beta',problemId:'isolated'}),c=await open(browser,'two',{problemId:'other'});
  try{
    await a.page.evaluate(()=>window.collaborationProvider.doc.getText('source').insert(0,'PRIVATE-ALPHA'));
    await expect.poll(()=>code(a.page)).toContain('PRIVATE-ALPHA');expect(await code(b.page)).not.toContain('PRIVATE-ALPHA');expect(await code(c.page)).not.toContain('PRIVATE-ALPHA');
    await a.page.reload();await a.page.evaluate(async()=>{const {mount}=await import('/tests/browser/collaborationHarness.jsx');mount({userId:'one',problemId:'isolated'});});await expect.poll(()=>code(a.page)).toContain('PRIVATE-ALPHA');
  }finally{await Promise.all([a.context.close(),b.context.close(),c.context.close()]);}
});
test('provider reconnect merges offline changes without another socket instance',async({browser})=>{
  const a=await open(browser,'one',{problemId:'offline'}),b=await open(browser,'two',{problemId:'offline'});
  try{
    await a.page.evaluate(()=>{const provider=window.collaborationProvider;window.originalCollaborationSocket=provider.socket;provider.socket.disconnect();provider.doc.getText('source').insert(0,'OFFLINE');});await b.page.evaluate(()=>window.collaborationProvider.doc.getText('source').insert(0,'ONLINE'));await a.page.evaluate(()=>window.collaborationProvider.socket.connect());
    await expect.poll(()=>code(a.page)).toContain('ONLINE');await expect.poll(()=>code(b.page)).toContain('OFFLINE');expect(await a.page.evaluate(()=>window.originalCollaborationSocket===window.collaborationProvider.socket)).toBe(true);
  }finally{await Promise.all([a.context.close(),b.context.close()]);}
});
test('a divergent local backup is preserved and can be downloaded before shared editing',async({browser})=>{
  const a=await open(browser,'backup-user',{problemId:'backup',backup:'offline source\n  preserve spaces\n'});
  try{const downloadPromise=a.page.waitForEvent('download');await a.page.getByRole('button',{name:'Download previous local backup'}).click();const download=await downloadPromise;expect(await readFile(await download.path(),'utf8')).toBe('offline source\n  preserve spaces\n');expect(await code(a.page)).toBe('// shared starter\n');}finally{await a.context.close();}
});
test('offline CRDT lineage survives browser refresh and merges with teammates without duplicate starter text',async({browser})=>{
  const a=await open(browser,'offline-refresh-a',{problemId:'offline-refresh'}),b=await open(browser,'offline-refresh-b',{problemId:'offline-refresh'});
  try{
    await a.page.evaluate(()=>{window.collaborationProvider.socket.disconnect();window.collaborationProvider.doc.getText('source').insert(0,'OFFLINE-REFRESH');});
    await expect.poll(()=>a.page.evaluate(async()=>{const {loadCollaborativeCache}=await import('/src/services/collaborationCache.js');const provider=window.collaborationProvider,doc=new provider.doc.constructor();await loadCollaborativeCache(provider.cacheIdentity,doc);const text=doc.getText('source').toString();doc.destroy();return text;})).toContain('OFFLINE-REFRESH');
    await b.page.evaluate(()=>window.collaborationProvider.doc.getText('source').insert(0,'ONLINE-TEAMMATE'));
    await b.page.evaluate(()=>window.collaborationProvider.flush());await a.page.reload();await a.page.evaluate(async()=>{const {mount}=await import('/tests/browser/collaborationHarness.jsx');mount({userId:'offline-refresh-a',problemId:'offline-refresh'});});
    await expect.poll(()=>code(a.page)).toContain('OFFLINE-REFRESH');await expect.poll(()=>code(a.page)).toContain('ONLINE-TEAMMATE');await expect.poll(()=>code(b.page)).toContain('OFFLINE-REFRESH');expect((await code(a.page)).match(/shared starter/g).length).toBe(1);
  }finally{await Promise.all([a.context.close(),b.context.close()]);}
});
test('only local Monaco keyboard edits contribute to typing; remote changes remain remote analytics',async({browser})=>{
  const a=await open(browser,'metrics-a',{problemId:'metrics'}),b=await open(browser,'metrics-b',{problemId:'metrics'});
  try{
    await a.page.getByRole('textbox',{name:'Shared battle code'}).focus();await a.page.keyboard.press('Control+Home');await a.page.keyboard.type('typing-sample');await a.page.evaluate(()=>window.collaborationProvider.flush());await expect.poll(()=>code(b.page)).toContain('typing-sample');
    await a.page.evaluate(()=>window.collaborationProvider.flushAnalytics());await b.page.evaluate(()=>window.collaborationProvider.flushAnalytics());
    expect(a.metrics.at(-1).metrics.keyboardChars).toBeGreaterThan(0);expect(b.metrics.at(-1).metrics.keyboardChars).toBe(0);expect(b.metrics.at(-1).metrics.pasteEvents).toBe(0);expect(b.metrics.at(-1).metrics.contributionChars).toBe(0);expect(b.metrics.at(-1).metrics.remoteUpdates).toBeGreaterThan(0);
  }finally{await Promise.all([a.context.close(),b.context.close()]);}
});
test('battle page uses the shared editor and sends only a document hash through existing Run/Submit',async({browser})=>{
  const context=await browser.newContext(),userId='full-editor';await context.addInitScript(id=>localStorage.setItem('token',`test.${btoa(JSON.stringify({id}))}.signature`),userId);
  await context.route('**/src/services/socket.js',async route=>{const response=await route.fetch();await route.fulfill({response,body:(await response.text()).replace('http://localhost:3000',url)});});
  let runPayload,submissionPayload;const problem={_id:'full-problem',title:'Collaborative example',difficulty:'easy',description:'Edit together in your team.',starterCode:'// shared starter\n',constraints:['Use C++'],examples:[{input:'21',output:'42'}]};
  const room={_id:'room',code:'ABCDEFGH',host:{_id:userId,name:userId},hostType:'PARTICIPANT_HOST',teamSize:2,duration:15,problemCount:1,problems:[problem],teams:[{_id:'alpha',name:'Alpha',lead:userId,members:[{user:{_id:userId,name:userId},ready:true,online:true}]},{_id:'beta',name:'Beta',members:[]}],status:'in_progress',revision:0,startTime:new Date(Date.now()-60000).toISOString(),endTime:new Date(Date.now()+840000).toISOString(),serverTime:new Date().toISOString(),submissions:[],progress:[],collaborationEnabled:true};
  await context.route('**/health',route=>route.fulfill({json:{status:'ok'}}));await context.route('**/api/v1/**',route=>{
    const path=new URL(route.request().url()).pathname;let data={};if(path.endsWith('/users/me'))data={_id:userId,name:userId};else if(path.endsWith('/rooms/room'))data=room;else if(path.endsWith('/limits'))data={maxProblems:20,maxDuration:180};else if(path.includes('/rooms/room/problems/'))data=problem;else if(path.endsWith('/submissions/run')){runPayload=route.request().postDataJSON();data={status:'accepted',passedTests:1,totalTests:1};}else if(path.endsWith('/submissions')){submissionPayload=route.request().postDataJSON();data={submissionId:'shared-submission',status:'pending',enqueueState:'queued'};}else if(path.endsWith('/submissions/shared-submission'))data={status:'accepted',passedTests:1,totalTests:1};return route.fulfill({json:{success:true,data}});
  });
  try{const page=await context.newPage();await page.setViewportSize({width:1440,height:1000});await page.goto('/battle/rooms/room');await expect(page.getByRole('textbox',{name:'Shared battle code'})).toBeVisible({timeout:25000});await expect(page.getByText(/Metrics expire after 30 days/)).toBeVisible();await page.getByRole('button',{name:'Run code',exact:true}).click();await expect.poll(()=>runPayload?.sourceHash).toMatch(/^[a-f0-9]{64}$/);expect(runPayload.code).toBeUndefined();await page.getByRole('button',{name:'Submit code',exact:true}).click();await expect.poll(()=>submissionPayload?.sourceHash).toMatch(/^[a-f0-9]{64}$/);expect(submissionPayload.code).toBeUndefined();await expect(page.getByRole('heading',{name:'Run / submission result'})).toBeVisible();await page.screenshot({path:'../docs/screenshots/collaborative-battle.png',fullPage:true});}finally{await context.close();}
});
test('completed review shows frozen server source while preserving unacknowledged offline text for download',async({browser})=>{
  const a=await open(browser,'completed-review',{problemId:'completed-review'});
  try{
    await a.page.evaluate(()=>{window.collaborationProvider.socket.disconnect();window.collaborationProvider.doc.getText('source').insert(0,'UNACKNOWLEDGED');});
    await expect.poll(()=>a.page.evaluate(async()=>{const {loadCollaborativeCache}=await import('/src/services/collaborationCache.js');const provider=window.collaborationProvider,doc=new provider.doc.constructor();await loadCollaborativeCache(provider.cacheIdentity,doc);const text=doc.getText('source').toString();doc.destroy();return text;})).toContain('UNACKNOWLEDGED');
    readOnlyProblems.add('completed-review');await a.page.reload();await a.page.evaluate(async()=>{const {mount}=await import('/tests/browser/collaborationHarness.jsx');mount({userId:'completed-review',problemId:'completed-review'});});
    await expect(a.page.getByText(/frozen server source shown/)).toBeVisible();await expect(a.page.locator('.monaco-editor .view-lines')).not.toContainText('UNACKNOWLEDGED');const downloadPromise=a.page.waitForEvent('download');await a.page.getByRole('button',{name:'Download previous local backup'}).click();const download=await downloadPromise;expect(await readFile(await download.path(),'utf8')).toContain('UNACKNOWLEDGED');
  }finally{readOnlyProblems.delete('completed-review');await a.context.close();}
});
