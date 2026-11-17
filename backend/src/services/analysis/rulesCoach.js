// Rule-based coach. It works with no API key at all, and its output is also
// the "draft" the LLM is asked to refine - so the model is anchored to facts.
const mmss = (s) => (s == null ? "n/a" : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`);

const generateRulesAnalysis = (m) => {
    const mistakes = [], behaviour = [], improvements = [], strengths = [], practice = [];
    const v = m.submissions.verdicts;
    const failures = v.wrong_answer + v.runtime_error + v.compile_error + v.time_limit_exceeded;
    const add = (list, item) => list.push(item);

    // ── mistakes, each tied to evidence ────────────────────────────────────
    if (v.compile_error > 0) add(mistakes, { category: "implementation", what: `${v.compile_error} submission(s) failed to compile, which costs time without testing any logic.`, evidence: `submissions.verdicts.compile_error = ${v.compile_error}` });
    if (v.time_limit_exceeded > 0) add(mistakes, { category: "complexity", what: "A submission exceeded the time limit; the approach is probably too slow for the largest inputs. Check the constraints and aim for a better time complexity.", evidence: `submissions.verdicts.time_limit_exceeded = ${v.time_limit_exceeded}` });
    if (v.runtime_error > 0) add(mistakes, { category: "edge_case", what: "A submission crashed at runtime - typically an out-of-bounds index, empty input, or division by zero.", evidence: `submissions.verdicts.runtime_error = ${v.runtime_error}` });
    if (v.wrong_answer > 0) {
        const partial = m.submissions.bestPassRatio > 0 && m.submissions.bestPassRatio < 1;
        add(mistakes, { category: "logic", what: partial ? `Wrong answers after passing about ${Math.round(m.submissions.bestPassRatio * 100)}% of tests usually mean a missed edge case (empty, single element, duplicates, negatives, maximum size) rather than a wrong idea.` : "The first tests already failed, which points to a misunderstanding of the problem or a core logic bug. Re-read the statement and trace a sample by hand.", evidence: `submissions.verdicts.wrong_answer = ${v.wrong_answer}, bestPassRatio = ${m.submissions.bestPassRatio}` });
    }
    if (m.submissions.repeatedFailure) add(mistakes, { category: "time_management", what: `The same verdict (${m.submissions.repeatedFailure.status.replace(/_/g, " ")}) repeated ${m.submissions.repeatedFailure.times} times in a row. Resubmitting without a new hypothesis rarely helps.`, evidence: `submissions.repeatedFailure.times = ${m.submissions.repeatedFailure.times}` });

    // ── behaviour ─────────────────────────────────────────────────────────
    if (m.runs.submitsBeforeFirstRun > 0 && m.runs.count === 0) add(behaviour, `You submitted ${m.runs.submitsBeforeFirstRun} time(s) without ever running the sample tests. Running samples first is the cheapest way to catch mistakes.`);
    else if (m.runs.submitsBeforeFirstRun > 0) add(behaviour, `${m.runs.submitsBeforeFirstRun} submission(s) happened before your first sample run.`);
    if (m.runs.count >= 3 && failures === 0) add(strengths, `You ran the samples ${m.runs.count} times before finishing - a disciplined test-as-you-go habit.`);
    const think = m.timing.firstKeystrokeSec;
    if (think != null && think > m.result.limitSec * 0.25) add(behaviour, `You spent ${mmss(think)} before typing anything (over a quarter of the battle). Planning is good, but sketch the approach in code comments sooner.`);
    if (think != null && think < 20 && failures >= 2) add(behaviour, "You started typing almost immediately and then needed several attempts - a minute of planning edge cases may be faster overall.");
    if (m.typing.longestStallSec != null && m.typing.longestStallSec >= 120) add(behaviour, `Your longest stall without any editing was ${mmss(m.typing.longestStallSec)}. When stuck, write a brute-force first, then optimise.`);
    if (m.typing.rewriteRatio >= 0.45 && m.typing.samples >= 6) add(behaviour, `About ${Math.round(m.typing.rewriteRatio * 100)}% of the code you typed was deleted again, which suggests restarting an approach midway.`);
    if (m.timing.firstSubmitSec != null && m.timing.firstSubmitSec < 60 && failures > 0) add(behaviour, "Your first submission came within a minute. Fast submits are only worth it when the solution is trivial.");
    if (m.integrity.strikes > 0) add(behaviour, `${m.integrity.strikes} integrity warning(s) were recorded (tab switches, pastes or code appearing without typing). This can cost you a battle and your rating.`);

    // ── comparison with the opponent ──────────────────────────────────────
    const o = m.opponent;
    let comparison = null;
    if (m.result.outcome === "lost" && o.acceptedAtSec != null) comparison = `Your opponent solved it at ${mmss(o.acceptedAtSec)} with ${o.submissions} submission(s); you made ${m.submissions.count}.`;
    else if (m.result.outcome === "won" && m.timing.acceptedAtSec != null) comparison = `You solved it at ${mmss(m.timing.acceptedAtSec)} using ${m.submissions.count} submission(s).`;
    else if (m.result.outcome !== "won" && m.submissions.bestPassRatio > o.bestPassRatio) comparison = "You were ahead on passing tests when the battle ended.";

    // ── improvements ─────────────────────────────────────────────────────
    if (v.time_limit_exceeded) add(improvements, "Before coding, estimate complexity from the constraints (n up to 1e5 means roughly O(n log n) or better).");
    if (v.wrong_answer || v.runtime_error) add(improvements, "Make a quick checklist of edge cases (empty, one element, duplicates, negatives, maximum size) and test each against your own code before submitting.");
    if (v.compile_error) add(improvements, "Run the samples after every significant edit; they surface syntax and type errors before a graded submission does.");
    if (m.runs.submitsBeforeFirstRun > 0) add(improvements, "Adopt a routine: write, run samples, fix, then submit.");
    if (!improvements.length) add(improvements, m.result.outcome === "won" ? "Try a harder problem next - your process looks solid." : "Review the opponent's speed and aim to start coding a little sooner.");

    // ── what to practise ─────────────────────────────────────────────────
    const tags = m.problem.tags.length ? m.problem.tags : [];
    if (m.result.outcome !== "won" || failures > 0) for (const tag of tags.slice(0, 2)) add(practice, { tag, why: `This battle's problem is tagged "${tag}" and ${failures ? `you had ${failures} failed submission(s)` : "you did not win"}. Solve two more ${m.problem.difficulty} problems with this tag.` });

    const headline = m.result.outcome === "won" ? "You won" : m.result.outcome === "lost" ? "You lost" : "The battle was a draw";
    const summary = `${headline} "${m.problem.title}" (${m.problem.difficulty}) ${m.result.endReason ? `by ${String(m.result.endReason).replace(/_/g, " ")}` : ""}. ${m.submissions.count} submission(s), best result ${Math.round(m.submissions.bestPassRatio * 100)}% of tests. ${comparison || ""}`.replace(/\s+/g, " ").trim();

    return { summary, mistakes, behaviour_insights: behaviour, strengths, improvements, recommended_practice: practice };
};

module.exports = { generateRulesAnalysis, mmss };
