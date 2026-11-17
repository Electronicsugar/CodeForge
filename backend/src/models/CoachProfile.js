const mongoose = require("mongoose");

// Cached long-term coaching profile, rebuilt when new battles have been analysed.
const schema = new mongoose.Schema(
    {
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, unique: true },
        basedOnBattles: { type: Number, default: 0 },
        narrativeBasedOn: { type: Number, default: -1 },
        stats: { type: mongoose.Schema.Types.Mixed, default: {} },
        narrative: { type: mongoose.Schema.Types.Mixed, default: null },
        source: { type: String, enum: ["llm", "rules"], default: "rules" },
        model: { type: String, default: null },
        generatedAt: { type: Date, default: null }
    },
    { timestamps: true }
);

module.exports = mongoose.model("CoachProfile", schema);
