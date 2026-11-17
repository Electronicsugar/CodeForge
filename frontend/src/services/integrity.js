// Editor interaction observations. Client signals are estimates and can be
// bypassed; they do not establish cheating or trigger automatic penalties.
//
// Privacy: paste-event text is used only to measure its length, never retained
// or transmitted. No global clipboard access is used.

/**
 * @param {{send:(type:string, meta?:object)=>void, scope?:()=>Element|null, enabled:()=>boolean}} opts
 * @returns {{noteChange:(prevLen:number,nextLen:number,inputType?:string)=>void, dispose:()=>void}}
 */
export function attachIntegrityListeners({ send, scope, enabled }) {
  const capture = {capture: true};
  const inScope = (target) => {
    const el = scope?.();
    return scope ? Boolean(el && target instanceof Node && el.contains(target)) : true;
  };
  const emit = (type, meta) => { if (enabled()) send(type, meta); };

  let hiddenAt = null;
  const onVisibility = () => {
    if (document.hidden) { hiddenAt = Date.now(); emit('tab_hidden'); }
    else { emit('tab_visible', { awayMs: hiddenAt ? Date.now() - hiddenAt : 0 }); hiddenAt = null; }
  };
  const onBlur = () => emit('window_blur');
  const onFocus = () => emit('window_focus');
  const onPaste = (e) => {
    if (!enabled() || !inScope(e.target)) return;
    const length = e.clipboardData?.getData('text')?.length ?? 0;
    emit('paste', { length });
  };
  const onCopy = (e) => {
    if (!enabled() || !inScope(e.target)) return;
    const length = window.getSelection?.()?.toString().length ?? 0;
    emit(e.type === 'cut' ? 'cut' : 'copy', { length });
  };
  const onContext = (e) => { if (inScope(e.target)) emit('context_menu'); };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('blur', onBlur);
  window.addEventListener('focus', onFocus);
  // capture phase: the paste report must reach the server BEFORE the editor's own
  // change handler sends the next code_sync, otherwise the jump looks unexplained
  document.addEventListener('paste', onPaste, capture);
  document.addEventListener('copy', onCopy, capture);
  document.addEventListener('cut', onCopy, capture);
  document.addEventListener('contextmenu', onContext, capture);

  return {
    // Large single-step growth that was NOT a paste (drag & drop, autofill, extensions)
    noteChange(prevLen, nextLen, inputType = '') {
      if (inputType === 'insertFromPaste' || inputType === 'insertFromPasteAsQuotation') return;
      if (nextLen - prevLen >= 80) emit('large_insert', { length: nextLen - prevLen });
    },
    dispose() {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('paste', onPaste, capture);
      document.removeEventListener('copy', onCopy, capture);
      document.removeEventListener('cut', onCopy, capture);
      document.removeEventListener('contextmenu', onContext, capture);
    },
  };
}
