export const metricFields=['insertedChars','deletedChars','contributionChars','editEvents','keyboardChars','keyboardEvents','keyboardActiveMs','pasteEvents','pasteChars','largeInsertions','largeInsertedChars','largeReplacements','replacements','undoEvents','redoEvents','toolEvents','programmaticEvents','remoteUpdates','remoteChars','activeMs','visibleMs','bursts','pauses','pauseMs','peerSamples','peerSum','maxPeers','cadence0','cadence1','cadence2','cadence3','cadence4','cadence5'];
export class BehaviourCollector{
  constructor({problemId,language='cpp',now=()=>Date.now(),sessionId=crypto.randomUUID()}={}){this.problemId=problemId;this.language=language;this.now=now;this.sessionId=sessionId;this.windows=new Map();this.createdAt=now();this.lastTick=this.createdAt;this.visible=true;this.lastEdit=null;this.lastKeyboard=null;this.origin=null;}
  window(time=this.now()){const minute=Math.floor(time/60000)*60000;if(!this.windows.has(minute))this.windows.set(minute,{problemId:this.problemId,language:this.language,sessionId:this.sessionId,minute,sequence:0,metrics:Object.fromEntries(metricFields.map(key=>[key,0]))});const window=this.windows.get(minute);window.dirty=true;return window;}
  key(event){const key=event.key||'';this.origin={time:this.now(),kind:!event.ctrlKey&&!event.metaKey&&!event.altKey&&(key.length===1||['Enter','Tab','Backspace','Delete'].includes(key))?'keyboard':'tool'};}
  paste(){const now=this.now(),window=this.window(now);window.metrics.pasteEvents++;window.firstPasteAt??=now;window.lastPasteAt=now;this.origin={time:now,kind:'paste'};}
  change(event,{remote=false,programmatic=false}={}){
    const now=this.now(),window=this.window(now),metrics=window.metrics;
    let inserted=0,deleted=0;for(const change of event.changes||[]){inserted+=(change.text||'').length;deleted+=change.rangeLength||0;}
    if(remote){metrics.remoteUpdates++;metrics.remoteChars+=inserted+deleted;return;}
    const origin=programmatic||event.isFlush?'programmatic':event.isUndoing?'undo':event.isRedoing?'redo':this.origin&&now-this.origin.time<250?this.origin.kind:'tool';this.origin=null;
    metrics.editEvents++;metrics.insertedChars+=inserted;metrics.deletedChars+=deleted;if(inserted&&deleted)metrics.replacements++;
    if(inserted>=100){metrics.largeInsertions++;metrics.largeInsertedChars+=inserted;}if(inserted>=100&&deleted>=100)metrics.largeReplacements++;
    if(origin==='programmatic'){metrics.programmaticEvents++;return;}
    metrics.contributionChars+=inserted+deleted;
    window.firstEditAt??=now;window.lastEditAt=now;
    const elapsed=this.lastEdit===null?null:Math.max(0,now-this.lastEdit);
    if(elapsed===null||elapsed>2000)metrics.bursts++;
    if(elapsed!==null&&elapsed>2000){metrics.pauses++;metrics.pauseMs+=Math.min(elapsed,60000);}
    const active=elapsed===null?0:Math.min(elapsed,5000,now-window.minute);metrics.activeMs=Math.min(60000,metrics.activeMs+active);this.lastEdit=now;
    if(origin==='keyboard'){
      // Counts observable inserted code characters, never literal key values.
      // Large completions are uncertain tool edits, not a typing-speed sample.
      if(inserted>20){metrics.toolEvents++;return;}
      metrics.keyboardEvents++;metrics.keyboardChars+=inserted;
      if(this.lastKeyboard!==null){const gap=Math.max(0,now-this.lastKeyboard);const bucket=[100,250,500,1000,2000].findIndex(bound=>gap<bound);metrics[`cadence${bucket<0?5:bucket}`]++;if(gap<=5000)metrics.keyboardActiveMs=Math.min(60000,metrics.keyboardActiveMs+Math.min(gap,now-window.minute));}this.lastKeyboard=now;
    }else if(origin==='paste')metrics.pasteChars+=inserted;
    else if(origin==='undo')metrics.undoEvents++;
    else if(origin==='redo')metrics.redoEvents++;
    else metrics.toolEvents++;
  }
  tick({visible=true,peerCount=0}={}){
    const now=this.now();let start=this.lastTick;this.lastTick=now;
    if(this.visible){while(start<now){const window=this.window(start),end=Math.min(now,window.minute+60000);window.metrics.visibleMs=Math.min(60000,window.metrics.visibleMs+Math.max(0,end-start));start=end;}}this.visible=visible;
    const metrics=this.window().metrics;metrics.peerSamples++;metrics.peerSum+=Math.max(0,peerCount);metrics.maxPeers=Math.max(metrics.maxPeers,peerCount);
  }
  batches(){return [...this.windows.values()].filter(window=>window.dirty).map(window=>{window.dirty=false;const {dirty:_dirty,...data}=window;return {...data,sequence:++window.sequence,metrics:{...window.metrics}};});}
}
