# Multi-player battle room foundation — implementation report

## Branches and rollout

Implementation is on `feature/team-battle-rooms`, based on the completed resilience commit `a4a78c7`. At the user's request, **local `main` was fast-forwarded to `feature/codeforge-resilience` (`a4a78c7`)** using a separate worktree. No unfinished team-room code was included in that merge. No push or production deployment was performed.

The verified source repository is `C:\Users\Aditi Jain\OneDrive\Desktop\Code_Forge\CodeForge`. The older Docker deployment copy was not modified. No existing database contents or volumes were reset. Backend tests use the existing disposable-test runner, which creates and removes only explicitly named test fixtures on localhost.

## Architecture actually implemented

- `/battle` now opens the existing battle entry flow as a private room lobby: format, host role, duration, independently configured problem count and manually selected catalogue problems.
- New `/battle/rooms/:roomId` page provides waiting-room rosters, readiness, team changes, shareable code, host configuration, guarded start, authoritative countdown, selected-problem navigation, progress and submission activity.
- Each new room has exactly two persistent teams, with teamSize 1–4. A participant host occupies one chosen team slot. An external host occupies no slot and becomes monitoring-only after start.
- The existing Express app, JWT authentication, Socket.IO server/singleton, IndexedDB drafts, submission intents and Docker/BullMQ judge are reused.
- New rooms are **not** legacy Battles. They have separate state and attribution so a new-room accepted solution cannot accidentally trigger old Elo/first-solve completion logic.
- Competitors use the existing textarea approach in a room-scoped editor component. No Monaco, Yjs, shared source, cursors or collaborative synchronization was added.

## Database design

### New `BattleRoom` / `battlerooms` collection

| Field | Purpose |
|---|---|
| `schemaVersion`, `revision` | Model version and atomic compare-and-swap room changes |
| `code` | Eight-character, cryptographically generated, uniquely indexed private code |
| `host`, `hostType` | Authenticated creator and PARTICIPANT_HOST / EXTERNAL_HOST role |
| `teamSize` | One through four, selected at creation and immutable through room APIs |
| `teams` | Exactly Alpha and Beta; persistent ObjectId team identities, member user IDs, readiness and join time |
| `teams[].score` | Reserved zero-valued field; no points are awarded in this foundation |
| `duration`, `problemCount`, `problems` | Independent configuration and exact catalogue ObjectIds |
| `status` | `waiting`, `ready`, `in_progress`, `completed`, `cancelled` |
| `createdAt`, `startTime`, `endTime`, `completedAt`, `cancelledAt` | Authoritative lifecycle timestamps; `endTime` is the scheduled deadline |

Indexes cover unique code, active deadline scanning, host recency and participant recency. Host-controlled configuration changes reset readiness. Readiness can be reset by the host but cannot be asserted on behalf of another participant.

### Additive Submission fields

`battleRoom` references the new room; `teamId` is derived by the server from membership. The original `user` remains the real submitting participant. Existing `battle` remains null for room submissions. Operation `room-submit` is a separate idempotency namespace. An index covers room/team/problem/creation time.

No historical records are rewritten. New indexes are prepared through normal model initialization; production rollouts with automatic indexing disabled must explicitly create the BattleRoom and Submission indexes before enabling the feature. Existing MongoDB/Redis URLs and deployment services are unchanged.

## Permissions

| Operation | Participant host | External host | Competitor | Outsider |
|---|---|---|---|---|
| Create a room | Yes, occupies one slot | Yes, no slot | Can create their own | Must authenticate first |
| Read private state | Own room | Own room | Joined room | No |
| Join a team | Exactly one initial slot; may switch before start | Never in own room | By valid code, capacity permitting | Code-based join is the only admission operation |
| Set own readiness | Before start | No | Before start | No |
| Reset all readiness | Before start | Before start | No | No |
| Configure problems/duration | Before start | Before start | No | No |
| Start/cancel | Before start, valid prerequisites | Same | No | No |
| Run/submit within room | Active battle, selected problem | No | Active battle, own server-derived team | No |
| Monitor source-free activity/presence | Yes | Yes | Yes | No |

Requests do not trust supplied host/member/team attribution. Host identity comes from JWT; team IDs are checked against the room; readiness always affects the caller; submission team attribution is server-derived. Team membership, duration and problems lock after start. External hosts have no post-start administrative operations. No pause/resume exists.

Problem statements unlock for competitors when the battle starts. Waiting hosts can see their selected catalogue. Room-specific problem and run/submit APIs reject unselected problems. Ordinary practice catalogue access remains a separate existing feature, not a room permission bypass or a room-scored submission.

## API and event changes

All new endpoints are under `/api/v1/battles/rooms` and use the existing authentication middleware:

| Method/path suffix | Action |
|---|---|
| `GET /limits` | Effective configuration limits |
| `GET /` | Up to twenty recent rooms owned/joined by caller |
| `POST /` | Create configured room |
| `POST /join` | Join using room code and Alpha/Beta/team ID |
| `GET /:roomId` | Authorized current state, server time and sanitized progress |
| `GET /:roomId/problems/:problemId` | Selected problem after start |
| `POST /:roomId/configure` | Host configuration; resets readiness |
| `POST /:roomId/team` | Caller switches team before start |
| `POST /:roomId/ready` | Caller sets readiness |
| `POST /:roomId/reset-ready` | Host resets readiness |
| `POST /:roomId/start` | Atomic server-timed start |
| `POST /:roomId/cancel` | Host cancellation before start |
| `POST /:roomId/leave` | Non-host leaves before start |

Creation/join/mutations are rate-limited. Existing submission creation/run endpoints accept additive `roomId`. Both room and legacy battle contexts cannot be supplied together. Original response fields and submission IDs are retained.

Socket events use the existing server:

- Client `battle_room_join`: reauthenticate, check membership, join private channel, return authoritative state/acknowledgement.
- Client `battle_room_unsubscribe`: stop observing a room without dropping roster membership.
- Server `battle_room_state`: authorized state snapshot on subscribe/reconnect.
- Server `battle_room_updated`: source-free invalidation containing room ID, revision, status and accepted transition type (`battle_room_created`, `participant_joined`, `team_selected`, `participant_ready`, `participant_ready_reset`, `participant_left`, `host_configuration_updated`, `battle_started`, `battle_cancelled`, `battle_completed`, `submission_judged`). Clients refetch authoritative state.
- Server `battle_room_presence`: presence invalidation on join/disconnect/unsubscribe.
- Server `battle_room_error`: session-verification error.

Rooms use `battle-room:<roomId>` channels; authenticated user channels deliver creation notification. Socket packets are rechecked for expired/revoked JWTs. Membership is checked before room subscription, API reads and writes. Leaving members are removed from notification channels. Clients never send authoritative room mutations over these events.

Only safe user names/IDs, configuration, readiness, presence and submission ID/status summaries are returned. No participant source, hidden tests, JWT, email or password is broadcast. Activity shows the latest 100 attempts; solved/progress aggregates cover all room submissions.

## Race conditions and lifecycle

- Unique code index is authoritative; allocation retries collisions up to five times.
- Join, team change, leave, readiness, configuration, start and cancellation use single-document revision compare-and-swap. On contention the action rereads and revalidates current membership, permissions, capacity and lifecycle, with at most eight attempts.
- Concurrent requests for one final slot cannot overfill a team. The same user cannot simultaneously enter both teams. Participant host consumes exactly one slot; external host is explicitly rejected as a competitor.
- Simultaneous starts commit only once. A configuration/start race either resets readiness before start, or rejects the configuration after start. Both cannot succeed against the same prior revision.
- Start writes state, server start timestamp and scheduled deadline in one update. No browser chooses the deadline. Countdown uses the saved deadline and the server clock offset.
- A two-second backend sweep completes overdue rooms. Authorized reads and submission checks also expire overdue state. A process restart can discover deadlines from MongoDB; no browser or in-memory timeout is the sole completion authority.
- Disconnect never mutates roster membership. Presence is derived from the current single Socket.IO server. Rejoin authenticates again, checks membership and returns current state. Subscription generations discard stale asynchronous subscribe responses.
- Frontend request generations/revisions prevent stale snapshots replacing newer lifecycle state. Socket snapshots trigger HTTP refetches; refreshes preserve the editor instead of setting starter code. Temporary authentication failure retains the visible room and local editor.

### Review boundaries that remain

- Catalogue validation and Submission insertion are separate collection operations, not a distributed transaction. A problem is checked at creation/configuration/start and submission authorization; concurrent administrator deletion can still make a selected problem unavailable. The UI/API reports that condition. Catalogue version pinning or snapshots are a possible future enhancement, not silently implemented here.
- Submission permission is checked against server time before persistence. An authorized request received just before the deadline may commit or finish judging after it; the next scoring phase must choose and document received-time versus judged-time semantics.
- Basic existing queue reconciliation/idempotency is preserved; there is no new distributed worker fencing or exactly-once settlement system.
- Presence is single-server and advisory. Slots survive disconnects indefinitely within the room lifecycle; no grace-period eviction was introduced.

## Resilience and legacy compatibility

Historical Battle documents, player1/player2 shape, result service, existing 1v1 timeout logic and Elo meaning are retained. The old `/battle/:battleId` editor and `/api/v1/battles/:battleId` path still work for its players; the read DTO adds `teamSize:1` and a legacy-kind label without migrating the database. Existing matchmaking server handlers remain for compatibility, but the new entry UI does not launch public/random matchmaking.

Legacy state reads and surrender now check player membership. Existing scoring code itself is unchanged. New room records never flow through the legacy first-accepted-wins branch: accepted new-room submissions update activity/progress and leave the room active until its deadline. This is explicit in the UI (`scoringMode: deferred`, zero reserved scores), not a silent scoring change.

New room drafts remain user-specific and isolated by context containing the server-derived team ID, room ID, problem and C++ language. Native single-tab ownership is retained for each participant's room/team editor. No competitive conflict-resolution UI is enabled. Autosave, restore, pre-submit flush, durable intent UUID, idempotent replay and final-status recovery are reused. Socket singleton, connection indicator and authentication recovery remain in place.

No anti-cheating penalty system was present in this checkout. The existing focus/visibility flush and single-tab restrictions were preserved; no claim is made that this implements new cross-device proctoring.

## Tests and demonstration

Test commands:

```powershell
# Repository root, Docker running, existing C++ runner image available
.\backend\tests\run-integration.ps1
cd frontend
npm test
npm run build
npm run test:browser
```

Integration uses disposable MongoDB/Redis on localhost, drops only the named test database, and removes its own containers. It runs real registration/login, concurrent idempotency, queue outage/recovery and Docker C++ judging as well as room capacity, role, race, expiry and socket tests. Browser room tests mock API/sockets for deterministic UI checks; backend integration tests separately exercise real service/database/socket behaviour.

Final acceptance results: **5 storage unit tests passed; 25 Playwright tests passed (7 new room UI tests plus 18 resilience regressions); 15 backend integration scenarios plus their parent passed (16 Node test entries).** The frontend production build and targeted lint passed. The build emitted a non-failing entry-chunk-size warning. Repository-wide lint retains the pre-existing EditProblem conditional-hook issue documented in the resilience report; that unrelated file was not modified. Background expiry was verified by waiting for the server sweep to mark an overdue room complete without a state-read trigger. Real new-room C++ submissions were accepted by the existing Docker worker without ending the room or awarding points.

To demonstrate each format:

1. Start the backend and frontend from this feature branch using the existing environment configuration. This source checkout is not the older running deployment copy.
2. Open Battle, select 1v1/2v2/3v3/4v4, choose host role, duration, problem count and exact eligible problems, then create the room.
3. Share its code. Join with enough separate authenticated accounts: 2, 4, 6 or 8 competitors. A participant host counts as one; an external host is additional.
4. Fill Alpha/Beta, mark every competitor ready, and start as host. Change configuration first if demonstrating that readiness resets.
5. Switch selected problems, type code, wait for Saved locally, refresh/reconnect and verify the same draft/deadline. Different participants should use separate profiles/accounts; a second editor tab for the same participant is deliberately read-only.
6. Submit C++; observe server-attributed participant/team statuses and team problem progress. External host receives monitoring UI only. Scores remain zero until the reviewed scoring phase.
7. Let the deadline expire; backend/read recovery marks the room completed without a browser choosing the transition.

## Next phases — intentionally not implemented

Scoring review should define an immutable first-acceptance record with a unique `(battleRoom, teamId, problemId)` constraint for teams, plus participant-specific uniqueness for the 1v1 scoring rule. Keep `Submission.user` as the real submitter. Define server `receivedAt`/`acceptedAt`, first-solve time semantics, configurable time decay, atomic once-only awards, tie breaking, accepted-after-deadline handling and replay-safe totals/settlement. Current legacy read-then-finish rating updates are not a sufficient concurrency primitive for future team scoring.

Future collaborative documents must authorize **room ID + server-derived team ID + selected problem ID + language**. Teammates may share that document; opposing teams must never share its channel or source snapshots. The foundation has stable team IDs and room membership checks, but no document endpoint, snapshots, Yjs or Monaco infrastructure was added.

Other deliberate limitations: C++ only (existing judge support); limits default to 1–20 selected problems and 1–180 minutes, adjustable through optional `BATTLE_MAX_PROBLEMS` / `BATTLE_MAX_DURATION_MINUTES`; no public matchmaking UI, invites beyond room codes, host transfer, spectator admission, pause/resume, moderation/kick, distributed presence or new deployment infrastructure. The Vite build may warn that the entry chunk exceeds 500 kB; code splitting can be reviewed separately.

## Changed files

Created: `backend/src/models/BattleRoom.js`, `backend/src/services/battleRoom.service.js`, `backend/src/routes/battleRoom.routes.js`, `backend/src/sockets/battleRoom.socket.js`, `backend/tests/battleRooms.scenarios.cjs`; `frontend/src/services/battleRoomService.js`, `frontend/src/components/RoomConfiguration.jsx`, `frontend/src/components/RoomCodeEditor.jsx`, `frontend/src/pages/BattleRoomsLobby.jsx`, `frontend/src/pages/BattleRoom.jsx`, `frontend/src/pages/BattleRooms.css`, `frontend/tests/browser/battleRooms.spec.js`; this report.

Modified: `backend/server.js`, `backend/src/controllers/battle.controller.js`, `backend/src/controllers/submission.controller.js`, `backend/src/models/Submission.js`, `backend/src/routes/battle.routes.js`, `backend/src/services/submission.service.js`, `backend/src/sockets/socket.js`, `backend/src/sockets/battle.socket.js`, `backend/src/workers/submission.worker.js`, `backend/tests/resilience.integration.cjs`; `frontend/src/App.jsx`, `frontend/src/pages/BattleLobby.jsx`, `frontend/src/services/submissionService.js`, `frontend/src/services/submissionRecovery.js`, `frontend/src/hooks/useSubmissionRecovery.js`.

No dependency was added. Team-room foundation remains on its review branch; do not proceed to scoring or production deployment without the next review.
