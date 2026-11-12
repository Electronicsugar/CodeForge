import {useCallback,useEffect,useRef,useState} from 'react';
import {useNavigate,useParams,useSearchParams} from 'react-router-dom';
import {useAuth} from '../context/AuthContext';
import {getSocket} from '../services/socket';
import {fetchRoom,changeRoom,roomLimits} from '../services/battleRoomService';
import RoomConfiguration from '../components/RoomConfiguration';
import RoomCodeEditor from '../components/RoomCodeEditor';
import Navbar from '../components/Navbar';
import './BattleRooms.css';
export default function BattleRoom(){
  const {roomId}=useParams(),navigate=useNavigate(),{user,verified}=useAuth();
  const [params,setParams]=useSearchParams();const [room,setRoom]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[now,setNow]=useState(Date.now()),[offset,setOffset]=useState(0),[copied,setCopied]=useState(false),[limits,setLimits]=useState({maxProblems:20,maxDuration:180});
  const current=useRef(null),generation=useRef(0),mounted=useRef(true);const userId=user?._id||user?.id;
  const activeRoom=useRef(roomId);activeRoom.current=roomId;
  const apply=useCallback(state=>{
    if(!mounted.current||activeRoom.current!==roomId||state._id!==roomId)return;
    if(current.current&&state.revision<current.current.revision)return;
    current.current=state;setRoom(state);setOffset(new Date(state.serverTime).getTime()-Date.now());setError('');
  },[roomId]);
  const refresh=useCallback(async()=>{
    const request=++generation.current;
    try{const state=await fetchRoom(roomId);if(request===generation.current)apply(state);}catch(error){if(mounted.current&&request===generation.current)setError(error.response?.data?.message||error.message);}
  },[roomId,apply]);
  useEffect(()=>{
    mounted.current=true;if(current.current?._id!==roomId){current.current=null;setRoom(null);}const requestRoom=roomId;
    roomLimits().then(setLimits).catch(()=>{});refresh();
    const socket=verified?getSocket():null;
    const rejoin=()=>{socket?.emit('battle_room_join',{roomId:requestRoom});refresh();};
    const changed=event=>{if(event.roomId===requestRoom&&(!current.current||event.revision===undefined||event.revision>=current.current.revision))refresh();};
    const state=state=>{if(state._id===requestRoom)refresh();};
    const denied=event=>setError(event.message);
    socket?.on('connect',rejoin);socket?.on('battle_room_updated',changed);socket?.on('battle_room_presence',changed);socket?.on('battle_room_state',state);
    socket?.on('battle_room_error',denied);
    if(socket?.connected)rejoin();const poll=setInterval(refresh,10000);
    return()=>{mounted.current=false;clearInterval(poll);socket?.emit('battle_room_unsubscribe',{roomId:requestRoom});socket?.off('connect',rejoin);socket?.off('battle_room_updated',changed);socket?.off('battle_room_presence',changed);socket?.off('battle_room_state',state);socket?.off('battle_room_error',denied);};
  },[roomId,verified,refresh,apply]);
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),500);return()=>clearInterval(timer);},[]);
  const act=async(action,data)=>{if(!verified)return;setBusy(true);try{const state=await changeRoom(roomId,action,data);if(action==='leave')navigate('/battle');else apply(state);}catch(error){setError(error.response?.data?.message||error.message);}finally{setBusy(false);}};
  if(!room)return <><Navbar/><main className="battle-rooms"><h1>Battle room</h1><p role="status">{error||'Loading room…'}</p><button className="room-button" onClick={refresh}>Retry</button></main></>;
  const host=room.host._id===userId;
  const team=room.teams.find(team=>team.members.some(member=>member.user._id===userId));
  const member=team?.members.find(member=>member.user._id===userId);
  const waiting=['waiting','ready'].includes(room.status);
  const selected=room.problems.find(problem=>problem._id===params.get('problem'))||room.problems[0];
  const remaining=room.endTime?Math.max(0,Math.ceil((new Date(room.endTime).getTime()-now-offset)/1000)):room.duration*60;
  const reason=room.teams.some(team=>team.members.length!==room.teamSize)?'Both teams must be full':room.teams.some(team=>team.members.some(member=>!member.ready))?'Every competitor must mark ready':'Ready to start';
  return <><Navbar/><main className="battle-rooms"><div className="room-row"><h1>{room.teamSize}v{room.teamSize} battle</h1><span>{room.status.replaceAll('_',' ').toUpperCase()}</span>{!waiting&&<span className="room-clock" aria-label="Battle countdown">{Math.floor(remaining/60)}:{String(remaining%60).padStart(2,'0')}</span>}</div>
    {error&&<div role="alert" className="room-error">{error}</div>}
    <div className="room-row"><span className="room-code">{room.code}</span><button className="room-button" onClick={async()=>{try{await navigator.clipboard.writeText(room.code);setCopied(true);}catch{setError('Copy unavailable. Select and copy the room code manually.');}}}>{copied?'Copied':'Copy code'}</button><span>Host: {room.host.name} · {room.hostType==='EXTERNAL_HOST'?'External host':'Participant host'}</span></div>
    <p>{room.duration} minutes · {room.problemCount} selected problems · Host {host?(waiting?'configuration enabled':'monitoring/competition only'):'managed'} · Team scores are reserved for the next scoring phase.</p>
    <div className="room-grid">{room.teams.map(item=><section className="room-card" key={item._id}><h2>Team {item.name} · Score {item.score}</h2><ul className="room-roster">{Array.from({length:room.teamSize},(_,index)=>{const member=item.members[index];return <li key={index}>{member?`${member.user.name} · ${member.ready?'Ready':'Not ready'} · ${member.online?'Connected':'Offline'}`:'Open slot'}</li>;})}</ul>{waiting&&member&&team._id!==item._id&&<button className="room-button" disabled={busy||!verified} onClick={()=>act('team',{teamId:item._id})}>Switch to {item.name}</button>}</section>)}</div>
    {waiting&&<section className="room-card" style={{marginTop:18}}><h2>Waiting room</h2><p>{reason}</p>{member&&<button className="room-button" disabled={busy||!verified} onClick={()=>act('ready',{ready:!member.ready})}>{member.ready?'Mark not ready':'Mark ready'}</button>} {member&&!host&&<button className="room-button" disabled={busy||!verified} onClick={()=>act('leave')}>Leave room</button>}
      {host&&<><div className="room-row"><button className="room-button room-button--primary" disabled={!room.canStart||busy||!verified} onClick={()=>act('start')}>Start battle</button><button className="room-button" disabled={busy||!verified} onClick={()=>act('reset-ready')}>Reset readiness</button><button className="room-button" disabled={busy||!verified} onClick={()=>act('cancel')}>Cancel room</button></div><h2>Host configuration</h2><RoomConfiguration key={`${room._id}:${room.duration}:${room.problems.map(p=>p._id).join(',')}`} initial={{duration:room.duration,problemCount:room.problemCount,problems:room.problems}} limits={limits} busy={busy||!verified} label="Save configuration" onSave={config=>act('configure',config)}/></>}
      {!host&&<p>The {room.problemCount} selected problem(s) unlock at the server-recorded start time.</p>}</section>}
    {!waiting&&room.status!=='cancelled'&&<><section className="room-card" style={{marginTop:18}}><h2>Selected problems</h2><nav className="room-nav">{room.problems.map(problem=><button className="room-button" key={problem._id} aria-current={selected?._id===problem._id} onClick={()=>setParams({problem:problem._id})}>{problem.title} · {problem.difficulty}</button>)}</nav><div className="room-row">{room.teams.map(team=><span key={team._id}>{team.name}: {(room.progress||[]).filter(item=>item.teamId===team._id&&item.solved).length}/{room.problemCount} solved</span>)}</div></section>
      {team&&selected&&<RoomCodeEditor key={`${room._id}:${team._id}:${selected._id}`} room={room} teamId={team._id} problemId={selected._id}/>}
      {!team&&<p className="room-warning">Monitoring only — external hosts cannot edit or submit.</p>}
      <section className="room-card" style={{marginTop:18}}><h2>Submission activity</h2><table className="room-table"><thead><tr><th>Team</th><th>Participant</th><th>Problem</th><th>Status</th></tr></thead><tbody>{room.submissions.map(submission=><tr key={submission._id}><td>{room.teams.find(team=>team._id===submission.teamId)?.name}</td><td>{room.teams.flatMap(team=>team.members).find(member=>member.user._id===submission.user)?.user.name||'Participant'}</td><td>{room.problems.find(problem=>problem._id===submission.problem)?.title}</td><td>{submission.status}</td></tr>)}</tbody></table></section></>}
  </main></>;
}
