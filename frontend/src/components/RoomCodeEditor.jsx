import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {useAuth} from '../context/AuthContext';
import {useCodeDraft} from '../hooks/useCodeDraft';
import {useSubmissionRecovery} from '../hooks/useSubmissionRecovery';
import {roomProblem} from '../services/battleRoomService';
import {runCode,createSubmission} from '../services/submissionService';
import DraftStatus from './DraftStatus';
import LanguageSelect from './LanguageSelect';
import {useLanguage} from '../hooks/useLanguage';
import {starterFor,languageExt} from '../services/languages';
import {draftKey,readDraft} from '../services/draftStorage';
const CollaborativeBattleEditor=lazy(()=>import('./CollaborativeBattleEditor'));
export default function RoomCodeEditor({room,teamId,problemId,onLocalEdit}){
  const {user,verified}=useAuth();const userId=user?._id||user?.id;
  const [problem,setProblem]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState(null);
  const collaborationEnabled=room.collaborationEnabled===true&&import.meta.env.VITE_BATTLE_COLLABORATION!=='false';
  const collaborative=collaborationEnabled;
  const provider=useRef(null);
  const {language,setLanguage,languages}=useLanguage();
  const [previousPrivate,setPreviousPrivate]=useState(null);
  const context=collaborationEnabled?`battle-collaborative-team:${teamId}`:`battle-team:${teamId}`;
  const draft=useCodeDraft({userId:teamId?userId:null,context,ownershipContext:`battle-team:${teamId}`,problemId,language,battleId:room._id},starterFor(problem,language),Boolean(teamId)&&problem?._id===problemId);
  const recovery=useSubmissionRecovery({problem:problemId,context,roomId:room._id,enabled:verified&&Boolean(teamId)&&draft.canEdit},setResult);
  const previousRecovery=useSubmissionRecovery({problem:problemId,context:`battle-team:${teamId}`,roomId:room._id,enabled:collaborationEnabled&&verified&&Boolean(teamId)&&draft.canEdit},setResult);
  useEffect(()=>{let active=true;setPreviousPrivate(null);if(collaborationEnabled&&userId&&teamId)readDraft(draftKey({userId,context:`battle-team:${teamId}`,problemId,language,battleId:room._id})).then(record=>{if(active&&record)setPreviousPrivate(record.code);}).catch(()=>{if(active)setError('The previous private draft could not be read. It has not been replaced.');});return()=>{active=false;};},[collaborationEnabled,userId,teamId,problemId,room._id,language]);
  useEffect(()=>{let active=true;roomProblem(room._id,problemId).then(problem=>{if(active)setProblem(problem);}).catch(error=>{if(active)setError(error.response?.data?.message||error.message);});return()=>{active=false;};},[room._id,problemId,verified]);
  const canWrite=draft.canEdit&&!draft.resolving&&room.status==='in_progress';
  const editable=verified&&canWrite;
  const execute=async submit=>{
    if(!editable||busy)return;setBusy(true);setError('');
    try{
      let snapshot;
      if(collaborative){if(!provider.current)throw new Error('Shared document is still synchronizing');snapshot=await provider.current.flush();}
      await draft.flush();const payload={problem:problemId,language,...(collaborative?{collaborative:true,sourceHash:snapshot.hash}:{code:draft.code}),roomId:room._id};
      if(submit){const response=await createSubmission({...payload,userId,context});setResult(response.data);recovery.recover();}
      else {const response=await runCode(payload);setResult(response.data);}
    }catch(error){setError(error.response?.data?.message||error.message);}finally{setBusy(false);}
  };
  const tab=event=>{
    if(event.key==='Tab'&&canWrite){event.preventDefault();const editor=event.target,start=editor.selectionStart,end=editor.selectionEnd;draft.setCode(draft.code.slice(0,start)+'    '+draft.code.slice(end));requestAnimationFrame(()=>{editor.selectionStart=editor.selectionEnd=start+4;});}
  };
  const history=room.submissions.filter(submission=>submission.user===userId&&submission.problem===problemId);
  return <><section className="room-statement"><span className="room-eyebrow">PROBLEM / {problem?.difficulty}</span><h2>{problem?.title||'Loading selected problem…'}</h2><p className="room-description">{problem?.description}</p>{problem?.examples?.map((example,index)=><div className="room-example" key={index}><h3>Example {index+1}</h3><pre>Input: {example.input}{'\n'}Output: {example.output}</pre>{example.explanation&&<p>{example.explanation}</p>}</div>)}{problem?.constraints?.length>0&&<><h3>Constraints</h3><ul className="room-constraints">{problem.constraints.map((constraint,index)=><li key={index}>{constraint}</li>)}</ul></>}{!teamId&&error&&<p role="alert" className="room-error">{error}</p>}</section>
    <section className="room-editor">{teamId?<><header className="room-editor-heading"><h2>Code editor</h2><span className="room-badge">{languages.find(item=>item.id===language)?.label||language} · {room.teams.find(team=>team._id===teamId)?.name}</span><LanguageSelect language={language} languages={languages} disabled={busy||!draft.canEdit} onChange={async value=>{if(busy)return;setBusy(true);try{await provider.current?.flush();await draft.flush();setResult(null);setLanguage(value);}catch(error){setError(error.message);}finally{setBusy(false);}}}/></header><p className="room-note">{collaborative?'Shared team document · teammates using the same language edit together · local backup':'Your private draft'} · one editor tab per participant</p><DraftStatus draft={draft}/>{collaborative&&draft.canEdit?<Suspense fallback={<p>Loading shared editor…</p>}><CollaborativeBattleEditor key={language} language={language} battleEnd={room.endTime} onLocalEdit={onLocalEdit} verified={verified} userId={userId} roomId={room._id} teamId={teamId} problemId={problemId} readOnly={!canWrite} onChange={draft.setCode} onProvider={value=>{provider.current=value;}}/></Suspense>:<textarea aria-label="Battle code" value={draft.code} onChange={event=>{onLocalEdit?.(draft.code.length,event.target.value.length,event.nativeEvent?.inputType);draft.setCode(event.target.value);}} onKeyDown={tab} readOnly={!canWrite} wrap="off" spellCheck={false}/>}
    <div className="room-editor-actions"><button className="room-button" disabled={!editable||busy} onClick={()=>execute(false)}>Run code</button><button className="room-button room-button--primary" disabled={!editable||busy} onClick={()=>execute(true)}>Submit code</button><button className="room-button" disabled={!verified||!draft.canEdit} onClick={()=>{recovery.recover();if(collaborationEnabled)previousRecovery.recover();}}>Recover submission status</button></div>
    {previousPrivate!==null&&<button className="room-button" onClick={()=>{const url=URL.createObjectURL(new Blob([previousPrivate],{type:'text/plain'}));const link=document.createElement('a');link.href=url;link.download=`codeforge-previous-private-draft.${languageExt(languages,language)}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Download previous private draft</button>}
    {(error||recovery.error||previousRecovery.error)&&<div role="alert" className="room-error">{error||recovery.error||`Previous private submission: ${previousRecovery.error}`}</div>}<div className="room-results" role="status"><h3>Run / submission result</h3>{result?<><strong>{result.status||result.enqueueState||'Pending'}</strong>{result.totalTests!==undefined&&<p>{result.passedTests||0} / {result.totalTests} tests passed</p>}{result.error&&<pre>{result.error}</pre>}</>:<p>Run your code to see results here.</p>}</div><div className="room-results"><h3>Your submission history</h3>{history.length?history.map(submission=><p key={submission._id}>{submission.status} · {new Date(submission.createdAt).toLocaleTimeString()}</p>):<p>No submissions for this problem.</p>}</div></>:<div className="room-monitor"><h2>Host monitoring</h2><p>Follow both teams in the activity panel. Competitors’ source code stays private.</p><p>Editing and submission are available to competitors only.</p></div>}</section></>;
}
