const {test}=require('node:test');
const assert=require('node:assert/strict');
const {drawRandom}=require('../src/services/roomProblemSelection');
const records=Array.from({length:60},(_,index)=>({_id:String(index),difficulty:['easy','medium','hard'][index%3]}));
test('deterministic shuffle respects every slot, uniqueness and database-order independence',()=>{
  let seed=5;const random=max=>{seed=(seed*1664525+1013904223)>>>0;return seed%max;};const first=new Set(),orders=new Set();
  for(let i=0;i<100;i++){const result=drawRandom(records,['easy','medium','easy','hard'],random);assert.equal(new Set(result.problems).size,4);assert.deepEqual(result.problems.map(id=>records[Number(id)].difficulty),result.difficulties);first.add(result.problems[0]);orders.add(result.problems.join(','));}assert.ok(first.size>5);assert.ok(orders.size>20);
});
test('production cryptographic default varies and shortage is explicit',()=>{
  const orders=new Set(Array.from({length:80},()=>drawRandom(records,['easy','easy','medium']).problems.join(',')));assert.ok(orders.size>1);assert.throws(()=>drawRandom(records,Array(21).fill('hard')),/only 20/);
});
