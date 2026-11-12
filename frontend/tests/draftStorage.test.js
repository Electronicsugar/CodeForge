import 'fake-indexeddb/auto';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftKey, readDraft, writeDraft, DraftConflict, openStorage, putIntent, getIntent,prepareIntent,patchIntent } from '../src/services/draftStorage.js';
test('draft identity isolates user, problem, language, context and battle', () => {
  const base = { userId: 'a', problemId: 'p' };
  const keys = [base, {...base,userId:'b'}, {...base,problemId:'q'}, {...base,language:'python'}, {...base,context:'contest'}, {...base,battleId:'b'}].map(draftKey);
  assert.equal(new Set(keys).size, 6);
});
test('exact source persists and stale simultaneous writes cannot overwrite it', async () => {
  const key = draftKey({userId:'storage',problemId:'p'});
  assert.equal(await readDraft(key), null);
  const results = await Promise.allSettled([writeDraft(key, 'first\n', 0, 'a'), writeDraft(key, 'second', 0, 'b')]);
  assert.equal(results.filter(r=>r.status==='fulfilled').length, 1);
  assert.ok(results.find(r=>r.status==='rejected').reason instanceof DraftConflict);
  const saved = await readDraft(key);
  assert.equal(saved.code, 'first\n');
  assert.equal(saved.schemaVersion, 1);
  const next = await writeDraft(key, '', saved.revision, 'b');
  assert.equal(next.revision, 2);
  assert.equal((await readDraft(key)).code, '');
});
test('corrupt records are rejected without replacement', async () => {
  const db = await openStorage();
  await new Promise(resolve=>{const tx=db.transaction('drafts','readwrite');tx.objectStore('drafts').put({key:'corrupt',code:42});tx.oncomplete=resolve;});
  await assert.rejects(readDraft('corrupt'), /invalid/);
  await assert.rejects(writeDraft('corrupt','keep editor',0,'a'), /invalid/);
});
test('submission intent survives subsequent reads', async () => {
  await putIntent({key:'intent',userId:'a',idempotencyKey:'uuid',payload:{code:'source'}});
  assert.equal((await getIntent('intent')).payload.code,'source');
});
test('concurrent intent preparation reuses one key; ambiguous intent cannot change payload',async()=>{
  const [a,b]=await Promise.all([prepareIntent('active','a',{code:'same'}),prepareIntent('active','a',{code:'same'})]);
  assert.equal(a.idempotencyKey,b.idempotencyKey);
  await assert.rejects(prepareIntent('active','a',{code:'different'}),/unresolved/);
  await putIntent({...a,completed:true});
  const next=await prepareIntent('active','a',{code:'different'});
  assert.notEqual(a.idempotencyKey,next.idempotencyKey);
  assert.equal(await patchIntent(a,{submissionId:'stale-id'}),false);
  assert.equal((await getIntent('active')).submissionId,undefined);
});
