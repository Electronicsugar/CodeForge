// Pure aggregation of a player's recent battle reviews + practice submissions
// into the stats that the long-term coach (rules or LLM) talks about.
const pct = (a, b) => (b > 0 ? Math.round((a / b) * 100) : null);
const avg = (xs) => { const v = xs.filter((x) => Number.isFinite(x)); return v.length ? Math.round(v.reduce((s, x) => s + x, 0) / v.length) : null; };

/** analyses: BattleAnalysis docs (metrics inside). practice: [{problemTags, difficulty, status, problem}] */
const buildCoachStats = (analyses, practice = []) => {
    const ms = analyses.map((a) => a.metrics).filter(Boolean);
    const battles = ms.length;
    const wins = ms.filter((m) => m.result.outcome === "won").length;
    const losses = ms.filter((m) => m.result.outcome === "lost").length;

    const verdicts = { wrong_answer: 0, runtime_error: 0, compile_error: 0, time_limit_exceeded: 0, accepted: 0 };
    for (const m of ms) for (const k of Object.keys(verdicts)) verdicts[k] += (m.submissions.verdicts && m.submissions.verdicts[k]) || 0;
    const totalSubs = Object.values(verdicts).reduce((s, x) => s + x, 0);

    const noRun = ms.filter((m) => m.runs.submitsBeforeFirstRun > 0 && m.runs.count === 0).length;
    const flagged = ms.filter((m) => m.integrity && m.integrity.strikes > 0).length;

    // by tag, from battles
    const byTag = {};
    for (const m of ms) for (const tag of m.problem.tags || []) {
        const t = (byTag[tag] ||= { tag, battles: 0, wins: 0, failedSubmissions: 0 });
        t.battles += 1; if (m.result.outcome === "won") t.wins += 1;
        t.failedSubmissions += m.submissions.count - ((m.submissions.verdicts && m.submissions.verdicts.accepted) || 0);
    }

    // by tag, from practice (every problem attempted outside battles)
    const practiceByTag = {};
    const byProblem = new Map();
    for (const row of practice) {
        const e = byProblem.get(String(row.problem)) || { tags: row.tags || [], attempts: 0, solved: false };
        e.attempts += 1; if (row.status === "accepted") e.solved = true;
        byProblem.set(String(row.problem), e);
    }
    for (const e of byProblem.values()) for (const tag of e.tags) {
        const t = (practiceByTag[tag] ||= { tag, problems: 0, solved: 0, attempts: 0 });
        t.problems += 1; t.attempts += e.attempts; if (e.solved) t.solved += 1;
    }

    const weakTags = [
        ...Object.values(byTag).filter((t) => t.battles >= 2 && t.wins / t.battles < 0.5).map((t) => ({ tag: t.tag, evidence: `won ${t.wins} of ${t.battles} battles` })),
        ...Object.values(practiceByTag).filter((t) => t.problems >= 2 && t.solved / t.problems < 0.5).map((t) => ({ tag: t.tag, evidence: `solved ${t.solved} of ${t.problems} practice problems` }))
    ].reduce((acc, t) => acc.some((x) => x.tag === t.tag) ? acc : [...acc, t], []).slice(0, 4);

    const strongTags = Object.values(byTag).filter((t) => t.battles >= 2 && t.wins / t.battles >= 0.75).map((t) => t.tag).slice(0, 3);

    const habits = [];
    if (battles >= 3 && noRun / battles >= 0.4) habits.push({ habit: "submits_without_running_samples", evidence: `${noRun} of ${battles} battles had submissions but no sample run` });
    if (totalSubs >= 6 && verdicts.compile_error / totalSubs >= 0.2) habits.push({ habit: "frequent_compile_errors", evidence: `${pct(verdicts.compile_error, totalSubs)}% of submissions failed to compile` });
    if (totalSubs >= 6 && verdicts.time_limit_exceeded / totalSubs >= 0.15) habits.push({ habit: "too_slow_solutions", evidence: `${pct(verdicts.time_limit_exceeded, totalSubs)}% of submissions hit the time limit` });
    if (totalSubs >= 6 && verdicts.wrong_answer / totalSubs >= 0.4) habits.push({ habit: "missed_edge_cases", evidence: `${pct(verdicts.wrong_answer, totalSubs)}% of submissions were wrong answers` });
    const stall = avg(ms.map((m) => m.typing && m.typing.longestStallSec));
    if (stall != null && stall >= 120) habits.push({ habit: "long_stalls", evidence: `average longest stall ${stall}s` });
    const think = avg(ms.map((m) => m.timing && m.timing.firstKeystrokeSec));
    if (flagged > 0) habits.push({ habit: "integrity_warnings", evidence: `${flagged} of ${battles} battles had integrity warnings` });

    return {
        battles, wins, losses, winRate: pct(wins, battles),
        avgFirstKeystrokeSec: think, avgFirstRunSec: avg(ms.map((m) => m.timing && m.timing.firstRunSec)),
        avgSubmissionsPerBattle: battles ? Number((totalSubs / battles).toFixed(1)) : null,
        verdicts, habits, weakTags, strongTags,
        practice: { problemsAttempted: byProblem.size, problemsSolved: [...byProblem.values()].filter((e) => e.solved).length, byTag: Object.values(practiceByTag).slice(0, 12) }
    };
};

const HABIT_TEXT = {
    submits_without_running_samples: "Run the sample tests before every submit - you often submit without running anything.",
    frequent_compile_errors: "Compile or syntax-check more often while writing; too many submissions fail before any test runs.",
    too_slow_solutions: "Estimate time complexity from the constraints before coding; several solutions were too slow.",
    missed_edge_cases: "Write down edge cases (empty, one element, duplicates, extremes) before submitting.",
    long_stalls: "When stuck for two minutes, write a brute-force version first and optimise afterwards.",
    integrity_warnings: "Stay in the battle tab and type your own solution - integrity warnings can cost you matches."
};

const rulesNarrative = (stats) => {
    if (!stats.battles) return { headline: "Play a few battles and your personal coach will appear here.", focus: [], strengths: [] };
    const headline = `Across your last ${stats.battles} analysed battle(s) you won ${stats.wins} (${stats.winRate}%). ` +
        (stats.habits.length ? `The most repeated pattern: ${HABIT_TEXT[stats.habits[0].habit].toLowerCase()}` : "No repeated bad habits showed up - keep it up.");
    const focus = [
        ...stats.habits.slice(0, 2).map((h) => HABIT_TEXT[h.habit]),
        ...stats.weakTags.slice(0, 2).map((t) => `Practise "${t.tag}" problems (${t.evidence}).`)
    ].slice(0, 3);
    const strengths = [];
    if (stats.strongTags.length) strengths.push(`Strong on: ${stats.strongTags.join(", ")}.`);
    if (stats.winRate >= 60) strengths.push("You win most of your battles.");
    return { headline, focus, strengths };
};

module.exports = { buildCoachStats, rulesNarrative, HABIT_TEXT };
