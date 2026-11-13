import {useEffect,useState,useRef} from 'react';
import {useAuth} from '../context/AuthContext';
import {submissionContext,recoverSubmission} from '../services/submissionRecovery';
export function useSubmissionRecovery({problem,context='practice',battleId,roomId,enabled=true},onResult) {
  const resultHandler=useRef(onResult);resultHandler.current=onResult;
  const {user,verified}=useAuth();
  const [request,setRequest]=useState(0);
  const [error,setError]=useState('');
  const userId=user?._id||user?.id;
  useEffect(()=>{
    if(!enabled||!verified||!userId||!problem)return;
    const key=submissionContext({userId,problem,context,battleId,roomId});
    const controller=new AbortController();let timer,disposed=false,failures=0;
    const poll=async()=>{
      try {
        const result=await recoverSubmission(key,controller.signal);
        if(disposed)return;
        setError('');failures=0;
        if(result)resultHandler.current(result);
        if(result&&['pending','running'].includes(result.status)&&result.enqueueState!=='enqueue_failed')timer=setTimeout(poll,2000);
        else if(result?.enqueueState==='enqueue_failed')setError(result.enqueueError||'Queue unavailable. Recover again when service returns.');
      } catch(err){if(!disposed){setError(err.message);if(err.status!==429&&err.response?.status!==429&&++failures<3)timer=setTimeout(poll,2000*2**failures);}}
    };
    poll();
    return()=>{disposed=true;clearTimeout(timer);controller.abort();};
  },[userId,verified,problem,context,battleId,roomId,request,enabled]);
  return {error,recover:()=>setRequest(n=>n+1)};
}
