# Collaborative battle editor — phase 1 checkpoint

Date: 12 November 2026. Scope: collaborative editor foundation only. Stopped for review before phase 2, following the requested phase checkpoints.

## Repository audit and preservation

The actual checkout was already on `feature/collaboration-profiles`, at `24d9cb466793b3af8623d2342e5eca884d2441db`. The battle-experience implementation was present as uncommitted changes, as described in `docs/BATTLE-EXPERIENCE-REPORT.md`. Backend Yjs 13.6.33 and y-protocols 1.0.7 dependency declarations were also already uncommitted at the start.

Before implementation, inspected Git status/history, the report, BattleRoom, RoomCodeEditor, room API client, submission recovery hooks/services, draft storage/ownership, Socket.IO singleton and server initialization, JWT/Redis checks, selected-problem authorization and the existing BullMQ/Docker submission pipeline. Recorded SHA-256 hashes for all 28 existing modified/untracked files in ignored `work/collaboration-audit/baseline-hashes.json`.

Only two of those pre-existing dirty files were incrementally extended: the backend integration test entry (one additional scenario module) and RoomCodeEditor (opt-in shared mode). The other 26 match their starting hashes, including the existing backend dependency files, report and three screenshots. Regression tests regenerated a screenshot; rerunning its deterministic fixture restored its original exact hash. No pre-existing work was discarded, reset or committed. No branch switch, merge, push or deployment occurred. Existing secrets, `.env`, databases/volumes/containers and the older Docker copy were not modified.

## Architecture assessment

Before this phase, RoomCodeEditor used an account-specific textarea backed by `useCodeDraft`. IndexedDB stores exact text with revision compare-and-swap, and native Web Locks enforce one editor tab per account/room/team. Run flushes a draft and sends its text; Submit creates a durable UUID intent, then the existing authenticated server service validates room/problem/team and stores immutable source for BullMQ/Docker. At this checkpoint, that existing server submission behaviour is unchanged.

The application already owns one authenticated Socket.IO server and one frontend socket singleton. The server verifies JWT and Redis session revocation at connection and per incoming packet. General battle-room channels contain safe room state/notifications, not source. The new adapter registers additional handlers on those existing sockets; it does not open another application server, namespace connection or independent battle connection.

## Completed foundation

- Battle-only, lazy-loaded Monaco editor, C++ tokenization, dark theme, line numbers, four-space indentation, bracket matching, responsive layout and vertically resizable editor surface. Practice and legacy editors are unchanged.
- Yjs shared `Y.Text('source')`, bound bidirectionally through y-monaco. Three real browser collaborators converged after typing/concurrent edits. Remote cursor selections and server-assigned names/presence are displayed.
- Exact canonical document identity: JSON encoding of `[battleRoomId, serverDerivedTeamId, selectedProblemId, 'cpp']`. A server-owned starter initializes each in-memory document once. Client text does not overwrite shared source by whole-text replacement.
- Team/problem isolation, refresh from the live server, and offline CRDT edits merging after reconnect on the **same** socket singleton. Full CRDT updates are exchanged in this bounded foundation; there is no last-writer-wins text replacement.
- Reuse of existing single-tab ownership and IndexedDB text backup. Shared mode uses `battle-collaborative-team:<teamId>` within the existing user/room/problem/language identity, so old private drafts remain intact. This context remains stable at completion, allowing a read-only text backup.
- Before replacing a divergent previously saved shared-mode text backup, it is durably copied to a unique `:recovery:<UUID>` context in the existing draft store. A download action exposes that previous backup. Storage failure prevents opening the editing binding rather than silently overwriting it. These are text backups, **not** durable CRDT lineage or automatic offline-refresh reconciliation.
- Run/Submit controls and existing intent/result recovery remain. In opt-in mode the browser waits for an acknowledged shared flush before handing its current text to the old pipeline. **This is not yet the authoritative server snapshot integration required by phase 2.**

## Authorization and limits

Events: `collab_join`, `collab_update`, `collab_awareness`, `collab_leave`, plus server-only `collab_denied`. Acknowledgements contain success/status/message and synchronization data where appropriate. Document channels use `collab:<canonical identity>`; no source travels on general battle-room notifications.

Every subscription/update/presence change verifies the session, active lifecycle, competitor membership, selected problem and supported language. The server derives team membership and rejects a conflicting claimed team. External hosts and outsiders cannot subscribe; another team's key cannot be used for updates. Only the subscribed document is writable. Each outbound source/presence recipient is also reauthorized, including Redis revocation, before emission. Invalid recipients are removed.

The server replaces client-supplied awareness identity with the authenticated participant's name/ID. It accepts bounded relative cursor positions and strips unrelated awareness fields. A socket can only publish its registered Yjs client identity; duplicate live client IDs are rejected. Disconnect removes its ephemeral presence. No clipboard data, behavioural metrics or raw keystrokes are collected in this phase.

Foundation limits: 256 KiB binary update, 512 KiB encoded document state, 50,000 source characters, source-text root only, no embedded non-string values/formatting attributes/pending missing dependencies, 2,048-character serialized cursor selection, 16 live document connections, 100 in-memory documents per process. Per authenticated user, update/awareness/join traffic shares 300 events and 2 MiB per ten-second window. Existing HTTP rate policies are untouched. These are finite development limits, not a distributed quota design.

The current transport is single-process and volatile. It is explicitly gated to server `NODE_ENV=development` **and** `BATTLE_COLLABORATION=true`. Production ignores this opt-in. Frontend activation separately requires `VITE_BATTLE_COLLABORATION=true`. Default existing behaviour remains active until phase 2 is complete and reviewed. This gate is intentional protection against treating the unfinished foundation as durable collaboration.

## Dependencies and compatibility

Registry metadata/peer declarations were inspected before installation. Frontend adds exact versions: Monaco 0.57.0, Yjs 13.6.33, y-monaco 0.1.6, y-protocols 1.0.7 and lib0 0.2.120. Backend dependency files are unchanged from their starting bytes; its existing Yjs/y-protocols declarations were preserved. No CDN editor loader is used.

Monaco 0.57 changed its public import exports, while y-monaco still imports the older API path. Vite has one exact compatibility alias to the current public editor API. No vendor files are patched. An older compatible Monaco release was evaluated but not retained because of its sanitizer advisory. The final Monaco dependency has a narrowly scoped DOMPurify 3.4.17 override. npm audit now reports four existing unrelated high advisories (axios, follow-redirects, source-map-js and Vite); no Monaco/DOMPurify advisory remains. Unrelated dependency upgrades were not performed.

The editor uses Monaco's stable textarea input path (`editContext:false`) for consistent browser automation and input behaviour. This does not replace the Monaco editor with the old battle textarea.

References: [y-monaco binding](https://github.com/yjs/y-monaco), [Yjs awareness](https://docs.yjs.dev/getting-started/adding-awareness), [Monaco](https://github.com/microsoft/monaco-editor). The packaged y-socket.io provider was inspected (registry modification date September 2023); it was not adopted because the application needs its existing singleton and per-document/per-recipient JWT/Redis checks. The small provider adapter uses the existing Socket.IO transport and standard Yjs CRDT/awareness objects.

## Database changes

None. There is no new MongoDB collection/index/migration in phase 1. Shared server documents live only in the scoped process manager. Existing IndexedDB store/schema remains version 1; divergent text recovery copies use existing draft records, not a destructive store replacement. MongoDB persistence, bounded local CRDT persistence and retention are phase 2 work.

## Executed tests

| Command | Result |
|---|---|
| `npm test` in frontend | 6/6 passed: five existing draft/intent tests and one new durable text-backup preservation test |
| `npm run test:browser` in frontend | Combined run: 42/42 passed (39 existing + three collaboration tests at that point) |
| `npx playwright test tests/browser/collaboration.spec.js` in frontend | Final focused run: 4/4 passed, including added divergent-backup download check |
| `powershell -NoProfile -ExecutionPolicy Bypass -File backend/tests/run-integration.ps1` from root | 35/35 Node entries passed: 34 scenarios plus parent, including seven collaboration scenarios and existing actual Docker C++ judging/Redis recovery |
| `npm run build` in frontend | Passed. Existing entry warning remains (~521 kB). Lazy collaborative editor chunk ~2.8 MB / ~724 kB gzip; worker ~303 kB |
| Targeted oxlint on every changed JS/JSX/CJS/config | Passed |
| `git diff --check` | Passed |
| `npm run lint` in frontend | Still fails on pre-existing conditional hook in EditProblem.jsx:121; existing warnings also reported |
| `npm audit --json` in frontend | Four existing unrelated high advisories remain; no automatic unrelated upgrades |

The combined 42-test browser run preceded the fourth focused collaboration test; do not interpret it as an executed 43-test combined run. The final four-test run exercised the final Monaco/provider/backup changes. Backend tests used the actual application server, JWTs, Redis and MongoDB. Browser collaboration tests used a separate, isolated **test-only** Socket.IO fixture with a deterministic authorizer; they are not a second server in the application. They exercised the actual provider, socket singleton, Monaco and y-monaco.

New backend coverage: three-way concurrent edits; Alpha/Beta isolation; outsider/external-host read/write rejection; unsupported language and unselected-problem rejection; server-owned awareness identity/cursor isolation; malformed/oversized/non-source update rejection; offline merge/reconnect; revoked recipient source denial; deadline rejection; production/disabled opt-in rejection.

New browser coverage: actual Monaco keyboard input; three participants and cursors; concurrent edits; problem/team separation; refresh recovery from live server; offline merge without another socket; exact divergent-backup download. The frontend unit test separately verifies the recovery record remains durable and does not overwrite the current record.

Build/import and test-input issues encountered while developing were corrected and rerun. No failed intermediate run is represented as passing. Existing battle rules, leadership, admission, readiness, selection, deadlines, scoring deferral and the legacy judge path were not rewritten.

## Local review instructions

1. Keep the existing MongoDB/Redis containers and all current `.env` values. In the PowerShell terminal launching backend, set `$env:NODE_ENV='development'` and `$env:BATTLE_COLLABORATION='true'`, then start the backend normally (`npm start` from backend). No `.env` replacement is needed.
2. In a separate terminal launching frontend, set `$env:VITE_BATTLE_COLLABORATION='true'`, then `npm run dev` from frontend. A Vite restart is necessary after changing this build flag.
3. Use separate authenticated browser profiles/contexts for three Alpha competitors and at least one Beta competitor. The external host, if used, needs a separate account. Create/start a room using the existing lead, personal readiness and Team Ready rules; those rules are unchanged.
4. Open the same selected problem as all Alpha members. Type distinct edits at once and move selections: text, collaborator names and remote cursors should synchronize. Beta should see its own separate starter/document. External host should remain monitoring-only.
5. Switch problems and return. Disconnect one participant temporarily, edit locally, then reconnect while the backend stays alive. Refresh another participant and confirm the live document returns. Existing single-tab ownership must still prevent a second editor tab for the same account/room/team.
6. Read the explicit “server memory only” status and development warning. Do **not** use this checkpoint for valuable battle work or restart-recovery claims. Normal Run/Submit still use the old browser-source pipeline, not a phase-2 authoritative snapshot.
7. Disable the two collaboration opt-ins and restart to use the unchanged normal battle editor. Do not toggle modes mid-battle: private and shared backup contexts are intentionally separate. Old private drafts are retained and are not automatically imported into a shared document.

To rerun automated tests, use the commands above. The backend integration runner refuses existing fixture names, creates only its own disposable test containers, and removes only those newly created fixtures. It never resets the existing application database/containers. Protocol-only browser tests need no real application database.

## Deliberately incomplete at this checkpoint

Phase 2: batched durable MongoDB Yjs updates/snapshots, concurrency-safe persistence, backend restart recovery, IndexedDB CRDT lineage, automatic offline-refresh reconciliation, persisted state acknowledgements, and immutable **server-derived** submission snapshots/revision/hash. Current text archives prevent silent loss but are not automatic CRDT recovery. Current client-flushed Run/Submit does not satisfy authoritative snapshot requirements. Full-state synchronization should become differential as persistence is introduced. No production/multi-instance collaboration claim is made.

Phase 3: behavioural input collection, reliable local/remote/programmatic attribution and batched summaries. No telemetry has started.

Phase 4: aggregation, neutral profile UI/charts, profile access control/disclosure and retention. No behavioural profile endpoints, schema or screen exist yet.

Phase 5: full end-to-end regression of persistence, authoritative submissions and analytics after those phases are implemented. The existing regressions and foundation tests above have already been run at this checkpoint.

Other current limits: C++ only; fixed development document capacity; no source access for external hosts; no scoring changes; no public matchmaking; no new spectator/host-transfer features. A manual recovery archive list/retention policy beyond the currently exposed divergent backup belongs to phase 2. Build-size optimization and existing unrelated lint/security issues are not hidden as completed work.

## Exact files changed in this phase

- backend/src/sockets/socket.js
- backend/src/sockets/collaboration.socket.js (new)
- backend/tests/resilience.integration.cjs
- backend/tests/collaboration.scenarios.cjs (new)
- frontend/package.json
- frontend/package-lock.json
- frontend/vite.config.js
- frontend/src/components/RoomCodeEditor.jsx
- frontend/src/components/CollaborativeBattleEditor.jsx (new)
- frontend/src/components/CollaborativeBattleEditor.css (new)
- frontend/src/services/collaborationProvider.js (new)
- frontend/src/services/collaborationBackup.js (new)
- frontend/tests/collaborationBackup.test.js (new)
- frontend/tests/browser/collaborationHarness.jsx (new)
- frontend/tests/browser/collaboration.spec.js (new)
- docs/COLLABORATION-PHASE-1-REPORT.md (new)

All remain uncommitted. Prior battle-experience changes remain alongside them.

## Starting uncommitted inventory

The pre-existing 28-file inventory follows (these are not all new work from this phase):
- backend/package-lock.json
- backend/package.json
- backend/src/controllers/submission.controller.js
- backend/src/middlewares/rateLimiter.middleware.js
- backend/src/models/BattleRoom.js
- backend/src/routes/battleRoom.routes.js
- backend/src/services/battleRoom.service.js
- backend/src/services/judge.service.js
- backend/tests/battleRooms.scenarios.cjs
- backend/tests/resilience.integration.cjs
- frontend/src/components/Navbar.jsx
- frontend/src/components/RoomCodeEditor.jsx
- frontend/src/components/RoomConfiguration.jsx
- frontend/src/hooks/useSubmissionRecovery.js
- frontend/src/pages/BattleRoom.jsx
- frontend/src/pages/BattleRooms.css
- frontend/src/pages/BattleRoomsLobby.jsx
- frontend/src/services/battleRoomService.js
- frontend/src/services/submissionRecovery.js
- frontend/tests/browser/battleRooms.spec.js
- backend/src/middlewares/rateLimitPolicy.js
- backend/src/services/roomProblemSelection.js
- backend/tests/battleExperience.scenarios.cjs
- backend/tests/rateLimits.test.cjs
- docs/BATTLE-EXPERIENCE-REPORT.md
- docs/screenshots/battle-active.png
- docs/screenshots/battle-lobby.png
- docs/screenshots/battle-waiting.png
