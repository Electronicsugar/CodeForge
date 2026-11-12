import {createContext,useContext,useEffect,useState} from 'react';
import {useAuth} from './AuthContext';
import {getSocket,disconnectSocket} from '../services/socket';
const ConnectionContext=createContext(null);
export function ConnectionProvider({children}) {
  const {token,verified,refreshUser}=useAuth();
  const [browserOnline,setBrowserOnline]=useState(navigator.onLine);
  const [backend,setBackend]=useState('checking');
  const [socketState,setSocketState]=useState('not-required');
  useEffect(()=>{
    let timer,controller,disposed=false,checking=false,failures=0;
    const check=async()=>{
      if(checking||disposed)return;
      clearTimeout(timer);
      if(!navigator.onLine){setBrowserOnline(false);return;}
      checking=true;setBrowserOnline(true);controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),5000);
      try {
        const apiBase=import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';
        const health=new URL(apiBase,window.location.origin);health.pathname=health.pathname.replace(/\/api\/v1\/?$/,'')+'/health';
        const response=await fetch(health,{signal:controller.signal,cache:'no-store'});
        const body=await response.json();
        if(!response.ok||body.status!=='ok')throw Error('Health check failed');
        if(!disposed){setBackend('reachable');failures=0;if(token&&!verified)await refreshUser();}
      } catch {if(!disposed){setBackend('unavailable');failures++;}}
      finally {clearTimeout(timeout);checking=false;if(!disposed)timer=setTimeout(check,failures?Math.min(30000,2000*2**Math.min(failures,4)):30000);}
    };
    const offline=()=>{setBrowserOnline(false);controller?.abort();};
    window.addEventListener('online',check);window.addEventListener('offline',offline);window.addEventListener('focus',check);
    check();
    return()=>{disposed=true;clearTimeout(timer);controller?.abort();window.removeEventListener('online',check);window.removeEventListener('offline',offline);window.removeEventListener('focus',check);};
  },[token,verified,refreshUser]);
  useEffect(()=>{
    if(!verified||!token){disconnectSocket();setSocketState(token?'connecting':'not-required');return;}
    const socket=getSocket();if(!socket)return;
    const connected=()=>setSocketState('connected');
    const disconnected=()=>setSocketState('connecting');
    setSocketState(socket.connected?'connected':'connecting');
    socket.on('connect',connected);socket.on('disconnect',disconnected);socket.on('connect_error',disconnected);
    const reconnect=()=>{if(!socket.connected)socket.connect();};window.addEventListener('online',reconnect);
    return()=>{socket.off('connect',connected);socket.off('disconnect',disconnected);socket.off('connect_error',disconnected);window.removeEventListener('online',reconnect);};
  },[token,verified]);
  const status=!browserOnline?'Offline':backend==='unavailable'?'Server unavailable':backend==='checking'||(token&&(!verified||socketState!=='connected'))?'Reconnecting':'Online';
  return <ConnectionContext.Provider value={{status,browserOnline,backend,socketState}}>{children}<div role="status" style={{position:'fixed',bottom:10,right:12,zIndex:1000,padding:'6px 10px',borderRadius:6,background:'#172033',color:'#fff',fontSize:12}}>{status}{token&&!verified?' · Local editing only':''}</div></ConnectionContext.Provider>;
}
export const useConnection=()=>useContext(ConnectionContext);
