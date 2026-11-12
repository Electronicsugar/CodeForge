import './DraftStatus.css';
export default function DraftStatus({ draft, filename }) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([draft.code], {type:'text/plain'}));
    const extension = {cpp:'cpp',python:'py',javascript:'js',java:'java'}[draft.language] || 'txt';
    const link = document.createElement('a'); link.href = url; link.download = filename || `codeforge-draft.${extension}`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const conflict = draft.multiTab && draft.conflict;
  return <div role="status" className={`draft-status${conflict ? ' draft-status--conflict' : ''}`}>
    <div className="draft-status__row">
    <span className="draft-status__message">{conflict ? <><strong className="draft-status__warning">Draft conflict</strong> — Another tab has saved a newer version. Your current editor contents have not been changed.</> : draft.status}
    {draft.status === 'Save failed' ? ': Your text remains in this editor. ' + (draft.error || '') : ''}</span>
    <div className="draft-status__actions">
    {conflict && <><button className="draft-action" type="button" disabled={draft.resolving} onClick={() => draft.resolve(false)}>Load saved version</button>
      <button className="draft-action draft-action--primary" type="button" disabled={draft.resolving} onClick={() => draft.resolve(true)}>Keep my version</button></>}
    {(conflict || draft.status === 'Save failed') && <button className="draft-action" type="button" onClick={download}>Download backup</button>}
    {draft.ownership === 'occupied' && <button className="draft-action" type="button" onClick={draft.retryOwnership}>Retry editor access</button>}
    </div></div>
  </div>;
}
