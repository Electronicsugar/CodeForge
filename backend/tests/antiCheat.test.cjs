const test = require("node:test");
const assert = require("node:assert");
const P = require("../src/services/integrity/integrity.policy");
const cfg = P.config({});  // defaults: enforce, forfeit at 3 strikes
const T0 = 1_000_000;

const run = (state, steps, c = cfg) => {
    let s = state, out = [];
    for (const [dt, kind, payload] of steps) {
        const now = T0 + dt;
        const r = kind === "sync" ? P.applySync(s, payload, now, c)
            : kind === "submit" ? P.checkSubmit(s, payload, now, c)
            : P.applyEvent(s, { type: kind, meta: payload }, now, c);
        s = r.state; out.push(r);
    }
    return { state: s, out };
};

test("unknown event types are rejected and never stored", () => {
    const r = P.applyEvent(P.newState(), { type: "drop_tables" }, T0, cfg);
    assert.strictEqual(r.record, null);
    assert.strictEqual(r.rejected, "unknown_event");
});

test("a quick alt-tab under the threshold is free", () => {
    const { state } = run(P.newState(), [[0, "tab_hidden"], [1500, "tab_visible"]]);
    assert.strictEqual(state.strikes, 0);
});

test("leaving the tab for longer than the threshold is one strike, measured by the SERVER", () => {
    // client claims it was only away 100ms; the server saw 10s
    const { state, out } = run(P.newState(), [[0, "tab_hidden"], [10000, "tab_visible", { awayMs: 100 }]]);
    assert.strictEqual(state.strikes, 1);
    assert.strictEqual(out[1].action, "warn");
    assert.strictEqual(out[1].record.meta.awayMs, 10000);
});

test("tab_hidden + window_blur fired together by one tab switch count once", () => {
    const { state } = run(P.newState(), [
        [0, "tab_hidden"], [5, "window_blur"], [9000, "tab_visible"], [9004, "window_focus"]
    ]);
    assert.strictEqual(state.strikes, 1);
});

test("clicking another window (tab stays visible) for >3s is a strike; <3s is not", () => {
    let r = run(P.newState(), [[0, "window_blur"], [1000, "window_focus"]]);
    assert.strictEqual(r.state.strikes, 0);
    r = run(P.newState(), [[0, "window_blur"], [6000, "window_focus"]]);
    assert.strictEqual(r.state.strikes, 1);
});

test("small pastes are logged but free; big pastes are strikes", () => {
    let r = run(P.newState(), [[0, "paste", { length: 10 }]]);
    assert.strictEqual(r.state.strikes, 0);
    assert.strictEqual(r.state.counts.smallPastes, 1);
    r = run(P.newState(), [[0, "paste", { length: 400 }]]);
    assert.strictEqual(r.state.strikes, 1);
    assert.strictEqual(r.state.counts.pastedChars, 400);
});

test("copying the statement is logged, never punished", () => {
    const { state } = run(P.newState(), [[0, "copy", { length: 500 }], [3000, "copy", { length: 500 }]]);
    assert.strictEqual(state.strikes, 0);
    assert.strictEqual(state.counts.copies, 2);
});

test("warn on 1st and 2nd strike, forfeit on the 3rd", () => {
    const { out } = run(P.newState(), [
        [0, "paste", { length: 100 }],
        [10000, "paste", { length: 100 }],
        [20000, "paste", { length: 100 }]
    ]);
    assert.deepStrictEqual(out.map((o) => o.action), ["warn", "warn", "forfeit"]);
});

test("monitor mode records strikes but never forfeits", () => {
    const monitor = P.config({ ANTICHEAT_MODE: "monitor" });
    const { state, out } = run(P.newState(), [
        [0, "paste", { length: 100 }], [10000, "paste", { length: 100 }], [20000, "paste", { length: 100 }], [30000, "paste", { length: 100 }]
    ], monitor);
    assert.strictEqual(state.strikes, 4);
    assert.ok(out.every((o) => o.action !== "forfeit"));
});

test("forfeitStrikes=0 disables forfeits", () => {
    const off = P.config({ ANTICHEAT_FORFEIT_STRIKES: "0" });
    const { out } = run(P.newState(), [0, 10000, 20000, 30000, 40000].map((t) => [t, "paste", { length: 100 }]), off);
    assert.ok(out.every((o) => o.action !== "forfeit"));
});

test("strikes inside the cooldown are coalesced (no double punishment for one act)", () => {
    const { state } = run(P.newState(), [[0, "paste", { length: 100 }], [500, "large_insert", { length: 200 }]]);
    assert.strictEqual(state.strikes, 1);
});

// ── server-side checks ────────────────────────────────────────────────────
test("normal typing never trips the jump check", () => {
    const steps = []; let len = 0;
    for (let i = 0; i < 60; i++) { len += 30; steps.push([i * 2000, "sync", { codeLength: len, language: "cpp" }]); }
    const { state } = run(P.newState(), steps);
    assert.strictEqual(state.strikes, 0);
    assert.strictEqual(state.counts.unreportedJumps, 0);
});

test("a 600-char block appearing between syncs with NO reported paste is a strike", () => {
    const { state, out } = run(P.newState(), [
        [0, "sync", { codeLength: 100, language: "cpp" }],
        [1500, "sync", { codeLength: 700, language: "cpp" }]
    ]);
    assert.strictEqual(state.strikes, 1);
    assert.strictEqual(state.counts.unreportedJumps, 1);
    assert.strictEqual(out[1].record.type, "unreported_jump");
});

test("the same jump is NOT double-punished when the client reported the paste", () => {
    const { state } = run(P.newState(), [
        [0, "sync", { codeLength: 100, language: "cpp" }],
        [1400, "paste", { length: 600 }],           // client reported (1 strike for paste)
        [1500, "sync", { codeLength: 700, language: "cpp" }]
    ]);
    assert.strictEqual(state.strikes, 1);
    assert.strictEqual(state.counts.unreportedJumps, 0);
});

test("documented contract: the client must send the paste report BEFORE the next code_sync", () => {
    const { state } = run(P.newState(), [
        [0, "sync", { codeLength: 100, language: "cpp" }],
        [1500, "sync", { codeLength: 700, language: "cpp" }]  // sync lands first => counted as unreported
    ]);
    assert.strictEqual(state.counts.unreportedJumps, 1);   // the React hook emits the paste event synchronously, before the debounced sync
});

test("switching language (starter code swap) resets the baseline, no false strike", () => {
    const { state } = run(P.newState(), [
        [0, "sync", { codeLength: 20, language: "cpp" }],
        [1000, "sync", { codeLength: 900, language: "java" }]
    ]);
    assert.strictEqual(state.strikes, 0);
});

test("idling for 10s then 600 chars appearing at once is still caught (rate-based, not window-based)", () => {
    const { state } = run(P.newState(), [
        [0, "sync", { codeLength: 100, language: "cpp" }],
        [10000, "sync", { codeLength: 700, language: "cpp" }]
    ]);
    assert.strictEqual(state.counts.unreportedJumps, 1);
});

test("a slow trickle of growth (e.g. long typing session) is not a jump", () => {
    const { state } = run(P.newState(), [
        [0, "sync", { codeLength: 0, language: "cpp" }],
        [20000, "sync", { codeLength: 400, language: "cpp" }]   // 400 chars in 20s is within a plausible typing rate
    ]);
    assert.strictEqual(state.strikes, 0);
});

test("submitting without any sync is flagged but never a strike", () => {
    const { state } = run(P.newState(), [[0, "submit", { codeLength: 800 }]]);
    assert.strictEqual(state.strikes, 0);
    assert.strictEqual(state.counts.submitWithoutSync, 1);
    assert.ok(state.flags.includes("submit_without_sync"));
});

test("a flood of events is rate limited", () => {
    let s = P.newState(), rejected = 0;
    for (let i = 0; i < 200; i++) { const r = P.applyEvent(s, { type: "context_menu" }, T0 + i * 10, cfg); s = r.state; if (r.rejected) rejected++; }
    assert.ok(rejected >= 100);
});

test("finalize counts a tab that was never returned to", () => {
    const { state } = run(P.newState(), [[0, "tab_hidden"]]);
    const closed = P.finalize(state, T0 + 60000);
    assert.strictEqual(closed.awayMs, 60000);
    assert.strictEqual(closed.hiddenSince, null);
});

test("summary labels: clean / suspicious / flagged", () => {
    assert.strictEqual(P.summarize(P.newState()).label, "clean");
    const one = run(P.newState(), [[0, "paste", { length: 100 }]]).state;
    assert.strictEqual(P.summarize(one).label, "suspicious");
    const three = run(P.newState(), [0, 10000, 20000].map((t) => [t, "paste", { length: 100 }])).state;
    assert.strictEqual(P.summarize(three).label, "flagged");
    assert.ok(P.summarize(three).score <= 40);
});

test("state is never mutated in place", () => {
    const s = P.newState(); const before = JSON.stringify(s);
    P.applyEvent(s, { type: "paste", meta: { length: 999 } }, T0, cfg);
    P.applySync(s, { codeLength: 5 }, T0, cfg);
    assert.strictEqual(JSON.stringify(s), before);
});
