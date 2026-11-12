export default function DraftStatus({ draft }) {
  const download = () => {
    const url = URL.createObjectURL(new Blob([draft.code], {type:'text/plain'}));
    const link = document.createElement('a'); link.href = url; link.download = 'codeforge-draft.cpp'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <div role="status" style={{fontSize:12, padding:'6px 10px', color:'var(--text-secondary)', display:'flex', gap:8, flexWrap:'wrap'}}>
    <span>{draft.status}{draft.status === 'Save failed' ? ': Your text remains in this editor. ' + (draft.error || '') : ''}</span>
    {draft.conflict && <><span>Another tab has a saved version. Your text is unchanged.</span>
      <button type="button" onClick={() => draft.resolve(false)}>Load saved version</button>
      <button type="button" onClick={() => draft.resolve(true)}>Keep my version</button></>}
    {(draft.conflict || draft.status === 'Save failed') && <button type="button" onClick={download}>Download current code</button>}
  </div>;
}
