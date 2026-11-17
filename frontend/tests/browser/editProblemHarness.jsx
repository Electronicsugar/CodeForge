import React from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {AuthProvider,useAuth} from '../../src/context/AuthContext';
import EditProblem from '../../src/pages/EditProblem';
function Role(){const auth=useAuth();return <button onClick={()=>auth.updateUser({role:auth.user?.role==='admin'?'user':'admin'})}>Role:{auth.user?.role||'loading'}</button>;}
export function mount(){
  const node=document.createElement('div');node.id='edit-test';document.body.append(node);
  createRoot(node).render(<AuthProvider><MemoryRouter initialEntries={['/edit/edit-target']}><Role/><Routes><Route path="/edit/:id" element={<EditProblem/>}/></Routes></MemoryRouter></AuthProvider>);
}
