import {test} from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import {draftKey,readDraft,writeDraft,openStorage} from '../src/services/draftStorage.js';
import {preserveCollaborationBackup} from '../src/services/collaborationBackup.js';
test('divergent offline backup is durably archived without changing the current or private draft',async()=>{
  const identity={userId:'backup-user',context:'battle-collaborative-team:alpha',battleId:'room',problemId:'problem',language:'cpp'};
  await writeDraft(draftKey(identity),'offline edits\n',0,'writer');
  assert.equal(await preserveCollaborationBackup(identity,'server text'),'offline edits\n');
  assert.equal((await readDraft(draftKey(identity))).code,'offline edits\n');
  const db=await openStorage();const records=await new Promise((resolve,reject)=>{const tx=db.transaction('drafts');const request=tx.objectStore('drafts').getAll();request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  assert.ok(records.some(record=>record.key.includes(':recovery:')&&record.code==='offline edits\n'));
  assert.equal(await preserveCollaborationBackup(identity,'offline edits\n'),null);
});
