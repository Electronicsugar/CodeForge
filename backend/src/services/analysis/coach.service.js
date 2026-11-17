const { buildCoachStats, rulesNarrative } = require("./coachStats");
const llmDefault = require("./llm.service");

const WINDOW = 20;               // last N analysed battles
const NARRATIVE_REFRESH_EVERY = 2; // re-ask the LLM only after this many new battles
const MIN_REFRESH_MS = 10 * 60 * 1000;

const defaultDeps = () => ({
    BattleAnalysis: require("../../models/BattleAnalysis"),
    CoachProfile: require("../../models/CoachProfile"),
    Submission: require("../../models/Submission"),
    Problem: require("../../models/Problem"),
    llm: llmDefault
});

const loadPractice = async (userId, { Submission, Problem }) => {
    const rows = await Submission.find({ user: userId, battle: null, battleRoom: { $exists: false } })
        .sort({ createdAt: -1 }).limit(400).select("problem status").lean();
    if (!rows.length) return [];
    const ids = [...new Set(rows.map((r) => String(r.problem)))];
    const problems = await Problem.find({ _id: { $in: ids } }).select("tags").lean();
    const tags = new Map(problems.map((p) => [String(p._id), p.tags || []]));
    return rows.map((r) => ({ problem: r.problem, status: r.status, tags: tags.get(String(r.problem)) || [] }));
};

const getCoach = async (userId, { refresh = false } = {}, deps = defaultDeps()) => {
    const { BattleAnalysis, CoachProfile, llm } = deps;
    const analyses = await BattleAnalysis.find({ user: userId, status: "ready" }).sort({ createdAt: -1 }).limit(WINDOW).select("metrics createdAt").lean();
    const cached = await CoachProfile.findOne({ user: userId }).lean();

    const fresh = cached && cached.basedOnBattles === analyses.length && !refresh;
    if (fresh) return cached;

    const practice = await loadPractice(userId, deps);
    const stats = buildCoachStats(analyses, practice);

    let narrative = rulesNarrative(stats), source = "rules", model = null, narrativeBasedOn = cached ? cached.narrativeBasedOn : -1;
    const canAsk = llm.isConfigured() && analyses.length >= 3 &&
        (refresh || !cached || !cached.narrative || cached.source !== "llm" ||
            (analyses.length - Math.max(0, cached.narrativeBasedOn) >= NARRATIVE_REFRESH_EVERY && Date.now() - +new Date(cached.generatedAt || 0) > MIN_REFRESH_MS));
    if (canAsk) {
        try {
            const r = await llm.summariseCoach({ stats });
            narrative = r.narrative; source = "llm"; model = r.model; narrativeBasedOn = analyses.length;
        } catch (e) { console.warn("[coach] LLM failed, using rule-based coach:", String(e.message).slice(0, 200)); }
    } else if (cached && cached.source === "llm" && cached.narrative) {
        // keep the earlier LLM narrative instead of downgrading to rules between refreshes
        narrative = cached.narrative; source = "llm"; model = cached.model;
    }

    return CoachProfile.findOneAndUpdate(
        { user: userId },
        { $set: { basedOnBattles: analyses.length, narrativeBasedOn, stats, narrative, source, model, generatedAt: new Date() } },
        { upsert: true, new: true }
    ).lean();
};

module.exports = { getCoach };
