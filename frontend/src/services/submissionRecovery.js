import api from './api';
import {draftKey,getIntent,prepareIntent,patchIntent} from './draftStorage';
import {sessionUserId} from './sessionState';
export const submissionContext = ({userId,problem,context='practice',battleId}) => draftKey({userId,problemId:problem,context,language:'cpp',battleId});
export async function sendIntent(intent) {
  if(sessionUserId()!==intent.userId)throw new Error('Verify the original account before recovering this submission.');
  const sessionToken=localStorage.getItem('token');
  try {
    const response=await api.post('/submissions',intent.payload,{sessionToken,headers:{'Idempotency-Key':intent.idempotencyKey}});
    await patchIntent(intent,{submissionId:response.data.data.submissionId,updatedAt:Date.now()});
    return response.data;
  } catch(error) {
    // Permanent rejection is not ambiguous. Keep the snapshot, but allow a new explicit attempt.
    if(error.response && [400,403,404,409,422].includes(error.response.status))await patchIntent(intent,{completed:true,rejected:true});
    throw new Error(error.response?.data?.message || `${error.message}. Submission status may be unknown; recover the existing request instead of sending different code.`);
  }
}
export async function submitReliably({userId,context,...payload}) {
  const key=submissionContext({userId,context,...payload});
  const intent=await prepareIntent(key,userId,payload);
  return sendIntent(intent);
}
export async function recoverSubmission(key,signal) {
  let intent=await getIntent(key);
  if(!intent || intent.rejected)return null;
  if(!intent.submissionId) {
    const response=await sendIntent(intent);
    intent={...intent,submissionId:response.data.submissionId};
  }
  const response=await api.get(`/submissions/${intent.submissionId}`,{signal});
  const result=response.data.data;
  if(!['pending','running'].includes(result.status))await patchIntent(intent,{completed:true});
  return result;
}
