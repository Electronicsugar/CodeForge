const {randomInt}=require('node:crypto');
const Problem=require('../models/Problem');
const TestCase=require('../models/TestCase');
const {generateCode}=require('./executor/code-generator');
const fail=message=>Object.assign(new Error(message),{status:400});
async function eligible(){
  const tested=await TestCase.distinct('problem');
  const problems=await Problem.find({_id:{$in:tested}}).lean();
  return problems.filter(problem=>{try{generateCode(problem,'class Solution {};');return ['easy','medium','hard'].includes(problem.difficulty);}catch{return false;}});
}
async function availability(){const records=await eligible();return {total:records.length,easy:records.filter(p=>p.difficulty==='easy').length,medium:records.filter(p=>p.difficulty==='medium').length,hard:records.filter(p=>p.difficulty==='hard').length};}
async function select(config,hostType){
  const mode=config.selectionMode||'RANDOM_DISTRIBUTION';
  if(!['RANDOM_DISTRIBUTION','MANUAL_SELECTION'].includes(mode))throw fail('Choose a valid selection mode');
  if(hostType==='PARTICIPANT_HOST'&&mode!=='RANDOM_DISTRIBUTION')throw fail('Participant hosts must use random distribution');
  const records=await eligible();
  if(config.problemCount>records.length)throw fail(`Requested ${config.problemCount} questions; only ${records.length} eligible problems are available`);
  if(mode==='MANUAL_SELECTION'){
    if(!Array.isArray(config.problems)||config.problems.length!==config.problemCount||new Set(config.problems.map(String)).size!==config.problemCount)throw fail('Select the exact number of distinct problem IDs');
    if(config.problems.some(id=>!records.some(p=>String(p._id)===String(id))))throw fail('Every selected problem must exist and have compatible C++ tests');
    return {selectionMode:mode,problems:config.problems.map(String),difficulties:config.problems.map(id=>records.find(p=>String(p._id)===String(id)).difficulty)};
  }
  if(config.problems?.length)throw fail('Random distribution does not accept client-supplied problem IDs');
  if(!Array.isArray(config.difficulties)||config.difficulties.length!==config.problemCount||config.difficulties.some(d=>!['easy','medium','hard'].includes(d)))throw fail('Choose one difficulty for each question');
  return drawRandom(records,config.difficulties);
}
function drawRandom(records,difficulties,random=randomInt){
  const pools={};
  for(const difficulty of ['easy','medium','hard']){
    const pool=records.filter(p=>p.difficulty===difficulty),needed=difficulties.filter(d=>d===difficulty).length;
    if(needed>pool.length)throw fail(`Requested ${needed} ${difficulty} question(s); only ${pool.length} eligible ${difficulty} problem(s) are available`);
    for(let i=pool.length-1;i>0;i--){const j=random(i+1);[pool[i],pool[j]]=[pool[j],pool[i]];}
    pools[difficulty]=pool;
  }
  return {selectionMode:'RANDOM_DISTRIBUTION',difficulties,problems:difficulties.map(d=>String(pools[d].pop()._id))};
}
module.exports={eligible,availability,select,drawRandom};
