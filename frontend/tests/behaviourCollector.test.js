import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BehaviourCollector} from '../src/services/behaviourCollector.js';
const edit=(text,rangeLength=0,extra={})=>({changes:[{text,rangeLength}],...extra});
test('keyboard estimates use actual local inserted characters and retain cadence, bursts and pauses',()=>{
  let now=180000;const collector=new BehaviourCollector({problemId:'p',now:()=>now});
  for(let i=0;i<6;i++){collector.key({key:'x'});collector.change(edit('x'));now+=500;}
  now+=10000;collector.key({key:'y'});collector.change(edit('y'));const [window]=collector.batches();
  assert.equal(window.metrics.keyboardChars,7);assert.equal(window.metrics.keyboardEvents,7);assert.equal(window.metrics.keyboardActiveMs,2500);assert.equal(window.metrics.bursts,2);assert.equal(window.metrics.pauses,1);assert.equal(window.metrics.cadence5,1);assert.equal(collector.batches().length,0);
});
test('direct paste, tool insertion, large replacement, programmatic changes and remote changes stay distinct',()=>{
  let now=240000;const collector=new BehaviourCollector({problemId:'p',now:()=>now});
  collector.paste();collector.change(edit('p'.repeat(150)));now+=500;collector.change(edit('snippet'.repeat(25),120));
  collector.change(edit('private remote'.repeat(20)),{remote:true});collector.change(edit('formatting'),{programmatic:true});collector.change(edit('',2,{isUndoing:true}));collector.change(edit('xx',0,{isRedoing:true}));
  collector.key({key:'Tab'});collector.change(edit('autocomplete'.repeat(3)));
  const metrics=collector.batches()[0].metrics;assert.equal(metrics.pasteEvents,1);assert.equal(metrics.pasteChars,150);assert.equal(metrics.largeInsertions,2);assert.equal(metrics.largeReplacements,1);assert.equal(metrics.keyboardChars,0);assert.equal(metrics.remoteUpdates,1);assert.equal(metrics.programmaticEvents,1);assert.equal(metrics.undoEvents,1);assert.equal(metrics.redoEvents,1);assert.equal(metrics.toolEvents,2);
  assert.equal(JSON.stringify(metrics).includes('private remote'),false);
});
test('visibility time splits windows and remote updates do not inflate individual contribution',()=>{
  let now=359000;const collector=new BehaviourCollector({problemId:'p',now:()=>now});now+=3000;collector.tick({visible:true,peerCount:3});const batches=collector.batches();assert.equal(batches.length,2);assert.equal(batches.reduce((sum,row)=>sum+row.metrics.visibleMs,0),3000);
  collector.change(edit('remote'),{remote:true});const metrics=collector.batches()[0].metrics;assert.equal(metrics.keyboardEvents,0);assert.equal(metrics.pasteEvents,0);assert.equal(metrics.contributionChars,0);
});
