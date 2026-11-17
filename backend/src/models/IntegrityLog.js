const mongoose = require("mongoose");

// Contest anti-cheat record: one document per (contest, user). Contests have no
// socket channel, so events arrive over REST; they are logged for admin review
// and never auto-disqualify anyone.
const schema = new mongoose.Schema(
    {
        context: { type: String, enum: ["contest"], required: true },
        contextId: { type: mongoose.Schema.Types.ObjectId, required: true },
        user: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
        state: { type: mongoose.Schema.Types.Mixed, default: {} },   // policy state (strikes, counters...)
        summary: { type: mongoose.Schema.Types.Mixed, default: {} }, // policy.summarize(state)
        events: [{ _id: false, type: String, at: Number, problem: String, meta: mongoose.Schema.Types.Mixed }]
    },
    { timestamps: true }
);
schema.index({ context: 1, contextId: 1, user: 1 }, { unique: true });

module.exports = mongoose.model("IntegrityLog", schema);
