import {test,expect} from '@playwright/test';

test('edit-problem role changes preserve hook order and only admins load private test cases',async({context,page})=>{
  await context.addInitScript(()=>localStorage.setItem('token',`test.${btoa(JSON.stringify({id:'edit-user'}))}.signature`));
  let loads=0;
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await context.route('**/health',route=>route.fulfill({json:{status:'ok'}}));
  await context.route('**/api/v1/**',async route=>{
    const path=new URL(route.request().url()).pathname;
    let data=[];
    if(path.endsWith('/users/me'))data={_id:'edit-user',name:'Editor',role:'user'};
    if(path.includes('/problems/edit-target')){loads++;data={_id:'edit-target',title:'Editable problem',difficulty:'easy',judgeConfig:{returnType:'int',parameters:[]}};}
    if(path.includes('/testcases')){loads++;data=[];}
    await route.fulfill({json:{success:true,data}});
  });
  await page.goto('/login');
  await page.evaluate(async()=>{const {mount}=await import('/tests/browser/editProblemHarness.jsx');mount();});
  const root=page.locator('#edit-test');
  await expect(root.getByRole('button',{name:'Role:user',exact:true})).toBeVisible();
  await expect(root.getByText('Admin Access Required')).toBeVisible();
  expect(loads).toBe(0);
  await root.getByRole('button',{name:'Role:user',exact:true}).click();
  await expect.poll(()=>loads).toBeGreaterThanOrEqual(2);
  await expect(root.getByText('Admin Access Required')).toHaveCount(0);
  await root.getByRole('button',{name:'Role:admin',exact:true}).click();
  await expect(root.getByText('Admin Access Required')).toBeVisible();
  expect(errors).toEqual([]);
});
