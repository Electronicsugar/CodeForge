const mongoose = require("mongoose");

// One post-battle review per (battle, player). `metrics` are the deterministic
// facts; `analysis` is what the player reads (LLM-refined or rule-based).
const schema = new mongoose.Schema(
    {
        battle: { type: mongoose.Schema.Types.ObjectId, ref: "Battle", required: true },
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        status: { type: String, enum: ["pending", "ready", "failed"], default: "pending" },
        source: { type: String, enum: ["llm", "rules"], default: "rules" },
        model: { type: String, default: null },
        metrics: { type: mongoose.Schema.Types.Mixed, default: {} },
        analysis: { type: mongoose.Schema.Types.Mixed, default: null },
        llmError: { type: String, default: null },
        generatedAt: { type: Date, default: null }
    },
    { timestamps: true }
);
schema.index({ battle: 1, user: 1 }, { unique: true });
schema.index({ user: 1, createdAt: -1 });

module.exports = mongoose.model("BattleAnalysis", schema);
