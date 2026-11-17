// Deterministic behaviour metrics for one player in one 1v1 battle.
// Pure functions: the LLM never computes anything, it only interprets these.
const sec = (ms) => (Number.isFinite(ms) ? Math.max(0, Math.round(ms / 1000)) : null);
const ratio = (a, b) => (b > 0 ? Number((a / b).toFixed(2)) : 0);
const FAIL = ["wrong_answer", "runtime_error", "compile_error", "time_limit_exceeded"];

const summariseSubmissions = (subs, startMs) => {
    const sorted = [...subs].sort((a, b) => +new Date(a.createdAt) - +new Date(b.createdAt));
    const verdicts = { accepted: 0, wrong_answer: 0, runtime_error: 0, compile_error: 0, time_limit_exceeded: 0 };
    const timeline = sorted.map((s) => {
        if (verdicts[s.status] !== undefined) verdicts[s.status] += 1;
        return {
            tSec: sec(+new Date(s.createdAt) - startMs), status: s.status, language: s.language,
            passed: s.passedTests || 0, total: s.totalTests || 0, runtimeMs: s.runtime ?? null, codeLength: (s.code || "").length
        };
    });
    const accepted = sorted.find((s) => s.status === "accepted");
    const best = sorted.reduce((m, s) => Math.max(m, ratio(s.passedTests || 0, s.totalTests || 0)), 0);
    const last = sorted[sorted.length - 1];

    // longest run of identical failing verdicts ("same mistake repeated")
    let streak = 0, longest = 0, streakStatus = null, prev = null;
    for (const s of sorted) {
        if (FAIL.includes(s.status) && s.status === prev) streak += 1; else streak = FAIL.includes(s.status) ? 1 : 0;
        if (streak > longest) { longest = streak; streakStatus = s.status; }
        prev = s.status;
    }
    return {
        count: sorted.length, verdicts, timeline,
        firstSubmitSec: sorted[0] ? sec(+new Date(sorted[0].createdAt) - startMs) : null,
        acceptedAtSec: accepted ? sec(+new Date(accepted.createdAt) - startMs) : null,
        bestPassRatio: best, finalPassRatio: last ? ratio(last.passedTests || 0, last.totalTests || 0) : 0,
        repeatedFailure: longest >= 2 ? { status: streakStatus, times: longest } : null,
        last
    };
};

// samples: [{t: ms since start, len}] ~ every 10s
const summariseTyping = (samples = []) => {
    if (!samples.length) return { samples: 0, longestStallSec: null, stalls60s: 0, maxLength: null, deletedChars: 0, rewriteRatio: 0 };
    let longest = 0, stalls = 0, run = 0, deleted = 0, grown = 0, max = 0;
    for (let i = 0; i < samples.length; i++) {
        max = Math.max(max, samples[i].len);
        if (i === 0) continue;
        const delta = samples[i].len - samples[i - 1].len, dt = samples[i].t - samples[i - 1].t;
        if (delta < 0) deleted += -delta; else grown += delta;
        if (Math.abs(delta) < 3) { run += dt; } else { if (run >= 60000) stalls += 1; longest = Math.max(longest, run); run = 0; }
    }
    if (run >= 60000) stalls += 1;
    longest = Math.max(longest, run);
    return { samples: samples.length, longestStallSec: sec(longest), stalls60s: stalls, maxLength: max, deletedChars: deleted, rewriteRatio: ratio(deleted, grown + deleted) };
};

/**
 * @param battle   lean Battle document (player1/2 with activity+integrity populated)
 * @param userId   the player being analysed
 * @param subs     this player's Submission docs for this battle
 * @param oppSubs  opponent's Submission docs for this battle
 * @param problem  lean Problem (title, difficulty, tags)
 */
const buildMetrics = ({ battle, userId, subs, oppSubs, problem }) => {
    const isP1 = String(battle.player1.user._id || battle.player1.user) === String(userId);
    const me = isP1 ? battle.player1 : battle.player2;
    const opp = isP1 ? battle.player2 : battle.player1;
    const startMs = +new Date(battle.startTime);
    const endMs = +new Date(battle.endTime || Date.now());
    const durationSec = sec(endMs - startMs);
    const won = battle.winner ? String(battle.winner._id || battle.winner) === String(userId) : null;

    const mine = summariseSubmissions(subs, startMs);
    const theirs = summariseSubmissions(oppSubs, startMs);
    const act = me.activity || {};
    const firstRunMs = act.firstRunAt ? +new Date(act.firstRunAt) : null;
    const submitsBeforeFirstRun = subs.filter((s) => firstRunMs === null || +new Date(s.createdAt) < firstRunMs).length;
    const typing = summariseTyping(act.samples);
    const integ = me.integrity || {};

    return {
        problem: { title: problem.title, difficulty: problem.difficulty, tags: problem.tags || [] },
        result: { outcome: won === null ? "draw" : won ? "won" : "lost", endReason: battle.endReason, durationSec, limitSec: (battle.duration || 15) * 60 },
        ratingChange: me.ratingChange ?? 0,
        languages: act.languagesUsed && act.languagesUsed.length ? act.languagesUsed : [...new Set(subs.map((s) => s.language))],
        timing: {
            firstKeystrokeSec: act.firstSyncAt ? sec(+new Date(act.firstSyncAt) - startMs) : null,
            firstRunSec: firstRunMs ? sec(firstRunMs - startMs) : null,
            firstSubmitSec: mine.firstSubmitSec,
            acceptedAtSec: mine.acceptedAtSec
        },
        runs: { count: act.runs || 0, verdicts: act.runVerdicts || {}, submitsBeforeFirstRun },
        submissions: {
            count: mine.count, verdicts: mine.verdicts, bestPassRatio: mine.bestPassRatio, finalPassRatio: mine.finalPassRatio,
            repeatedFailure: mine.repeatedFailure, timeline: mine.timeline.slice(0, 20)
        },
        typing,
        integrity: { strikes: integ.strikes || 0, score: integ.score ?? 100, label: integ.label || "clean", awaySec: sec(integ.awayMs || 0), counts: integ.counts || {} },
        opponent: {
            submissions: theirs.count, acceptedAtSec: theirs.acceptedAtSec, bestPassRatio: theirs.bestPassRatio,
            firstSubmitSec: theirs.firstSubmitSec, runs: (opp.activity && opp.activity.runs) || 0
        },
        // only used when the operator explicitly allows code to leave the server
        _lastCode: mine.last ? mine.last.code : null
    };
};

const publicMetrics = (metrics) => { const { _lastCode, ...rest } = metrics; return rest; };

module.exports = { buildMetrics, publicMetrics, summariseSubmissions, summariseTyping };
