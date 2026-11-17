// Runs real compilers/interpreters end to end. Languages whose toolchain is not
// installed on the machine are skipped (not failed).
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const dockerTests = process.env.TEST_DOCKER === 'true' || (process.platform === 'win32' && process.env.TEST_DOCKER !== 'false');
if (dockerTests) delete process.env.FORCE_DIRECT_EXECUTION;
else process.env.FORCE_DIRECT_EXECUTION = "true";

const { generateCode } = require("../src/services/executor/code-generator");
const { executeCode } = require("../src/services/executor/runner");

const has = (cmd, args = ["--version"]) => {
    try { execFileSync(cmd, args, { stdio: "ignore" }); return true; } catch { return false; }
};
const available = {
    cpp: has("g++"), python: has("python3"), javascript: has("node"),
    java: has("javac", ["-version"]) || has("java", ["--list-modules"])
};
if (dockerTests) for (const language of Object.keys(available)) available[language] = true;

const problem = (functionName, returnType, parameters) => ({ functionName, judgeConfig: { returnType, parameters } });

const SOLUTIONS = {
    twoSum: {
        problem: problem("twoSum", "vector<int>", [{ name: "nums", type: "vector<int>" }, { name: "target", type: "int" }]),
        tests: [["[4,8,1]\n9", "[1,2]"], ["[-5,2,7]\n2", "[0,2]"], ["[6,6]\n12", "[0,1]"]],
        code: {
            cpp: "class Solution { public: vector<int> twoSum(vector<int>& nums,int t){ for(int i=0;i<(int)nums.size();i++)for(int j=i+1;j<(int)nums.size();j++)if(nums[i]+nums[j]==t)return {i,j};return {}; } };",
            python: "class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n        for i in range(len(nums)):\n            for j in range(i+1, len(nums)):\n                if nums[i]+nums[j]==target: return [i,j]\n        return []",
            javascript: "class Solution { twoSum(nums, target) { for (let i=0;i<nums.length;i++) for (let j=i+1;j<nums.length;j++) if (nums[i]+nums[j]===target) return [i,j]; return []; } }",
            java: "class Solution { public int[] twoSum(int[] nums, int target) { for (int i=0;i<nums.length;i++) for (int j=i+1;j<nums.length;j++) if (nums[i]+nums[j]==target) return new int[]{i,j}; return new int[0]; } }"
        }
    },
    isPalindrome: {
        problem: problem("isPalindrome", "bool", [{ name: "x", type: "int" }]),
        tests: [["232", "true"], ["-44", "false"], ["0", "true"]],
        code: {
            cpp: "class Solution { public: bool isPalindrome(int x){ if(x<0)return false; string s=to_string(x),r=s; reverse(r.begin(),r.end()); return s==r; } };",
            python: "class Solution:\n    def isPalindrome(self, x: int) -> bool:\n        return x >= 0 and str(x) == str(x)[::-1]",
            javascript: "class Solution { isPalindrome(x) { return x >= 0 && String(x) === String(x).split('').reverse().join(''); } }",
            java: "import java.util.*;\npublic class Solution { public boolean isPalindrome(int x) { if (x < 0) return false; String s = String.valueOf(x); return new StringBuilder(s).reverse().toString().equals(s); } }"
        }
    },
    reverseWords: {
        problem: problem("rev", "vector<string>", [{ name: "words", type: "vector<string>" }]),
        tests: [['["ab","cd"]', '["cd","ab"]'], ["[]", "[]"]],
        code: {
            cpp: "class Solution { public: vector<string> rev(vector<string>& w){ reverse(w.begin(), w.end()); return w; } };",
            python: "class Solution:\n    def rev(self, words):\n        return words[::-1]",
            javascript: "class Solution { rev(words) { return words.reverse(); } }",
            java: "class Solution { public String[] rev(String[] w) { List<String> l = new ArrayList<>(Arrays.asList(w)); Collections.reverse(l); return l.toArray(new String[0]); } }"
        }
    },
    transpose: {
        problem: problem("transpose", "vector<vector<int>>", [{ name: "g", type: "vector<vector<int>>" }]),
        tests: [["[[1,2,3],[4,5,6]]", "[[1,4],[2,5],[3,6]]"], ["[[7]]", "[[7]]"]],
        code: {
            cpp: "class Solution { public: vector<vector<int>> transpose(vector<vector<int>>& g){ int n=g.size(),m=g[0].size(); vector<vector<int>> r(m, vector<int>(n)); for(int i=0;i<n;i++)for(int j=0;j<m;j++)r[j][i]=g[i][j]; return r; } };",
            python: "class Solution:\n    def transpose(self, g):\n        return [list(r) for r in zip(*g)]",
            javascript: "class Solution { transpose(g) { return g[0].map((_, j) => g.map(r => r[j])); } }",
            java: "class Solution { public int[][] transpose(int[][] g) { int n=g.length,m=g[0].length; int[][] r=new int[m][n]; for(int i=0;i<n;i++)for(int j=0;j<m;j++)r[j][i]=g[i][j]; return r; } }"
        }
    },
    longestWord: {
        problem: problem("echo", "string", [{ name: "s", type: "string" }, { name: "k", type: "long long" }]),
        tests: [["hello world\n3", "hello world"]],
        code: {
            cpp: "class Solution { public: string echo(string s, long long k){ return s; } };",
            python: "class Solution:\n    def echo(self, s, k):\n        return s",
            javascript: "class Solution { echo(s, k) { return s; } }",
            java: "class Solution { public String echo(String s, long k) { return s; } }"
        }
    }
};
// Python/Java users often include hoisted imports; Java one above exercises that.
SOLUTIONS.reverseWords.code.java = "import java.util.*;\n" + SOLUTIONS.reverseWords.code.java;

for (const language of Object.keys(available)) {
    for (const [name, spec] of Object.entries(SOLUTIONS)) {
        test(`${language}: ${name} passes all tests`, { skip: !available[language] && `${language} toolchain missing` }, async () => {
            const tests = spec.tests.map(([input, expectedOutput]) => ({ input, expectedOutput }));
            const { results } = await executeCode(language, generateCode(spec.problem, spec.code[language], language), tests);
            results.forEach((r, i) => {
                assert.strictEqual(r.status, "success", `${language}/${name} test ${i + 1}: ${r.error}`);
                assert.strictEqual(r.output.trim(), tests[i].expectedOutput);
            });
        });
    }

    test(`${language}: compile/syntax error is reported`, { skip: !available[language] && "missing" }, async () => {
        const broken = { cpp: "class Solution { public: int f(int x){ return x +; } };", python: "class Solution:\n    def f(self, x):\n    return x +", javascript: "class Solution { f(x) { return x +; } }", java: "class Solution { public int f(int x) { return x +; } }" }[language];
        const p = problem("f", "int", [{ name: "x", type: "int" }]);
        const { results } = await executeCode(language, generateCode(p, broken, language), [{ input: "1" }]);
        assert.strictEqual(results[0].status, "compile_error");
        assert.ok(results[0].error.length > 0);
        assert.ok(!results[0].error.includes("codeforge-"), "temp dir leaked into error text");
    });

    test(`${language}: infinite loop -> time_limit_exceeded, runtime crash -> runtime_error`, { skip: !available[language] && "missing" }, async () => {
        const p = problem("f", "int", [{ name: "x", type: "int" }]);
        const loop = { cpp: "class Solution { public: int f(int x){ while(true){} return 0; } };", python: "class Solution:\n    def f(self, x):\n        while True: pass", javascript: "class Solution { f(x) { while (true) {} } }", java: "class Solution { public int f(int x) { while (true) {} } }" }[language];
        const crash = { cpp: "class Solution { public: int f(int x){ int* p=nullptr; return *p; } };", python: "class Solution:\n    def f(self, x):\n        return 1 // 0", javascript: "class Solution { f(x) { throw new Error('boom'); } }", java: "class Solution { public int f(int x) { return 1 / (x - x); } }" }[language];
        const a = await executeCode(language, generateCode(p, loop, language), [{ input: "1" }]);
        assert.strictEqual(a.results[0].status, "time_limit_exceeded");
        const b = await executeCode(language, generateCode(p, crash, language), [{ input: "1" }]);
        assert.strictEqual(b.results[0].status, "runtime_error");
    });

    test(`${language}: user code cannot read server secrets from the environment`, { skip: !available[language] && "missing" }, async () => {
        process.env.JWT_SECRET = "super-secret-value";
        process.env.MONGO_URI = "mongodb://secret";
        const p = problem("f", "string", [{ name: "x", type: "int" }]);
        const peek = {
            cpp: 'class Solution { public: string f(int x){ const char* a=getenv("JWT_SECRET"); const char* b=getenv("MONGO_URI"); return string(a?a:"none")+"|"+(b?b:"none"); } };',
            python: 'import os\nclass Solution:\n    def f(self, x):\n        return os.environ.get("JWT_SECRET","none")+"|"+os.environ.get("MONGO_URI","none")',
            javascript: 'class Solution { f(x) { return (process.env.JWT_SECRET||"none")+"|"+(process.env.MONGO_URI||"none"); } }',
            java: 'class Solution { public String f(int x) { String a=System.getenv("JWT_SECRET"), b=System.getenv("MONGO_URI"); return (a==null?"none":a)+"|"+(b==null?"none":b); } }'
        }[language];
        const { results } = await executeCode(language, generateCode(p, peek, language), [{ input: "1" }]);
        assert.strictEqual(results[0].status, "success", results[0].error);
        assert.strictEqual(results[0].output.trim(), "none|none");
    });
}

test("stop-on-failure skips the remaining tests", { skip: !available.python && "python missing" }, async () => {
    const p = problem("f", "int", [{ name: "x", type: "int" }]);
    const code = generateCode(p, "class Solution:\n    def f(self, x):\n        raise RuntimeError('x')", "python");
    const { results } = await executeCode("python", code, [{ input: "1" }, { input: "2" }, { input: "3" }], { isFailure: (r) => r.status !== "success" });
    assert.strictEqual(results.length, 1);
});
