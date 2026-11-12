import {test,expect,chromium} from '@playwright/test';
import {readFile} from 'node:fs/promises';
test('late initialization preserves edits and language contexts stay isolated',async({page})=>{
  await page.goto('/login');
  await page.evaluate(async()=>{const root=document.createElement('div');root.id='harness-root';document.body.append(root);const {mount}=await import('/tests/browser/harness.jsx');mount();});
  const editor=page.getByRole('textbox',{name:'harness editor'});
  await editor.fill('edited before metadata');await page.getByRole('button',{name:'Metadata ready'}).click();
  await expect(page.getByText('Saved locally',{exact:true})).toBeVisible();
  await expect(editor).toHaveValue('edited before metadata');
  await page.getByRole('button',{name:'Switch language'}).click();
  await expect(editor).toHaveValue('late starter');
  await editor.fill('python draft');await expect(page.getByText('Saved locally',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Switch language'}).click();await expect(editor).toHaveValue('edited before metadata');
});
const problem = id => ({_id:id,problemNumber:1,title:'Persistence test',description:'Test',difficulty:'easy',tags:[],examples:[],constraints:[],starterCode:'// starter'});
async function mock(context, userId='user-a') {
  await context.addInitScript(id=>{if(!localStorage.getItem('token'))localStorage.setItem('token',`test.${btoa(JSON.stringify({id}))}.signature`);},userId);
  await context.route('**/health',route=>route.fulfill({json:{status:'ok'}}));
  await context.route('**/api/v1/**', async route=>{
    const path=new URL(route.request().url()).pathname;
    let data={};
    if(path.endsWith('/users/me')) data={data:{_id:userId,name:'Test User'}};
    else if(/\/problems\/[^/]+$/.test(path)) data={data:problem(path.split('/').pop())};
    else if(path.endsWith('/problems')) data={data:{problems:[problem('p'),problem('q')],pagination:{totalPages:1}}};
    else data={data:[],pagination:{totalPages:1}};
    await route.fulfill({json:data});
  });
}
test('exact source restores after refresh; problem identities are separate',async({context,page})=>{
  await mock(context);
  await page.goto('/problems/p');
  const editor=page.locator('textarea');
  await expect(editor).toHaveValue('// starter');
  await editor.fill('int main() {\n  return 42;\n}\n');
  await expect(page.getByText('Saved locally',{exact:true})).toBeVisible();
  await page.reload();
  await expect(editor).toHaveValue('int main() {\n  return 42;\n}\n');
  await page.goto('/problems/q');
  await expect(editor).toHaveValue('// starter');
  await page.goto('/problems/p');
  await expect(editor).toHaveValue('int main() {\n  return 42;\n}\n');
});
test('saved draft survives closing and reopening the browser with the same profile',async({},info)=>{
  const profile=info.outputPath('browser-profile');
  let context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true});
  try {
    await mock(context);let page=await context.newPage();await page.goto('http://localhost:5180/problems/p');
    await expect(page.locator('textarea')).toHaveValue('// starter');
    await page.locator('textarea').fill('browser restart source');
    await expect(page.getByText('Saved locally',{exact:true})).toBeVisible();
    await context.close();
    context=await chromium.launchPersistentContext(profile,{channel:'msedge',headless:true});
    await mock(context);page=await context.newPage();await page.goto('http://localhost:5180/problems/p');
    await expect(page.locator('textarea')).toHaveValue('browser restart source');
  } finally {await context.close();}
});
test('offline editing saves locally and temporary auth failure retains the token',async({context,page})=>{
  await mock(context);await page.goto('/problems/p');
  await expect(page.locator('textarea')).toHaveValue('// starter');
  await context.setOffline(true);
  await expect(page.getByText('Offline',{exact:true})).toBeVisible();
  await page.locator('textarea').fill('offline source');
  await expect(page.getByText('Saved locally',{exact:true})).toBeVisible();
  await context.setOffline(false);
  await context.route('**/users/me',route=>route.fulfill({status:503,json:{message:'Dependency unavailable'}}));
  await page.reload();
  await expect(page.locator('textarea')).toHaveValue('offline source');
  expect(await page.evaluate(()=>!!localStorage.getItem('token'))).toBe(true);
  await expect(page.getByText(/Local editing only/)).toBeVisible();
});
test('different account on the same origin never restores the previous account draft',async({context,page})=>{
  await mock(context);await page.goto('/problems/p');
  await expect(page.locator('textarea')).toHaveValue('// starter');
  await page.locator('textarea').fill('private user-a');
  await expect(page.getByText('Saved locally',{exact:true})).toBeVisible();
  await page.evaluate(()=>localStorage.setItem('token','test.'+btoa(JSON.stringify({id:'user-b'}))+'.signature'));
  await context.route('**/users/me',route=>route.fulfill({json:{data:{_id:'user-b',name:'User B'}}}));
  await page.reload();await expect(page.locator('textarea')).toHaveValue('// starter');
});
test('two tabs preserve losing text and require explicit resolution',async({context,page})=>{
  await mock(context);await page.goto('/problems/p');
  await expect(page.locator('textarea')).toHaveValue('// starter');
  const second=await context.newPage();await second.goto('/problems/p');
  await expect(second.locator('textarea')).toHaveValue('// starter');
  await page.locator('textarea').fill('tab one');
  await expect(page.getByText('Saved locally',{exact:true})).toBeVisible();
  await expect(second.getByText('Draft conflict',{exact:true})).toBeVisible();
  await expect(second.locator('textarea')).toHaveValue('// starter');
  await second.locator('textarea').fill('tab two kept');
  await second.getByRole('button',{name:'Keep my version'}).click();
  await expect(second.getByText('Saved locally',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Load saved version'}).click();
  await expect(page.locator('textarea')).toHaveValue('tab two kept');
});
test('storage failure preserves editor contents',async({context,page})=>{
  await mock(context);
  await context.addInitScript(()=>{Object.defineProperty(window,'indexedDB',{get(){throw new Error('Simulated storage failure');}});});
  await page.goto('/problems/p');
  await expect(page.getByText(/Save failed/)).toBeVisible();
  await page.locator('textarea').fill('still editable');
  await page.waitForTimeout(1000);
  await expect(page.locator('textarea')).toHaveValue('still editable');
});
test('lost submission acknowledgement and refresh reuse the persisted key and original ID',async({context,page})=>{
  await mock(context);
  let key,created=0,calls=0;
  await context.route('**/api/v1/submissions',async route=>{
    if(route.request().method()!=='POST')return route.fallback();
    const received=route.request().headers()['idempotency-key'];
    expect(received).toBeTruthy();
    if(!key){key=received;created++;}else expect(received).toBe(key);
    if(++calls===1)return route.abort('failed');
    await route.fulfill({json:{success:true,data:{submissionId:'original-id',status:'pending',enqueueState:'queued'}}});
  });
  await context.route('**/api/v1/submissions/original-id',route=>route.fulfill({json:{data:{_id:'original-id',status:'accepted',passedTests:1,totalTests:1,sampleResults:[]}}}));
  await page.goto('/problems/p');await expect(page.locator('textarea')).toHaveValue('// starter');
  await page.locator('textarea').fill('submitted once');
  await page.locator('#submit-code-btn').click();
  await expect.poll(()=>calls).toBeGreaterThanOrEqual(1);
  await page.reload();
  await expect(page.locator('textarea')).toHaveValue('submitted once');
  await expect.poll(()=>calls).toBeGreaterThanOrEqual(2);
  await expect(page.locator('.dp-verdict-chip').filter({hasText:'Accepted'}).first()).toBeVisible();
  expect(created).toBe(1);
});
test('battle refresh and reconnect preserve draft and refetch authoritative state',async({context,page})=>{
  await mock(context);
  await context.route('**/src/services/socket.js',route=>route.fulfill({contentType:'text/javascript',body:`
    const handlers=new Map();
    const socket={connected:true,on(n,h){if(!handlers.has(n))handlers.set(n,new Set());handlers.get(n).add(h);},off(n,h){handlers.get(n)?.delete(h);},emit(n){if(n==='rejoin_battle')window.rejoins=(window.rejoins||0)+1;},connect(){socket.connected=true;for(const h of handlers.get('connect')||[])h();}};
    window.testSocket=socket;export const getSocket=()=>socket;export const disconnectSocket=()=>{};
  `}));
  let reads=0;
  await context.route('**/api/v1/battles/b1',route=>{reads++;return route.fulfill({json:{data:{_id:'b1',status:'in_progress',problem:problem('p'),player1:{user:{_id:'user-a',name:'A'},initialRating:1200},player2:{user:{_id:'user-b',name:'B'},initialRating:1200}}}});});
  await page.goto('/battle/b1');await expect(page.locator('textarea')).toHaveValue('// starter');
  await page.locator('textarea').fill('battle draft');await expect(page.getByText('Saved locally',{exact:true})).toBeVisible();
  const before=reads;await page.evaluate(()=>window.testSocket.connect());
  await expect.poll(()=>reads).toBeGreaterThan(before);
  await expect(page.locator('textarea')).toHaveValue('battle draft');
  await page.reload();await expect(page.locator('textarea')).toHaveValue('battle draft');
});
test('403 retains the account; 401 expires it without deleting its draft',async({context,page})=>{
  await mock(context);await page.goto('/problems/p');
  await expect(page.locator('textarea')).toHaveValue('// starter');
  await page.locator('textarea').fill('retained after auth failure');
  await expect(page.getByText('Saved locally',{exact:true})).toBeVisible();
  await context.route('**/users/me',route=>route.fulfill({status:403,json:{message:'Forbidden'}}));
  await page.reload();await expect(page.locator('textarea')).toHaveValue('retained after auth failure');
  expect(await page.evaluate(()=>!!localStorage.getItem('token'))).toBe(true);
  await context.route('**/users/me',route=>route.fulfill({status:401,json:{message:'Expired'}}));
  await page.reload();await expect(page).toHaveURL(/\/login$/);
  expect(await page.evaluate(()=>localStorage.getItem('token'))).toBeNull();
  const drafts=await page.evaluate(async()=>{
    const {openStorage}=await import('/src/services/draftStorage.js');const db=await openStorage();
    return new Promise(resolve=>{const request=db.transaction('drafts').objectStore('drafts').getAll();request.onsuccess=()=>resolve(request.result);});
  });
  expect(drafts.some(draft=>draft.code==='retained after auth failure')).toBe(true);
});
test('repeated socket access while disconnected reuses one instance',async({context,page})=>{
  await mock(context);await page.goto('/problems/p');await expect(page.locator('textarea')).toHaveValue('// starter');
  expect(await page.evaluate(async()=>{
    const {getSocket}=await import('/src/services/socket.js');const first=getSocket();
    return !!first&&getSocket()===first&&getSocket()===first;
  })).toBe(true);
});
test('quota failure keeps text editable and fallback tab notifications detect changes',async({context,page})=>{
  await context.addInitScript(()=>{window.BroadcastChannel=undefined;});
  await mock(context);await page.goto('/problems/p');await expect(page.locator('textarea')).toHaveValue('// starter');
  const second=await context.newPage();await second.goto('/problems/p');await expect(second.locator('textarea')).toHaveValue('// starter');
  await page.locator('textarea').fill('fallback saved');await expect(page.getByText('Saved locally',{exact:true})).toBeVisible();
  await expect(second.getByText('Draft conflict',{exact:true})).toBeVisible();
  await second.close();
  await page.evaluate(()=>{
    const original=IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put=function(...args){if(this.name==='drafts')throw new DOMException('Simulated quota failure','QuotaExceededError');return original.apply(this,args);};
  });
  await page.locator('textarea').fill('quota unsaved source');await expect(page.getByText(/Save failed/)).toBeVisible();
  await expect(page.locator('textarea')).toHaveValue('quota unsaved source');
});
test('practice conflict actions stay compact, keep exact text without downloading and export only on backup',async({context,page},info)=>{
  await mock(context);await page.goto('/problems/p');await expect(page.locator('textarea')).toHaveValue('// starter');
  const second=await context.newPage();await second.goto('/problems/p');await expect(second.locator('textarea')).toHaveValue('// starter');
  const exact='// local version\nint main() { return 17; }\n';
  await page.locator('textarea').fill(exact);await expect(page.getByText('Saved locally',{exact:true})).toBeVisible();
  await expect(second.getByText('Draft conflict',{exact:true})).toBeVisible();
  const local='// retain exact whitespace\n  return 23;\n';await second.locator('textarea').fill(local);
  const downloads=[];second.on('download',download=>downloads.push(download));
  const box=await second.getByRole('button',{name:'Keep my version',exact:true}).boundingBox();
  expect(box.height).toBeLessThan(40);expect(box.width).toBeLessThan(170);
  const layout=await second.locator('textarea').evaluate(node=>{
    const rect=node.getBoundingClientRect(),parent=node.parentElement.getBoundingClientRect();
    return {editorWidth:rect.width,parentWidth:parent.width,wrap:node.wrap};
  });
  expect(layout.editorWidth).toBeGreaterThan(layout.parentWidth-65);expect(layout.wrap).toBe('off');
  const bg=await second.getByRole('button',{name:'Keep my version',exact:true}).evaluate(node=>getComputedStyle(node).backgroundColor);
  expect(bg).not.toBe('rgb(255, 255, 255)');
  await second.screenshot({path:info.outputPath('practice-conflict.png')});
  await second.setViewportSize({width:600,height:900});
  const mobile=await second.getByRole('button',{name:'Keep my version',exact:true}).boundingBox();
  expect(mobile.height).toBeLessThan(40);expect(mobile.x+mobile.width).toBeLessThanOrEqual(600);
  await second.screenshot({path:info.outputPath('practice-conflict-small.png'),fullPage:true});
  await second.setViewportSize({width:1280,height:720});
  await second.getByRole('button',{name:'Keep my version',exact:true}).click();
  await expect(second.getByText('Saved locally',{exact:true})).toBeVisible();
  await expect(second.locator('textarea')).toHaveValue(local);expect(downloads).toHaveLength(0);
  await expect(page.getByText('Draft conflict',{exact:true})).toBeVisible();
  const backup=page.waitForEvent('download');await page.getByRole('button',{name:'Download backup',exact:true}).click();
  const file=await backup;expect(file.suggestedFilename()).toBe('codeforge-draft.cpp');expect(await readFile(await file.path(),'utf8')).toBe(exact);
  await expect(page.locator('textarea')).toHaveValue(exact);await expect(page.getByText('Draft conflict',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Load saved version',exact:true}).click();await expect(page.locator('textarea')).toHaveValue(local);
  await second.reload();await expect(second.locator('textarea')).toHaveValue(local);
});
test('an intervening write during Keep my version remains an unresolved conflict',async({context,page})=>{
  await mock(context);await page.goto('/problems/p');await expect(page.locator('textarea')).toHaveValue('// starter');
  const second=await context.newPage();await second.goto('/problems/p');await expect(second.locator('textarea')).toHaveValue('// starter');
  await page.locator('textarea').fill('first committed');await expect(page.getByText('Saved locally',{exact:true})).toBeVisible();
  await expect(second.getByText('Draft conflict',{exact:true})).toBeVisible();await second.locator('textarea').fill('my exact version');
  await second.evaluate(()=>{
    const transaction=IDBDatabase.prototype.transaction;let once=true;
    IDBDatabase.prototype.transaction=function(stores,mode,...args){
      if(once&&stores==='drafts'&&mode==='readwrite'){
        once=false;const rival=transaction.call(this,stores,mode,...args);const store=rival.objectStore('drafts');
        store.openCursor().onsuccess=event=>{const cursor=event.target.result;if(cursor){const record=cursor.value;cursor.update({...record,revision:record.revision+1,code:'rival committed',writerId:'rival'});}};
      }
      return transaction.call(this,stores,mode,...args);
    };
  });
  await second.getByRole('button',{name:'Keep my version',exact:true}).click();
  await expect(second.getByText('Draft conflict',{exact:true})).toBeVisible();await expect(second.locator('textarea')).toHaveValue('my exact version');
  await second.getByRole('button',{name:'Load saved version',exact:true}).click();await expect(second.locator('textarea')).toHaveValue('rival committed');
});
for(const mode of ['battle','contest'])test(`${mode} owns one editor tab while preserving saves, refresh and visibility flush`,async({context,page})=>{
  await mock(context);
  let url='/problems/p?contestId=c1';
  if(mode==='battle'){
    url='/battle/b1';
    await context.route('**/api/v1/battles/b1',route=>route.fulfill({json:{data:{_id:'b1',status:'in_progress',problem:problem('p'),player1:{user:{_id:'user-a',name:'A'},initialRating:1200},player2:{user:{_id:'user-b',name:'B'},initialRating:1200}}}}));
  }else await context.route('**/api/v1/contests/c1',route=>route.fulfill({json:{data:{data:{_id:'c1',problems:[problem('p')],startTime:new Date().toISOString(),endTime:new Date(Date.now()+3600000).toISOString()}}}}));
  await page.goto(url);await expect(page.locator('textarea')).toHaveValue('// starter');await expect(page.locator('textarea')).not.toHaveAttribute('readonly');
  await page.locator('textarea').fill(`${mode} saved`);await expect(page.getByText('Saved locally',{exact:true})).toBeVisible();
  const second=await context.newPage();await second.goto(url);
  await expect(second.getByText(/this editor is active in another tab/)).toBeVisible();await expect(second.locator('textarea')).toHaveAttribute('readonly');
  await expect(second.getByRole('button',{name:'Keep my version'})).toHaveCount(0);
  await expect(second.getByRole('button',{name:'Load saved version'})).toHaveCount(0);
  await expect(second.getByRole('button',{name:mode==='battle'?'Submit Code':'Submit',exact:true})).toBeDisabled();
  await page.locator('textarea').fill(`${mode} flushed on hide`);
  await page.evaluate(()=>{Object.defineProperty(document,'visibilityState',{configurable:true,get:()=> 'hidden'});document.dispatchEvent(new Event('visibilitychange'));});
  await expect(page.getByText('Saved locally',{exact:true})).toBeVisible();
  await page.reload();await expect(page.locator('textarea')).toHaveValue(`${mode} flushed on hide`);
  await page.close();await second.getByRole('button',{name:'Retry editor access'}).click();
  await expect(second.locator('textarea')).not.toHaveAttribute('readonly');await expect(second.locator('textarea')).toHaveValue(`${mode} flushed on hide`);
  await second.locator('textarea').fill(`${mode} new owner`);await expect(second.getByText('Saved locally',{exact:true})).toBeVisible();
});
for(const [language,extension] of [['python','py'],['javascript','js']])test(`backup preserves ${language} source and extension`,async({page})=>{
  await page.goto('/login');
  const source='// exact backup\n  whitespace\n';
  await page.evaluate(async({language,source})=>{const root=document.createElement('div');root.id='harness-root';document.body.append(root);const {mountBackup}=await import('/tests/browser/harness.jsx');mountBackup(language,source);},{language,source});
  const pending=page.waitForEvent('download');await page.getByRole('button',{name:'Download backup',exact:true}).click();
  const file=await pending;expect(file.suggestedFilename()).toBe(`codeforge-draft.${extension}`);expect(await readFile(await file.path(),'utf8')).toBe(source);
  await expect(page.getByText('Draft conflict',{exact:true})).toBeVisible();
});
