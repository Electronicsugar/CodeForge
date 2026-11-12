import {test,expect} from '@playwright/test';
const problem = id => ({_id:id,problemNumber:1,title:'Persistence test',description:'Test',difficulty:'easy',tags:[],examples:[],constraints:[],starterCode:'// starter'});
async function mock(context, userId='user-a') {
  await context.addInitScript(id=>localStorage.setItem('token',`test-${id}`),userId);
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
