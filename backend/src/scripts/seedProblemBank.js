// Usage (from backend/):
//   node src/scripts/seedProblemBank.js --verify     # check every problem; needs g++ only, no database
//   node src/scripts/seedProblemBank.js              # verify, then insert missing problems (needs MONGO_URI + one user)
//   node src/scripts/seedProblemBank.js --no-verify  # insert without verifying (not recommended)
// Existing problems (matched by title) are never modified or deleted.
const { bank } = require("./problemBank");
const { generateCode } = require("../services/executor/code-generator");
const { executeCode } = require("../services/executor/runner");

const toRecord = ({ def }) => ({
    title: def.title, difficulty: def.difficulty, tags: def.tags, description: def.description, constraints: def.constraints,
    functionName: def.fn, judgeConfig: { returnType: def.ret, parameters: def.params.map(([name, type]) => ({ name, type })) }
});

/** Runs each reference C++ solution on its generated tests. Returns [{title, ok, tests, error}] */
const verifyAll = async (entries = bank(), log = console.log) => {
    const results = [];
    for (const entry of entries) {
        const { def, cases } = entry;
        const problem = toRecord(entry);
        try {
            const { results: out } = await executeCode("cpp", generateCode(problem, def.cpp, "cpp"), cases.map((c) => ({ input: c.input })));
            let error = null;
            out.forEach((r, i) => {
                if (error) return;
                if (r.status !== "success") error = `test ${i + 1} ${r.status}: ${String(r.error).slice(0, 200)}`;
                else if (r.output.trim() !== cases[i].expected) error = `test ${i + 1}: expected ${cases[i].expected.slice(0, 60)} got ${r.output.trim().slice(0, 60)}`;
            });
            results.push({ title: def.title, ok: !error, tests: cases.length, error });
            log(`${error ? "FAIL" : "ok  "} ${def.difficulty.padEnd(6)} ${def.title} (${cases.length} tests)${error ? " -> " + error : ""}`);
        } catch (e) {
            results.push({ title: def.title, ok: false, tests: cases.length, error: e.message });
            log(`FAIL ${def.title} -> ${e.message}`);
        }
    }
    return results;
};

const seed = async (entries) => {
    require("dotenv").config({ path: require("node:path").join(__dirname, "../../.env") });
    const mongoose = require("mongoose");
    const User = require("../models/User"), Problem = require("../models/Problem"), TestCase = require("../models/TestCase");
    if (!process.env.MONGO_URI) throw Error("MONGO_URI is missing");
    await mongoose.connect(process.env.MONGO_URI);
    try {
        const owner = await User.findOne({ role: "admin" }).select("_id") || await User.findOne().select("_id");
        if (!owner) throw Error("Register a user first; this script will not create or change user accounts.");
        await Problem.init();
        let number = (await Problem.findOne().sort({ problemNumber: -1 }).select("problemNumber"))?.problemNumber || 0;
        let added = 0;
        for (const entry of entries) {
            const { def, cases } = entry;
            if (await Problem.findOne({ title: def.title })) { console.log(`Preserved existing: ${def.title}`); continue; }
            const record = toRecord(entry);
            const problem = await Problem.create({
                ...record, problemNumber: ++number, createdBy: owner._id,
                starterCode: require("../services/executor/starter-generator").generateStarter(record, "cpp"),
                examples: cases.filter((c) => !c.isHidden).slice(0, 2).map((c) => ({ input: c.input, output: c.expected, explanation: "Inputs are listed in function-parameter order, one parameter per line." }))
            });
            await TestCase.insertMany(cases.map((c) => ({ problem: problem._id, input: c.input, expectedOutput: c.expected, isHidden: c.isHidden, createdBy: owner._id })));
            added++;
            console.log(`Added #${problem.problemNumber}: ${problem.title} (${cases.length} tests)`);
        }
        console.log(`Done. ${added} added.`);
    } finally { await mongoose.disconnect(); }
};

if (require.main === module) {
    (async () => {
        const entries = bank();
        const verifyOnly = process.argv.includes("--verify");
        if (!process.argv.includes("--no-verify")) {
            const results = await verifyAll(entries);
            const bad = results.filter((r) => !r.ok);
            console.log(`\n${results.length - bad.length}/${results.length} problems verified.`);
            if (bad.length) { process.exitCode = 1; console.error("Refusing to seed: fix the failures above."); return; }
        }
        if (!verifyOnly) await seed(entries);
    })().catch((e) => { console.error(e.message); process.exitCode = 1; });
}

module.exports = { verifyAll, toRecord };
