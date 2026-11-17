const analysisService = require("../services/analysis/analysis.service");
const coachService = require("../services/analysis/coach.service");
const { isConfigured } = require("../services/analysis/llm.service");

const getBattleAnalysis = async (req, res) => {
    try {
        const doc = await analysisService.getOrCreate(req.params.battleId, req.user.id);
        return res.status(200).json({
            success: true,
            data: { battleId: doc.battle, source: doc.source, model: doc.model, generatedAt: doc.generatedAt, metrics: doc.metrics, analysis: doc.analysis }
        });
    } catch (error) {
        return res.status(error.status || 500).json({ success: false, message: error.message || "Could not build the analysis" });
    }
};

const getMyCoach = async (req, res) => {
    try {
        const profile = await coachService.getCoach(req.user.id, { refresh: req.query.refresh === "true" });
        return res.status(200).json({
            success: true,
            data: { basedOnBattles: profile.basedOnBattles, stats: profile.stats, narrative: profile.narrative, source: profile.source, generatedAt: profile.generatedAt, aiEnabled: isConfigured() }
        });
    } catch (error) {
        return res.status(error.status || 500).json({ success: false, message: error.message || "Could not build the coach profile" });
    }
};

module.exports = { getBattleAnalysis, getMyCoach };
