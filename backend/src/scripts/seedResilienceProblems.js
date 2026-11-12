// Small, independently worded practice fixtures with original tests, not a mirror
// of LeetCode statements or its hidden test suites. Existing data is never reset.
require('dotenv').config({path:require('node:path').join(__dirname,'../../.env')});
const mongoose=require('mongoose');
const User=require('../models/User');
const Problem=require('../models/Problem');
const TestCase=require('../models/TestCase');
const fixtures=[
  {
    title:'Two Sum — Resilience Practice',
    description:'Find two different positions in nums whose values total target. Return their zero-based indices in increasing order. Each test has exactly one valid pair. This local variant requires sorted indices because Code Forge compares exact output. Implement Solution::twoSum. Independently worded practice variant inspired by https://leetcode.com/problems/two-sum/ . Tests are original local fixtures, not LeetCode hidden tests.',
    tags:['array','hash-table'],constraints:['2 <= nums.length <= 1000','Values and target are between -100000 and 100000','Return indices in increasing order'],
    functionName:'twoSum',judgeConfig:{returnType:'vector<int>',parameters:[{name:'nums',type:'vector<int>'},{name:'target',type:'int'}]},
    starterCode:'class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        // Find the pair, then return the indices in increasing order.\n        return {};\n    }\n};',
    solution:'class Solution { public: vector<int> twoSum(vector<int>& nums,int target){ for(int i=0;i<(int)nums.size();i++)for(int j=i+1;j<(int)nums.size();j++)if(nums[i]+nums[j]==target)return {i,j};return {}; } };',
    tests:[['[4,8,1]\n9','[1,2]'],['[-5,2,7]\n2','[0,2]'],['[6,6]\n12','[0,1]'],['[2,9,4,7]\n13','[1,2]']],
  },
  {
    title:'Palindrome Number — Resilience Practice',
    description:'Decide whether the decimal digits of x read identically from either direction. Negative integers are not palindromes; zero is. Return a boolean from Solution::isPalindrome. Independently worded practice variant inspired by https://leetcode.com/problems/palindrome-number/ . Uses original local tests.',
    tags:['math'],constraints:['x is a signed 32-bit integer'],functionName:'isPalindrome',judgeConfig:{returnType:'bool',parameters:[{name:'x',type:'int'}]},
    starterCode:'class Solution {\npublic:\n    bool isPalindrome(int x) {\n        // Check whether the decimal digits are symmetric.\n        return false;\n    }\n};',
    solution:'class Solution { public: bool isPalindrome(int x){if(x<0)return false;string s=to_string(x),r=s;reverse(r.begin(),r.end());return s==r;} };',
    tests:[['232','true'],['-44','false'],['120','false'],['0','true'],['2147447412','true']],
  },
  {
    title:'Running Sum — Resilience Practice',
    description:'Build an array in which position i contains the total of nums from position zero through i. Return that array from Solution::runningSum. Independently worded practice variant inspired by https://leetcode.com/problems/running-sum-of-1d-array/ . Uses original local tests.',
    tags:['array','prefix-sum'],constraints:['1 <= nums.length <= 1000','-1000 <= nums[i] <= 1000'],functionName:'runningSum',judgeConfig:{returnType:'vector<int>',parameters:[{name:'nums',type:'vector<int>'}]},
    starterCode:'class Solution {\npublic:\n    vector<int> runningSum(vector<int>& nums) {\n        // Return the prefix totals.\n        return {};\n    }\n};',
    solution:'class Solution { public: vector<int> runningSum(vector<int>& nums){vector<int> result;int sum=0;for(int value:nums){sum+=value;result.push_back(sum);}return result;} };',
    tests:[['[2,5,-1]','[2,7,6]'],['[0]','[0]'],['[-3,-2,4]','[-3,-5,-1]'],['[8,0,2]','[8,8,10]']],
  },
];
(async()=>{
  if(!process.env.MONGO_URI)throw Error('MONGO_URI is missing');
  await mongoose.connect(process.env.MONGO_URI);
  const owner=await User.findOne().select('_id');
  if(!owner)throw Error('Register a user first; this script will not create or change user accounts.');
  await Problem.init();
  let number=(await Problem.findOne().sort({problemNumber:-1}).select('problemNumber'))?.problemNumber || 0;
  for(const fixture of fixtures){
    if(process.argv.includes('--verify')){
      const {generateCode}=require('../services/executor/code-generator');
      const {executeCpp}=require('../services/executor/cpp.executor');
      const result=await executeCpp(generateCode(fixture,fixture.solution),fixture.tests.map(([input,expectedOutput])=>({input,expectedOutput})));
      result.results.forEach((test,index)=>{
        if(test.status!=='success'||test.output.trim()!==fixture.tests[index][1])throw Error(`${fixture.title}: test ${index+1} failed: ${test.error || test.output}`);
      });
      console.log(`Verified ${fixture.tests.length} Docker C++ tests: ${fixture.title}`);
    }
    let problem=await Problem.findOne({title:fixture.title});
    if(problem){console.log(`Preserved existing problem: ${fixture.title}`);continue;}
    const {tests,solution,...data}=fixture;
    problem=await Problem.create({...data,problemNumber:++number,difficulty:'easy',createdBy:owner._id,examples:tests.slice(0,2).map(([input,output])=>({input,output,explanation:'Inputs are listed in function-parameter order, one parameter per line.'}))});
    await TestCase.insertMany(tests.map(([input,expectedOutput],index)=>({problem:problem._id,input,expectedOutput,isHidden:index>=2,createdBy:owner._id})));
    console.log(`Added #${problem.problemNumber}: ${problem.title} — /problems/${problem._id}`);
  }
})().catch(error=>{console.error(error.message);process.exitCode=1;}).finally(()=>mongoose.disconnect());
