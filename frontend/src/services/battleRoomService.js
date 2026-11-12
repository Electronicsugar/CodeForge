import api from './api';
export const roomLimits=()=>api.get('/battles/rooms/limits').then(r=>r.data.data);
export const myRooms=()=>api.get('/battles/rooms').then(r=>r.data.data);
export const createRoom=config=>api.post('/battles/rooms',config).then(r=>r.data.data);
export const joinRoom=(code,teamId)=>api.post('/battles/rooms/join',{code,teamId}).then(r=>r.data.data);
export const fetchRoom=id=>api.get(`/battles/rooms/${id}`).then(r=>r.data.data);
export const changeRoom=(id,action,data={})=>api.post(`/battles/rooms/${id}/${action}`,data).then(r=>r.data.data);
export const roomProblem=(id,problem)=>api.get(`/battles/rooms/${id}/problems/${problem}`).then(r=>r.data.data);
