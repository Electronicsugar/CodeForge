import {test} from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import * as Y from 'yjs';
import {cacheKey,loadCollaborativeCache,saveCollaborativeCache} from '../src/services/collaborationCache.js';
test('cached CRDT lineage survives refresh and concurrent cache writes merge without lost edits',async()=>{
  const seed=new Y.Doc();seed.getText('source').insert(0,'starter');const a=new Y.Doc(),b=new Y.Doc();for(const doc of [a,b])Y.applyUpdate(doc,Y.encodeStateAsUpdate(seed));a.getText('source').insert(0,'offline-A');b.getText('source').insert(0,'offline-B');
  const key=cacheKey({userId:'a',roomId:'r',teamId:'alpha',problemId:'p',language:'cpp'});await Promise.all([saveCollaborativeCache(key,a),saveCollaborativeCache(key,b)]);const fresh=new Y.Doc();await loadCollaborativeCache(key,fresh);const text=fresh.getText('source').toString();assert.ok(text.includes('offline-A'));assert.ok(text.includes('offline-B'));assert.equal(text.match(/starter/g).length,1);
  const other=new Y.Doc();await loadCollaborativeCache(cacheKey({userId:'b',roomId:'r',teamId:'alpha',problemId:'p',language:'cpp'}),other);assert.equal(other.getText('source').length,0);for(const doc of [seed,a,b,fresh,other])doc.destroy();
});
