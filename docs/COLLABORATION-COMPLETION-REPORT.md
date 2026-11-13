# CodeForge collaborative editor and behavioural profiles — completion report

Completed locally on 13 November 2026, branch `feature/collaboration-profiles`, based on `24d9cb466793b3af8623d2342e5eca884d2441db` plus the existing uncommitted battle-experience and phase-one implementation. This report supersedes the incomplete-work statements in `COLLABORATION-PHASE-1-REPORT.md`.

## Completed scope

All remaining implementation phases are delivered: durable collaborative document recovery, authoritative Run/Submit integration, individual behavioural event aggregation, private profile screens/charts, and regression testing. No scoring, matchmaking, spectator access, host transfer, penalties or automatic cheating decisions were added. Existing work remains uncommitted; nothing was merged, pushed or deployed. Existing `.env`, secrets, application database containers/volumes and the older Docker deployment copy were not replaced or reset. Automated backend tests used newly created disposable fixtures only.

## Editor architecture and isolation

Monaco is bound to a Yjs `Y.Text('source')` with y-monaco. C++ highlighting, line numbers, indentation, bracket matching, resizable coding area, names and collaborator selections remain inside the existing battle workspace. The existing Socket.IO singleton/server carries document updates and awareness; no second application connection/server was introduced.

Document identity is the canonical JSON tuple `[roomId, serverDerivedTeamId, problemId, 'cpp']`. JWT/Redis session, actual competitor membership, selected problem, supported language and lifecycle are checked server-side. External hosts, outsiders and opponents cannot subscribe to another team's source or send updates using its key. Recipients are reauthorized before outgoing source/presence delivery. Awareness identities are server-assigned and unrelated payload fields are stripped. Source never travels through general room notifications.

New rooms receive immutable `BattleRoom.editorMode='collaborative'`. Older documents without that field retain the original private editor and submission behaviour; no mid-battle draft conversion or destructive backfill occurs. A new room is required to use collaboration for an older private battle. Private drafts remain in their original IndexedDB context, with a download action where a previous private draft exists. Pending private submission recovery is retained alongside shared intent recovery. Both modes use the same native editor-ownership scope, preserving one editor tab per participant/room/team.

## Durable synchronization and recovery

`CollaborativeDocument` stores the canonical tuple, binary Yjs state, revision and SHA-256 source hash. A unique key and unique `(room, teamId, problem, language)` index prevent duplicate documents. The server seeds starter code only on first insertion; competing initializers load the stored winner rather than inserting a second starter lineage.

Updates are validated for source-only shape, binary/text limits and missing dependencies before application. Dirty updates share a short batched persistence timer (150 ms), rather than issuing a MongoDB write directly for each Monaco event. Acknowledgements wait for successful persistence. Each commit merges the current stored CRDT and uses a revision compare-and-swap. A stale snapshot therefore cannot overwrite another writer's commit. Concurrent commits retry; readers/snapshots refresh newer stored revisions. Storage failures leave the generation dirty and do not acknowledge it as saved.

Browser recovery uses a separate native IndexedDB store, `codeforge-collaboration-v1`, keyed by participant plus canonical document identity. It preserves CRDT updates/lineage, not just the last text string. Read/write transactions merge concurrent cached state before saving. Initial synchronization waits for cached state and merges offline changes with the server state; refresh does not duplicate starter text. Existing `codeforge-resilience` drafts and durable intent stores remain intact. Divergent text backups are archived before replacement and can be downloaded. No old private code is automatically pasted over a team's shared document.

Completed rooms reject edits. Read-only review displays the frozen server source. If a participant has unacknowledged offline changes, those remain in local recovery and are offered for download rather than silently being presented as the authoritative completed document. Awareness is intentionally ephemeral. Connection, local recovery and server save states are distinct.

Limits remain finite: 50,000 source characters, 512 KiB encoded document/update, 16 document connections, 500 resident server documents, and per-user traffic ceilings of 300 collaboration events / 2 MiB per ten seconds. Existing HTTP auth/room/submission rate policies remain unchanged.

## Authoritative Run and Submit

The shared client flushes pending CRDT updates and receives a persisted revision/hash. Its Run/Submit payload sends the document hash, not an editor-code snapshot. The server derives the team, verifies active membership/problem/language, refreshes and persists the current document, rechecks the deadline after waiting, and reads an immutable source string from that state.

If a teammate changed the document since the client's acknowledged hash, a new request receives 409 and asks the participant to review/resubmit. The browser's `code` field is ignored for collaborative snapshots. New collaborative rooms cannot bypass this by submitting private browser code before opening a document. Old private rooms retain their original path.

Submission records contain the actual submitter, server `createdAt`, document key, source revision, hash and immutable code. Later edits do not modify the submission. The existing durable UUID, replay checks, queue recovery, BullMQ worker and Docker C++ executor are reused. A retry of an already-created submission returns the original record even if the live document subsequently changes; it does not select a new source version. Run uses the same authoritative source selection and existing public-test privacy. Hidden-test details remain protected. Room acceptance timestamps are recorded server-side using an atomic minimum, with fallback to existing history timestamps for older records.

## Behavioural collection and calculations

Collection starts only inside a competitor's shared Monaco editor, after initial binding, and is disclosed above the editor. It measures counts, durations and window timestamps; it does not capture clipboard contents, literal keys, passwords, unrelated inputs or activity outside CodeForge.

- Keyboard provenance comes from local editor input and subsequent content changes. CPM counts observable inserted code characters divided by estimated active keyboard-edit time. WPM is CPM / 5, explicitly labelled a code-character equivalent. At least five keyboard edits and two seconds of active keyboard duration are required; otherwise speed is unavailable.
- Cadence is a six-bucket histogram of intervals between keyboard-originated edits. Bursts/pauses and active duration are estimates; long gaps are not treated as continuous typing. Visible/focused problem time is tracked separately.
- A trusted native paste event is distinct from insertion size. Paste content is never read from the clipboard. Only inserted-character counts, event counts and first/last window timestamps are summarized. Insertions/replacements of 100+ characters have separate counters. Large completion/tool edits do not automatically become typing or paste.
- Insertions, deletions, replacements, undo, redo, uncertain tool edits and programmatic changes have separate counters. Initial binding is excluded. Remote Yjs application is marked explicitly and cannot increase the receiving participant's typing, paste or contribution counters.
- Approximate contribution is a participant's observed local insert/delete volume divided by the team's observed volume. It is not ownership of final source, unique lines written or a cheating score. Undo/redo and replacing code affect editing volume, so it must not be interpreted as unique productive output.
- First edit is client-observed with server clock offset. First Run, first submission and acceptance derive from server-side actions/submission records. Per-problem and overall summaries are provided.

The browser persists cumulative one-minute windows locally, batches uploads approximately every 15 seconds and on lifecycle transitions, and retains unsent windows through disconnect/refresh. Window/session identity and increasing sequence numbers make replay idempotent. The backend derives participant/team/document identity, validates room time bounds and numeric consistency, and atomically replaces only newer cumulative windows. Concurrent or stale uploads cannot double-count. The queue preserves newer local sequences while an older upload is acknowledged; 429 cooldowns are respected and permanently rejected uploads are not blindly retried.

## Profiles, privacy and retention

Open **My behavioural profile** from the room, or `/battle/rooms/:roomId/profile`. It includes overview, estimated typing speed over time, cadence, active/idle periods, paste versus large insertion charts, reliable keyboard/paste proportions, per-problem first actions, local versus remote activity, and approximate contribution. Missing/insufficient measurements are shown explicitly. Charts and activity tables follow the charcoal/orange styling and remain contained on mobile.

New APIs (existing authenticated room prefix):

| Endpoint | Purpose |
|---|---|
| `POST /api/v1/battles/rooms/:roomId/behaviour` | Up to 24 bounded aggregate windows; server-derived attribution |
| `GET /api/v1/battles/rooms/:roomId/behaviour/me` | Only the authenticated competitor's private profile |

There is no endpoint granting another competitor or external host a private profile. A spoofed user/team field cannot change attribution. Only a source-free aggregate team denominator is used for the owner's contribution estimate. Waiting-room profiles do not reveal hidden random questions. Disclosure is neutral and no analytics value causes bans, deductions or verdicts.

New MongoDB collections/indexes:

| Model | Additive indexes / retention |
|---|---|
| `CollaborativeDocument` | Unique `key`; unique room/team/problem/language tuple; source retained for permitted battle review |
| `BehaviourWindow` | Unique user/document/session/minute; room/user/minute lookup; single-field `expiresAt` TTL |
| `BehaviourAction` | Unique room/user/problem for first Run; single-field `expiresAt` TTL |

Aggregate windows/actions expire 30 days after the battle deadline. Reads exclude expired data even before MongoDB's asynchronous TTL sweep. Late uploads are accepted only through one day after the battle deadline. Local aggregate queues expire after 30 days and clean up on next use; an inactive offline browser cannot run a wall-clock deletion task while closed. Source recovery/drafts and existing submission history retain their existing purpose and are not erased by analytics TTL. At most 10,000 server windows per participant/room and 2,000 pending local windows are accepted. No unlimited raw keystroke log exists.

Startup initializes the additive indexes. No application data migration/reset ran. See [MongoDB TTL behaviour](https://www.mongodb.com/docs/manual/core/index-ttl/) for asynchronous expiry semantics.

## Dependencies

No extra runtime package was ultimately needed for the remaining phases. Native IndexedDB was used for explicit transaction/error handling alongside the existing recovery infrastructure. The y-indexeddb adapter was evaluated but not retained. Existing phase-one exact versions remain: Monaco 0.57.0, Yjs 13.6.33, y-monaco 0.1.6, y-protocols 1.0.7 and frontend lib0 0.2.120. The Monaco export alias and scoped DOMPurify 3.4.17 override remain. Backend Yjs declarations were preserved.

## Local testing

1. Keep existing MongoDB, Redis, Docker runner and `.env` values. Start backend normally from `backend` with `npm start`; start frontend from `frontend` with `npm run dev`. Collaboration is now available for newly created collaborative rooms by default. `BATTLE_COLLABORATION=false` or `VITE_BATTLE_COLLABORATION=false` explicitly disables it; do not toggle these while a shared battle is in progress. Previous development-only gating is removed now that persistence/snapshots are implemented.
2. Create a **new** room, preferably 3v3/4v4 for collaboration testing. Existing rooms without editorMode intentionally retain private drafts. Use separate authenticated browser profiles/contexts for three Alpha accounts and at least one Beta account. A separate external host can monitor without reading code/profiles.
3. Use the unchanged lead assignment, personal readiness and Team Ready controls, then start. Type concurrently on the same Alpha problem. Verify text/cursors/presence converge while Beta remains separate. Switch problems and return. Native ownership still blocks another editor tab for the same participant/room/team.
4. Edit in a loaded editor while disconnected. Reconnect and refresh after the frontend is reachable. Verify offline edits merge once. Restart the backend normally and reconnect: committed CRDT state must reload from MongoDB. Browser-local recovery retains unacknowledged edits. No database/container recreation is necessary.
5. Run/Submit, then let a teammate edit. Submission history must retain the earlier source hash/revision and result. A stale new submission should show 409 and require reviewing the current document. Replays retain the original UUID/result.
6. Type incrementally, paste locally, insert a snippet, undo/redo and pause. Open **My behavioural profile**, then Refresh profile after local summaries upload. Speed remains unavailable until enough keyboard activity exists. The teammate receiving your edits should show remote activity, not your typing/paste as their own. External hosts/outsiders must be denied the private profile API.
7. Use a short battle to verify completion: Run/Submit close, frozen server code is read-only, and any late offline text remains a downloadable backup. No scoring outcome or penalty is invented.

## Known limits

- The existing deployment architecture remains a single Socket.IO backend. MongoDB CAS protects concurrent persistence, but multi-instance live broadcasting/presence would additionally require a shared Socket.IO adapter and coordination; none was deployed here.
- Analytics are bounded client-observed estimates and can be falsified by a modified client. They are descriptive, not forensic evidence. Autocomplete/formatting attribution is deliberately uncertain when origin is not reliably observable. Paste timelines are minute summaries with first/last timestamps, not permanent raw event streams.
- A server cannot include a teammate's edits that have never reached it. Submissions use the latest acknowledged/available persisted state at snapshot time. Conflicting later edits trigger hash validation for new requests.
- Full CRDT updates are bounded at 512 KiB; the transport is not optimized for arbitrarily large documents or unbounded histories. Resident document capacity is finite. C++ is the supported language in the existing judge.
- IndexedDB can be unavailable, full or cleared by the browser. Errors retain editor/text backups and are surfaced; browser storage clearance cannot be undone. Offline refresh of the application shell itself needs reachable/cached frontend assets—no unrelated service-worker application rebuild was added.
- First-Run analytics recording is best-effort and cannot break code execution if its ancillary write fails. Existing unrelated lint warnings/error and bundle-size warnings remain documented below.

## Screenshots

`docs/screenshots/collaborative-battle.png` and `docs/screenshots/behaviour-profile.png` were generated from deterministic UI fixtures and visually inspected. They contain test accounts/data, not production users. Existing screenshots were not replaced; the old capture test now writes to ignored test output instead of overwriting prior uncommitted documentation assets.

## Executed validation

Final test results and exact changed-file inventory follow.

| Command | Actual result |
|---|---|
| `npm test` (frontend) | 10/10 passed |
| `npm run test:browser` (frontend) | 51/51 passed, including existing battle/resilience and new editor/profile checks |
| `powershell -NoProfile -ExecutionPolicy Bypass -File backend/tests/run-integration.ps1` (root) | 44/44 Node entries passed: 43 scenarios plus parent; real MongoDB/Redis and Docker C++ |
| `node --test tests/rateLimits.test.cjs` (backend) | 4/4 passed |
| `npm run build` (frontend) | Passed; entry ~535 kB, lazy Monaco chunk ~2.81 MB / ~727 kB gzip; size warnings remain |
| Targeted oxlint on changed implementation/tests | Passed; pre-existing unused controller import warning remains |
| `npm run lint` (frontend) | Pre-existing conditional hook error in EditProblem.jsx:121 and existing warnings remain; not claimed as passing |
| `git diff --check` | Passed |

Backend coverage includes authorization, three-way editing, team isolation, malformed updates, durable batching, concurrent CAS writers, storage failure/retry, fresh-process document reload, immutable server snapshots, stale-hash rejection, idempotent replay, real Docker judging, private-room compatibility, analytics attribution/deduplication, access restrictions, TTL expiry, Redis recovery and legacy 1v1. Browser coverage includes actual Monaco typing/cursors, local-versus-remote metrics, offline refresh/merge, frozen completion review with downloadable pending edits, hash-only Run/Submit integration, private profile charts, insufficient data, mobile layout and the existing resilience suite.

The process-restart storage check launches a fresh Node process against the isolated MongoDB fixture and verifies recovered CRDT source; it is not a claim of testing a cloud rollout or load-balanced deployment. Initial failures during development (including Monaco overlap blocking action clicks) were corrected and the complete final suites rerun.

## Exact files added or extended during completion

- `backend/server.js`
- `backend/src/controllers/submission.controller.js`
- `backend/src/models/BattleRoom.js`
- `backend/src/models/BehaviourAction.js`
- `backend/src/models/BehaviourWindow.js`
- `backend/src/models/CollaborativeDocument.js`
- `backend/src/models/Submission.js`
- `backend/src/routes/battleRoom.routes.js`
- `backend/src/services/battleRoom.service.js`
- `backend/src/services/behaviour.service.js`
- `backend/src/services/collaborativeDocument.service.js`
- `backend/src/services/judge.service.js`
- `backend/src/services/submission.service.js`
- `backend/src/sockets/collaboration.socket.js`
- `backend/src/sockets/socket.js`
- `backend/tests/battleExperience.scenarios.cjs`
- `backend/tests/battleRooms.scenarios.cjs`
- `backend/tests/collaboration.scenarios.cjs`
- `backend/tests/collaborationCompletion.scenarios.cjs`
- `backend/tests/resilience.integration.cjs`
- `docs/COLLABORATION-COMPLETION-REPORT.md`
- `docs/screenshots/behaviour-profile.png`
- `docs/screenshots/collaborative-battle.png`
- `frontend/src/App.jsx`
- `frontend/src/components/CollaborativeBattleEditor.css`
- `frontend/src/components/CollaborativeBattleEditor.jsx`
- `frontend/src/components/RoomCodeEditor.jsx`
- `frontend/src/hooks/useCodeDraft.js`
- `frontend/src/pages/BattleRoom.jsx`
- `frontend/src/pages/BattleRooms.css`
- `frontend/src/pages/BehaviourProfile.css`
- `frontend/src/pages/BehaviourProfile.jsx`
- `frontend/src/services/behaviourCollector.js`
- `frontend/src/services/behaviourStorage.js`
- `frontend/src/services/collaborationCache.js`
- `frontend/src/services/collaborationProvider.js`
- `frontend/src/services/submissionService.js`
- `frontend/tests/behaviourCollector.test.js`
- `frontend/tests/browser/battleRooms.spec.js`
- `frontend/tests/browser/behaviourProfile.spec.js`
- `frontend/tests/browser/collaboration.spec.js`
- `frontend/tests/collaborationCache.test.js`

This inventory is relative to the phase-one checkpoint, not to the older Git HEAD; previously uncommitted unrelated files remain preserved. All implementation work remains local and uncommitted.
