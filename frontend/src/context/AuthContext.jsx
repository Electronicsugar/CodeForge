import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { getCurrentUser } from '../services/userService';
import { logoutUser } from '../services/authService';
import { disconnectSocket } from '../services/socket';
import { verifySession, invalidateSession } from '../services/sessionState';
const AuthContext = createContext(null);
function identityHint(token) {
  try {
    const part=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');
    const claims=JSON.parse(atob(part));
    return claims.id ? {_id:claims.id,name:'Local editing'} : null;
  } catch { return null; }
}
export function AuthProvider({children}) {
  const [token,setToken]=useState(()=>localStorage.getItem('token'));
  const [user,setUser]=useState(()=>identityHint(localStorage.getItem('token') || ''));
  const [loading,setLoading]=useState(true);
  const [verified,setVerified]=useState(false);
  const checking=useRef(false);
  const clear=useCallback(()=>{
    invalidateSession(); disconnectSocket(); localStorage.removeItem('token');
    setToken(null);setUser(null);setVerified(false);setLoading(false);
  },[]);
  const logout=useCallback(async()=>{const request=logoutUser();clear();await request;},[clear]);
  const verifyUser=useCallback(async()=>{
    const saved=localStorage.getItem('token');
    if (!saved) {setLoading(false);return;}
    if (checking.current) return;
    checking.current=true;
    try {
      const res=await getCurrentUser();
      if (localStorage.getItem('token')!==saved) return;
      verifySession(saved);setVerified(true);setUser(res.data);
    } catch(error) {
      if (localStorage.getItem('token')!==saved) return;
      if (error.response?.status===401) clear();
      else {invalidateSession();setVerified(false);}
    } finally {checking.current=false;setLoading(false);}
  },[clear]);
  useEffect(()=>{verifyUser();},[verifyUser,token]);
  useEffect(()=>{
    const unavailable=()=>{invalidateSession();setVerified(false);};
    const changed=event=>{
      if(event.key==='token') {invalidateSession();disconnectSocket();setVerified(false);const next=localStorage.getItem('token');setToken(next);setUser(identityHint(next||''));}
    };
    window.addEventListener('codeforge-auth-expired',clear);
    window.addEventListener('codeforge-session-unavailable',unavailable);
    window.addEventListener('storage',changed);
    return()=>{window.removeEventListener('codeforge-auth-expired',clear);window.removeEventListener('codeforge-session-unavailable',unavailable);window.removeEventListener('storage',changed);};
  },[clear]);
  const login=(newToken,userData)=>{
    disconnectSocket();invalidateSession();localStorage.setItem('token',newToken);
    setToken(newToken);setUser(userData||identityHint(newToken));setVerified(false);
  };
  return <AuthContext.Provider value={{user,token,loading,verified,isAuthenticated:!!token&&verified,login,logout,refreshUser:verifyUser,updateUser:partial=>setUser(previous=>({...previous,...partial}))}}>{children}</AuthContext.Provider>;
}
export function useAuth(){const context=useContext(AuthContext);if(!context)throw Error('AuthProvider required');return context;}
export default AuthContext;
