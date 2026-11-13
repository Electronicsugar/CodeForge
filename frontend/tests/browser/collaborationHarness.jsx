import React from 'react';
import {createRoot} from 'react-dom/client';
import CollaborativeBattleEditor from '../../src/components/CollaborativeBattleEditor';
import {verifySession} from '../../src/services/sessionState';
export function mount(identity){
  verifySession(localStorage.getItem('token'),identity.userId);
  const node=document.createElement('div');node.style.cssText='width:900px;height:500px;max-width:100%';document.body.append(node);
  createRoot(node).render(<CollaborativeBattleEditor userId={identity.userId} roomId="room" teamId={identity.teamId||'alpha'} problemId={identity.problemId||'problem1'} readOnly={false} onChange={code=>{window.collaborationCode=code;}} onProvider={provider=>{window.collaborationProvider=provider;}}/>);
}
