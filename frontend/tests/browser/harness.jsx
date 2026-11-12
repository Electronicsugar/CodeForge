import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useCodeDraft} from '../../src/hooks/useCodeDraft';
import DraftStatus from '../../src/components/DraftStatus';
function Harness(){
  const [language,setLanguage]=useState('cpp');
  const [ready,setReady]=useState(false);
  const draft=useCodeDraft({userId:'harness-user',problemId:'harness-problem',language},'late starter',ready);
  return <><textarea aria-label="harness editor" value={draft.code} onChange={e=>draft.setCode(e.target.value)}/><span>{draft.status}</span><button onClick={()=>setReady(true)}>Metadata ready</button><button onClick={()=>setLanguage(language==='cpp'?'python':'cpp')}>Switch language</button></>;
}
export function mount(){createRoot(document.getElementById('harness-root')).render(<Harness/>);}
export function mountBackup(language,source){
  const root=document.getElementById('harness-root');
  root.style.cssText='position:fixed;top:12px;left:12px;right:12px;z-index:2000';
  createRoot(root).render(<DraftStatus draft={{code:source,language,multiTab:true,conflict:{revision:2},status:'Draft conflict',resolve:()=>{}}}/>);
}
