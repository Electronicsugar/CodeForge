import * as Y from 'yjs';
import {Awareness,applyAwarenessUpdate,removeAwarenessStates} from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import {cacheKey,loadCollaborativeCache,saveCollaborativeCache} from './collaborationCache.js';

// Uses the authenticated application singleton supplied by the caller. It never
// opens a socket or subscribes to general room notifications for source updates.
export class CollaborationProvider {
  constructor(socket,identity,onStatus=()=>{}){
    this.socket=socket;this.identity=identity;this.doc=new Y.Doc();this.awareness=new Awareness(this.doc);this.status=onStatus;this.key=null;this.destroyed=false;this.connected=false;
    this.ready=new Promise((resolve,reject)=>{this.resolve=resolve;this.reject=reject;});
    this.remote={};
    this.localVersion=0;this.sentVersion=-1;this.canWrite=true;
    this.cacheIdentity=identity.userId?cacheKey(identity):null;
    this.localReady=this.cacheIdentity?loadCollaborativeCache(this.cacheIdentity,this.doc):Promise.resolve();
    this.onUpdate=(_update,origin)=>{
      if(this.cacheIdentity)saveCollaborativeCache(this.cacheIdentity,this.doc).catch(error=>this.status(`Local recovery failed: ${error.message}`));
      if(origin!==this.remote){this.localVersion++;clearTimeout(this.updateTimer);this.updateTimer=setTimeout(()=>{if(this.connected&&this.canWrite)this.flush().catch(error=>this.status(error.message));},40);}
    };
    this.onAwareness=(_change,origin)=>{
      if(origin===this.remote)return;clearTimeout(this.cursorTimer);this.cursorTimer=setTimeout(()=>this.sendAwareness(),100);
    };
    this.applyRemote=update=>{this.applyingRemote=true;try{Y.applyUpdate(this.doc,new Uint8Array(update),this.remote);}finally{this.applyingRemote=false;}};
    this.receiveUpdate=packet=>{if(packet.key===this.key)this.applyRemote(packet.update);};
    this.receiveAwareness=packet=>{
      if(packet.key!==this.key||packet.clientId===this.doc.clientID)return;
      const encoder=encoding.createEncoder();encoding.writeVarUint(encoder,1);encoding.writeVarUint(encoder,packet.clientId);encoding.writeVarUint(encoder,packet.clock);encoding.writeVarString(encoder,JSON.stringify(packet.state));applyAwarenessUpdate(this.awareness,encoding.toUint8Array(encoder),this.remote);
    };
    this.denied=()=>{this.connected=false;this.status('Document access ended; your local backup is retained.');};
    this.disconnected=()=>{this.connected=false;removeAwarenessStates(this.awareness,[...this.awareness.getStates().keys()].filter(id=>id!==this.doc.clientID),this.remote);this.status('Offline · local backup only');};
    this.join=async()=>{
      const generation=this.generation=(this.generation||0)+1;
      try{
        await this.localReady;if(this.destroyed||generation!==this.generation)return;
        this.status('Synchronizing shared document…');
        const response=await this.request('collab_join',{...identity,clientId:this.doc.clientID});
        if(this.destroyed||generation!==this.generation)return;
        this.key=response.key;this.canWrite=response.canWrite!==false;this.serverOffset=(Number(response.serverTime)||Date.now())-Date.now();this.startTime=response.startTime;this.endTime=response.endTime;
        if(!this.canWrite){const authoritative=new Y.Doc();Y.applyUpdate(authoritative,new Uint8Array(response.update));this.authoritativeCode=authoritative.getText('source').toString();authoritative.destroy();}
        this.applyRemote(response.update);
        for(const packet of response.presence)this.receiveAwareness(packet);
        this.connected=true;this.awareness.setLocalStateField('user',response.user);this.awareness.setLocalState(this.awareness.getLocalState());
        this.sentVersion=-1;if(this.canWrite)await this.flush();else{this.unmergedLocalBackup=this.doc.getText('source').toString()!==this.authoritativeCode?this.doc.getText('source').toString():null;this.status(this.unmergedLocalBackup?'Battle completed · frozen server source shown; unsynchronized edits remain in your local backup':'Battle completed · shared source is read-only');}if(this.destroyed||generation!==this.generation)return;
        this.resolve(this);this.sendAwareness();
      }catch(error){if(!this.destroyed){this.connected=false;this.status(error.message);this.reject(error);}}
    };
    this.doc.on('update',this.onUpdate);this.awareness.on('update',this.onAwareness);
    socket.on('collab_update',this.receiveUpdate);socket.on('collab_awareness',this.receiveAwareness);socket.on('collab_denied',this.denied);socket.on('disconnect',this.disconnected);socket.on('connect',this.join);
    if(socket.connected)this.join();else this.status('Waiting for the existing battle connection…');
  }
  request(event,data){
    return new Promise((resolve,reject)=>{
      if(!this.socket.connected||this.destroyed){reject(new Error('Offline · shared edits have not synchronized'));return;}
      const timer=setTimeout(()=>reject(new Error('Document synchronization timed out; reconnect to recover.')),8000);
      this.socket.emit(event,data,response=>{clearTimeout(timer);if(response?.success)resolve(response);else reject(Object.assign(new Error(response?.message||'Document request rejected'),{status:response?.status}));});
    });
  }
  async flush(){
    if(!this.connected)throw new Error('Offline · local backup only');
    if(!this.canWrite)throw new Error('Battle completed · submissions are closed');
    if(this.flushing){await this.flushing;if(this.sentVersion<this.localVersion)return this.flush();return this.lastSnapshot;}
    this.flushing=(async()=>{
      do{
        const version=this.localVersion;
        if(this.cacheIdentity)await saveCollaborativeCache(this.cacheIdentity,this.doc);
        this.status('Synchronizing and saving…');
        this.lastSnapshot=await this.request('collab_update',{key:this.key,update:Y.encodeStateAsUpdate(this.doc)});this.sentVersion=version;
      }while(this.sentVersion<this.localVersion&&!this.destroyed&&this.connected);
      if(!this.destroyed&&this.connected)this.status('Saved to server · local recovery ready');return this.lastSnapshot;
    })();
    try{return await this.flushing;}finally{this.flushing=null;}
  }
  sendAwareness(){
    if(!this.connected||this.destroyed)return;
    const clock=this.awareness.meta.get(this.doc.clientID)?.clock||0;
    this.request('collab_awareness',{key:this.key,clock,state:this.awareness.getLocalState()}).catch(error=>this.status(error.message));
  }
  destroy(){
    this.destroyed=true;this.connected=false;clearTimeout(this.cursorTimer);clearTimeout(this.updateTimer);this.generation=(this.generation||0)+1;
    this.doc.off('update',this.onUpdate);this.awareness.off('update',this.onAwareness);
    this.socket.off('collab_update',this.receiveUpdate);this.socket.off('collab_awareness',this.receiveAwareness);this.socket.off('collab_denied',this.denied);this.socket.off('disconnect',this.disconnected);this.socket.off('connect',this.join);
    if(this.socket.connected)this.socket.emit('collab_leave',{});
    this.awareness.destroy();this.doc.destroy();
  }
}
