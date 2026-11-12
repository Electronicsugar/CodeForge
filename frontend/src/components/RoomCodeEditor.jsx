import {useEffect,useState} from 'react';
import {useAuth} from '../context/AuthContext';
import {useCodeDraft} from '../hooks/useCodeDraft';
import {useSubmissionRecovery} from '../hooks/useSubmissionRecovery';
import {roomProblem} from '../services/battleRoomService';
import {runCode,createSubmission} from '../services/submissionService';
import DraftStatus from './DraftStatus';
export default function RoomCodeEditor({room,teamId,problemId}){
  const {user,verified}=useAuth();const userId=user?._id||user?.id;
  const [problem,setProblem]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[result,setResult]=useState(null);
  const context=`battle-team:${teamId}`;
  const draft=useCodeDraft({userId,context,problemId,language:'cpp',battleId:room._id},problem?.starterCode||'',problem?._id===problemId);
  const recovery=useSubmissionRecovery({problem:problemId,context,roomId:room._id,enabled:verified&&draft.canEdit},setResult);
  useEffect(()=>{let active=true;roomProblem(room._id,problemId).then(problem=>{if(active)setProblem(problem);}).catch(error=>{if(active)setError(error.response?.data?.message||error.message);});return()=>{active=false;};},[room._id,problemId,verified]);
  const editable=verified&&draft.canEdit&&room.status==='in_progress';
  const execute=async submit=>{
    if(!editable||busy)return;setBusy(true);setError('');
    try{
      await draft.flush();const payload={problem:problemId,language:'cpp',code:draft.code,roomId:room._id};
      if(submit){const response=await createSubmission({...payload,userId,context});setResult(response.data);recovery.recover();}
      else {const response=await runCode(payload);setResult(response.data);}
    }catch(error){setError(error.response?.data?.message||error.message);}finally{setBusy(false);}
  };
  const tab=event=>{
    if(event.key==='Tab'&&editable){event.preventDefault();const editor=event.target,start=editor.selectionStart,end=editor.selectionEnd;draft.setCode(draft.code.slice(0,start)+'    '+draft.code.slice(end));requestAnimationFrame(()=>{editor.selectionStart=editor.selectionEnd=start+4;});}
  };
  return <section className="room-editor"><div className="room-card"><h2>{problem?.title||'Loading selected problem…'}</h2><p>{problem?.description}</p>{problem?.examples?.map((example,index)=><pre key={index}>Input: {example.input}{'\n'}Output: {example.output}</pre>)}<p>Team {room.teams.find(team=>team._id===teamId)?.name} · C++ · One editor tab per participant</p></div>
    <DraftStatus draft={draft}/><textarea aria-label="Battle code" value={draft.code} onChange={event=>draft.setCode(event.target.value)} onKeyDown={tab} readOnly={!draft.canEdit||draft.resolving||room.status!=='in_progress'} wrap="off" spellCheck={false}/>
    <div className="room-card room-row"><button className="room-button" disabled={!editable||busy} onClick={()=>execute(false)}>Run code</button><button className="room-button room-button--primary" disabled={!editable||busy} onClick={()=>execute(true)}>Submit code</button><button className="room-button" disabled={!verified||!draft.canEdit} onClick={recovery.recover}>Recover submission status</button></div>
    {(error||recovery.error)&&<div role="alert" className="room-error">{error||recovery.error}</div>}
    {result&&<pre role="status">{JSON.stringify({status:result.status,passedTests:result.passedTests,totalTests:result.totalTests,error:result.error,enqueueState:result.enqueueState},null,2)}</pre>}
  </section>;
}
