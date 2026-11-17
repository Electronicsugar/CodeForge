// Builds a starter template for any language from a problem's judgeConfig, so
// problems created before multi-language support still work in every language.
const { PY_TYPES, JAVA_TYPES } = require("./wrappers");

const cppRef = (type) => (type.startsWith("vector<") ? `${type}&` : type);
const cppDefault = (type) =>
    ({ int: "0", "long long": "0", double: "0.0", bool: "false", string: '""' }[type] || "{}");
const javaDefault = (type) =>
    ({ int: "0", "long": "0", double: "0.0", bool: "false", string: '""' }[type]
        || (type === "vector<int>" ? "new int[0]" : type === "vector<string>" ? "new String[0]" : type === "vector<vector<int>>" ? "new int[0][]" : "0"));

const generateStarter = (problem, language) => {
    const cfg = problem.judgeConfig;
    const fn = problem.functionName || "solve";
    if (!cfg) return "";
    const params = cfg.parameters || [];

    switch (language) {
        case "cpp":
            return `class Solution {\npublic:\n    ${cfg.returnType} ${fn}(${params.map((p) => `${cppRef(p.type)} ${p.name}`).join(", ")}) {\n        // Write your solution here\n        return ${cppDefault(cfg.returnType)};\n    }\n};`;
        case "python":
            return `class Solution:\n    def ${fn}(self${params.map((p) => `, ${p.name}: ${PY_TYPES[p.type]}`).join("")}) -> ${PY_TYPES[cfg.returnType]}:\n        # Write your solution here\n        pass\n`;
        case "javascript": {
            const doc = [...params.map((p) => `     * @param {${p.type.replace(/vector<vector<int>>/, "number[][]").replace(/vector<int>/, "number[]").replace(/vector<string>/, "string[]").replace(/long long|int|double/, "number").replace(/bool/, "boolean")}} ${p.name}`)].join("\n");
            return `class Solution {\n    /**\n${doc}\n     */\n    ${fn}(${params.map((p) => p.name).join(", ")}) {\n        // Write your solution here\n    }\n}\n`;
        }
        case "java": {
            const jt = (t) => JAVA_TYPES[t];
            return `class Solution {\n    public ${jt(cfg.returnType)} ${fn}(${params.map((p) => `${jt(p.type)} ${p.name}`).join(", ")}) {\n        // Write your solution here\n        return ${javaDefault(cfg.returnType)};\n    }\n}\n`;
        }
        default:
            return "";
    }
};

// stored starterCode (C++, the historical field) wins for cpp; a per-language
// override in problem.starterCodes wins over generation for the others.
const buildStarterCodes = (problem) => {
    const plain = typeof problem.toObject === "function" ? problem.toObject() : problem;
    const overrides = plain.starterCodes || {};
    const out = {};
    for (const language of ["cpp", "python", "javascript", "java"]) {
        out[language] = overrides[language]
            || (language === "cpp" && plain.starterCode)
            || generateStarter(plain, language);
    }
    return out;
};

// Plain-object copy of a problem with resolved per-language starter code.
const withStarterCodes = (problem) => {
    if (!problem) return problem;
    const plain = typeof problem.toObject === "function" ? problem.toObject() : { ...problem };
    return { ...plain, starterCodes: buildStarterCodes(plain) };
};

module.exports = { generateStarter, buildStarterCodes, withStarterCodes };
