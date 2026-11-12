import axios from "axios";
import { sessionVerified } from './sessionState';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || "http://localhost:3000/api/v1",
  headers: { "Content-Type": "application/json" },
  timeout: 10000,
});

// REQUEST interceptor — attach JWT token to every request
api.interceptors.request.use((config) => {
  if (!['get','head','options'].includes(config.method || 'get') && !config.url.startsWith('/auth/') && !sessionVerified()) {
    return Promise.reject(new Error('Session is not verified. Your code remains saved locally.'));
  }
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// RESPONSE interceptor — if server returns 401 (expired/invalid JWT),
// clear token from storage and redirect to /login automatically
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      if (error.config?.headers?.Authorization === `Bearer ${localStorage.getItem('token')}`) window.dispatchEvent(new Event('codeforge-auth-expired'));
    } else if (!error.response || error.response.status >= 500) {
      if (error.code !== 'ERR_CANCELED') window.dispatchEvent(new Event('codeforge-session-unavailable'));
    }
    return Promise.reject(error);
  }
);

export default api;
