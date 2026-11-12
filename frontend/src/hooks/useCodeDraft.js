import { useEffect, useRef, useState, useCallback } from 'react';
import { draftKey, readDraft, writeDraft, DraftConflict } from '../services/draftStorage';
import { draftChannel } from '../services/draftChannel';
import {claimEditor} from '../services/editorOwnership';

// A session belongs to an immutable editor identity. Async completions never write
// into a different session, even when navigation happens during a transaction.
export function useCodeDraft(identity, starterCode = '', ready = true) {
  const key = identity.userId && identity.problemId ? draftKey(identity) : null;
  const multiTab = (identity.context || 'practice') === 'practice' && !identity.battleId;
  const scope = !multiTab && identity.userId ? JSON.stringify([identity.userId,identity.context,identity.battleId || '']) : null;
  const [ownership,setOwnership]=useState({scope:null,state:'waiting'});
  const [ownershipAttempt,setOwnershipAttempt]=useState(0);
  const sessions=useRef(new Set());
  const writer = useRef(crypto.randomUUID());
  const active = useRef(null);
  const [, render] = useState(0);
  const redraw = useCallback(session => { if (active.current === session) render(n => n + 1); }, []);
  if (active.current?.key !== key) {
    active.current = {key, scope, multiTab, owned:multiTab, code:'', revision:0, initialized:false, dirty:false, status:'Loading draft', conflict:null, saving:false,resolving:false};
    if(!multiTab)sessions.current.add(active.current);
  }
  const session = active.current;
  const channel = useRef(null);
  const save = useCallback(async function persist(target) {
    if (!target.key || !target.owned || !target.initialized || !target.dirty || target.conflict || target.saving || target.blocked || target.resolving) return;
    target.saving = true;
    target.status = 'Saving'; redraw(target);
    const source = target.code;
    try {
      const record = await writeDraft(target.key, source, target.revision, writer.current);
      target.revision = record.revision;
      target.dirty = target.code !== source;
      target.status = target.dirty ? 'Unsaved changes' : 'Saved locally';
      if(target.multiTab) channel.current?.send({key:target.key, revision:record.revision, writerId:writer.current});
    } catch (error) {
      if (error instanceof DraftConflict) {
        if(target.multiTab){target.conflict = error.record; target.status = 'Draft conflict';}
        else {target.blocked=true;target.status='Save failed';target.error='This draft changed outside the active editor. Download your current code, then reload to recover safely.';}
      }
      else { target.status = 'Save failed'; target.error = error.message; }
    } finally {
      target.saving = false; redraw(target);
      if (target.dirty && target.status === 'Unsaved changes') target.timer = setTimeout(() => persist(target), 750);
    }
  }, [redraw]);
  useEffect(()=>{
    if(!scope)return;
    const ownedSessions=sessions.current;
    const release=claimEditor(scope,state=>setOwnership({scope,state}));
    return()=>{
      // Finish already-started saves before another tab can own this editor.
      const closing=[...ownedSessions].filter(target=>target.scope===scope);
      void Promise.all(closing.map(async target=>{
        clearTimeout(target.timer);
        while(target.saving||target.resolving)await new Promise(resolve=>setTimeout(resolve,20));
        await save(target);target.owned=false;
        ownedSessions.delete(target);
      })).finally(release);
    };
  },[scope,ownershipAttempt,save]);
  const ownsEditor=multiTab || (ownership.scope===scope&&ownership.state==='owned');
  useEffect(() => {
    if (!session.key || !ready || !ownsEditor || session.initialized) return;
    session.owned=true;
    let cancelled = false;
    readDraft(session.key).then(record => {
      if (cancelled) return;
      session.revision = record?.revision || 0;
      if (session.multiTab && session.dirty && record && record.code !== session.code) {
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
  }, [session, ready, starterCode, save, redraw,ownsEditor]);
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
    const bus = session.multiTab ? draftChannel(check) : null; channel.current = bus;
    const onFocus = () => check();
    const flush = () => { clearTimeout(session.timer); void save(session); };
    const hidden = () => { if (document.visibilityState === 'hidden') flush(); };
    if(session.multiTab)window.addEventListener('focus', onFocus);
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      flush(); bus?.close();
      window.removeEventListener('focus', onFocus); window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', hidden);
    };
  }, [session, save, redraw]);
  const setCode = value => {
    if(!multiTab && (!ownsEditor||!session.initialized||session.blocked))return;
    session.code = typeof value === 'function' ? value(session.code) : value;
    session.dirty = true; session.status = session.blocked ? 'Save failed' : session.conflict ? 'Draft conflict' : 'Unsaved changes';
    clearTimeout(session.timer);
    session.timer = setTimeout(() => save(session), 750); redraw(session);
  };
  const resolve = async keepCurrent => {
    if(!session.multiTab || !session.conflict || session.resolving)return;
    clearTimeout(session.timer);
    session.resolving=true;redraw(session);
    try {
      while(session.saving)await new Promise(resolve=>setTimeout(resolve,20));
      const record = await readDraft(session.key);
      if (active.current !== session) return;
      if (!keepCurrent) {
        // UI offers download before replacing text; replacement is explicit.
        session.code = record?.code ?? session.code; session.dirty = false;
        session.revision=record?.revision||0;session.conflict=null;session.status='Draft restored';
      } else {
        // The choice is committed with the latest revision as its CAS precondition.
        // Do not clear the conflict or advertise success before transaction commit.
        const source=session.code;
        const saved=await writeDraft(session.key,source,record?.revision||0,writer.current);
        session.revision=saved.revision;session.conflict=null;
        session.dirty=session.code!==source;session.status=session.dirty?'Unsaved changes':'Saved locally';
        channel.current?.send({key:session.key,revision:saved.revision,writerId:writer.current});
      }
      redraw(session);
    } catch (error) {
      if(error instanceof DraftConflict){session.conflict=error.record;session.status='Draft conflict';}
      else {session.status='Save failed';session.error=error.message;}
      redraw(session);
    } finally {
      session.resolving=false;redraw(session);
      if(session.dirty&&!session.conflict)session.timer=setTimeout(()=>save(session),750);
    }
  };
  const flush = async () => {
    clearTimeout(session.timer);
    while(session.saving) await new Promise(resolve=>setTimeout(resolve,20));
    await save(session);
  };
  const ownerState=ownsEditor?'owned':ownership.scope===scope?ownership.state:'waiting';
  const status=!multiTab&&!ownsEditor ? ownerState==='occupied'?'Multi-tab disabled — this editor is active in another tab.':ownerState==='unsupported'?'Multi-tab disabled — use a browser with secure single-tab locking.':'Checking editor access' : session.status;
  return {code:session.code, setCode, status, error:session.error, conflict:session.conflict, resolve, flush, initialized:session.initialized,multiTab,language:identity.language||'cpp',resolving:session.resolving,ownership:ownerState,canEdit:multiTab||ownsEditor&&session.initialized&&!session.blocked,retryOwnership:()=>setOwnershipAttempt(n=>n+1)};
}
