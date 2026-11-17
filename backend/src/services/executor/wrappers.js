// Per-language "main()" wrappers. Every language reads the SAME stdin format
// that the C++ wrapper already used, so stored test cases never change:
//   one parameter per line, vectors as [1,2,3], vector<string> as ["a","b"],
//   strings raw. Output formatting is identical across languages:
//   ints plain, bool true/false, strings raw, vectors compact ([1,2,3]).

const SUPPORTED_TYPES = [
    "int", "long long", "double", "bool", "string",
    "vector<int>", "vector<string>", "vector<vector<int>>"
];

const assertType = (type) => {
    if (!SUPPORTED_TYPES.includes(type)) throw new Error(`Unsupported type: ${type}`);
};

const validateConfig = (judgeConfig) => {
    if (!judgeConfig) throw new Error("Judge configuration not found");
    assertType(judgeConfig.returnType);
    (judgeConfig.parameters || []).forEach((p) => assertType(p.type));
};

// ───────────────────────────── Python ────────────────────────────────────
const PY_TYPES = {
    "int": "int", "long long": "int", "double": "float", "bool": "bool", "string": "str",
    "vector<int>": "List[int]", "vector<string>": "List[str]",
    "vector<vector<int>>": "List[List[int]]"
};

const pyParse = (type, i) => {
    switch (type) {
        case "int": case "long long": return `int(_line(${i}).strip())`;
        case "double": return `float(_line(${i}).strip())`;
        case "bool": return `_line(${i}).strip().lower() in ("true", "1")`;
        case "string": return `_line(${i})`;
        case "vector<int>": return `[int(x) for x in _flat(_line(${i}))]`;
        case "vector<string>": return `_strs(_line(${i}))`;
        case "vector<vector<int>>": return `_grid(_line(${i}))`;
    }
};

const generatePython = (problem, userCode) => {
    const cfg = problem.judgeConfig;
    const params = cfg.parameters.map((p, i) => `    ${p.name} = ${pyParse(p.type, i)}`).join("\n");
    const args = cfg.parameters.map((p) => p.name).join(", ");
    return `import sys, re, json
from typing import *
from collections import *
import heapq, bisect, math, itertools, functools

${userCode}

_LINES = sys.stdin.read().split("\\n")
def _line(i):
    return _LINES[i].rstrip("\\r") if i < len(_LINES) else ""
def _flat(s):
    return [t for t in re.split(r"[\\[\\],\\s]+", s) if t != ""]
def _strs(s):
    s = s.strip()
    if s.startswith("["): s = s[1:]
    if s.endswith("]"): s = s[:-1]
    if s.strip() == "": return []
    return [t.strip().strip('"') for t in s.split(",")]
def _grid(s):
    rows = re.findall(r"\\[([^\\[\\]]*)\\]", s[1:-1] if s.strip().startswith("[[") else s)
    return [[int(x) for x in _flat(r)] for r in rows]
def _fmt(v, nested=False):
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, float): return "%g" % v
    if isinstance(v, int): return str(v)
    if isinstance(v, str): return '"' + v + '"' if nested else v
    if v is None: return "null"
    return "[" + ",".join(_fmt(x, True) for x in v) + "]"

def _main():
${params}
    result = Solution().${problem.functionName}(${args})
    sys.stdout.write(_fmt(result))

_main()
`;
};

// ──────────────────────────── JavaScript ─────────────────────────────────
const jsParse = (type, i) => {
    switch (type) {
        case "int": case "long long": case "double": return `Number(_line(${i}).trim())`;
        case "bool": return `["true", "1"].includes(_line(${i}).trim().toLowerCase())`;
        case "string": return `_line(${i})`;
        case "vector<int>": return `_flat(_line(${i})).map(Number)`;
        case "vector<string>": return `_strs(_line(${i}))`;
        case "vector<vector<int>>": return `_grid(_line(${i}))`;
    }
};

const generateJavaScript = (problem, userCode) => {
    const cfg = problem.judgeConfig;
    const params = cfg.parameters.map((p, i) => `    const ${p.name} = ${jsParse(p.type, i)};`).join("\n");
    const args = cfg.parameters.map((p) => p.name).join(", ");
    return `"use strict";
${userCode}

const _LINES = require("fs").readFileSync(0, "utf8").split("\\n");
const _line = (i) => (i < _LINES.length ? _LINES[i].replace(/\\r$/, "") : "");
const _flat = (s) => s.split(/[\\[\\],\\s]+/).filter((t) => t !== "");
const _strs = (s) => {
    s = s.trim();
    if (s.startsWith("[")) s = s.slice(1);
    if (s.endsWith("]")) s = s.slice(0, -1);
    if (s.trim() === "") return [];
    return s.split(",").map((t) => t.trim().replace(/^"|"$/g, ""));
};
const _grid = (s) => {
    const body = s.trim().startsWith("[[") ? s.trim().slice(1, -1) : s;
    return [...body.matchAll(/\\[([^\\[\\]]*)\\]/g)].map((m) => _flat(m[1]).map(Number));
};
const _fmt = (v, nested) => {
    if (typeof v === "boolean") return v ? "true" : "false";
    if (typeof v === "number") return Number.isInteger(v) ? String(v) : String(Number(v.toPrecision(6)));
    if (typeof v === "string") return nested ? '"' + v + '"' : v;
    if (v === null || v === undefined) return "null";
    return "[" + Array.from(v).map((x) => _fmt(x, true)).join(",") + "]";
};

(function main() {
${params}
    const _fn = typeof Solution !== "undefined"
        ? (...a) => new Solution().${problem.functionName}(...a)
        : ${problem.functionName};
    process.stdout.write(_fmt(_fn(${args})));
})();
`;
};

// ───────────────────────────────── Java ──────────────────────────────────
const JAVA_TYPES = {
    "int": "int", "long long": "long", "double": "double", "bool": "boolean", "string": "String",
    "vector<int>": "int[]", "vector<string>": "String[]", "vector<vector<int>>": "int[][]"
};

const javaParse = (type, i) => {
    switch (type) {
        case "int": return `Integer.parseInt(line(${i}).trim())`;
        case "long long": return `Long.parseLong(line(${i}).trim())`;
        case "double": return `Double.parseDouble(line(${i}).trim())`;
        case "bool": return `parseBool(line(${i}))`;
        case "string": return `line(${i})`;
        case "vector<int>": return `toInts(flat(line(${i})))`;
        case "vector<string>": return `strs(line(${i}))`;
        case "vector<vector<int>>": return `grid(line(${i}))`;
    }
};

const javaPrint = (type) => {
    switch (type) {
        case "int": case "long long": case "string": return "System.out.print(result);";
        case "double": return "System.out.print(fmtDouble(result));";
        case "bool": return 'System.out.print(result ? "true" : "false");';
        case "vector<int>": return "System.out.print(fmtInts(result));";
        case "vector<string>": return "System.out.print(fmtStrs(result));";
        case "vector<vector<int>>": return "System.out.print(fmtGrid(result));";
    }
};

// Imports must precede class declarations, so hoist any the user wrote.
const splitJavaImports = (code) => {
    const imports = [];
    const body = code.split("\n").filter((l) => {
        if (/^\s*import\s+[\w.*]+\s*;\s*$/.test(l)) { imports.push(l.trim()); return false; }
        return true;
    }).join("\n");
    // A public Solution class would have to live in Solution.java.
    return { imports, body: body.replace(/\bpublic\s+(final\s+)?class\s+Solution\b/g, "$1class Solution") };
};

const generateJava = (problem, userCode) => {
    const cfg = problem.judgeConfig;
    const { imports, body } = splitJavaImports(userCode);
    const params = cfg.parameters
        .map((p, i) => `        ${JAVA_TYPES[p.type]} ${p.name} = ${javaParse(p.type, i)};`).join("\n");
    const args = cfg.parameters.map((p) => p.name).join(", ");
    return `import java.util.*;
import java.util.stream.*;
import java.io.*;
${imports.join("\n")}

${body}

public class Main {
    static List<String> LINES = new ArrayList<>();
    static String line(int i) { return i < LINES.size() ? LINES.get(i).replace("\\r", "") : ""; }
    static boolean parseBool(String s) { s = s.trim().toLowerCase(); return s.equals("true") || s.equals("1"); }
    static List<String> flat(String s) {
        List<String> out = new ArrayList<>();
        for (String t : s.split("[\\\\[\\\\],\\\\s]+")) if (!t.isEmpty()) out.add(t);
        return out;
    }
    static int[] toInts(List<String> parts) {
        int[] r = new int[parts.size()];
        for (int i = 0; i < r.length; i++) r[i] = Integer.parseInt(parts.get(i));
        return r;
    }
    static String[] strs(String s) {
        s = s.trim();
        if (s.startsWith("[")) s = s.substring(1);
        if (s.endsWith("]")) s = s.substring(0, s.length() - 1);
        if (s.trim().isEmpty()) return new String[0];
        String[] parts = s.split(",");
        for (int i = 0; i < parts.length; i++) parts[i] = parts[i].trim().replaceAll("^\\"|\\"$", "");
        return parts;
    }
    static int[][] grid(String s) {
        s = s.trim();
        if (s.startsWith("[[")) s = s.substring(1, s.length() - 1);
        List<int[]> rows = new ArrayList<>();
        java.util.regex.Matcher m = java.util.regex.Pattern.compile("\\\\[([^\\\\[\\\\]]*)\\\\]").matcher(s);
        while (m.find()) rows.add(toInts(flat(m.group(1))));
        return rows.toArray(new int[0][]);
    }
    static String fmtDouble(double d) {
        if (d == Math.rint(d) && Math.abs(d) < 1e15) return String.valueOf((long) d);
        return new java.math.BigDecimal(d).round(new java.math.MathContext(6)).stripTrailingZeros().toPlainString();
    }
    static String fmtInts(int[] a) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(","); sb.append(a[i]); }
        return sb.append("]").toString();
    }
    static String fmtStrs(String[] a) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < a.length; i++) { if (i > 0) sb.append(","); sb.append('"').append(a[i]).append('"'); }
        return sb.append("]").toString();
    }
    static String fmtGrid(int[][] g) {
        StringBuilder sb = new StringBuilder("[");
        for (int i = 0; i < g.length; i++) { if (i > 0) sb.append(","); sb.append(fmtInts(g[i])); }
        return sb.append("]").toString();
    }

    public static void main(String[] args) throws Exception {
        BufferedReader br = new BufferedReader(new InputStreamReader(System.in));
        String l;
        while ((l = br.readLine()) != null) LINES.add(l);
${params}
        ${JAVA_TYPES[cfg.returnType]} result = new Solution().${problem.functionName}(${args});
        ${javaPrint(cfg.returnType)}
        System.out.flush();
    }
}
`;
};

module.exports = {
    SUPPORTED_TYPES, validateConfig,
    generatePython, generateJavaScript, generateJava,
    PY_TYPES, JAVA_TYPES
};
