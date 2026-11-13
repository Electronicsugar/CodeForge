import {useRef,useState} from 'react';
import {changeRoom} from '../services/battleRoomService';
export default function AdmissionNotifications({room,userId,verified,onState,onRefresh}){
  const [processing,setProcessing]=useState(null),[errors,setErrors]=useState({}),[results,setResults]=useState({});const working=useRef(false);
  const allowed=request=>room.host._id===userId||room.teams.some(team=>team._id===request.teamId&&team.lead===userId);
  const pending=[...new Map((room.admissions||[]).filter(request=>request.status==='pending'&&allowed(request)).map(request=>[request._id,request])).values()];
  const decide=async(request,decision)=>{
    if(working.current||!verified)return;working.current=true;setProcessing(request._id);setErrors(previous=>({...previous,[request._id]:null}));
    try{const state=await changeRoom(room._id,'admission',{requestId:request._id,decision});setResults(previous=>({...previous,[request._id]:{...request,status:decision}}));onState(state);}
    catch(error){setErrors(previous=>({...previous,[request._id]:error.response?.data?.message||'Could not decide this request. Please retry.'}));if(error.response?.status===409)await onRefresh();}
    finally{working.current=false;setProcessing(null);}
  };
  const completed=Object.values(results).filter(allowed);
  const dismiss=id=>{setResults(previous=>({...previous,[id]:{...previous[id],closing:true}}));setTimeout(()=>setResults(previous=>{const next={...previous};delete next[id];return next;}),180);};
  if(!pending.length&&!completed.length)return null;
  return <section className="room-admission-notifications" aria-label="Admission notifications" aria-live="polite"><div className="room-row"><h2>Admission requests</h2><span className="room-badge">{pending.length} pending</span></div>{[...pending,...completed.filter(request=>!pending.some(item=>item._id===request._id))].map(request=>{
    const team=room.teams.find(team=>team._id===request.teamId),active=request.status==='pending',loading=processing===request._id;
    return <article key={request._id} className={`room-admission-notice${request.closing?' room-admission-notice--closing':''}`} aria-label={`${request.user.name} admission to ${team?.name}`}><div><strong>{request.user.name}</strong><p>Team {team?.name} · Room {room.code}</p><span className="room-badge">{loading?'Processing…':request.status}</span>{errors[request._id]&&<p role="alert" className="room-error">{errors[request._id]}</p>}</div><div className="room-row">{active?<><button className="room-button room-button--primary" disabled={!verified||Boolean(processing)||team?.members.length>=room.teamSize} onClick={()=>decide(request,'approved')}>{loading?'Processing…':`Approve ${request.user.name}`}</button><button className="room-button" disabled={!verified||Boolean(processing)} onClick={()=>decide(request,'rejected')}>Reject {request.user.name}</button>{team?.members.length>=room.teamSize&&<span>Team is full</span>}</>:<button className="room-button" aria-label={`Dismiss ${request.user.name} admission result`} disabled={request.closing} onClick={()=>dismiss(request._id)}>Dismiss</button>}</div></article>;
  })}</section>;
}
