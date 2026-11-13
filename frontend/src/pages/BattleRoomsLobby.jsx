import {useEffect,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import Navbar from '../components/Navbar';
import RoomConfiguration from '../components/RoomConfiguration';
import {roomLimits,myRooms,createRoom,joinRoom,previewRoom} from '../services/battleRoomService';
import {useAuth} from '../context/AuthContext';
import './BattleRooms.css';
export default function BattleRoomsLobby(){
  const navigate=useNavigate();const {verified}=useAuth();
  const [limits,setLimits]=useState({maxProblems:20,maxDuration:180}),[rooms,setRooms]=useState([]),[code,setCode]=useState(''),[team,setTeam]=useState('Alpha'),[preview,setPreview]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[pending,setPending]=useState(false);
  useEffect(()=>{let active=true;Promise.all([roomLimits(),myRooms()]).then(([limits,rooms])=>{if(active){setLimits(limits);setRooms(rooms);}}).catch(()=>{if(active)setError('Room service unavailable. Reconnect and retry.');});return()=>{active=false;};},[verified]);
  // Applicants only receive a safe preview. Stop polling on any error, including 429.
  useEffect(()=>{
    if(!pending||!preview)return;
    let active=true;const timer=setTimeout(async()=>{try{const next=await previewRoom(preview.code);if(!active)return;setPreview(next);if(next.canEnter){setPending(false);navigate(`/battle/rooms/${next.roomId}`);}else if(next.request?.status!=='pending')setPending(false);}catch(error){if(active){setError(error.response?.data?.message||error.message);setPending(false);}}},10000);
    return()=>{active=false;clearTimeout(timer);};
  },[pending,preview,navigate]);
  const perform=async action=>{setError('');setBusy(true);try{const room=await action();if(room.pending){setPreview(await previewRoom(code));setPending(true);}else navigate(`/battle/rooms/${room._id}`);}catch(error){setError(error.response?.data?.message||error.message);}finally{setBusy(false);}};
  const inspect=async(value=code)=>{setBusy(true);setError('');try{const room=await previewRoom(value);setPreview(room);setCode(room.code);setPending(room.request?.status==='pending');if(room.canEnter)navigate(`/battle/rooms/${room.roomId}`);}catch(error){setError(error.response?.data?.message||error.message);}finally{setBusy(false);}};
  return <><Navbar/><main className="battle-rooms"><header className="room-page-header"><div><span className="room-eyebrow">CODEFORGE / BATTLE</span><h1>Your team. Your next challenge.</h1><p>Private rooms for 1v1 to 4v4. Choose a format, invite your team and get ready.</p></div><span className="room-badge">Private battles</span></header>{error&&<div className="room-error" role="alert">{error}</div>}
    <div className="room-grid room-lobby-grid"><section className="room-card"><h2>Create battle</h2><RoomConfiguration limits={limits} busy={busy||!verified} onSave={config=>perform(()=>createRoom(config))}/></section>
    <div><section className="room-card"><h2>Join a room</h2><p>Enter the invite code to see available places and admission rules.</p><form onSubmit={e=>{e.preventDefault();inspect();}}><div className="room-form"><label>Room code<input aria-label="Room code" required maxLength={8} value={code} onChange={e=>{setCode(e.target.value.toUpperCase());setPreview(null);setPending(false);}} placeholder="ABCDEFGH"/></label><button className="room-button" disabled={busy||!verified}>Preview room</button></div></form>
      {preview&&<div className="room-join-preview"><div className="room-row"><strong>{preview.teamSize}v{preview.teamSize}</strong><span className="room-badge">{preview.status}</span></div>{preview.request&&<p role="status">Admission {preview.request.status}{pending?' · Waiting for the team lead or host.':''}</p>}
      <form onSubmit={e=>{e.preventDefault();perform(()=>joinRoom(preview.code,team));}}><label className="room-selection">Join team<select aria-label="Join team" value={team} onChange={e=>setTeam(e.target.value)}>{preview.teams.map(item=><option key={item._id} value={item.name}>{item.name} · {item.occupied} of {item.capacity} · {item.admissionPolicy==='OPEN'?'Open':'Approval required'}</option>)}</select></label><button className="room-button room-button--primary" disabled={busy||!verified||pending||!['waiting','ready'].includes(preview.status)}>{preview.teams.find(item=>item.name===team)?.admissionPolicy==='APPROVAL_REQUIRED'?'Request to join':'Join room'}</button> <button type="button" className="room-button" disabled={busy} onClick={()=>inspect()}>Check status</button></form></div>}
    </section><section className="room-card room-recents"><h2>Recent rooms</h2>{rooms.length===0&&<p>No rooms yet. Create one to get started.</p>}{rooms.map(room=><button className="room-recent-row" key={room._id} onClick={()=>room.isHost||room.team?navigate(`/battle/rooms/${room._id}`):inspect(room.code)}><span><strong>{room.code}</strong><small>{room.team|| (room.isHost?'Host':'Applicant')} · {room.teamSize}v{room.teamSize}</small></span><span className="room-badge">{room.status.replaceAll('_',' ')}</span></button>)}<p className="room-note">Scoring is not yet available for team rooms. Legacy battles retain their existing results.</p></section></div></div>
  </main></>;
}
