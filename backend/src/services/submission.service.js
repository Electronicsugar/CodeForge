const submissionRepository = require("../repositories/submission.repository");
const problemRepository = require("../repositories/problem.repository");
const Submission = require('../models/Submission');
const {createHash} = require('node:crypto');
const {enqueue} = require('./submissionEnqueue.service');
const failure = (status,message) => Object.assign(new Error(message),{status});
function fingerprint(data) {
    if(data.roomId&&(data.collaborative===true||data.sourceHash))return createHash('sha256').update(JSON.stringify([String(data.problem),data.language,String(data.roomId),'shared',data.sourceHash])).digest('hex');
    if(data.roomId)return createHash('sha256').update(JSON.stringify([String(data.problem),data.language,data.code,String(data.roomId)])).digest('hex');
    return createHash('sha256').update(JSON.stringify([String(data.problem),data.language,data.code,data.battleId ? String(data.battleId) : null])).digest('hex');
}

const createSubmission = async (submissionData, userId) => {
    const key=submissionData.idempotencyKey;
    if (key !== undefined && (typeof key !== 'string' || !/^[a-zA-Z0-9-]{16,100}$/.test(key))) throw failure(400,'Invalid submission key');
    if(submissionData.roomId&&submissionData.battleId)throw failure(400,'Choose one battle context');
    const operation=submissionData.roomId?'room-submit':submissionData.battleId ? 'battle-submit' : 'submit';
    const payloadHash=fingerprint(submissionData);
    const replay=async existing=>{
        if(existing.payloadHash!==payloadHash)throw failure(409,'Submission key belongs to different code or context');
        existing.replayed=true;
        if(existing.status==='pending'&&existing.enqueueState!=='queued'&&existing.enqueueAttempts<5)await enqueue(existing);
        return existing;
    };
    if(key){const existing=await Submission.findOne({user:userId,operation,idempotencyKey:key});if(existing)return replay(existing);}
    let sourceSnapshot;
    let roomTeam;
    if(submissionData.roomId){
        const checked=await require('./battleRoom.service').selectedProblem(submissionData.roomId,userId,String(submissionData.problem),true);
        roomTeam=checked.access.team._id;
        sourceSnapshot=await require('./collaborativeDocument.service').submissionSnapshot(submissionData,userId);
        if(sourceSnapshot)submissionData={...submissionData,code:sourceSnapshot.code};
    }
    if(typeof submissionData.code!=='string'||submissionData.code.length>50000)throw failure(400,'Code must be at most 50000 characters');
    if(submissionData.battleId){
        const battleService=require('./battle.service');
        await battleService.getPlayerNumber(submissionData.battleId,userId);
        const battle=await battleService.getBattleById(submissionData.battleId);
        if(battle.status!=='in_progress')throw failure(409,'Battle is not active');
        if(String(battle.problem._id||battle.problem)!==String(submissionData.problem))throw failure(400,'Battle problem mismatch');
    }

    const problem = await problemRepository.findById(submissionData.problem);

    if(!problem){
        throw new Error("Problem not found");
    }

    if (submissionData.language !== "cpp") {
        throw new Error("Only C++ is supported currently");
    }
    let submission;
    try { submission = await submissionRepository.create({
        operation, ...(key ? {idempotencyKey:key,payloadHash}:{}),enqueueState:'waiting',
        user: userId,
        problem: submissionData.problem,
        language: submissionData.language,
        code: submissionData.code,
        ...(sourceSnapshot?{documentKey:sourceSnapshot.key,sourceRevision:sourceSnapshot.revision,sourceHash:sourceSnapshot.hash}:{}),
        status: "pending",
        battle: submissionData.battleId || null
        ,...(submissionData.roomId?{battleRoom:submissionData.roomId,teamId:roomTeam}:{})
    }); } catch(error) {
        if(error.code===11000&&key){const existing=await Submission.findOne({user:userId,operation,idempotencyKey:key});if(existing)return replay(existing);}
        throw error;
    }
    if(submissionData.battleId) {
        const battleService=require('./battle.service');
        const playerNumber=await battleService.getPlayerNumber(submissionData.battleId,userId);
        await require('../repositories/battle.repository').updatePlayer(submissionData.battleId,playerNumber,{code:submissionData.code,status:'submitted'});
    }
    return enqueue(submission);
};

const getSubmissionById = async (id, userId) => {
    
    const submission = await submissionRepository.findById(id);
    if (!submission) throw new Error("Submission not found");

    if (submission.user._id.toString() !== userId.toString()) {
        throw new Error("You are not allowed to access this submission");
    }

    return submission;
};

const getMySubmissions = async (userId, query) => {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const skip = (page - 1) * limit;

    const filter = {
        user: userId
    };

    if (query.status) {
        filter.status = query.status;
    }
    const [submissions, total] = await Promise.all([
        submissionRepository.findByFilter(filter, skip, limit),
        submissionRepository.countByFilter(filter)
    ]);

    return {
        submissions,
        pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit)
        }
    };
};

const getProblemSubmissions = async (userId, problemId, query) => {

    const problem = await problemRepository.findById(problemId);

    if (!problem) {
        throw new Error("Problem not found");
    }

    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const skip = (page - 1) * limit;

    const [submissions, total] = await Promise.all([
        submissionRepository.findByUserAndProblem(userId, problemId, skip, limit),
        submissionRepository.countByUserAndProblem( userId, problemId)
    ]);

    return {
        submissions, pagination: { page, limit, total, totalPages: Math.ceil(total / limit)}
    };
};


const getMyStats = async (userId) => {

    const [
        totalSubmissions, accepted, wrongAnswer, compileError, runtimeError, timeLimitExceeded, solvedProblems, recentSubmissions
    ] = await Promise.all([
        submissionRepository.countByUser(userId),

        submissionRepository.countByUserAndStatus(userId, "accepted"),
        submissionRepository.countByUserAndStatus(userId, "wrong_answer"),
        submissionRepository.countByUserAndStatus(userId, "compile_error"),
        submissionRepository.countByUserAndStatus(userId, "runtime_error"),
        submissionRepository.countByUserAndStatus(userId, "time_limit_exceeded"),

        submissionRepository.countSolvedProblems(userId),

        submissionRepository.findRecentByUser(userId, 5)
    ]);

    const acceptanceRate = totalSubmissions === 0 ? 0 : Number(((accepted / totalSubmissions) * 100).toFixed(2));

    return {
        totalSubmissions, accepted, wrongAnswer, compileError, runtimeError, timeLimitExceeded, solvedProblems, acceptanceRate, recentSubmissions
    };
};

module.exports = {
    createSubmission, getSubmissionById, getMySubmissions, getProblemSubmissions, getMyStats
};
