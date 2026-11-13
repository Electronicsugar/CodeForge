import {draftKey,readDraft,writeDraft} from './draftStorage.js';
// Preserve an unsynchronized text backup before the live CRDT replaces the
// displayed draft. Phase two will persist CRDT lineage for automatic merging.
export async function preserveCollaborationBackup(identity,sharedCode){
  if(!identity.userId)return null;
  const previous=await readDraft(draftKey(identity));
  if(!previous||previous.code===sharedCode)return null;
  const archiveIdentity={...identity,context:`${identity.context}:recovery:${crypto.randomUUID()}`};
  await writeDraft(draftKey(archiveIdentity),previous.code,0,crypto.randomUUID());
  return previous.code;
}
