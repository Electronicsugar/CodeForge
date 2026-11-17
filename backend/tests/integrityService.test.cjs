// Exercises the stateful integrity service with an in-memory Battle model
// (no MongoDB needed): persistence, warnings, forfeit on the final strike.
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");

const stub = (rel, exports) => { const id = require.resolve(path.join("..", "src", rel)); require.cache[id] = { id, filename: id, loaded: true, exports }; };

const db = { battle: null, updates: [], forfeits: [] };
const lean = (v) => ({ select: () => ({ lean: async () => v }), lean: async () => v });
stub("models/Battle.js", {
    findById: () => lean(db.battle),
    updateOne: async (q, u) => { db.updates.push(u); return {}; }
});
stub("models/IntegrityLog.js", {});
stub("services/battleResult.service.js", { finishBattle: async (id, winner, reason) => { db.forfeits.push({ id, winner, reason }); db.battle.status = "completed"; } });
const service = require("../src/services/integrity/integrity.service");

const reset = () => {
    db.battle = { status: "in_progress", startTime: new Date(Date.now() - 60000), player1: { user: "alice" }, player2: { user: "bob" } };
    db.updates = []; db.forfeits = [];
};
const socketFor = (id) => { const emitted = []; return { user: { id }, emitted, emit: (e, p) => emitted.push([e, p]), to: () => ({ emit() {} }) }; };
const send = (s, type, meta, battleId = "b1") => service.handleEvent(null, s, { battleId, type, meta });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test("big paste is persisted as neutral analytics without warnings or penalties", async () => {
    reset(); const alice = socketFor("alice"), bob = socketFor("bob");
    await send(alice, "paste", { length: 500 });
    const w = alice.emitted.find((e) => e[0] === "integrity_warning");
    assert.strictEqual(w, undefined);
    assert.strictEqual(bob.emitted.length, 0);
    const saved = db.updates.find((u) => u.$set && u.$set["player1.integrity.counts"]?.pastes === 1);
    assert.ok(saved, "paste count written to player1.integrity");
    assert.strictEqual(saved.$set['player1.integrity.strikes'], 0);
    assert.strictEqual(saved.$set['player1.integrity.score'], null);
    assert.strictEqual(saved.$set['player1.integrity.label'], 'recorded');
    assert.ok(!JSON.stringify(db.updates).includes("secret"), "no clipboard content stored");
    await service.finalizeBattle("b1").catch(() => {});
});

test("repeated large pastes never forfeit the battle even with enforcement configured", async () => {
    const previous = process.env.ANTICHEAT_MODE;
    process.env.ANTICHEAT_MODE = 'enforce';
    try {
    reset(); const alice = socketFor("alice");
    await send(alice, "paste", { length: 500 });
    await wait(2600);                       // outside the 2.5s cooldown
    await send(alice, "paste", { length: 500 });
    await wait(2600);
    assert.strictEqual(db.forfeits.length, 0);
    await send(alice, "paste", { length: 500 });
    assert.deepStrictEqual(db.forfeits, []);
    assert.strictEqual(db.battle.status, 'in_progress');
    } finally {
        if (previous === undefined) delete process.env.ANTICHEAT_MODE;
        else process.env.ANTICHEAT_MODE = previous;
    }
});

test("outsiders cannot report events for someone else's battle", async () => {
    reset();
    await assert.rejects(send(socketFor("mallory"), "paste", { length: 500 }, "b-outsider"), /not a player/);
    assert.strictEqual(db.updates.length, 0);
});

test("events after the battle ended are ignored", async () => {
    reset(); db.battle.status = "completed";
    const alice = socketFor("alice");
    await send(alice, "paste", { length: 500 }, "b-done");
    assert.strictEqual(alice.emitted.length, 0);
    assert.strictEqual(db.updates.length, 0);
});

test("server-side jump check fires through handleSync with no client report", async () => {
    reset(); const alice = socketFor("alice");
    await service.handleSync(null, alice, { battleId: "b-sync", codeLength: 50, language: "cpp" });
    await service.handleSync(null, alice, { battleId: "b-sync", codeLength: 900, language: "cpp" });
    const w = alice.emitted.find((e) => e[0] === "integrity_warning");
    assert.strictEqual(w, undefined);
    assert.ok(db.updates.some(u => u.$set?.['player1.integrity.counts']?.unreportedJumps === 1));
    assert.strictEqual(db.forfeits.length, 0);
});

test("unknown event types never reach storage", async () => {
    reset(); const alice = socketFor("alice");
    await send(alice, "drop_tables", {}, "b-unk");
    assert.strictEqual(db.updates.length, 0);
});
