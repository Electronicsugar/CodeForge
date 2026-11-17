const mongoose = require("mongoose");

const integritySchema = new mongoose.Schema(
    {
        strikes: { type: Number, default: 0 },
        score: { type: Number, default: null },
        label: { type: String, enum: ["recorded", "clean", "minor", "suspicious", "flagged"], default: "recorded" },
        awayMs: { type: Number, default: 0 },
        counts: { type: mongoose.Schema.Types.Mixed, default: {} },
        flags: [String],
        // capped at 300 by the service ($slice); never contains clipboard content
        events: [{ _id: false, type: String, at: Number, meta: mongoose.Schema.Types.Mixed }]
    }, { _id: false }
);

// Lightweight behaviour trace used by the post-battle analysis. Only sizes and
// timestamps are stored - never code or keystrokes.
const activitySchema = new mongoose.Schema(
    {
        firstSyncAt: { type: Date, default: null },
        firstRunAt: { type: Date, default: null },
        runs: { type: Number, default: 0 },
        runVerdicts: { type: mongoose.Schema.Types.Mixed, default: {} },
        language: { type: String, default: null },
        languagesUsed: [String],
        // [t_ms_since_battle_start, codeLength] sampled at most every 10s, capped
        samples: [{ _id: false, t: Number, len: Number }]
    }, { _id: false }
);

const playerSchema = new mongoose.Schema(
    {
        integrity: { type: integritySchema, default: () => ({}) },
        activity: { type: activitySchema, default: () => ({}) },
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        initialRating: {
            type: Number,
            required: true
        },
        finalRating: {
            type: Number,
            default: null
        },
        ratingChange: {
            type: Number,
            default: 0
        },
        code: {
            type: String,
            default: ""
        },
        passedTests: {
            type: Number,
            default: 0
        },
        totalTests: {
            type: Number,
            default: 0
        },
        status: {
            type: String,
            enum: ["waiting", "playing", "submitted", "won", "lost", "draw", "disconnected"],
            default: "waiting"
        }
    }, {
        _id: false
    }
);

const battleSchema = new mongoose.Schema(
    {
        player1: {
            type: playerSchema,
            required: true
        },
        player2: {
            type: playerSchema,
            required: true
        },
        problem: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Problem",
            required: true
        },
        winner: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            default: null
        },
        status: {
            type: String,
            enum: ["waiting", "in_progress", "completed", "abandoned"],
            default: "waiting"
        },
        startTime: {
            type: Date,
            default: null
        },
        endTime: {
            type: Date,
            default: null
        },
        duration: {
            type: Number,
            default: 15
        },
        endReason: {
            type: String,
            enum: ["accepted", "timeout", "surrender", "disconnect", "draw", "cheating"],
            default: null
        }
    }, {
        timestamps: true
    }
);

module.exports = mongoose.model("Battle", battleSchema);
