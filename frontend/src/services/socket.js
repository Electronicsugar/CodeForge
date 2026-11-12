import { io } from 'socket.io-client';
import { sessionVerified } from './sessionState';
let socket = null, socketToken = null;
export const getSocket = () => {
  const token = localStorage.getItem('token');
  if (!token || !sessionVerified()) return null;
  if (socketToken !== token) disconnectSocket();
  if (!socket) {
    socketToken = token;
    socket = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:3000', {
      auth:{token}, reconnection:true, reconnectionAttempts:Infinity,
      reconnectionDelay:1000, reconnectionDelayMax:10000, randomizationFactor:0.5,
    });
  }
  return socket;
};
export const disconnectSocket = () => { socket?.disconnect(); socket = null; socketToken = null; };
