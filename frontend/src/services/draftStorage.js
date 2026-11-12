const DB_NAME = 'codeforge-resilience';
let database;
export class DraftConflict extends Error {
  constructor(record) { super('Another tab saved a newer draft.'); this.record = record; }
}
export const draftKey = ({ userId, context = 'practice', problemId, language = 'cpp', battleId = '' }) => {
  if (!userId || !problemId) throw new Error('Draft identity is incomplete.');
  return JSON.stringify([userId, context, problemId, language, battleId]);
};
export function openStorage() {
  if (!database) database = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { reject(new Error('Local storage is unavailable.')); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      for (const name of ['drafts', 'intents']) request.result.createObjectStore(name, { keyPath: 'key' });
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Close older Code Forge tabs to enable local storage.'));
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => { db.close(); database = undefined; };
      resolve(db);
    };
  }).catch(error => { database = undefined; throw error; });
  return database;
}
export function validDraft(record) {
  return record?.schemaVersion === 1 && typeof record.code === 'string' &&
    Number.isSafeInteger(record.revision) && record.revision > 0 &&
    Number.isFinite(record.updatedAt) && typeof record.writerId === 'string';
}
export async function readDraft(key) {
  const db = await openStorage();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readonly');
    const req = tx.objectStore('drafts').get(key);
    tx.oncomplete = () => {
      if (req.result && !validDraft(req.result)) reject(new Error('Saved draft is invalid; current text has been preserved.'));
      else resolve(req.result || null);
    };
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Draft read failed.'));
  });
}
export async function writeDraft(key, code, expectedRevision, writerId) {
  const db = await openStorage();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('drafts', 'readwrite');
    const store = tx.objectStore('drafts');
    let next, failure;
    store.get(key).onsuccess = event => {
      const current = event.target.result;
      if (current && !validDraft(current)) { failure = new Error('Saved draft is invalid. Export your code before clearing storage.'); tx.abort(); return; }
      if ((current?.revision || 0) !== expectedRevision) { failure = new DraftConflict(current); tx.abort(); return; }
      next = { key, code, revision: expectedRevision + 1, schemaVersion: 1, updatedAt: Date.now(), writerId };
      store.put(next);
    };
    tx.oncomplete = () => resolve(next);
    tx.onabort = tx.onerror = () => reject(failure || tx.error || new Error('Draft save failed.'));
  });
}
export async function putIntent(intent) {
  const db = await openStorage();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('intents', 'readwrite');
    tx.objectStore('intents').put(intent);
    tx.oncomplete = () => resolve(intent);
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Could not persist submission intent.'));
  });
}
export async function getIntent(key) {
  const db = await openStorage();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('intents', 'readonly');
    const req = tx.objectStore('intents').get(key);
    tx.oncomplete = () => resolve(req.result || null);
    tx.onabort = tx.onerror = () => reject(tx.error || new Error('Could not read submission intent.'));
  });
}
export async function prepareIntent(key, userId, payload) {
  const db = await openStorage();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('intents','readwrite');const store=tx.objectStore('intents');let result,failure;
    store.get(key).onsuccess=event=>{
      const current=event.target.result;
      if(current && !current.completed) {
        if(JSON.stringify(current.payload)!==JSON.stringify(payload)) {failure=new Error('An earlier submission is unresolved. Recover it before submitting different code.');tx.abort();return;}
        result=current;
      } else {
        result={key,userId,payload,idempotencyKey:crypto.randomUUID(),updatedAt:Date.now(),completed:false};store.put(result);
      }
    };
    tx.oncomplete=()=>resolve(result);
    tx.onabort=tx.onerror=()=>reject(failure||tx.error||new Error('Could not persist submission intent.'));
  });
}
export async function patchIntent(intent, changes) {
  const db=await openStorage();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('intents','readwrite');const store=tx.objectStore('intents');let updated=false;
    store.get(intent.key).onsuccess=event=>{
      const current=event.target.result;
      if(current?.idempotencyKey===intent.idempotencyKey){store.put({...current,...changes});updated=true;}
    };
    tx.oncomplete=()=>resolve(updated);
    tx.onabort=tx.onerror=()=>reject(tx.error||new Error('Intent update failed'));
  });
}
