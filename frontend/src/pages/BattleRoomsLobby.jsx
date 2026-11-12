import {useEffect,useState} from 'react';
import {useNavigate} from 'react-router-dom';
import Navbar from '../components/Navbar';
import RoomConfiguration from '../components/RoomConfiguration';
import {roomLimits,myRooms,createRoom,joinRoom} from '../services/battleRoomService';
import {useAuth} from '../context/AuthContext';
import './BattleRooms.css';
export default function BattleRoomsLobby(){
  const navigate=useNavigate();const {verified}=useAuth();
  const [limits,setLimits]=useState({maxProblems:20,maxDuration:180}),[rooms,setRooms]=useState([]),[code,setCode]=useState(''),[team,setTeam]=useState('Alpha'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;Promise.all([roomLimits(),myRooms()]).then(([limits,rooms])=>{if(active){setLimits(limits);setRooms(rooms);}}).catch(()=>{if(active)setError('Room service unavailable. Reconnect and retry.');});return()=>{active=false;};},[verified]);
  const perform=async action=>{setError('');setBusy(true);try{const room=await action();navigate(`/battle/rooms/${room._id}`);}catch(error){setError(error.response?.data?.message||error.message);}finally{setBusy(false);}};
  return <><Navbar/><main className="battle-rooms"><h1>Private battle rooms</h1><p>Choose 1v1 through 4v4. Share a code, select problems and start when both teams are ready.</p>{error&&<div className="room-error" role="alert">{error}</div>}
    <div className="room-grid"><section className="room-card"><h2>Create battle</h2><RoomConfiguration limits={limits} busy={busy||!verified} onSave={config=>perform(()=>createRoom(config))}/></section>
    <section className="room-card"><h2>Join a private room</h2><form onSubmit={e=>{e.preventDefault();perform(()=>joinRoom(code,team));}}><div className="room-form"><label>Room code<input aria-label="Room code" required maxLength={8} value={code} onChange={e=>setCode(e.target.value.toUpperCase())}/></label><label>Team<select aria-label="Join team" value={team} onChange={e=>setTeam(e.target.value)}><option>Alpha</option><option>Beta</option></select></label></div><button className="room-button room-button--primary" disabled={busy||!verified}>Join room</button></form>
    <h2 style={{marginTop:24}}>Your recent rooms</h2>{rooms.map(room=><div className="room-row" key={room._id}><button className="room-button" onClick={()=>navigate(`/battle/rooms/${room._id}`)}>{room.code} · {room.teamSize}v{room.teamSize} · {room.status}</button></div>)}
    <p className="room-warning">Scoring for these new rooms is reserved for the next phase. Historical 1v1 battles keep their existing result rules.</p></section></div>
  </main></>;
}
