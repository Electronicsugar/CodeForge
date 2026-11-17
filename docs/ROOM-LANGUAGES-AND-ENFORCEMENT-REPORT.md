# Multilingual rooms, restored enforcement and coaching verification

This follow-up applies the user's revised requirements after integration commit
`b3da123`, on `integration/combine-codeforge`. It supersedes the earlier report's
monitoring-only override, C++-only room limitation and unresolved hook lint error.

## Completed changes

- Restored the colleague's original legacy 1v1 integrity policy and service,
  including paste/large-insertion/unreported-growth strikes and the original
  default three-strike forfeit behavior. Existing configuration thresholds and
  explicit monitor mode remain supported. Contests remain record-only.
- Kept separate collaborative team-room behavioural profiling. No new team
  scoring or team-forfeit rules were invented; the restored penalty service
  operates on legacy `Battle` documents, as in the colleague's repository.
- Added C++, Python, JavaScript and Java to collaborative room authorization,
  durable document schemas, language-specific starters and Monaco highlighting.
  Competitors choose their editor language; teammates using the same language
  share a document. Switching languages preserves each separate document/draft.
- Preserved document identity as `[roomId, server-derived teamId, problemId,
  language]`. Stored subscriptions retain the chosen language for authorization
  rechecks. Unsupported languages remain rejected. Team isolation, host privacy
  and authenticated membership checks remain in force.
- Run and Submit both synchronize the selected language's authoritative document.
  Immutable source snapshots, content hashes and submission UUID replay semantics
  remain in use through the existing BullMQ/Docker pipeline.
- Behaviour collection and persistence now retain the selected language and use
  that language in document and local queue identities. Existing C++ identities
  and records remain valid. Backup downloads use the selected language's extension.
- Fixed the conditional-hook error in EditProblem: hooks are called consistently,
  data-loading callbacks have stable dependencies, and private problem/testcase
  loading is gated on administrator access. Removed its unused response binding.
- Kept both problem-bank files unchanged, with no seeding or production data writes.

## AI and rule-based coaching

No live provider credentials are configured. The user indicated that they do not
know which provider to use; no account, paid plan, API key or external provider was
created or selected on their behalf. A real external-provider/model test remains
pending until credentials are connected locally.

The scheduled background analysis was exercised over real HTTP against a local
provider fixture, covering valid model responses, per-participant persistence,
`analysis_ready` notification, HTTP 503 failure and rule-based fallback for both
participants. Existing tests also cover both provider protocol shapes, response
validation, malformed JSON, timeout, no-key fallback, concurrent request deduplication
and source-code omission by default. This is protocol/orchestration verification,
not a successful call to a real external AI service. Rule-based coaching is intact.

## Verification

- Backend unit regression: 51 passed, including restored enforcement and scheduled
  HTTP-provider success/failure tests.
- Isolated MongoDB/Redis/API integration: 51 passed, including shared-room Python,
  JavaScript and Java synchronization, real Docker Run/Submit, immutable snapshots,
  UUID replay, persistence reload, team isolation and language-separated analytics.
- Frontend unit regression: 18 passed.
- Full Playwright browser regression: 58 passed. Tests cover all existing room/draft/collaboration regressions plus
  three-language Monaco synchronization, isolation from C++, room language-selector
  persistence and admin role changes without a hook-order error.
- Total for the four regression groups above: 178 passing checks. The 31-problem
  verification from the prior integration checkpoint was not rerun because both
  problem-bank files and the judge implementation are unchanged in this follow-up.
- Frontend production build and full lint complete successfully. Existing unrelated
  lint warnings and the large-bundle build warning remain.
- Syntax checks and `git diff --check` pass.

Early browser attempts exposed fixture issues (first-load navigation, importing a
CommonJS optimized module without Vite interop, and clicking Monaco's hidden input).
Tests now use an isolated preloaded component page, a normal JSX harness, and the
visible editor surface. These failures were resolved before the final regressions.

## Local checks

Use the integration checkout's existing backend/frontend dependencies. The
`codeforge-runner:2.0` Docker image built during integration is required.

```powershell
# backend
node --test --test-force-exit tests/antiCheat.test.cjs tests/integrityService.test.cjs tests/analysis.test.cjs tests/runnerSafety.test.cjs tests/randomSelection.test.cjs tests/rateLimits.test.cjs
./tests/run-integration.ps1
# frontend
npm test
npm run test:browser
npm run lint
npm run build
```

No existing secrets, database volumes, deployment configuration or running public
deployment was replaced. This remains a local integration candidate; it has not
been merged to main, pushed or deployed by this follow-up.
