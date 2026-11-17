import api from './api';

export const getMyCoach = (refresh = false) => api.get('/coach/me', { params: refresh ? { refresh: 'true' } : undefined });
