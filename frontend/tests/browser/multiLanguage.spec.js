import {test, expect} from '@playwright/test';

test('practice language switching preserves separate drafts and sends the selected language to Run', async ({context, page}) => {
  await context.addInitScript(() => localStorage.setItem('token', `test.${btoa(JSON.stringify({id:'language-user'}))}.signature`));
  await context.route('**/health', route => route.fulfill({json:{status:'ok'}}));
  let runPayload;
  const problem = {_id:'language-problem',problemNumber:1,title:'Language test',description:'Test',difficulty:'easy',tags:[],examples:[],constraints:[],starterCode:'// cpp starter',starterCodes:{cpp:'// cpp starter',python:'# python starter',javascript:'// js starter',java:'// java starter'}};
  await context.route('**/api/v1/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    let data = {data:[],pagination:{totalPages:1}};
    if (pathname.endsWith('/users/me')) data = {data:{_id:'language-user',name:'Language User'}};
    else if (pathname.endsWith('/problems/languages')) data = {data:['cpp','python','javascript','java'].map(id => ({id,label:id,ext:id}))};
    else if (pathname.endsWith('/problems/language-problem')) data = {data:problem};
    else if (pathname.endsWith('/problems')) data = {data:{problems:[problem],pagination:{totalPages:1}}};
    else if (pathname.endsWith('/submissions/run')) {
      runPayload = route.request().postDataJSON();
      data = {data:{status:'accepted',results:[],passedTests:0,totalTests:0}};
    }
    await route.fulfill({json:data});
  });
  await page.goto('/problems/language-problem');
  const editor = page.locator('textarea');
  const language = page.getByRole('combobox',{name:'Programming language'});
  await expect(editor).toHaveValue('// cpp starter');
  await editor.fill('// saved cpp');
  await expect(page.getByText('Saved locally',{exact:true})).toBeVisible();
  await language.selectOption('python');
  await expect(editor).toHaveValue('# python starter');
  await editor.fill('print(42)');
  await expect(page.getByText('Saved locally',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:/^Run/}).click();
  await expect.poll(() => runPayload?.language).toBe('python');
  expect(runPayload.code).toBe('print(42)');
  await language.selectOption('cpp');
  await expect(editor).toHaveValue('// saved cpp');
  await language.selectOption('python');
  await expect(editor).toHaveValue('print(42)');
  await page.reload();
  await expect(language).toHaveValue('python');
  await expect(editor).toHaveValue('print(42)');
});
