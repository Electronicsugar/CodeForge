import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {useCodeDraft} from '../../src/hooks/useCodeDraft';
function Harness(){
  const [language,setLanguage]=useState('cpp');
  const [ready,setReady]=useState(false);
  const draft=useCodeDraft({userId:'harness-user',problemId:'harness-problem',language},'late starter',ready);
  return <><textarea aria-label="harness editor" value={draft.code} onChange={e=>draft.setCode(e.target.value)}/><span>{draft.status}</span><button onClick={()=>setReady(true)}>Metadata ready</button><button onClick={()=>setLanguage(language==='cpp'?'python':'cpp')}>Switch language</button></>;
}
export function mount(){createRoot(document.getElementById('harness-root')).render(<Harness/>);}
