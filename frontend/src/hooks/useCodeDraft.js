import { useEffect, useRef, useState } from 'react';
import { draftKey, readDraft, writeDraft, DraftConflict } from '../services/draftStorage';
import { draftChannel } from '../services/draftChannel';

// A session belongs to an immutable editor identity. Async completions never write
// into a different session, even when navigation happens during a transaction.
export function useCodeDraft(identity, starterCode = '', ready = true) {
  const key = identity.userId && identity.problemId ? draftKey(identity) : null;
  const writer = useRef(crypto.randomUUID());
  const active = useRef(null);
  const [, render] = useState(0);
  const redraw = session => { if (active.current === session) render(n => n + 1); };
  if (active.current?.key !== key) {
    active.current = {key, code:'', revision:0, initialized:false, dirty:false, status:'Loading draft', conflict:null, saving:false};
  }
  const session = active.current;
  const channel = useRef(null);
  const save = async target => {
    if (!target.key || !target.initialized || !target.dirty || target.conflict || target.saving || target.blocked) return;
    target.saving = true;
    target.status = 'Saving'; redraw(target);
    const source = target.code;
    try {
      const record = await writeDraft(target.key, source, target.revision, writer.current);
      target.revision = record.revision;
      target.dirty = target.code !== source;
      target.status = target.dirty ? 'Unsaved changes' : 'Saved locally';
      channel.current?.send({key:target.key, revision:record.revision, writerId:writer.current});
    } catch (error) {
      if (error instanceof DraftConflict) { target.conflict = error.record; target.status = 'Draft conflict'; }
      else { target.status = 'Save failed'; target.error = error.message; }
    } finally {
      target.saving = false; redraw(target);
      if (target.dirty && target.status === 'Unsaved changes') target.timer = setTimeout(() => save(target), 750);
    }
  };
  useEffect(() => {
    if (!session.key || !ready || session.initialized) return;
    let cancelled = false;
    readDraft(session.key).then(record => {
      if (cancelled) return;
      session.revision = record?.revision || 0;
      if (session.dirty && record && record.code !== session.code) {
        session.conflict = record; session.status = 'Draft conflict';
      } else if (!session.dirty) {
        session.code = record ? record.code : starterCode;
        session.status = record ? 'Draft restored' : 'Ready';
      }
      session.initialized = true;
      if (session.dirty && !session.conflict) session.timer = setTimeout(() => save(session), 750);
      redraw(session);
    }).catch(error => {
      if (cancelled) return;
      if (!session.dirty) session.code = starterCode;
      session.initialized = true; session.blocked = true;
      session.status = 'Save failed'; session.error = error.message; redraw(session);
    });
    return () => { cancelled = true; };
  }, [key, ready, starterCode]);
  useEffect(() => {
    const check = async notification => {
      if (!session.key || !session.initialized || (notification && (notification.key !== session.key || notification.writerId === writer.current))) return;
      try {
        const record = await readDraft(session.key);
        if (record && record.revision > session.revision && record.writerId !== writer.current) {
          clearTimeout(session.timer); session.conflict = record; session.status = 'Draft conflict'; redraw(session);
        }
      } catch (error) { session.status = 'Save failed'; session.error = error.message; redraw(session); }
    };
    const bus = draftChannel(check); channel.current = bus;
    const onFocus = () => check();
    const flush = () => { clearTimeout(session.timer); void save(session); };
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      flush(); bus.close();
      window.removeEventListener('focus', onFocus); window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [key]);
  const setCode = value => {
    session.code = typeof value === 'function' ? value(session.code) : value;
    session.dirty = true; session.status = session.blocked ? 'Save failed' : session.conflict ? 'Draft conflict' : 'Unsaved changes';
    clearTimeout(session.timer);
    session.timer = setTimeout(() => save(session), 750); redraw(session);
  };
  const resolve = async keepCurrent => {
    try {
      const record = await readDraft(session.key);
      if (active.current !== session) return;
      if (!keepCurrent) {
        // UI offers download before replacing text; replacement is explicit.
        session.code = record?.code ?? session.code; session.dirty = false;
      }
      session.revision = record?.revision || 0; session.conflict = null;
      session.status = keepCurrent ? 'Unsaved changes' : 'Draft restored';
      if (keepCurrent) { session.dirty = true; await save(session); }
      redraw(session);
    } catch (error) { session.status = 'Save failed'; session.error = error.message; redraw(session); }
  };
  return {code:session.code, setCode, status:session.status, error:session.error, conflict:session.conflict, resolve, initialized:session.initialized};
}
