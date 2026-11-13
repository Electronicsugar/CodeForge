import {useEffect,useState} from 'react';
import {getProblems} from '../services/problemService';
export default function RoomConfiguration({initial,limits,onSave,label='Create room',busy}){
  const [form,setForm]=useState(()=>({teamSize:1,hostType:'PARTICIPANT_HOST',hostTeam:'Alpha',duration:15,problemCount:1,problems:[],selectionMode:'RANDOM_DISTRIBUTION',difficulties:['easy'],admissionPolicies:{Alpha:'OPEN',Beta:'OPEN'},...initial}));
  const [catalogue,setCatalogue]=useState([]),[search,setSearch]=useState(''),[page,setPage]=useState(1),[pages,setPages]=useState(1),[error,setError]=useState('');
  const manual=form.hostType==='EXTERNAL_HOST'&&form.selectionMode==='MANUAL_SELECTION';
  useEffect(()=>{
    if(!manual)return;
    let active=true;const timer=setTimeout(()=>getProblems({search,page,limit:20}).then(result=>{if(active){setCatalogue(result.data.problems);setPages(result.data.pagination?.totalPages||1);setError('');}}).catch(()=>{if(active)setError('Problem catalogue could not be loaded');}),250);
    return()=>{active=false;clearTimeout(timer);};
  },[manual,search,page]);
  const update=(name,value)=>setForm(previous=>({...previous,[name]:value}));
  const selected=form.problems.map(value=>typeof value==='string'?value:value._id);
  const validation=[];
  if(form.problemCount<1||form.problemCount>limits.maxProblems)validation.push(`Choose 1–${limits.maxProblems} questions.`);
  if(limits.availability){
    if(form.problemCount>limits.availability.total)validation.push(`Only ${limits.availability.total} eligible questions are available.`);
    if(!manual)for(const difficulty of ['easy','medium','hard']){const needed=form.difficulties.filter(value=>value===difficulty).length;if(needed>limits.availability[difficulty])validation.push(`Requested ${needed} ${difficulty}; only ${limits.availability[difficulty]} available.`);}
  }
  const count=value=>setForm(previous=>({...previous,problemCount:value,difficulties:Array.from({length:Math.max(0,Math.min(limits.maxProblems,value))},(_,index)=>previous.difficulties?.[index]||'easy')}));
  return <form onSubmit={event=>{event.preventDefault();onSave({...form,selectionMode:manual?'MANUAL_SELECTION':'RANDOM_DISTRIBUTION',problems:manual?selected:[],difficulties:form.difficulties});}}>
    {!initial&&<><fieldset className="room-fieldset"><legend>Battle format</legend><div className="room-format">{[1,2,3,4].map(size=><button type="button" className="room-format-tile" aria-pressed={form.teamSize===size} key={size} onClick={()=>update('teamSize',size)}><strong>{size}v{size}</strong><span>Up to {size*2} players</span></button>)}</div></fieldset>
      <div className="room-form"><label>Host type<select aria-label="Host type" value={form.hostType} onChange={e=>setForm(previous=>({...previous,hostType:e.target.value,selectionMode:'RANDOM_DISTRIBUTION'}))}><option value="PARTICIPANT_HOST">Participant host</option><option value="EXTERNAL_HOST">External host</option></select></label>
      {form.hostType==='PARTICIPANT_HOST'&&<label>Your team<select aria-label="Your team" value={form.hostTeam} onChange={e=>update('hostTeam',e.target.value)}><option>Alpha</option><option>Beta</option></select></label>}</div></>}
    <div className="room-form"><label>Duration (minutes)<input aria-label="Duration" type="number" min="1" max={limits.maxDuration} required value={form.duration} onChange={e=>update('duration',Number(e.target.value))}/></label><label>Number of problems<input aria-label="Number of problems" type="number" min="1" max={limits.maxProblems} required value={form.problemCount} onChange={e=>count(Number(e.target.value))}/></label></div>
    {form.hostType==='EXTERNAL_HOST'?<label className="room-selection">Problem selection<select aria-label="Problem selection" value={form.selectionMode} onChange={e=>update('selectionMode',e.target.value)}><option value="RANDOM_DISTRIBUTION">Random by difficulty</option><option value="MANUAL_SELECTION">Manual selection</option></select></label>:<p className="room-note">Random questions keep the participant host on equal footing. Questions unlock when the battle starts.</p>}
    {!manual?<div className="room-difficulties">{form.difficulties?.map((difficulty,index)=><label key={index}>Question {index+1}<select aria-label={`Question ${index+1} difficulty`} value={difficulty} onChange={e=>update('difficulties',form.difficulties.map((value,i)=>i===index?e.target.value:value))}>{['easy','medium','hard'].map(value=><option key={value} value={value}>{value}{limits.availability?` (${limits.availability[value]} available)`:''}</option>)}</select></label>)}</div>:<>
      <div className="room-form"><label>Search problems<input aria-label="Search problems" value={search} onChange={e=>{setSearch(e.target.value);setPage(1);}}/></label><span>{selected.length} / {form.problemCount} selected</span></div>
      {error&&<p role="alert">{error}</p>}<div className="room-problem-list">{catalogue.map(problem=><label key={problem._id}><input type="checkbox" checked={selected.includes(problem._id)} onChange={e=>update('problems',e.target.checked?[...selected,problem._id]:selected.filter(id=>id!==problem._id))}/>{problem.title} · {problem.difficulty}</label>)}</div>
      <div className="room-row"><button className="room-button" type="button" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Previous page</button><span>Page {page}/{pages}</span><button className="room-button" type="button" disabled={page>=pages} onClick={()=>setPage(p=>p+1)}>Next page</button></div>
      <div className="room-row">{selected.map(id=><button className="room-button" key={id} type="button" onClick={()=>update('problems',selected.filter(value=>value!==id))}>Remove {catalogue.find(p=>p._id===id)?.title||initial?.problems.find(p=>p._id===id)?.title||id}</button>)}</div></>}
    {!initial&&<div className="room-form">{['Alpha','Beta'].map(name=><label key={name}>{name} admission<select aria-label={`${name} admission`} value={form.admissionPolicies[name]} onChange={e=>update('admissionPolicies',{...form.admissionPolicies,[name]:e.target.value})}><option value="OPEN">Open</option><option value="APPROVAL_REQUIRED">Lead approval</option></select></label>)}</div>}
    {validation.length>0&&<div role="alert" className="room-error">{validation.map(message=><p key={message}>{message}</p>)}</div>}
    <button className="room-button room-button--primary" disabled={busy||validation.length>0||(manual&&selected.length!==form.problemCount)}>{label}</button>
    {!initial&&<p className="room-note">As host, assign one competitor as lead for each team in the waiting room.</p>}
    <p className="room-note">Only problems with compatible C++ judging and test cases are eligible. Saving configuration resets both Team Ready confirmations.</p>
  </form>;
}
