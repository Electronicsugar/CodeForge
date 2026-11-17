// Stateful wrapper around the pure rules in integrity.policy.js:
// keeps per-player interaction summaries and persists them on the Battle.
// Runtime monitoring does not issue penalties or forfeit matches.
const Battle = require("../../models/Battle");
const policy = require("./integrity.policy");

// Interaction patterns are analytics, never grounds for an automatic penalty.
// Preserve the existing battle system's separate tab-ownership rules.
const cfg = () => ({ ...policy.config(), mode: 'monitor', forfeitStrikes: 0 });
const contexts = new Map(); // `${battleId}:${userId}` -> ctx
const SAMPLE_EVERY_MS = 10000;
const MAX_SAMPLES = 240;       // ~40 min at one sample / 10 s
const REVERIFY_MS = 15000;

const key = (battleId, userId) => `${battleId}:${userId}`;

const rehydrate = (integrity) => {
    const state = policy.newState();
    if (!integrity) return state;
    state.strikes = integrity.strikes || 0;
    state.awayMs = integrity.awayMs || 0;
    state.flags = [...(integrity.flags || [])];
    Object.assign(state.counts, integrity.counts || {});
    return state;
};

// Loads (or refreshes) the per-player context. Throws if the user is not a player.
const getContext = async (battleId, userId, { force = false } = {}) => {
    const k = key(battleId, userId);
    const cached = contexts.get(k);
    const now = Date.now();
    if (cached && !force && now - cached.verifiedAt < REVERIFY_MS) return cached;

    const battle = await Battle.findById(battleId)
        .select("status startTime player1 player2")
        .lean();
    if (!battle) throw Object.assign(new Error("Battle not found"), { status: 404 });

    const isP1 = String(battle.player1.user) === String(userId);
    const isP2 = String(battle.player2.user) === String(userId);
    if (!isP1 && !isP2) throw Object.assign(new Error("You are not a player in this battle"), { status: 403 });

    const playerNumber = isP1 ? 1 : 2;
    const me = battle[`player${playerNumber}`];
    const ctx = cached || {
        battleId: String(battleId), userId: String(userId), playerNumber,
        state: rehydrate(me.integrity), queue: Promise.resolve(), lastSampleAt: 0
    };
    ctx.status = battle.status;
    ctx.startTime = battle.startTime ? +new Date(battle.startTime) : null;
    ctx.opponentId = String(isP1 ? battle.player2.user : battle.player1.user);
    ctx.verifiedAt = now;
    contexts.set(k, ctx);
    return ctx;
};

// Serialise work per player so two rapid events cannot race on the same state.
const enqueue = (ctx, fn) => {
    const run = ctx.queue.then(fn, fn);
    ctx.queue = run.catch(() => {});
    return run;
};

const persist = async (ctx, record) => {
    const summary = policy.summarize(ctx.state);
    const p = `player${ctx.playerNumber}.integrity`;
    const update = {
        $set: {
            [`${p}.strikes`]: summary.strikes, [`${p}.score`]: summary.score, [`${p}.label`]: summary.label,
            [`${p}.awayMs`]: summary.awayMs, [`${p}.counts`]: summary.counts, [`${p}.flags`]: summary.flags
        }
    };
    if (record) update.$push = { [`${p}.events`]: { $each: [record], $slice: -policy.config().maxEvents } };
    await Battle.updateOne({ _id: ctx.battleId }, update);
};

// Applies a pure-policy result to ctx, persists, notifies, enforces.
const settle = async (io, socket, ctx, result) => {
    ctx.state = result.state;
    if (!result.record && !result.strike) return;
    await persist(ctx, result.record);

    if (result.strike && result.strike.awarded && socket) {
        const c = cfg();
        socket.emit("integrity_warning", {
            battleId: ctx.battleId,
            reason: result.strike.reason,
            message: policy.WARNING_TEXT[result.strike.reason] || "Suspicious activity detected.",
            strikes: ctx.state.strikes,
            maxStrikes: c.mode === "enforce" ? c.forfeitStrikes : 0,
            action: result.action
        });
    }
};

const guardActive = (ctx) => ctx.status === "in_progress";

/** socket "integrity_event" */
const handleEvent = async (io, socket, payload) => {
    const { battleId, type, meta } = payload || {};
    if (!battleId || typeof type !== "string") return;
    const ctx = await getContext(battleId, socket.user.id);
    if (!guardActive(ctx)) return;

    await enqueue(ctx, async () => {
        const before = ctx.state.hiddenSince, beforeBlur = ctx.state.blurSince;
        const result = policy.applyEvent(ctx.state, { type, meta }, Date.now(), cfg());
        if (result.rejected) return;
        await settle(io, socket, ctx, result);

        // quiet signal to the opponent: "away" / "back" (no reasons, no counts)
        const away = ctx.state.hiddenSince != null || ctx.state.blurSince != null;
        const wasAway = before != null || beforeBlur != null;
        if (away !== wasAway) {
            socket.to(`battle:${battleId}`).emit("opponent_presence", { battleId, away });
        }
    });
};

/** called from the existing code_sync handler (server-side jump detection + behaviour samples) */
const handleSync = async (io, socket, { battleId, codeLength, language }) => {
    const ctx = await getContext(battleId, socket.user.id);
    if (!guardActive(ctx)) return;
    await enqueue(ctx, async () => {
        const now = Date.now();
        const result = policy.applySync(ctx.state, { codeLength, language }, now, cfg());
        await settle(io, socket, ctx, result);
        await sampleActivity(ctx, codeLength, language, now);
    });
};

/** called when a battle submission is created */
const handleSubmit = async (io, socket, { battleId, codeLength }) => {
    try {
        const ctx = await getContext(battleId, socket.user.id);
        if (!guardActive(ctx)) return;
        await enqueue(ctx, async () => {
            const result = policy.checkSubmit(ctx.state, { codeLength }, Date.now(), cfg());
            await settle(io, socket, ctx, result);
        });
    } catch (e) { console.error("[integrity] submit check failed:", e.message); }
};

const sampleActivity = async (ctx, codeLength, language, now) => {
    const p = `player${ctx.playerNumber}.activity`;
    const set = {}, push = {}, addToSet = {};
    if (!ctx.firstSyncSaved) { set[`${p}.firstSyncAt`] = new Date(now); ctx.firstSyncSaved = true; }
    if (language && ctx.language !== language) {
        ctx.language = language; set[`${p}.language`] = language; addToSet[`${p}.languagesUsed`] = language;
    }
    if (now - ctx.lastSampleAt >= SAMPLE_EVERY_MS && ctx.startTime) {
        ctx.lastSampleAt = now;
        push[`${p}.samples`] = { $each: [{ t: now - ctx.startTime, len: Math.max(0, Math.floor(codeLength) || 0) }], $slice: -MAX_SAMPLES };
    }
    const update = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(push).length) update.$push = push;
    if (Object.keys(addToSet).length) update.$addToSet = addToSet;
    if (Object.keys(update).length) await Battle.updateOne({ _id: ctx.battleId }, update);
};

/** REST "Run" inside a battle (only counts, verdict names - no code) */
const recordRun = async (battleId, userId, status) => {
    const ctx = await getContext(battleId, userId);
    if (!guardActive(ctx)) return;
    const p = `player${ctx.playerNumber}.activity`;
    const safe = /^[a-z_]{3,30}$/.test(String(status)) ? String(status) : "unknown";
    await Battle.updateOne({ _id: battleId }, {
        $inc: { [`${p}.runs`]: 1, [`${p}.runVerdicts.${safe}`]: 1 },
        $min: { [`${p}.firstRunAt`]: new Date() }
    });
};

/** Close open away-intervals and write the final summary for both players. */
const finalizeBattle = async (battleId) => {
    const battle = await Battle.findById(battleId).select("player1 player2").lean();
    if (!battle) return;
    const now = Date.now();
    for (const n of [1, 2]) {
        const userId = String(battle[`player${n}`].user);
        const k = key(battleId, userId);
        const ctx = contexts.get(k);
        const state = policy.finalize(ctx ? ctx.state : rehydrate(battle[`player${n}`].integrity), now);
        const summary = policy.summarize(state);
        const p = `player${n}.integrity`;
        await Battle.updateOne({ _id: battleId }, { $set: {
            [`${p}.strikes`]: summary.strikes, [`${p}.score`]: summary.score, [`${p}.label`]: summary.label,
            [`${p}.awayMs`]: summary.awayMs, [`${p}.counts`]: summary.counts, [`${p}.flags`]: summary.flags
        } });
        contexts.delete(k);
    }
};

// ─── contests (REST, flag-only) ──────────────────────────────────────────────
const IntegrityLog = require("../../models/IntegrityLog");
const MAX_CONTEST_EVENTS = 400;

const handleContestEvent = async (userId, contestId, { type, meta, problemId }) => {
    const Contest = require("../../models/Contest");
    const contest = await Contest.findById(contestId).select("startTime endTime participants").lean();
    if (!contest) throw Object.assign(new Error("Contest not found"), { status: 404 });
    const now = new Date();
    if (now < contest.startTime || now > contest.endTime) return { ignored: "contest_not_running" };
    if (!(contest.participants || []).some((p) => String(p) === String(userId))) {
        throw Object.assign(new Error("Join the contest first"), { status: 403 });
    }

    const monitorOnly = { ...policy.config(), mode: "monitor" };
    const doc = await IntegrityLog.findOne({ context: "contest", contextId: contestId, user: userId }).lean();
    const state = Object.assign(policy.newState(), doc ? doc.state : {});
    const result = policy.applyEvent(state, { type, meta }, Date.now(), monitorOnly);
    if (result.rejected) return { ignored: result.rejected };

    const summary = policy.summarize(result.state);
    const update = { $set: { state: result.state, summary } };
    if (result.record) {
        update.$push = { events: { $each: [{ ...result.record, problem: problemId ? String(problemId) : undefined }], $slice: -MAX_CONTEST_EVENTS } };
    }
    await IntegrityLog.updateOne({ context: "contest", contextId: contestId, user: userId }, update, { upsert: true });

    return {
        strikes: summary.strikes,
        warning: result.strike && result.strike.awarded ? (policy.WARNING_TEXT[result.strike.reason] || "Suspicious activity detected.") : null,
        // contests record for organisers; they never auto-disqualify
        enforced: false
    };
};

const contestReport = async (contestId) => {
    const logs = await IntegrityLog.find({ context: "contest", contextId: contestId })
        .populate("user", "name email").select("user summary updatedAt").lean();
    return logs
        .map((l) => ({ user: l.user, ...l.summary, updatedAt: l.updatedAt }))
        .sort((a, b) => (a.score ?? 100) - (b.score ?? 100));
};

module.exports = { handleEvent, handleSync, handleSubmit, recordRun, finalizeBattle, handleContestEvent, contestReport, getContext };
