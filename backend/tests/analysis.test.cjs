const test = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const { buildMetrics } = require("../src/services/analysis/battleMetrics");
const { generateRulesAnalysis } = require("../src/services/analysis/rulesCoach");
const llm = require("../src/services/analysis/llm.service");
const { buildCoachStats, rulesNarrative } = require("../src/services/analysis/coachStats");

const T0 = Date.UTC(2026, 10, 16, 10, 0, 0);
const at = (s) => new Date(T0 + s * 1000);
const sub = (s, status, passed, total, extra = {}) => ({ createdAt: at(s), status, passedTests: passed, totalTests: total, language: "cpp", code: "int x;", runtime: 5, ...extra });
const battle = (over = {}) => ({
    startTime: at(0), endTime: at(600), duration: 15, endReason: "accepted", winner: "u2",
    player1: { user: "u1", ratingChange: -16, activity: { firstSyncAt: at(200), firstRunAt: null, runs: 0, samples: [{ t: 10000, len: 0 }, { t: 20000, len: 50 }, { t: 30000, len: 50 }, { t: 100000, len: 50 }, { t: 110000, len: 120 }] }, integrity: { strikes: 1, score: 80, label: "suspicious", awayMs: 9000, counts: { pastes: 1 } } },
    player2: { user: "u2", ratingChange: 16, activity: { firstSyncAt: at(30), firstRunAt: at(120), runs: 3, samples: [] }, integrity: {} },
    ...over
});
const problem = { title: "Two Sum", difficulty: "easy", tags: ["array", "hash-table"] };

test("metrics: timing, verdicts, submits-before-run, opponent comparison", () => {
    const m = buildMetrics({ battle: battle(), userId: "u1", problem,
        subs: [sub(300, "wrong_answer", 1, 5), sub(340, "wrong_answer", 1, 5), sub(400, "time_limit_exceeded", 3, 5)],
        oppSubs: [sub(200, "accepted", 5, 5)] });
    assert.strictEqual(m.result.outcome, "lost");
    assert.strictEqual(m.timing.firstKeystrokeSec, 200);
    assert.strictEqual(m.timing.firstSubmitSec, 300);
    assert.strictEqual(m.runs.submitsBeforeFirstRun, 3);
    assert.strictEqual(m.submissions.verdicts.wrong_answer, 2);
    assert.deepStrictEqual(m.submissions.repeatedFailure, { status: "wrong_answer", times: 2 });
    assert.strictEqual(m.submissions.bestPassRatio, 0.6);
    assert.strictEqual(m.opponent.acceptedAtSec, 200);
    assert.strictEqual(m.typing.longestStallSec, 80);   // 20s..100s without growth
    assert.strictEqual(m.integrity.strikes, 1);
});

test("rules coach: every claim is grounded in the metrics", () => {
    const m = buildMetrics({ battle: battle(), userId: "u1", problem,
        subs: [sub(300, "wrong_answer", 1, 5), sub(340, "wrong_answer", 1, 5), sub(400, "time_limit_exceeded", 3, 5)], oppSubs: [sub(200, "accepted", 5, 5)] });
    const a = generateRulesAnalysis(m);
    assert.match(a.summary, /You lost/);
    assert.ok(a.mistakes.some((x) => x.category === "complexity"));
    assert.ok(a.mistakes.some((x) => x.category === "logic"));
    assert.ok(a.behaviour_insights.some((x) => /without ever running/.test(x)));
    assert.ok(a.behaviour_insights.some((x) => /integrity warning/.test(x)));
    assert.ok(a.recommended_practice.some((p) => p.tag === "array"));
    assert.ok(a.mistakes.every((x) => x.evidence));
});

test("rules coach: a clean win produces strengths, not invented mistakes", () => {
    const b = battle({ winner: "u1" });
    b.player1.activity = { firstSyncAt: at(40), firstRunAt: at(100), runs: 4, samples: [] };
    b.player1.integrity = {};
    const m = buildMetrics({ battle: b, userId: "u1", problem, subs: [sub(300, "accepted", 5, 5)], oppSubs: [] });
    const a = generateRulesAnalysis(m);
    assert.strictEqual(a.mistakes.length, 0);
    assert.ok(a.strengths.length > 0);
    assert.match(a.summary, /You won/);
});

// ── LLM client against a local mock server ───────────────────────────────
const VALID = { summary: "You lost a close one.", mistakes: [{ category: "bogus", what: "Missed edge case", evidence: "x" }], behaviour_insights: ["Run samples"], strengths: [], improvements: ["Test edge cases"], recommended_practice: [{ tag: "array", why: "practice" }] };
const startServer = (handler) => new Promise((resolve) => {
    const requests = [];
    const server = http.createServer((req, res) => {
        let body = ""; req.on("data", (c) => (body += c)); req.on("end", () => { requests.push({ url: req.url, headers: req.headers, body: JSON.parse(body) }); handler(req, res, requests.length); });
    }).listen(0, () => resolve({ server, requests, url: `http://127.0.0.1:${server.address().port}` }));
});
const json = (res, status, obj) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(obj)); };

test("llm: anthropic request shape + fenced JSON + category coercion", async () => {
    const s = await startServer((req, res) => json(res, 200, { content: [{ type: "text", text: "```json\n" + JSON.stringify(VALID) + "\n```" }] }));
    const env = { LLM_PROVIDER: "anthropic", LLM_API_KEY: "k", LLM_BASE_URL: s.url, LLM_MODEL: "m1" };
    const out = await llm.refineAnalysis({ metrics: { a: 1, _lastCode: "SECRET CODE" }, draft: {} }, env);
    s.server.close();
    assert.strictEqual(s.requests[0].url, "/v1/messages");
    assert.strictEqual(s.requests[0].headers["x-api-key"], "k");
    assert.strictEqual(s.requests[0].body.model, "m1");
    assert.ok(!JSON.stringify(s.requests[0].body).includes("SECRET CODE"), "code must not leave by default");
    assert.strictEqual(out.analysis.mistakes[0].category, "logic");
    assert.strictEqual(out.model, "anthropic:m1");
});

test("llm: openai-compatible request shape; code only sent when explicitly enabled", async () => {
    const s = await startServer((req, res) => json(res, 200, { choices: [{ message: { content: "Here you go: " + JSON.stringify(VALID) } }] }));
    const env = { LLM_PROVIDER: "openai", LLM_API_KEY: "k", LLM_BASE_URL: s.url, LLM_INCLUDE_CODE: "true" };
    await llm.refineAnalysis({ metrics: { a: 1, _lastCode: "MY CODE" }, draft: {} }, env);
    s.server.close();
    assert.strictEqual(s.requests[0].url, "/chat/completions");
    assert.strictEqual(s.requests[0].headers.authorization, "Bearer k");
    assert.ok(JSON.stringify(s.requests[0].body).includes("MY CODE"));
});

test("llm: garbage, HTTP errors and timeouts all throw (caller falls back)", async () => {
    const bad = await startServer((req, res) => json(res, 200, { content: [{ type: "text", text: "sorry, no json" }] }));
    await assert.rejects(llm.refineAnalysis({ metrics: {}, draft: {} }, { LLM_PROVIDER: "anthropic", LLM_API_KEY: "k", LLM_BASE_URL: bad.url }));
    bad.server.close();
    const err = await startServer((req, res) => json(res, 500, { error: "boom" }));
    await assert.rejects(llm.refineAnalysis({ metrics: {}, draft: {} }, { LLM_PROVIDER: "openai", LLM_API_KEY: "k", LLM_BASE_URL: err.url }), /HTTP 500/);
    err.server.close();
    const slow = await startServer(() => {});
    await assert.rejects(llm.refineAnalysis({ metrics: {}, draft: {} }, { LLM_PROVIDER: "openai", LLM_API_KEY: "k", LLM_BASE_URL: slow.url, LLM_TIMEOUT_MS: "200" }));
    slow.server.closeAllConnections(); slow.server.close();
});

test("llm: not configured without a key", () => assert.strictEqual(llm.isConfigured({}), false));

// ── orchestration with in-memory fakes ───────────────────────────────────
const makeDeps = ({ llmImpl, store = [], battleDoc = battle({ status: "completed" }), subs = [] }) => ({
    Battle: { findById: () => { const q = { populate: () => q, select: () => q, lean: async () => ({ ...battleDoc, problem }) }; return q; } },
    Submission: { find: ({ user }) => ({ select: () => ({ lean: async () => subs.filter((s) => s.user === user) }) }) },
    BattleAnalysis: {
        findOne: ({ battle, user }) => ({ lean: async () => store.find((d) => d.battle === battle && d.user === user) || null }),
        findOneAndUpdate: ({ battle, user }, { $set }) => ({ lean: async () => { let d = store.find((x) => x.battle === battle && x.user === user); if (!d) store.push((d = { battle, user })); Object.assign(d, $set); return d; } })
    },
    llm: llmImpl, notify: () => {}
});
const svc = require("../src/services/analysis/analysis.service");

test('background analysis calls a provider over HTTP and retains rules fallback when it fails', async () => {
    let failRequests = false;
    const server = await startServer((_req, res) => failRequests
        ? json(res, 503, {error:'test provider unavailable'})
        : json(res, 200, {choices:[{message:{content:JSON.stringify(VALID)}}]}));
    const env = {LLM_PROVIDER:'openai',LLM_API_KEY:'test-only',LLM_MODEL:'test-model',LLM_BASE_URL:server.url};
    const store = [], notifications = [];
    const deps = makeDeps({store, llmImpl:{isConfigured:()=>true,refineAnalysis:input=>llm.refineAnalysis(input,env)}});
    deps.notify = (userId,event,payload) => notifications.push({userId,event,payload});
    const waitFor = async count => {
        const deadline=Date.now()+3000;
        while(notifications.length<count && Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,10));
        assert.equal(notifications.length,count);
    };
    try {
        svc.scheduleBattleAnalysis('scheduled-success',deps,0);
        await waitFor(2);
        assert.equal(store.filter(row=>row.source==='llm').length,2);
        assert.ok(notifications.every(row=>row.event==='analysis_ready'));
        assert.ok(server.requests.every(request=>!JSON.stringify(request.body).includes('lastSubmittedCode')));
        failRequests = true;
        svc.scheduleBattleAnalysis('scheduled-failure',deps,0);
        await waitFor(4);
        const fallback = store.filter(row=>row.battle==='scheduled-failure');
        assert.equal(fallback.length,2);
        assert.ok(fallback.every(row=>row.source==='rules' && row.analysis.summary && /HTTP 503/.test(row.llmError)));
    } finally {server.server.close();}
});

test("orchestration: no LLM key -> rules analysis saved; second call reuses it", async () => {
    const store = [];
    const deps = makeDeps({ llmImpl: { isConfigured: () => false }, store, subs: [{ user: "u1", ...sub(300, "wrong_answer", 1, 5) }] });
    const a = await svc.getOrCreate("b1", "u1", deps);
    assert.strictEqual(a.source, "rules");
    assert.ok(a.analysis.summary);
    assert.ok(!("_lastCode" in a.metrics));
    await svc.getOrCreate("b1", "u1", deps);
    assert.strictEqual(store.length, 1);
});

test("orchestration: LLM failure falls back to rules and records why", async () => {
    const deps = makeDeps({ llmImpl: { isConfigured: () => true, refineAnalysis: async () => { throw new Error("rate limited"); } } });
    const a = await svc.getOrCreate("b2", "u1", deps);
    assert.strictEqual(a.source, "rules");
    assert.match(a.llmError, /rate limited/);
});

test("orchestration: LLM success is stored as source=llm", async () => {
    const deps = makeDeps({ llmImpl: { isConfigured: () => true, refineAnalysis: async () => ({ analysis: { summary: "ok", mistakes: [], behaviour_insights: [], strengths: [], improvements: [], recommended_practice: [] }, model: "x:y" }) } });
    const a = await svc.getOrCreate("b3", "u1", deps);
    assert.strictEqual(a.source, "llm");
    assert.strictEqual(a.model, "x:y");
});

test("orchestration: concurrent requests share one generation", async () => {
    let calls = 0;
    const deps = makeDeps({ llmImpl: { isConfigured: () => true, refineAnalysis: async () => { calls++; await new Promise((r) => setTimeout(r, 50)); return { analysis: { summary: "s", mistakes: [], behaviour_insights: [], strengths: [], improvements: [], recommended_practice: [] }, model: "m" }; } } });
    await Promise.all([svc.getOrCreate("b4", "u1", deps), svc.getOrCreate("b4", "u1", deps), svc.getOrCreate("b4", "u1", deps)]);
    assert.strictEqual(calls, 1);
});

test("orchestration: unfinished battles and outsiders are refused", async () => {
    await assert.rejects(svc.getOrCreate("b5", "u1", makeDeps({ llmImpl: { isConfigured: () => false }, battleDoc: battle({ status: "in_progress" }) })), /still in progress/);
    await assert.rejects(svc.getOrCreate("b6", "intruder", makeDeps({ llmImpl: { isConfigured: () => false }, battleDoc: battle({ status: "completed" }) })), /not a player/);
});

// ── long-term coach ──────────────────────────────────────────────────────
test("coach stats: habits and weak tags need enough evidence", () => {
    const mk = (outcome, tags, noRun) => ({ metrics: { result: { outcome }, problem: { tags }, submissions: { count: 3, verdicts: { wrong_answer: 2, runtime_error: 0, compile_error: 0, time_limit_exceeded: 0, accepted: 1 } }, runs: { count: noRun ? 0 : 2, submitsBeforeFirstRun: noRun ? 3 : 0 }, timing: { firstKeystrokeSec: 40, firstRunSec: 90 }, typing: { longestStallSec: 30 }, integrity: { strikes: 0 } } });
    const few = buildCoachStats([mk("lost", ["dp"], true)]);
    assert.strictEqual(few.habits.length, 0);
    assert.strictEqual(few.weakTags.length, 0);
    const many = buildCoachStats([mk("lost", ["dp"], true), mk("lost", ["dp"], true), mk("won", ["array"], false), mk("lost", ["dp"], true)],
        [{ problem: "p1", status: "wrong_answer", tags: ["graph"] }, { problem: "p2", status: "wrong_answer", tags: ["graph"] }]);
    assert.ok(many.habits.some((h) => h.habit === "submits_without_running_samples"));
    assert.ok(many.habits.some((h) => h.habit === "missed_edge_cases"));
    assert.ok(many.weakTags.some((t) => t.tag === "dp"));
    assert.ok(many.weakTags.some((t) => t.tag === "graph"));
    assert.match(rulesNarrative(many).headline, /won 1/);
    assert.strictEqual(rulesNarrative(buildCoachStats([])).focus.length, 0);
});
