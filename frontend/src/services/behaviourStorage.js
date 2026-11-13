import api from './api';
import {sessionUserId} from './sessionState';
let database;const running=new Map();
const open=()=>database||(database=new Promise((resolve,reject)=>{const request=indexedDB.open('codeforge-behaviour-v1',1);request.onupgradeneeded=()=>request.result.createObjectStore('pending',{keyPath:'id'});request.onsuccess=()=>{request.result.onversionchange=()=>{request.result.close();database=null;};resolve(request.result);};request.onerror=()=>reject(request.error);}).catch(error=>{database=null;throw error;}));
export async function saveBehaviourWindows(userId,roomId,windows){
  if(!windows.length)return;const db=await open();
  return new Promise((resolve,reject)=>{const tx=db.transaction('pending','readwrite'),store=tx.objectStore('pending');let failure;
    store.getAll().onsuccess=event=>{const records=event.target.result;for(const record of records)if(record.expiresAt<Date.now())store.delete(record.id);const live=records.filter(record=>record.expiresAt>=Date.now());
      for(const window of windows){const id=JSON.stringify([userId,roomId,window.problemId,window.sessionId,window.minute]);const existing=live.find(record=>record.id===id);if(existing?.window.sequence>=window.sequence)continue;if(!existing&&live.length>=2000){failure=Error('Analytics recovery queue is full; code editing is unaffected.');tx.abort();return;}store.put({id,userId,roomId,window,expiresAt:window.minute+30*86400000,retryAfterAt:existing?.retryAfterAt||0});if(!existing)live.push({id});}
    };tx.oncomplete=()=>resolve();tx.onerror=tx.onabort=()=>reject(failure||tx.error||Error('Analytics local save failed'));});
}
async function pending(userId){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('pending','readwrite'),store=tx.objectStore('pending'),request=store.getAll();request.onsuccess=()=>{for(const record of request.result)if(record.expiresAt<=Date.now())store.delete(record.id);};tx.oncomplete=()=>resolve(request.result.filter(record=>record.userId===userId&&!record.failed&&record.expiresAt>Date.now()&&record.retryAfterAt<=Date.now()));tx.onerror=()=>reject(tx.error);});}
async function finish(records,{retryAfterAt,failed}={}){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('pending','readwrite'),store=tx.objectStore('pending');for(const record of records)store.get(record.id).onsuccess=event=>{const current=event.target.result;if(current&&retryAfterAt)store.put({...current,retryAfterAt});else if(current&&current.window.sequence===record.window.sequence){if(failed)store.put({...current,failed:true});else store.delete(record.id);}};tx.oncomplete=()=>resolve();tx.onerror=()=>reject(tx.error);});}
export async function flushBehaviour(userId){
  if(running.has(userId))return running.get(userId);
  const request=(async()=>{
    if(sessionUserId()!==userId)throw Error('Verify the original account before uploading analytics');
    const records=await pending(userId);let accepted=0;
    for(const roomId of new Set(records.map(record=>record.roomId))){const own=records.filter(record=>record.roomId===roomId);for(let offset=0;offset<own.length;offset+=24){const batch=own.slice(offset,offset+24);if(sessionUserId()!==userId)throw Error('Account changed; analytics upload stopped');try{await api.post(`/battles/rooms/${roomId}/behaviour`,{windows:batch.map(record=>record.window)});await finish(batch);accepted+=batch.length;}catch(error){if(error.response?.status===429)await finish(batch,{retryAfterAt:Date.now()+(Number(error.response.data?.retryAfterSeconds)||60)*1000});else if([400,403,404,409,413].includes(error.response?.status))await finish(batch,{failed:true});throw Object.assign(Error(error.response?.data?.message||'Analytics saved locally; upload will resume after reconnect.'),{status:error.response?.status});}}}
    return accepted;
  })();running.set(userId,request);try{return await request;}finally{running.delete(userId);}
}
