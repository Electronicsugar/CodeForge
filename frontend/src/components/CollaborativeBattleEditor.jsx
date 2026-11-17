import {useEffect,useRef,useState} from 'react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/languages/definitions/cpp/register.js';
import 'monaco-editor/languages/definitions/python/register.js';
import 'monaco-editor/languages/definitions/javascript/register.js';
import 'monaco-editor/languages/definitions/java/register.js';
import 'monaco-editor/editor/contrib/bracketMatching/browser/bracketMatching.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import {MonacoBinding} from 'y-monaco';
import {getSocket} from '../services/socket';
import {CollaborationProvider} from '../services/collaborationProvider';
import {preserveCollaborationBackup} from '../services/collaborationBackup';
import {BehaviourCollector} from '../services/behaviourCollector';
import {saveBehaviourWindows,flushBehaviour} from '../services/behaviourStorage';
import './CollaborativeBattleEditor.css';

globalThis.MonacoEnvironment={getWorker:()=>new EditorWorker()};
export default function CollaborativeBattleEditor({roomId,teamId,problemId,userId,language='cpp',verified=true,readOnly,onChange,onProvider}){
  const container=useRef(null),editor=useRef(null),change=useRef(onChange),providerChanged=useRef(onProvider),locked=useRef(readOnly);
  locked.current=readOnly;
  change.current=onChange;providerChanged.current=onProvider;
  const liveProvider=useRef(null);
  const [status,setStatus]=useState('Connecting…'),[peers,setPeers]=useState([]),[previousBackup,setPreviousBackup]=useState(null),[analyticsStatus,setAnalyticsStatus]=useState('Analytics ready');
  useEffect(()=>{
    const socket=getSocket();if(!socket){setStatus('Verify your session to open the shared editor.');return;}
    let disposed=false,model,observer,collector,timer,keyListener,editListener,pasteNode,saveAnalytics;
    setPreviousBackup(null);setStatus('Connecting…');
    const provider=new CollaborationProvider(socket,{roomId,teamId,problemId,userId,language},setStatus);liveProvider.current=provider;
    providerChanged.current(provider);
    const presence=()=>setPeers([...provider.awareness.getStates()].filter(([id])=>id!==provider.doc.clientID).map(([id,state])=>({id,name:state.user?.name||'Teammate'})));
    provider.awareness.on('change',presence);
    provider.ready.then(async()=>{
      const previous=await preserveCollaborationBackup({userId,context:`battle-collaborative-team:${teamId}`,battleId:roomId,problemId,language},provider.doc.getText('source').toString());
      if(disposed)return;
      setPreviousBackup(provider.unmergedLocalBackup??previous);
      model=monaco.editor.createModel('', language);
      editor.current=monaco.editor.create(container.current,{model,theme:'vs-dark',automaticLayout:true,minimap:{enabled:false},fontSize:13,lineNumbers:'on',tabSize:4,insertSpaces:true,matchBrackets:'always',scrollBeyondLastLine:false,ariaLabel:'Shared battle code',editContext:false,readOnly:locked.current||!provider.canWrite});
      if(provider.canWrite)provider.monacoBinding=new MonacoBinding(provider.doc.getText('source'),model,new Set([editor.current]),provider.awareness);else model.setValue(provider.authoritativeCode||'');
      observer=()=>change.current(provider.doc.getText('source').toString());provider.doc.getText('source').observe(observer);observer();presence();
      if(userId&&provider.canWrite){
        collector=new BehaviourCollector({problemId,language,now:()=>Date.now()+(provider.serverOffset||0)});
        collector.tick({visible:document.visibilityState==='visible'&&document.hasFocus(),peerCount:provider.awareness.getStates().size});
        const withinBattle=()=>!provider.endTime||Date.now()+(provider.serverOffset||0)<=+new Date(provider.endTime);
        keyListener=editor.current.onKeyDown(event=>collector.key(event.browserEvent));
        pasteNode=editor.current.getDomNode();const paste=event=>{if(event.isTrusted&&withinBattle())collector.paste();};pasteNode.addEventListener('paste',paste,true);
        editListener=model.onDidChangeContent(event=>{if(provider.canWrite&&withinBattle())collector.change(event,{remote:provider.applyingRemote,programmatic:event.isFlush});});
        saveAnalytics=async(upload=true)=>{
          if(withinBattle())collector.tick({visible:document.visibilityState==='visible'&&document.hasFocus(),peerCount:provider.awareness.getStates().size});
          const windows=collector.batches();
          try{await saveBehaviourWindows(userId,roomId,windows);}
          catch(error){for(const window of collector.windows.values())window.dirty=true;if(!disposed)setAnalyticsStatus(error.message);return;}
          try{if(upload&&!provider.analyticsUploadBlocked)await flushBehaviour(userId);if(!disposed)setAnalyticsStatus(provider.analyticsUploadBlocked?'Analytics upload paused; summaries remain local':upload?'Analytics synchronized':'Analytics saved locally');}
          catch(error){if([400,403,404,409,413].includes(error.status))provider.analyticsUploadBlocked=true;if(!disposed)setAnalyticsStatus(error.message);}
        };
        timer=setInterval(()=>saveAnalytics(),15000);
        const hidden=()=>saveAnalytics(false);document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',hidden);window.addEventListener('blur',hidden);window.addEventListener('focus',hidden);
        provider.analyticsCleanup=()=>{clearInterval(timer);keyListener.dispose();editListener.dispose();pasteNode.removeEventListener('paste',paste,true);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',hidden);window.removeEventListener('blur',hidden);window.removeEventListener('focus',hidden);void saveAnalytics();};
        provider.flushAnalytics=saveAnalytics;
      }
    }).catch(error=>{if(!disposed)setStatus(error.message);});
    return()=>{disposed=true;provider.analyticsCleanup?.();liveProvider.current=null;providerChanged.current(null);provider.awareness.off('change',presence);if(observer)provider.doc.getText('source').unobserve(observer);provider.monacoBinding?.destroy();editor.current?.dispose();editor.current=null;model?.dispose();provider.destroy();};
  },[roomId,teamId,problemId,userId,language]);
  useEffect(()=>{const provider=liveProvider.current;editor.current?.updateOptions({readOnly:readOnly||provider?.canWrite===false});if(provider?.canWrite===false&&editor.current){provider.monacoBinding?.destroy();provider.monacoBinding=null;const model=editor.current.getModel();if(model.getValue()!==provider.authoritativeCode)model.setValue(provider.authoritativeCode||'');if(provider.unmergedLocalBackup)setPreviousBackup(provider.unmergedLocalBackup);}},[readOnly,status]);
  useEffect(()=>{const provider=liveProvider.current;if(verified&&provider?.socket.connected&&!provider.connected)provider.join();},[verified]);
  return <div className="collaboration-editor"><div className="collaboration-status" role="status">{status}<span>{peers.length?peers.map(peer=>peer.name).join(', '):'No other connected teammates'}</span><button className="room-button" onClick={()=>liveProvider.current?.join()}>Reconnect shared editor</button></div><p className="collaboration-phase-note">Battle analytics records aggregate editing timing, paste-event counts and approximate contribution. Clipboard contents and raw keys are never recorded. Your profile is private; these metrics do not produce cheating verdicts or penalties. Metrics expire after 30 days.</p><p className="collaboration-phase-note" role="status">{analyticsStatus}</p>{previousBackup!==null&&<button className="room-button" onClick={()=>{const url=URL.createObjectURL(new Blob([previousBackup],{type:'text/plain'}));const link=document.createElement('a');link.href=url;link.download=`codeforge-unsynchronized-backup.${({cpp:'cpp',python:'py',javascript:'js',java:'java'})[language]}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}}>Download previous local backup</button>}<div className="collaboration-monaco" ref={container}/></div>;
}
