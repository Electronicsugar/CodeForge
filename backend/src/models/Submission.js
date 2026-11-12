const mongoose = require("mongoose");

const submissionSchema = new mongoose.Schema(
    {
        operation: { type: String, default: 'submit' },
        idempotencyKey: { type: String },
        payloadHash: { type: String },
        enqueueState: { type: String, enum: ['waiting','queued','enqueue_failed'] },
        enqueueAttempts: { type: Number, default: 0 },
        nextEnqueueAt: { type: Date },
        enqueueError: { type: String },
        user: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "User",
            required: true
        },
        problem: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Problem",
            required: true
        },
        language: {
            type: String,
            enum: ["cpp", "java", "python", "javascript"],
            required: true
        },
        code: {
            type: String,
            required: true,
        },
        status: {
            type: String,
            enum: ["pending", "running", "accepted", "wrong_answer", "runtime_error", "compile_error", "time_limit_exceeded"],
            default: "pending"
        },
        runtime: {
            type: Number,
            default: null
        },
        memory: {
            type: Number,
            default: null
        },
        passedTests: {
            type: Number,
            default: 0
        },
        totalTests: {
            type: Number,
            default: 0
        },
        error: {
            type: String,
            default: null
        },
        battle: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Battle",
            default: null
        },
        battleRoom:{type:mongoose.Schema.Types.ObjectId,ref:'BattleRoom'},
        teamId:{type:mongoose.Schema.Types.ObjectId},
    }, {
        timestamps: true
    }
)

submissionSchema.index({user:1,operation:1,idempotencyKey:1}, {
    unique:true, partialFilterExpression:{idempotencyKey:{$type:'string'}}
});
submissionSchema.index({status:1,enqueueState:1,nextEnqueueAt:1});
submissionSchema.index({battleRoom:1,teamId:1,problem:1,createdAt:-1});
module.exports = mongoose.model("Submission", submissionSchema);
