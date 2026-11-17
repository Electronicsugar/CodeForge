// Problem bank: original statements, deterministic tests.
//
// Each problem has TWO independent implementations:
//   ref : JavaScript reference used to generate the expected outputs
//   cpp : C++ solution that must reproduce every expected output through the real judge
// `seedProblemBank.js --verify` runs the C++ solution for every problem and
// refuses to seed anything that disagrees, so a wrong expected output cannot ship.
//
// Rules the judge imposes: parameters one-per-line, vectors as [1,2,3]; expected
// output must be non-empty (Mongo `required`), so no problem returns "".

const rng = (seed) => { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const ri = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const arr = (r, n, lo, hi) => Array.from({ length: n }, () => ri(r, lo, hi));
const word = (r, n, alpha = "abcdefghij") => Array.from({ length: n }, () => alpha[ri(r, 0, alpha.length - 1)]).join("");
const distinctSorted = (r, n, lo, hi) => [...new Set(arr(r, n * 2, lo, hi))].sort((a, b) => a - b).slice(0, n);
const grid = (r, h, w, p = 0.5) => Array.from({ length: h }, () => Array.from({ length: w }, () => (r() < p ? 1 : 0)));

const fmt = (type, v) => {
    if (type === "string") return v;
    if (type === "bool") return v ? "true" : "false";
    if (type === "int" || type === "long long") return String(v);
    return JSON.stringify(v);
};

const make = (def) => ({ ...def });

const BANK = [
    // ───────────────────────────── EASY ─────────────────────────────────────
    make({ title: "Reverse a String", difficulty: "easy", tags: ["string", "two-pointers"],
        description: "Given a string s, return the string written backwards. Spaces inside the string are kept and move with the other characters (the judge trims leading and trailing whitespace, so tests never start or end with a space).",
        constraints: ["1 <= s.length <= 100000"], fn: "reverseText", ret: "string", params: [["s", "string"]],
        samples: [["codeforge"], ["a b c"]], edge: [["x"], ["h  i"]], gen: (r) => [word(r, ri(r, 2, 40), "abcxyz")], big: (r) => [word(r, 100000)],
        ref: (s) => [...s].reverse().join(""),
        cpp: "class Solution { public: string reverseText(string s){ reverse(s.begin(), s.end()); return s; } };" }),
    make({ title: "Balanced Brackets", difficulty: "easy", tags: ["string", "stack"],
        description: "A string contains only the characters ( ) [ ] { }. It is balanced if every opening bracket is closed by the same kind of bracket in the correct order. Return true if s is balanced.",
        constraints: ["1 <= s.length <= 10000"], fn: "isBalanced", ret: "bool", params: [["s", "string"]],
        samples: [["([]){}"], ["(]"]], edge: [["("], ["]["], ["{[()]}"]], gen: (r) => [word(r, ri(r, 2, 14), "()[]{}")],
        ref: (s) => { const st = [], m = { ")": "(", "]": "[", "}": "{" }; for (const c of s) { if ("([{".includes(c)) st.push(c); else if (st.pop() !== m[c]) return false; } return st.length === 0; },
        cpp: "class Solution { public: bool isBalanced(string s){ string st; for(char c: s){ if(c=='('||c=='['||c=='{') st.push_back(c); else { if(st.empty()) return false; char o=st.back(); st.pop_back(); if((c==')'&&o!='(')||(c==']'&&o!='[')||(c=='}'&&o!='{')) return false; } } return st.empty(); } };" }),
    make({ title: "Largest Element", difficulty: "easy", tags: ["array"],
        description: "Return the largest value in the array nums.", constraints: ["1 <= nums.length <= 100000", "-1000000 <= nums[i] <= 1000000"],
        fn: "largest", ret: "int", params: [["nums", "vector<int>"]],
        samples: [[[3, 9, 2]], [[-5, -2, -9]]], edge: [[[7]], [[0, 0, 0]]], gen: (r) => [arr(r, ri(r, 1, 30), -100, 100)], big: (r) => [arr(r, 100000, -1000000, 1000000)],
        ref: (a) => Math.max(...a),
        cpp: "class Solution { public: int largest(vector<int>& nums){ return *max_element(nums.begin(), nums.end()); } };" }),
    make({ title: "Count the Vowels", difficulty: "easy", tags: ["string"],
        description: "Count how many characters of s are vowels (a, e, i, o, u). The string contains only lowercase letters and spaces.",
        constraints: ["1 <= s.length <= 100000"], fn: "countVowels", ret: "int", params: [["s", "string"]],
        samples: [["education"], ["rhythm"]], edge: [["aeiou"], ["xyz"]], gen: (r) => [word(r, ri(r, 1, 50), "abcdeiou xyz")],
        ref: (s) => [...s].filter((c) => "aeiou".includes(c)).length,
        cpp: "class Solution { public: int countVowels(string s){ int c=0; for(char ch: s) if(string(\"aeiou\").find(ch)!=string::npos) c++; return c; } };" }),
    make({ title: "Ways to Climb", difficulty: "easy", tags: ["dp", "math"],
        description: "A staircase has n steps. You may climb 1 or 2 steps at a time. Return the number of distinct ways to reach the top.",
        constraints: ["1 <= n <= 40"], fn: "climb", ret: "int", params: [["n", "int"]],
        samples: [[3], [5]], edge: [[1], [2], [40]], gen: (r) => [ri(r, 3, 39)],
        ref: (n) => { let a = 1, b = 1; for (let i = 2; i <= n; i++) [a, b] = [b, a + b]; return b; },
        cpp: "class Solution { public: int climb(int n){ vector<long long> f(n+2); f[0]=1; f[1]=1; for(int i=2;i<=n;i++) f[i]=f[i-1]+f[i-2]; return (int)f[n]; } };" }),
    make({ title: "Sorted Search", difficulty: "easy", tags: ["array", "binary-search"],
        description: "nums is sorted in strictly increasing order. Return the index of target in nums, or -1 if it is absent. Aim for O(log n).",
        constraints: ["1 <= nums.length <= 100000", "All values are distinct"], fn: "search", ret: "int", params: [["nums", "vector<int>"], ["target", "int"]],
        samples: [[[1, 4, 7, 9], 7], [[1, 4, 7, 9], 5]], edge: [[[5], 5], [[5], 4]],
        gen: (r) => { const a = distinctSorted(r, ri(r, 1, 25), -50, 50); return [a, r() < 0.6 ? a[ri(r, 0, a.length - 1)] : ri(r, -60, 60)]; },
        big: (r) => { const a = Array.from({ length: 100000 }, (_, i) => i * 3 - 1000); return [a, a[77777]]; },
        ref: (a, t) => a.indexOf(t),
        cpp: "class Solution { public: int search(vector<int>& nums,int target){ int lo=0,hi=(int)nums.size()-1; while(lo<=hi){ int m=lo+(hi-lo)/2; if(nums[m]==target) return m; if(nums[m]<target) lo=m+1; else hi=m-1; } return -1; } };" }),
    make({ title: "Merge Two Sorted Arrays", difficulty: "easy", tags: ["array", "two-pointers"],
        description: "Both arrays are sorted in non-decreasing order. Return a single sorted array containing all elements of a and b.",
        constraints: ["1 <= a.length, b.length <= 50000"], fn: "mergeSorted", ret: "vector<int>", params: [["a", "vector<int>"], ["b", "vector<int>"]],
        samples: [[[1, 3, 5], [2, 4, 6]], [[1, 1], [1]]], edge: [[[1], [2]], [[-5, 0], [-5, 0]]],
        gen: (r) => [arr(r, ri(r, 1, 12), -20, 20).sort((x, y) => x - y), arr(r, ri(r, 1, 12), -20, 20).sort((x, y) => x - y)],
        ref: (a, b) => [...a, ...b].sort((x, y) => x - y),
        cpp: "class Solution { public: vector<int> mergeSorted(vector<int>& a, vector<int>& b){ vector<int> r(a.size()+b.size()); merge(a.begin(),a.end(),b.begin(),b.end(),r.begin()); return r; } };" }),
    make({ title: "The Lonely Number", difficulty: "easy", tags: ["array", "bit-manipulation"],
        description: "Every value in nums appears exactly twice, except one value that appears once. Return that value. Try to use O(1) extra memory.",
        constraints: ["1 <= nums.length <= 99999 (odd)", "-100000 <= nums[i] <= 100000"], fn: "findLonely", ret: "int", params: [["nums", "vector<int>"]],
        samples: [[[4, 1, 2, 1, 2]], [[7]]], edge: [[[-3, -3, 9]]],
        gen: (r) => { const k = ri(r, 1, 8), vals = [...new Set(arr(r, k + 1, -30, 30))]; const lone = vals.pop(); const a = [lone]; for (const v of vals) a.push(v, v); return [a.sort(() => r() - 0.5)]; },
        ref: (a) => a.reduce((x, y) => x ^ y, 0),
        cpp: "class Solution { public: int findLonely(vector<int>& nums){ int x=0; for(int v: nums) x^=v; return x; } };" }),
    make({ title: "Zeroes to the End", difficulty: "easy", tags: ["array", "two-pointers"],
        description: "Return a copy of nums in which every zero has been moved to the end while the other values keep their original relative order.",
        constraints: ["1 <= nums.length <= 100000"], fn: "zeroesLast", ret: "vector<int>", params: [["nums", "vector<int>"]],
        samples: [[[0, 3, 0, 5, 8]], [[1, 2]]], edge: [[[0]], [[0, 0, 4]]], gen: (r) => [arr(r, ri(r, 1, 20), -3, 3)],
        ref: (a) => [...a.filter((x) => x !== 0), ...a.filter((x) => x === 0)],
        cpp: "class Solution { public: vector<int> zeroesLast(vector<int>& nums){ vector<int> r; for(int v: nums) if(v!=0) r.push_back(v); while(r.size()<nums.size()) r.push_back(0); return r; } };" }),
    make({ title: "Anagram Check", difficulty: "easy", tags: ["string", "hash-table"],
        description: "Return true if string b can be formed by rearranging the letters of string a (same letters, same counts). Strings contain lowercase letters only.",
        constraints: ["1 <= a.length, b.length <= 100000"], fn: "isAnagram", ret: "bool", params: [["a", "string"], ["b", "string"]],
        samples: [["listen", "silent"], ["rat", "car"]], edge: [["a", "a"], ["ab", "abc"]],
        gen: (r) => { const a = word(r, ri(r, 1, 8), "abc"); const b = r() < 0.5 ? [...a].sort(() => r() - 0.5).join("") : word(r, a.length, "abc"); return [a, b]; },
        ref: (a, b) => [...a].sort().join("") === [...b].sort().join(""),
        cpp: "class Solution { public: bool isAnagram(string a, string b){ sort(a.begin(),a.end()); sort(b.begin(),b.end()); return a==b; } };" }),
    make({ title: "The Missing Number", difficulty: "easy", tags: ["array", "math"],
        description: "nums holds n distinct integers taken from 0..n. Exactly one number from that range is missing. Return it.",
        constraints: ["1 <= n <= 100000"], fn: "missing", ret: "int", params: [["nums", "vector<int>"]],
        samples: [[[3, 0, 1]], [[0, 1]]], edge: [[[1]], [[0]]],
        gen: (r) => { const n = ri(r, 1, 25), all = Array.from({ length: n + 1 }, (_, i) => i); all.splice(ri(r, 0, n), 1); return [all.sort(() => r() - 0.5)]; },
        ref: (a) => { const n = a.length; return (n * (n + 1)) / 2 - a.reduce((s, x) => s + x, 0); },
        cpp: "class Solution { public: int missing(vector<int>& nums){ long long n=nums.size(), s=n*(n+1)/2; for(int v: nums) s-=v; return (int)s; } };" }),
    make({ title: "Any Repeats?", difficulty: "easy", tags: ["array", "hash-table"],
        description: "Return true if some value appears at least twice in nums, and false if all values are distinct.",
        constraints: ["1 <= nums.length <= 100000"], fn: "hasRepeat", ret: "bool", params: [["nums", "vector<int>"]],
        samples: [[[1, 2, 3, 1]], [[1, 2, 3]]], edge: [[[5]], [[2, 2]]], gen: (r) => [arr(r, ri(r, 1, 12), 0, 15)],
        ref: (a) => new Set(a).size !== a.length,
        cpp: "class Solution { public: bool hasRepeat(vector<int>& nums){ unordered_set<int> s; for(int v: nums) if(!s.insert(v).second) return true; return false; } };" }),

    // ──────────────────────────── MEDIUM ────────────────────────────────────
    make({ title: "Best Contiguous Sum", difficulty: "medium", tags: ["array", "dp"],
        description: "Return the largest possible sum of a non-empty contiguous block of nums.",
        constraints: ["1 <= nums.length <= 100000", "-10000 <= nums[i] <= 10000"], fn: "bestSum", ret: "int", params: [["nums", "vector<int>"]],
        samples: [[[-2, 1, -3, 4, -1, 2, 1, -5, 4]], [[-4, -1, -7]]], edge: [[[5]], [[-1]]], gen: (r) => [arr(r, ri(r, 1, 20), -10, 10)], big: (r) => [arr(r, 100000, -10000, 10000)],
        ref: (a) => { let best = -Infinity, cur = 0; for (const x of a) { cur = Math.max(x, cur + x); best = Math.max(best, cur); } return best; },
        cpp: "class Solution { public: int bestSum(vector<int>& nums){ long long best=LLONG_MIN, cur=0; for(int x: nums){ cur=max((long long)x,cur+x); best=max(best,cur);} return (int)best; } };" }),
    make({ title: "Longest Unique Stretch", difficulty: "medium", tags: ["string", "sliding-window", "hash-table"],
        description: "Return the length of the longest substring of s in which no character appears twice.",
        constraints: ["1 <= s.length <= 100000"], fn: "longestUnique", ret: "int", params: [["s", "string"]],
        samples: [["abcabcbb"], ["bbbb"]], edge: [["a"], ["abcdef"]], gen: (r) => [word(r, ri(r, 1, 30), "abcde")], big: (r) => [word(r, 100000, "abcdefghijklmnopqrstuvwxyz")],
        ref: (s) => { const seen = new Map(); let best = 0, lo = 0; for (let i = 0; i < s.length; i++) { if (seen.has(s[i]) && seen.get(s[i]) >= lo) lo = seen.get(s[i]) + 1; seen.set(s[i], i); best = Math.max(best, i - lo + 1); } return best; },
        cpp: "class Solution { public: int longestUnique(string s){ vector<int> last(256,-1); int best=0, lo=0; for(int i=0;i<(int)s.size();i++){ unsigned char c=s[i]; if(last[c]>=lo) lo=last[c]+1; last[c]=i; best=max(best,i-lo+1);} return best; } };" }),
    make({ title: "Widest Water Tank", difficulty: "medium", tags: ["array", "two-pointers", "greedy"],
        description: "heights[i] is the height of a vertical wall at position i. Choose two walls; the water they hold has area (distance between them) x (the shorter wall). Return the largest area possible.",
        constraints: ["2 <= heights.length <= 100000", "0 <= heights[i] <= 10000"], fn: "maxWater", ret: "int", params: [["heights", "vector<int>"]],
        samples: [[[1, 8, 6, 2, 5, 4, 8, 3, 7]], [[1, 1]]], edge: [[[0, 0]], [[5, 1, 1, 5]]], gen: (r) => [arr(r, ri(r, 2, 20), 0, 30)], big: (r) => [arr(r, 100000, 0, 10000)],
        ref: (h) => { let best = 0; for (let i = 0, j = h.length - 1; i < j;) { best = Math.max(best, (j - i) * Math.min(h[i], h[j])); if (h[i] < h[j]) i++; else j--; } return best; },
        cpp: "class Solution { public: int maxWater(vector<int>& h){ long long best=0; int i=0,j=(int)h.size()-1; while(i<j){ best=max(best,(long long)(j-i)*min(h[i],h[j])); if(h[i]<h[j]) i++; else j--; } return (int)best; } };" }),
    make({ title: "Fewest Coins", difficulty: "medium", tags: ["dp"],
        description: "You have unlimited coins of each denomination in coins. Return the fewest coins needed to make exactly amount, or -1 if it is impossible.",
        constraints: ["1 <= coins.length <= 12", "1 <= coins[i] <= 1000", "1 <= amount <= 10000"], fn: "fewestCoins", ret: "int", params: [["coins", "vector<int>"], ["amount", "int"]],
        samples: [[[1, 2, 5], 11], [[4, 6], 7]], edge: [[[3], 9], [[2], 1]], gen: (r) => [[...new Set(arr(r, ri(r, 1, 5), 1, 12))], ri(r, 1, 60)], big: () => [[7, 13, 29, 101, 997], 10000],
        ref: (c, a) => { const d = Array(a + 1).fill(Infinity); d[0] = 0; for (let i = 1; i <= a; i++) for (const x of c) if (x <= i) d[i] = Math.min(d[i], d[i - x] + 1); return d[a] === Infinity ? -1 : d[a]; },
        cpp: "class Solution { public: int fewestCoins(vector<int>& coins,int amount){ vector<int> d(amount+1, INT_MAX); d[0]=0; for(int i=1;i<=amount;i++) for(int c: coins) if(c<=i && d[i-c]!=INT_MAX) d[i]=min(d[i], d[i-c]+1); return d[amount]==INT_MAX?-1:d[amount]; } };" }),
    make({ title: "Longest Rising Subsequence", difficulty: "medium", tags: ["dp", "binary-search"],
        description: "Return the length of the longest strictly increasing subsequence of nums (elements need not be adjacent).",
        constraints: ["1 <= nums.length <= 5000", "-100000 <= nums[i] <= 100000"], fn: "longestRising", ret: "int", params: [["nums", "vector<int>"]],
        samples: [[[10, 9, 2, 5, 3, 7, 101, 18]], [[7, 7, 7]]], edge: [[[1]], [[5, 4, 3, 2, 1]]], gen: (r) => [arr(r, ri(r, 1, 25), -20, 20)], big: (r) => [arr(r, 5000, -100000, 100000)],
        ref: (a) => { const t = []; for (const x of a) { let lo = 0, hi = t.length; while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < x) lo = m + 1; else hi = m; } t[lo] = x; } return t.length; },
        cpp: "class Solution { public: int longestRising(vector<int>& nums){ int n=nums.size(); vector<int> d(n,1); int best=0; for(int i=0;i<n;i++){ for(int j=0;j<i;j++) if(nums[j]<nums[i]) d[i]=max(d[i],d[j]+1); best=max(best,d[i]); } return best; } };" }),
    make({ title: "Street Robber", difficulty: "medium", tags: ["dp"],
        description: "Houses stand in a row and money[i] is the cash in house i. You may not rob two neighbouring houses. Return the maximum cash you can take.",
        constraints: ["1 <= money.length <= 100000", "0 <= money[i] <= 10000"], fn: "maxLoot", ret: "int", params: [["money", "vector<int>"]],
        samples: [[[2, 7, 9, 3, 1]], [[5]]], edge: [[[0, 0]], [[3, 10, 3]]], gen: (r) => [arr(r, ri(r, 1, 20), 0, 30)], big: (r) => [arr(r, 100000, 0, 10000)],
        ref: (m) => { let a = 0, b = 0; for (const x of m) [a, b] = [b, Math.max(b, a + x)]; return b; },
        cpp: "class Solution { public: int maxLoot(vector<int>& m){ long long take=0, skip=0; for(int x: m){ long long nt=skip+x, ns=max(take,skip); take=nt; skip=ns;} return (int)max(take,skip); } };" }),
    make({ title: "Product of the Others", difficulty: "medium", tags: ["array", "prefix-sum"],
        description: "Return an array out where out[i] is the product of every element of nums except nums[i]. Do not use division. All products fit in a 32-bit signed integer.",
        constraints: ["2 <= nums.length <= 12", "-5 <= nums[i] <= 5"], fn: "productExceptSelf", ret: "vector<int>", params: [["nums", "vector<int>"]],
        samples: [[[1, 2, 3, 4]], [[2, 0, 5]]], edge: [[[0, 0, 3]], [[-1, 1]]], gen: (r) => [arr(r, ri(r, 2, 11), -4, 4)],
        ref: (a) => a.map((_, i) => a.reduce((p, x, j) => (j === i ? p : p * x), 1)),
        cpp: "class Solution { public: vector<int> productExceptSelf(vector<int>& a){ int n=a.size(); vector<int> r(n,1); int pre=1; for(int i=0;i<n;i++){ r[i]=pre; pre*=a[i]; } int suf=1; for(int i=n-1;i>=0;i--){ r[i]*=suf; suf*=a[i]; } return r; } };" }),
    make({ title: "Rotate to the Right", difficulty: "medium", tags: ["array", "math"],
        description: "Rotate nums to the right by k positions and return the result. The last k values move to the front, keeping their order. k may be larger than the array length.",
        constraints: ["1 <= nums.length <= 100000", "0 <= k <= 1000000000"], fn: "rotateRight", ret: "vector<int>", params: [["nums", "vector<int>"], ["k", "int"]],
        samples: [[[1, 2, 3, 4, 5], 2], [[9, 8], 5]], edge: [[[1], 3], [[1, 2, 3], 0], [[1, 2, 3], 3]], gen: (r) => [arr(r, ri(r, 1, 15), -9, 9), ri(r, 0, 40)],
        ref: (a, k) => { const n = a.length, s = k % n; return [...a.slice(n - s), ...a.slice(0, n - s)]; },
        cpp: "class Solution { public: vector<int> rotateRight(vector<int>& a,int k){ int n=a.size(); k%=n; rotate(a.begin(), a.begin()+(n-k), a.end()); return a; } };" }),
    make({ title: "Count the Islands", difficulty: "medium", tags: ["graph", "dfs", "matrix"],
        description: "grid is a rectangle of 0 (water) and 1 (land). An island is a group of land cells connected up, down, left or right. Return the number of islands.",
        constraints: ["1 <= rows, columns <= 100"], fn: "countIslands", ret: "int", params: [["grid", "vector<vector<int>>"]],
        samples: [[[[1, 1, 0], [0, 1, 0], [1, 0, 1]]], [[[0, 0], [0, 0]]]], edge: [[[[1]]], [[[1, 0, 1, 0, 1]]]], gen: (r) => [grid(r, ri(r, 1, 8), ri(r, 1, 8), 0.45)], big: (r) => [grid(r, 100, 100, 0.55)],
        ref: (g) => { const h = g.length, w = g[0].length, seen = g.map((row) => row.map(() => false)); let c = 0; for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) { if (g[i][j] !== 1 || seen[i][j]) continue; c++; const st = [[i, j]]; seen[i][j] = true; while (st.length) { const [x, y] = st.pop(); for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const a = x + dx, b = y + dy; if (a >= 0 && b >= 0 && a < h && b < w && g[a][b] === 1 && !seen[a][b]) { seen[a][b] = true; st.push([a, b]); } } } } return c; },
        cpp: "class Solution { public: int countIslands(vector<vector<int>>& g){ int h=g.size(), w=g[0].size(), c=0; function<void(int,int)> dfs=[&](int x,int y){ if(x<0||y<0||x>=h||y>=w||g[x][y]!=1) return; g[x][y]=2; dfs(x+1,y); dfs(x-1,y); dfs(x,y+1); dfs(x,y-1); }; for(int i=0;i<h;i++) for(int j=0;j<w;j++) if(g[i][j]==1){ c++; dfs(i,j);} return c; } };" }),
    make({ title: "Warmer Days", difficulty: "medium", tags: ["array", "stack"],
        description: "temps[i] is the temperature on day i. For each day return how many days you must wait for a strictly warmer day, or 0 if there is none.",
        constraints: ["1 <= temps.length <= 100000", "30 <= temps[i] <= 100"], fn: "warmerDays", ret: "vector<int>", params: [["temps", "vector<int>"]],
        samples: [[[73, 74, 75, 71, 69, 72, 76, 73]], [[50, 40, 30]]], edge: [[[60]], [[60, 60, 61]]], gen: (r) => [arr(r, ri(r, 1, 18), 30, 40)], big: (r) => [arr(r, 100000, 30, 100)],
        ref: (t) => { const out = Array(t.length).fill(0), st = []; for (let i = 0; i < t.length; i++) { while (st.length && t[st[st.length - 1]] < t[i]) { const j = st.pop(); out[j] = i - j; } st.push(i); } return out; },
        cpp: "class Solution { public: vector<int> warmerDays(vector<int>& t){ int n=t.size(); vector<int> r(n,0); vector<int> st; for(int i=0;i<n;i++){ while(!st.empty() && t[st.back()]<t[i]){ r[st.back()]=i-st.back(); st.pop_back(); } st.push_back(i);} return r; } };" }),
    make({ title: "K-th Largest", difficulty: "medium", tags: ["array", "heap", "sorting"],
        description: "Return the k-th largest value of nums when it is sorted in descending order. Equal values are counted separately.",
        constraints: ["1 <= k <= nums.length <= 100000"], fn: "kthLargest", ret: "int", params: [["nums", "vector<int>"], ["k", "int"]],
        samples: [[[3, 2, 1, 5, 6, 4], 2], [[7, 7, 7], 3]], edge: [[[1], 1]], gen: (r) => { const a = arr(r, ri(r, 1, 20), -20, 20); return [a, ri(r, 1, a.length)]; }, big: (r) => [arr(r, 100000, -1000000, 1000000), 50000],
        ref: (a, k) => [...a].sort((x, y) => y - x)[k - 1],
        cpp: "class Solution { public: int kthLargest(vector<int>& nums,int k){ nth_element(nums.begin(), nums.begin()+(k-1), nums.end(), greater<int>()); return nums[k-1]; } };" }),
    make({ title: "Paths Around Obstacles", difficulty: "medium", tags: ["dp", "matrix"],
        description: "A robot starts at the top-left cell of a grid and must reach the bottom-right cell, moving only right or down. Cells containing 1 are blocked. Return the number of different paths (0 if none). The answer fits in a 32-bit integer.",
        constraints: ["1 <= rows, columns <= 12"], fn: "countPaths", ret: "int", params: [["grid", "vector<vector<int>>"]],
        samples: [[[[0, 0, 0], [0, 1, 0], [0, 0, 0]]], [[[0, 1], [1, 0]]]], edge: [[[[0]]], [[[1]]]], gen: (r) => { const g = grid(r, ri(r, 1, 7), ri(r, 1, 7), 0.2); g[0][0] = 0; g[g.length - 1][g[0].length - 1] = 0; return [g]; },
        ref: (g) => { const h = g.length, w = g[0].length, d = g.map((r) => r.map(() => 0)); if (g[0][0] === 1) return 0; d[0][0] = 1; for (let i = 0; i < h; i++) for (let j = 0; j < w; j++) { if (g[i][j] === 1) { d[i][j] = 0; continue; } if (i || j) d[i][j] = (i ? d[i - 1][j] : 0) + (j ? d[i][j - 1] : 0); } return d[h - 1][w - 1]; },
        cpp: "class Solution { public: int countPaths(vector<vector<int>>& g){ int h=g.size(), w=g[0].size(); vector<vector<long long>> d(h, vector<long long>(w,0)); if(g[0][0]==1) return 0; d[0][0]=1; for(int i=0;i<h;i++) for(int j=0;j<w;j++){ if(g[i][j]==1){ d[i][j]=0; continue;} if(i||j){ d[i][j]=(i?d[i-1][j]:0)+(j?d[i][j-1]:0);} } return (int)d[h-1][w-1]; } };" }),
    make({ title: "Spiral Walk", difficulty: "medium", tags: ["array", "matrix", "simulation"],
        description: "Walk through a matrix in a clockwise spiral starting at the top-left cell and return the visited values in order.",
        constraints: ["1 <= rows, columns <= 100"], fn: "spiral", ret: "vector<int>", params: [["matrix", "vector<vector<int>>"]],
        samples: [[[[1, 2, 3], [4, 5, 6], [7, 8, 9]]], [[[1, 2], [3, 4], [5, 6]]]], edge: [[[[7]]], [[[1, 2, 3]]], [[[1], [2], [3]]]],
        gen: (r) => { const h = ri(r, 1, 6), w = ri(r, 1, 6); return [Array.from({ length: h }, () => arr(r, w, -9, 9))]; },
        ref: (m) => { const out = []; let t = 0, b = m.length - 1, l = 0, rr = m[0].length - 1; while (t <= b && l <= rr) { for (let j = l; j <= rr; j++) out.push(m[t][j]); t++; for (let i = t; i <= b; i++) out.push(m[i][rr]); rr--; if (t <= b) { for (let j = rr; j >= l; j--) out.push(m[b][j]); b--; } if (l <= rr) { for (let i = b; i >= t; i--) out.push(m[i][l]); l++; } } return out; },
        cpp: "class Solution { public: vector<int> spiral(vector<vector<int>>& m){ vector<int> out; int t=0,b=m.size()-1,l=0,r=m[0].size()-1; while(t<=b&&l<=r){ for(int j=l;j<=r;j++) out.push_back(m[t][j]); t++; for(int i=t;i<=b;i++) out.push_back(m[i][r]); r--; if(t<=b){ for(int j=r;j>=l;j--) out.push_back(m[b][j]); b--; } if(l<=r){ for(int i=b;i>=t;i--) out.push_back(m[i][l]); l++; } } return out; } };" }),
    make({ title: "Leftmost Longest Palindrome", difficulty: "medium", tags: ["string", "dp"],
        description: "Return the longest palindromic substring of s. If several have the same maximum length, return the one that starts earliest.",
        constraints: ["1 <= s.length <= 1000"], fn: "longestPalindrome", ret: "string", params: [["s", "string"]],
        samples: [["babad"], ["cbbd"]], edge: [["a"], ["abc"]], gen: (r) => [word(r, ri(r, 1, 18), "abc")], big: (r) => [word(r, 1000, "ab")],
        ref: (s) => { let bs = 0, bl = 1; for (let c = 0; c < s.length; c++) for (const [a0, b0] of [[c, c], [c, c + 1]]) { let a = a0, b = b0; while (a >= 0 && b < s.length && s[a] === s[b]) { a--; b++; } const len = b - a - 1; if (len > bl || (len === bl && a + 1 < bs)) { bl = len; bs = a + 1; } } return s.substr(bs, bl); },
        cpp: "class Solution { public: string longestPalindrome(string s){ int n=s.size(), bs=0, bl=1; for(int c=0;c<n;c++) for(int t=0;t<2;t++){ int a=c,b=c+t; while(a>=0&&b<n&&s[a]==s[b]){a--;b++;} int len=b-a-1; if(len>bl||(len==bl&&a+1<bs)){bl=len;bs=a+1;} } return s.substr(bs,bl); } };" }),

    // ───────────────────────────── HARD ─────────────────────────────────────
    make({ title: "Rain Between the Walls", difficulty: "hard", tags: ["array", "two-pointers", "stack"],
        description: "heights[i] is the height of a wall of width 1. After rain, water collects between walls. Return the total units of water trapped.",
        constraints: ["1 <= heights.length <= 100000", "0 <= heights[i] <= 10000"], fn: "trappedWater", ret: "int", params: [["heights", "vector<int>"]],
        samples: [[[0, 1, 0, 2, 1, 0, 1, 3, 2, 1, 2, 1]], [[4, 2, 0, 3, 2, 5]]], edge: [[[3]], [[1, 2, 3]]], gen: (r) => [arr(r, ri(r, 1, 22), 0, 9)], big: (r) => [arr(r, 100000, 0, 10000)],
        ref: (h) => { const n = h.length, L = [], R = []; let m = 0; for (let i = 0; i < n; i++) { m = Math.max(m, h[i]); L[i] = m; } m = 0; for (let i = n - 1; i >= 0; i--) { m = Math.max(m, h[i]); R[i] = m; } return h.reduce((s, x, i) => s + Math.min(L[i], R[i]) - x, 0); },
        cpp: "class Solution { public: int trappedWater(vector<int>& h){ int i=0,j=(int)h.size()-1, lm=0, rm=0; long long total=0; while(i<j){ if(h[i]<h[j]){ lm=max(lm,h[i]); total+=lm-h[i]; i++; } else { rm=max(rm,h[j]); total+=rm-h[j]; j--; } } return (int)total; } };" }),
    make({ title: "Edit Distance Between Words", difficulty: "hard", tags: ["dp", "string"],
        description: "In one step you can insert a character, delete a character, or replace a character. Return the minimum number of steps needed to turn string a into string b.",
        constraints: ["1 <= a.length, b.length <= 500"], fn: "editDistance", ret: "int", params: [["a", "string"], ["b", "string"]],
        samples: [["horse", "ros"], ["abc", "abc"]], edge: [["a", "b"], ["intention", "execution"]], gen: (r) => [word(r, ri(r, 1, 12), "abc"), word(r, ri(r, 1, 12), "abc")], big: (r) => [word(r, 500, "abcd"), word(r, 500, "abcd")],
        ref: (a, b) => { const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]); for (let j = 0; j <= b.length; j++) d[0][j] = j; for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); return d[a.length][b.length]; },
        cpp: "class Solution { public: int editDistance(string a,string b){ int n=a.size(), m=b.size(); vector<vector<int>> d(n+1, vector<int>(m+1)); for(int i=0;i<=n;i++) d[i][0]=i; for(int j=0;j<=m;j++) d[0][j]=j; for(int i=1;i<=n;i++) for(int j=1;j<=m;j++) d[i][j]=min({d[i-1][j]+1, d[i][j-1]+1, d[i-1][j-1]+(a[i-1]!=b[j-1])}); return d[n][m]; } };" }),
    make({ title: "Longest Valid Parentheses Run", difficulty: "hard", tags: ["string", "stack", "dp"],
        description: "s contains only ( and ). Return the length of the longest contiguous substring that is a correctly matched sequence of parentheses.",
        constraints: ["1 <= s.length <= 100000"], fn: "longestValid", ret: "int", params: [["s", "string"]],
        samples: [["(()"], [")()())"]], edge: [["("], ["()()"], ["))(("]], gen: (r) => [word(r, ri(r, 1, 20), "()")], big: (r) => [word(r, 100000, "(()")],
        ref: (s) => { const st = [-1]; let best = 0; for (let i = 0; i < s.length; i++) { if (s[i] === "(") st.push(i); else { st.pop(); if (!st.length) st.push(i); else best = Math.max(best, i - st[st.length - 1]); } } return best; },
        cpp: "class Solution { public: int longestValid(string s){ vector<int> st; st.push_back(-1); int best=0; for(int i=0;i<(int)s.size();i++){ if(s[i]=='(') st.push_back(i); else { st.pop_back(); if(st.empty()) st.push_back(i); else best=max(best,i-st.back()); } } return best; } };" }),
    make({ title: "Smallest Covering Window", difficulty: "hard", tags: ["string", "sliding-window", "hash-table"],
        description: "Return the shortest substring of s that contains every character of t, counting repeats (if t has two 'a', the window needs two 'a'). If several windows have the same shortest length, return the leftmost. A valid window always exists in the tests.",
        constraints: ["1 <= t.length <= s.length <= 100000", "Lowercase letters only"], fn: "minWindow", ret: "string", params: [["s", "string"], ["t", "string"]],
        samples: [["ADOBECODEBANC".toLowerCase(), "abc"], ["a", "a"]], edge: [["aa", "aa"], ["bbaa", "aba"]],
        gen: (r) => { const s = word(r, ri(r, 4, 30), "abc"); const t = [...s].slice(ri(r, 0, 2), ri(r, 3, 6)).join("") || "a"; return [s, t.length > s.length ? s : t]; },
        ref: (s, t) => { const need = {}; for (const c of t) need[c] = (need[c] || 0) + 1; let miss = t.length, lo = 0, bs = -1, bl = Infinity; for (let hi = 0; hi < s.length; hi++) { if (need[s[hi]] !== undefined) { if (need[s[hi]] > 0) miss--; need[s[hi]]--; } while (miss === 0) { if (hi - lo + 1 < bl) { bl = hi - lo + 1; bs = lo; } if (need[s[lo]] !== undefined) { need[s[lo]]++; if (need[s[lo]] > 0) miss++; } lo++; } } return bs < 0 ? null : s.substr(bs, bl); },
        cpp: "class Solution { public: string minWindow(string s,string t){ int need[256]={0}; for(unsigned char c: t) need[c]++; int miss=t.size(), lo=0, bs=-1, bl=INT_MAX; for(int hi=0;hi<(int)s.size();hi++){ unsigned char c=s[hi]; if(need[c]>0) miss--; need[c]--; while(miss==0){ if(hi-lo+1<bl){bl=hi-lo+1;bs=lo;} unsigned char d=s[lo]; need[d]++; if(need[d]>0) miss++; lo++; } } return bs<0?string(\"\"):s.substr(bs,bl); } };" }),
    make({ title: "Biggest Rectangle in Bars", difficulty: "hard", tags: ["array", "stack"],
        description: "bars[i] is the height of a bar of width 1 in a histogram. Return the area of the largest rectangle that fits entirely inside the histogram.",
        constraints: ["1 <= bars.length <= 100000", "0 <= bars[i] <= 10000"], fn: "largestRectangle", ret: "int", params: [["bars", "vector<int>"]],
        samples: [[[2, 1, 5, 6, 2, 3]], [[2, 4]]], edge: [[[0]], [[3, 3, 3]]], gen: (r) => [arr(r, ri(r, 1, 18), 0, 9)], big: (r) => [arr(r, 100000, 0, 10000)],
        ref: (h) => { let best = 0; const st = []; for (let i = 0; i <= h.length; i++) { const cur = i === h.length ? 0 : h[i]; while (st.length && h[st[st.length - 1]] >= cur) { const height = h[st.pop()]; const left = st.length ? st[st.length - 1] : -1; best = Math.max(best, height * (i - left - 1)); } st.push(i); } return best; },
        cpp: "class Solution { public: int largestRectangle(vector<int>& h){ int n=h.size(); long long best=0; vector<int> st; for(int i=0;i<=n;i++){ int cur=i==n?0:h[i]; while(!st.empty() && h[st.back()]>=cur){ long long height=h[st.back()]; st.pop_back(); int left=st.empty()?-1:st.back(); best=max(best, height*(i-left-1)); } st.push_back(i);} return (int)best; } };" })
];

// ── build final records ──────────────────────────────────────────────────────
const buildProblem = (def, index) => {
    const r = rng(1000 + index * 7919);
    const types = def.params.map(([, t]) => t);
    const render = (args) => args.map((a, i) => fmt(types[i], a)).join("\n");
    const cases = [];
    const push = (args, hidden) => {
        const out = def.ref(...args);
        if (out === null || out === undefined || out === "") return; // output must be non-empty
        cases.push({ args, input: render(args), expected: fmt(def.ret, out), isHidden: hidden });
    };
    def.samples.forEach((a) => push(a, false));
    (def.edge || []).forEach((a) => push(a, true));
    for (let i = 0; i < 6; i++) push(def.gen(r), true);
    if (def.big) push(def.big(r), true);
    return { def, cases };
};

const bank = () => BANK.map(buildProblem);

module.exports = { bank, BANK, fmt };
