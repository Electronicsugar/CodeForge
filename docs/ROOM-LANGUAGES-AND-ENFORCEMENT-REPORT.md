# Multilingual rooms, restored enforcement and coaching verification

Latest update: 21 November 2026. New battle rooms now have their own integrity
enforcement as described in the final section below, superseding the earlier
legacy-only limitation.

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

After the replacement key was saved locally, a live Gemini test using
`gemini-3.8-flash` through Google's OpenAI-compatible endpoint returned a valid
post-battle coaching response. Only synthetic metrics were sent; source-code
sharing remained disabled. The API key was read from the ignored backend `.env`
without printing or committing it.

A separate live personal-coach request timed out at the default 25-second limit,
then timed out again with a process-only 60-second test timeout. Live personal
coaching is therefore not verified as working; its rule-based fallback remains
covered by passing tests. No provider account, billing setting, model substitution
or permanent timeout change was made. The earlier missing-credentials blocker is
resolved, but this live-provider timeout is an outstanding limitation.

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


## New battle-room enforcement — 21 November 2026

Per the user's explicit rule, a participant reaching the strike limit forfeits
**their entire team**, in every room size from 1v1 through 4v4. Room scoring/Elo
behavior is otherwise unchanged; an integrity forfeit records winner/forfeited
team metadata and ends editing/submission without assigning Elo or team scores.

The room socket handler now authenticates JWT/Redis state and derives roster/team
membership on the server. The existing pure integrity rules handle paste lengths,
large local insertions, tab/window absence, small pastes and copy/cut. Defaults
remain 25 characters for a paste, 80 for a large insertion, three seconds away,
three strikes, and the existing 2.5-second strike cooldown. Copying alone is not
a strike. Explicit monitor mode remains supported.

State is durable in an optional private member `integrityState`. A single room
revision compare-and-swap persists the event and, at the final strike, completes
the room atomically. The actual end time is recorded immediately. Event UUIDs
make acknowledgement retries idempotent (256 recent IDs); event payloads are
limited to 2 KiB and policy traffic limits remain in force. No source/clipboard
text is stored in integrity state. Room views remove private member states and
return only the requesting competitor's strike summary; hosts cannot report
competitor events. Public notifications contain room/status metadata, not source
or behavioural event records.

The room-level UI discloses the rules before start. During the battle there are
no strike warning popups or visible strike counter. The third qualifying strike
by any participant immediately disqualifies their entire team and declares the
opposing team the winner. No confirmation is required. Copying alone remains
penalty-free; existing paste/absence thresholds and duplicate-event safeguards
remain unchanged. The server does not emit room integrity warning events. Monitoring
uses the existing Socket.IO singleton and starts only for active competitors.
It survives problem/language switches and restores private strike state after refresh;
queued retries keep their event UUID. Switching accounts drops the old event
queue. Offline events cannot be independently verified; browser signals can be
bypassed and are not proof of cheating.

Monaco reports only local model changes for large-insertion enforcement. Remote
Yjs updates, initial/programmatic flushes, undo and redo do not become local
insertion violations. Direct paste attribution prevents a paste also becoming a
second large-insertion event. Existing analytics still use their separate private
aggregate data. Local backups, shared source, immutable submissions, hidden tests
and all 34 existing problem records remain intact.

Verification: 58 backend unit checks and 53 disposable-database integration checks
passed. All 60 browser checks and 18 frontend unit checks passed, including remote-edit
attribution, warning/refresh/forfeit behavior, existing collaboration and recovery.
Full lint passed with existing unrelated warnings. Production build and public
deployment are recorded in the final task report. An earlier integration attempt was cancelled at its 180-second parent
limit under low free memory; the sequential rerun passed all 53 checks with a
300-second test-only budget. These limits do not alter battle deadlines.

Silent-disqualification update (2026-11-21): 58 backend unit tests, 53
disposable-database integration checks, all 26 battle-room browser checks and
18 frontend unit tests passed. Frontend lint passed with existing warnings; the
production build passed with its existing bundle-size warning. The first backend
unit attempt had seven local-network failures under restricted execution; all
58 passed when rerun with local-network access. Socket integration verifies no
warning event is emitted, the winner is persisted, and late edits/submissions
are rejected. No live database records or secrets were changed.
