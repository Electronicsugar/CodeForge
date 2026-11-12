import {useEffect,useState} from 'react';
import {getProblems} from '../services/problemService';
export default function RoomConfiguration({initial,limits,onSave,label='Create room',busy}){
  const [form,setForm]=useState(()=>initial||{teamSize:1,hostType:'PARTICIPANT_HOST',hostTeam:'Alpha',duration:15,problemCount:1,problems:[]});
  const [catalogue,setCatalogue]=useState([]),[search,setSearch]=useState(''),[page,setPage]=useState(1),[pages,setPages]=useState(1),[error,setError]=useState('');
  useEffect(()=>{
    let active=true;const timer=setTimeout(()=>getProblems({search,page,limit:20}).then(result=>{if(active){setCatalogue(result.data.problems);setPages(result.data.pagination?.totalPages||1);}}).catch(()=>{if(active)setError('Problem catalogue could not be loaded');}),250);
    return()=>{active=false;clearTimeout(timer);};
  },[search,page]);
  const update=(name,value)=>setForm(previous=>({...previous,[name]:value}));
  const selected=form.problems.map(value=>typeof value==='string'?value:value._id);
  return <form onSubmit={event=>{event.preventDefault();onSave({...form,problems:selected});}}>
    <div className="room-form">
    {!initial&&<><label>Format<select aria-label="Format" value={form.teamSize} onChange={e=>update('teamSize',Number(e.target.value))}>{[1,2,3,4].map(size=><option key={size} value={size}>{size}v{size}</option>)}</select></label>
    <label>Host type<select aria-label="Host type" value={form.hostType} onChange={e=>update('hostType',e.target.value)}><option value="PARTICIPANT_HOST">Participant host</option><option value="EXTERNAL_HOST">External host</option></select></label>
    {form.hostType==='PARTICIPANT_HOST'&&<label>Your team<select aria-label="Your team" value={form.hostTeam} onChange={e=>update('hostTeam',e.target.value)}><option>Alpha</option><option>Beta</option></select></label>}</>}
    <label>Duration (minutes)<input aria-label="Duration" type="number" min="1" max={limits.maxDuration} required value={form.duration} onChange={e=>update('duration',Number(e.target.value))}/></label>
    <label>Number of problems<input aria-label="Number of problems" type="number" min="1" max={limits.maxProblems} required value={form.problemCount} onChange={e=>update('problemCount',Number(e.target.value))}/></label>
    </div>
    <div className="room-form"><label>Search problems<input aria-label="Search problems" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></label><span>{selected.length} / {form.problemCount} selected</span></div>
    {error&&<p role="alert">{error}</p>}
    <div className="room-problem-list">{catalogue.map(problem=><label key={problem._id}><input type="checkbox" checked={selected.includes(problem._id)} onChange={e=>update('problems',e.target.checked?[...selected,problem._id]:selected.filter(id=>id!==problem._id))}/>{problem.title} · {problem.difficulty}</label>)}</div>
    <div className="room-row"><button className="room-button" type="button" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Previous page</button><span>Page {page}/{pages}</span><button className="room-button" type="button" disabled={page>=pages} onClick={()=>setPage(p=>p+1)}>Next page</button></div>
    <div className="room-row">{selected.map(id=><button className="room-button" key={id} type="button" onClick={()=>update('problems',selected.filter(value=>value!==id))}>Remove {catalogue.find(p=>p._id===id)?.title||initial?.problems.find(p=>p._id===id)?.title||id}</button>)}</div>
    <button className="room-button room-button--primary" disabled={busy||selected.length!==form.problemCount}>{label}</button>
    <p className="room-warning">Problems must have compatible C++ judging configuration and test cases. The server validates eligibility.</p>
  </form>;
}
