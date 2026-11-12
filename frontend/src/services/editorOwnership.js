// Native Web Locks are released by the browser on refresh, tab close or crash.
// Unlike a localStorage lease they cannot grant two tabs ownership in a race.
export function claimEditor(scope, onState) {
  if (!navigator.locks?.request) {
    onState('unsupported');
    return () => {};
  }
  let disposed = false, release;
  navigator.locks.request(`codeforge-editor:${scope}`, {ifAvailable:true}, async lock => {
    if (disposed) return;
    if (!lock) { onState('occupied'); return; }
    onState('owned');
    await new Promise(resolve => { release = resolve; if (disposed) resolve(); });
  }).catch(() => { if (!disposed) onState('unsupported'); });
  return () => { disposed = true; release?.(); };
}
