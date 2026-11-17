// Builds, stores and serves the post-battle review for each player.
// Flow:  battle ends -> metrics (deterministic) -> rule-based draft
//        -> LLM refinement (optional, validated) -> saved -> "analysis_ready" socket event
// If there is no API key, or the LLM fails/times out/returns garbage, the
// rule-based analysis is saved instead, so the feature never breaks a battle.
const { buildMetrics, publicMetrics } = require("./battleMetrics");
const { generateRulesAnalysis } = require("./rulesCoach");
const llmDefault = require("./llm.service");

const inflight = new Map(); // `${battleId}:${userId}` -> Promise

const defaultDeps = () => ({
    Battle: require("../../models/Battle"),
    Submission: require("../../models/Submission"),
    BattleAnalysis: require("../../models/BattleAnalysis"),
    llm: llmDefault,
    notify: (userId, event, payload) => {
        try { require("../../sockets/socketManager").getIO().to(`user:${userId}`).emit(event, payload); } catch { /* sockets may be down in tests/scripts */ }
    }
});

const generate = async (battleId, userId, deps) => {
    const { Battle, Submission, BattleAnalysis, llm } = deps;
    const battle = await Battle.findById(battleId).populate("problem", "title difficulty tags").lean();
    if (!battle) throw Object.assign(new Error("Battle not found"), { status: 404 });
    if (battle.status !== "completed") throw Object.assign(new Error("The battle is still in progress"), { status: 409 });

    const p1 = String(battle.player1.user._id || battle.player1.user), p2 = String(battle.player2.user._id || battle.player2.user);
    if (String(userId) !== p1 && String(userId) !== p2) throw Object.assign(new Error("You are not a player in this battle"), { status: 403 });
    const oppId = String(userId) === p1 ? p2 : p1;

    const [subs, oppSubs] = await Promise.all([
        Submission.find({ battle: battleId, user: userId }).select("status language code runtime passedTests totalTests createdAt").lean(),
        Submission.find({ battle: battleId, user: oppId }).select("status language runtime passedTests totalTests createdAt").lean()
    ]);

    const metrics = buildMetrics({ battle, userId, subs, oppSubs, problem: battle.problem });
    const draft = generateRulesAnalysis(metrics);

    let analysis = draft, source = "rules", model = null, llmError = null;
    if (llm.isConfigured()) {
        try {
            const refined = await llm.refineAnalysis({ metrics, draft });
            analysis = refined.analysis; source = "llm"; model = refined.model;
        } catch (e) { llmError = String(e.message).slice(0, 300); console.warn("[analysis] LLM failed, using rule-based review:", llmError); }
    }

    const doc = await BattleAnalysis.findOneAndUpdate(
        { battle: battleId, user: userId },
        { $set: { status: "ready", source, model, metrics: publicMetrics(metrics), analysis, llmError, generatedAt: new Date() } },
        { upsert: true, new: true }
    ).lean();
    return doc;
};

/** Returns the saved review, generating it if needed. Concurrent calls share one generation. */
const getOrCreate = async (battleId, userId, deps = defaultDeps()) => {
    const existing = await deps.BattleAnalysis.findOne({ battle: battleId, user: userId, status: "ready" }).lean();
    if (existing) return existing;

    const k = `${battleId}:${userId}`;
    if (!inflight.has(k)) {
        const run = generate(battleId, userId, deps).finally(() => inflight.delete(k));
        inflight.set(k, run);
    }
    return inflight.get(k);
};

/** Called when a battle ends; never throws, never blocks the result. */
const scheduleBattleAnalysis = (battleId, deps = defaultDeps(), delayMs = 1500) => {
    setTimeout(async () => {
        try {
            const battle = await deps.Battle.findById(battleId).select("player1.user player2.user").lean();
            if (!battle) return;
            for (const userId of [battle.player1.user, battle.player2.user]) {
                try {
                    const doc = await getOrCreate(battleId, userId, deps);
                    deps.notify(String(userId), "analysis_ready", { battleId: String(battleId), source: doc.source });
                } catch (e) { console.error("[analysis] generation failed:", e.message); }
            }
        } catch (e) { console.error("[analysis] schedule failed:", e.message); }
    }, delayMs).unref?.();
};

module.exports = { getOrCreate, scheduleBattleAnalysis, generate, inflight };
