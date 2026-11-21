import {useCallback,useEffect,useRef,useState} from 'react';
import {getSocket} from '../services/socket';
import {attachIntegrityListeners} from '../services/integrity';

export function useRoomIntegrity({roomId,userId,verified,enabled,persisted}){
  const active=useRef(enabled),listeners=useRef(null),queue=useRef([]),report=useRef(()=>{}),lastPaste=useRef(0);
  active.current=enabled;
  const [state,setState]=useState({strikes:0,maxStrikes:3}),[error,setError]=useState('');
  useEffect(()=>{setState({strikes:0,maxStrikes:3});setError('');queue.current=[];lastPaste.current=0;},[roomId,userId]);
  useEffect(()=>{if(persisted)setState(previous=>({...persisted,strikes:Math.max(previous.strikes,persisted.strikes||0)}));},[persisted]);
  useEffect(()=>{
    if(!verified)return;
    const socket=getSocket();if(!socket)return;
    let disposed=false,flushing=false;
    const apply=data=>{if(disposed||data.roomId&&data.roomId!==roomId)return;setState(previous=>({...previous,...data,strikes:Math.max(previous.strikes,data.strikes||0)}));};
    const flush=async()=>{
      if(flushing||!socket.connected||disposed)return;flushing=true;
      try{
        while(queue.current.length&&socket.connected&&!disposed){
          const event=queue.current[0];
          const reply=await new Promise((resolve,reject)=>{
            const timer=setTimeout(()=>reject(Error('Battle rule events are awaiting reconnection.')),5000);
            socket.emit('room_integrity_event',event,data=>{clearTimeout(timer);resolve(data);});
          });
          if(disposed)return;
          if(!reply?.success){
            if([400,403,413,429].includes(reply?.status))queue.current.shift();
            throw Error(reply?.message||'Could not synchronize battle rule event.');
          }
          queue.current.shift();apply(reply);setError('');
        }
      }catch(error){if(!disposed)setError(error.message);}finally{flushing=false;}
    };
    const send=(type,meta)=>{
      if(!active.current)return;
      if(type==='paste')lastPaste.current=Date.now();
      if(queue.current.length>=32){setError('Battle rule events could not be synchronized. Reconnect to continue.');return;}
      queue.current.push({roomId,type,meta,eventId:crypto.randomUUID()});void flush();
    };
    report.current=send;
    const resume=()=>{if(active.current){send(document.hidden?'tab_hidden':'tab_visible',{});send(document.hasFocus()?'window_focus':'window_blur',{});}void flush();};
    listeners.current=attachIntegrityListeners({send,enabled:()=>active.current,scope:()=>document.querySelector('.room-editor .monaco-editor')||document.querySelector('.room-editor > textarea')});
    socket.on('connect',resume);
    const timer=setInterval(flush,5000);
    return()=>{disposed=true;clearInterval(timer);listeners.current?.dispose();listeners.current=null;report.current=()=>{};socket.off('connect',resume);};
  },[roomId,userId,verified]);
  useEffect(()=>{if(enabled&&verified){report.current(document.hidden?'tab_hidden':'tab_visible',{});report.current(document.hasFocus()?'window_focus':'window_blur',{});}},[enabled,verified,roomId,userId]);
  const noteChange=useCallback((previous,next,inputType)=>listeners.current?.noteChange(previous,next,Date.now()-lastPaste.current<500?'insertFromPaste':inputType),[]);
  return {...state,error,noteChange};
}
