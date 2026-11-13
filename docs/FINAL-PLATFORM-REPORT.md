# Final platform fixes and merge review

13 November 2026. Source branch: `feature/collaboration-profiles`; authorized target: local `main`. This report supersedes the earlier readiness descriptions for the 1v1 special case. No remote push or deployment is authorized or performed.

## 1v1 readiness

Root cause: the room service and UI applied the larger-format lead/Team Ready workflow to every format. In 1v1, the sole participant's personal Ready now determines their team's readiness. No lead assignment or separate confirmation is needed or displayed. Both participants must be ready; withdrawal, leaving/switching membership and relevant configuration changes invalidate readiness. The DTO normalizes old 1v1 flags to personal readiness so contradictory persisted team flags cannot bypass the rule. The legacy team-ready API remains compatible for the sole participant and mirrors personal readiness; it does not permit another participant or host to impersonate them.

2v2–4v4 retain member-only lead assignment and independent lead confirmations. Other members' personal flags remain optional, and partially occupied teams can start. Legacy Battle records and their routes remain unchanged.

## Random selection audit

No deterministic-first selection defect was reproduced in the actual source or live catalogue. The existing implementation already used Node crypto.randomInt with Fisher–Yates shuffling, per-difficulty pools and selection without replacement. Stored IDs are mapped back in their persisted order; refresh/start do not reroll. The UI initially focuses the first question of the *selected list*, not necessarily the first database record.

The existing live catalogue had three eligible problems, all easy, and no eligible medium/hard problems. Read-only sampling selected all three distinct first IDs in 40 independent draws. Repeats are valid with that small pool. No sample problems were inserted into the application database. The pure draw function is now injectable for deterministic tests while production keeps crypto.randomInt. No Math.random fallback, manual-selection change or forced anti-repeat bias was introduced.

Tests cover 100 deterministic mixed-difficulty draws over 60 eligible-shaped records, production-crypto variation, distinctness/ordering/shortages, and 30 actual independently persisted room configurations against an expanded disposable eligible catalogue. Existing refresh/reconnect/start stability tests remain.

## Review and preservation

The full pending implementation includes battle experience, admission notifications, Monaco/Yjs, durable source persistence, authoritative immutable snapshots, private behavioural analytics/profiles, recovery and rate policies. Intended source/tests/documentation and deterministic fixture screenshots are included together. Unrelated logs, work files, node_modules, build outputs, secrets, `.env` and database contents are excluded by path review and staging checks. Workspace-personal paths in new reports were generalized before committing. Test-only dummy credentials remain deterministic fixtures, not production secrets.

All modified/untracked paths and complete diffs were reviewed. Remote references were fetched. Local main was eight commits ahead of origin/main and was an ancestor of the source branch, allowing a non-destructive fast-forward; no divergent remote changes needed resolution. No reset, branch deletion, history rewrite or force push is used.

## Validation and limits

Backend integration: 47/47 Node test entries passed, using disposable MongoDB/Redis and actual Docker C++ judging. Frontend unit tests: 10/10 passed. Random-selection tests: 2/2 passed. Production build passed. Targeted lint and git diff --check passed. Full lint retains the pre-existing conditional hook error at EditProblem.jsx:121 and existing unrelated warnings. Large entry/Monaco chunks remain warnings. Full browser results and post-merge checks are recorded in the final chat report after they finish; they are not inferred from a test launch.

Existing architectural limits remain documented in COLLABORATION-COMPLETION-REPORT.md: single Socket.IO backend, bounded CRDT size/cache, C++ judge support, estimated client-observed analytics, 30-day aggregate retention and no automated cheating verdicts. Additional eligible medium/hard catalogue entries are needed to request those difficulties; they are never silently substituted.

The commit hash, final merge outcome, branch and working-tree status are reported after the actual Git operations rather than predicted in this document.

Pre-commit full browser verification completed: 54/54 passed. The expanded backend integration run passed 47/47 entries. Both new fixes and the existing collaboration/profile/recovery flows passed before committing.
