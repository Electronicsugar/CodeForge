# CodeForge battle experience implementation report

Implemented on 12 November 2026 in `<repository root>`.

Branch: `feature/battle-experience`. Base commit: `24d9cb466793b3af8623d2342e5eca884d2441db` (the existing room foundation, including the resilience work). Changes are local and uncommitted for review. This task did not merge, push or deploy anything. The older Docker deployment copy and existing MongoDB/Redis containers, volumes and data were not changed. Tests created and removed only their own named disposable fixtures.

## Delivered behaviour

- Formats 1v1, 2v2, 3v3 and 4v4 use **maximum capacity**, not a minimum roster. One competitor on each team is sufficient.
- Host explicitly assigns one member as lead for each team. Membership exclusivity prevents a competitor leading both teams. A departing/switching lead is cleared and must be reassigned.
- Every competitor must mark personal readiness. Each lead must then separately confirm Team Ready. Host cannot impersonate either action. Start gives exact missing requirements.
- OPEN teams join directly. APPROVAL_REQUIRED teams create pending requests without admitting the applicant to private state or sockets. Host or the relevant team's lead approves/rejects. Requests retain requester, target team, created time, status, decider and decision time.
- A join, leave, lead change, policy change or personal unready invalidates the affected confirmation. Switching invalidates both affected teams; changing configuration/duration invalidates both confirmations. Existing competitors' personal readiness is retained except when they become unready, switch teams or the host explicitly resets everyone.
- Start and cancellation expire pending requests. Team/configuration/admission changes are locked after start. Server deadline and existing expiry sweep finish the room. Completion closes Run/Submit and keeps permitted history and drafts available.

## Database design and compatibility

`BattleRoom` remains a separate collection from legacy `Battle`. New rooms default to schemaVersion 2.

| Added field | Meaning |
|---|---|
| `teams[].lead` | User ObjectId or null; service requires actual membership in that team |
| `teams[].teamReady` | Separate lead confirmation, default false |
| `teams[].admissionPolicy` | OPEN or APPROVAL_REQUIRED, default OPEN |
| `admissions[]` | Embedded requests: `_id`, `user`, `teamId`, `createdAt`, `status`, `decidedBy`, `decidedAt` |
| `selectionMode` | RANDOM_DISTRIBUTION or MANUAL_SELECTION |
| `difficulties[]` | Ordered difficulty for each stored problem |

Added compound index: `admissions.user:1, admissions.status:1`. Existing unique code, lifecycle/deadline, host and membership indexes remain. Embedded requests keep membership and admission decisions inside one atomic room document; they do not need a cross-collection transaction. At most 100 pending and 1,000 historical requests are accepted per room to bound document growth.

All mutations use the existing room revision compare-and-swap mechanism. On contention they reload and revalidate role, lifecycle, membership and capacity (up to eight attempts; thereafter 409 asks the caller to refresh). Approvals can only consume a pending request once. Direct joins and approvals use the same authoritative roster capacity. The server derives submission user/team from the authenticated account and stored membership; no client team ID is trusted for submission attribution.

No destructive migration or backfill ran. Missing policies/confirmations/admissions on old documents are interpreted safely as OPEN/false/empty. Old waiting participant-host rooms must save random configuration and assign leads before starting. Old active/completed rooms retain their stored questions and deadlines. Existing legacy 1v1 documents, routes, judge/result rules and Elo remain unchanged. New room scores stay deferred; the UI does not present zeros as a result or announce a winner.

## APIs and socket contract

All HTTP routes below require existing JWT authentication and Redis-backed session verification. Prefix: `/api/v1/battles/rooms`.

| Route | Access / result |
|---|---|
| `GET /limits` | Current duration/count bounds, eligible counts by difficulty, active rate policy |
| `GET /` | Compact recent rooms involving the user as host, member or applicant; no rosters/source |
| `POST /preview` `{code}` | New safe code preview: format/status, team capacity/policy, caller's own request status and `canEnter`; no roster, question IDs or source |
| `POST /join` `{code,teamId}` | Direct membership or `{pending:true,...}` according to server policy |
| `POST /:roomId/lead` `{teamId,userId}` | Host only; member of that exact team required |
| `POST /:roomId/policy` `{teamId,policy}` | Host or that team's lead, before start |
| `POST /:roomId/team-ready` `{teamId,ready}` | That lead only; all team members personally ready before confirming |
| `POST /:roomId/admission` `{requestId,decision}` | Host or target team's lead; decision approved/rejected |

Existing create, fetch, configure, team, ready, reset-ready, start, cancel, leave and selected-problem routes remain, with the revised rules. Room detail is restricted to host/members. Applicants cannot use it until admitted. Own-team leads see their team's requests, host sees all, ordinary members do not receive other applicants' requests.

No second Socket.IO server or socket singleton was added. Existing `battle_room_join`, `battle_room_unsubscribe`, `battle_room_state`, `battle_room_presence` and `battle_room_updated` remain. The update envelope's `event` now also identifies `admission_requested`, `admission_decided`, `team_lead_assigned`, `admission_policy_changed`, and `team_ready_confirmed`; these are event **labels inside the existing notification**, not new standalone socket channels. Notifications contain room/revision/status only; the authenticated viewer refetches their authorized DTO. Pending applicants poll only their safe preview every ten seconds and stop on errors, including 429. Existing membership checks, reconnect reauthentication, unauthorized-socket rejection and eviction remain.

## Problem selection and test privacy

Participant hosts must use RANDOM_DISTRIBUTION; sending exact IDs is rejected. External hosts may choose random or MANUAL_SELECTION. Random configuration supplies exactly one easy/medium/hard difficulty per question. The server checks the eligible catalogue (existing problems with judge test cases and compatible C++ generation), verifies count and per-difficulty availability, shuffles with Node's cryptographic `randomInt`, then selects without replacement. Manual mode validates exact count, unique IDs and judge eligibility. Errors explain shortages; the form also prevents known invalid difficulty/count combinations using server availability.

The exact ordered IDs are stored at create/configuration time, never rerolled by refresh, reconnect or start. Explicitly saving problem configuration can redraw random questions and resets both confirmations; duration-only API changes preserve the list. Random problem IDs/titles are hidden from everyone, including either kind of host, before start. An external manual host can see their own selected titles. Problem access and submission endpoints enforce the frozen selected list and lifecycle.

The workspace uses only source-free submission summaries and progress. Own detailed submission recovery remains account-authorized. A room Run request uses public tests only; if none exist it returns 409 and directs the competitor to Submit. This avoids the older Run fallback exposing private tests. For room judge failures on hidden tests, failed-case payloads omit inputs/expected/actual outputs and stored failure messages omit hidden-test output. Compile diagnostics remain available; hidden runtime output is withheld. Legacy judge behaviour was preserved.

## Original 429 diagnosis and development policy

The reported 15-minute message matches the old `authLimiter` in `backend/src/middlewares/rateLimiter.middleware.js`. `backend/src/routes/auth.routes.js` attaches that **same limiter instance** to `POST /api/v1/auth/register` and `POST /api/v1/auth/login`: **10 requests per IP per 15 minutes**, counting successful and failed requests. Different accounts on one computer share that production quota. Registration plus login for several test accounts exhausts it; format 3v3 itself is not the cause.

The historical browser request trace was not supplied, so it is not possible to distinguish whether the user's particular blocked request was login or registration. The source uniquely identifies the shared authentication limiter and its two endpoints. An executed HTTP test reproduced the eleventh-attempt 429 after mixing successful/failed requests across login/register, including different email accounts on the same IP.

Audit: there is no global API limiter in this checkout. Room mutations previously shared 60/minute/IP. Run and Submit shared 5/minute/IP. These production quotas, windows, keys and counting behaviour remain unchanged. The response bodies now identify the operation and retry delay, and include `Retry-After`. Ordinary room writes are never automatically retried. Socket reconnect refetches authorized GET state and does not recreate/join a competitor or retry readiness/start. Submission recovery retains its durable UUID and bounded network-error recovery; a 429 now persists a cooldown and stops automatic retries, surviving refresh without creating a new request.

Development overrides activate **only when both server settings are present**:

```dotenv
NODE_ENV=development
CODEFORGE_DEV_RATE_LIMITS=true
# Optional; defaults shown:
DEV_AUTH_MAX=120
DEV_AUTH_WINDOW_MS=60000
DEV_ROOM_MAX=300
DEV_ROOM_WINDOW_MS=60000
DEV_SUBMISSION_MAX=30
DEV_SUBMISSION_WINDOW_MS=60000
```

Add these lines to the existing ignored `backend/.env` without replacing MONGO_URI, REDIS_URL, JWT_SECRET or other existing settings, then restart the backend. This task did not edit your `.env` or secrets. Alternatively set those variables in the terminal launching the backend. `NODE_ENV=development` alone does not relax limits.

Development keys: authentication uses normalized email + normalized IP; an additional IP burst ceiling is `max(600, 8 × DEV_AUTH_MAX)` per auth window (960 by default). Room mutations use authenticated user ID + operation, so creation, joining, lead assignment, approvals, readiness etc. each have independent finite quotas. Run/Submit retain a shared per-user submission quota. Integers must be 1–3,600,000; invalid opt-in booleans/numbers fail at startup. Production ignores all development settings, even malformed development numbers. No client flag, reset endpoint or limit-disable switch was added.

Inspect with authenticated `GET /api/v1/battles/rooms/limits` in browser developer tools. `data.rateLimits.development` must be true for local relaxed testing. Existing production deployments need no environment change.

## UI review

Screenshots use deterministic Playwright fixtures (not production accounts or data) and were inspected after capture:

- `docs/screenshots/battle-lobby.png`: dropdown format selection replaced with four tiles; random per-question difficulties, external manual selector, admission defaults, room preview/request status and compact recent rows.
- `docs/screenshots/battle-waiting.png`: balanced indigo/orange team sections, actual occupancy plus optional slots, host/lead labels, presence/personal readiness, lead assignment, per-team admission, pending decisions, separate confirmations and exact Start blockers. Host configuration is collapsible.
- `docs/screenshots/battle-active.png`: vertically stacked page replaced with independently scrolling sidebar, statement/examples/constraints and private editor/results/history. Timer, connection, identity and deferred score areas stay above the workspace. Smaller screens expose Overview / Problem / Editor tabs. Desktop panels are fixed proportions rather than draggable.

New room drafts still use user + room ID + server-derived team ID + problem + C++ language identities. Existing IndexedDB restoration, autosave, pre-submit flush, native single-tab ownership, durable submission intent, session recovery and socket singleton are reused. External hosts do not acquire competitor draft ownership or get editor/submit controls. Existing focus/visibility flush and single-tab restrictions remain; this checkout did not contain a separate anti-cheating penalty engine, and none was invented here.

## Executed validation

| Command (working directory) | Actual result |
|---|---|
| `npm test` (`frontend`) | 5/5 storage/intent unit tests passed |
| `npm run test:browser` (`frontend`) | 39/39 Playwright tests passed: 21 battle + 18 existing resilience |
| `npx playwright test tests/browser/battleRooms.spec.js` (`frontend`, focused UI rerun) | 20/20 passed; screenshots regenerated |
| `node --test tests/rateLimits.test.cjs` (`backend`) | 4/4 passed, including production override isolation and 11th-attempt 429 reproduction |
| `powershell -NoProfile -ExecutionPolicy Bypass -File backend/tests/run-integration.ps1` (repository root) | 28/28 Node test entries passed: 27 scenarios plus parent; actual MongoDB/Redis, authenticated HTTP/sockets and Docker C++ execution |
| `npm run build` (`frontend`) | Passed; 520.33 kB JS entry, existing >500 kB chunk warning |
| Targeted `frontend/node_modules/.bin/oxlint` on all changed JS/JSX/CJS | Exit 0; one pre-existing unused `submissionQueue` import warning in submission controller |
| `npm run lint` (`frontend`) | Existing unrelated conditional hook error remains in `src/pages/EditProblem.jsx:121`; other pre-existing warnings. Not reported as passing |
| `git diff --check` | Passed |

Integration covers full rosters in every format, one competitor per team in every format, missing team/lead/confirmation rejection, role spoofing, external host restrictions, capacity, lead departure/reassignment, switch/join/unready/configuration invalidation, own-team admission permissions, request rejection/history/privacy, direct final-slot race, duplicate cross-team requests, concurrent host/lead decisions, full-team approval rejection, join-vs-confirm, unready-vs-start, configure-vs-confirm, concurrent configure, concurrent starts, late approval rejection/expiry, distinct mixed-difficulty random selection, shortages/invalid IDs/manual duplicates, pre-start secrecy, stable questions, deadline expiry, source privacy, hidden-test privacy, public Run, idempotent Docker submissions, queue outage recovery and legacy 1v1 sockets. Development HTTP test repeatedly creates all four formats and joins/readies multiple separately signed accounts on the same IP. Rate tests use isolated real local HTTP servers; UI tests mock API/sockets while backend tests exercise their real implementations.

Browser coverage includes format tiles, external manual selection, difficulty/count validation, approval waiting/admission, policy/lead controls, partial-team start, external monitoring, active/completed states, 429 no-retry behaviour, persisted submission cooldown and editable local drafts during temporary session loss. Layout checks execute at 390, 768, 1024 and 1440 pixels. Earlier failures during development were fixed before these final results: a Run test initially used the seed problem rather than the room's randomly selected problem; it now checks the correct stored question. An encoding/line-ending issue in the edited room page was also corrected before final build/lint/UI checks.

## Testing all formats alone

1. Keep your existing databases and Docker C++ runner. Start backend with the opt-in development variables above and the current `.env`; start frontend with `npm run dev` from `frontend`. Open the local URL printed by Vite, then Battle.
2. Create up to eight test accounts in **separate authenticated browser contexts**: separate Edge profiles, separate browser applications/profiles, or Playwright `browser.newContext()`. Tabs in one normal profile share login storage. Several InPrivate windows of the same browser can also share a private session; do not assume each is a different account. Never copy someone else's real token.
3. As a participant host, choose 1v1/2v2/3v3/4v4, an eligible difficulty distribution and Alpha. Copy the code. The host already occupies Alpha's first slot. For full teams use 2/4/6/8 competitor accounts total, filling each team to its selected maximum. An external host uses a separate ninth account for a full 4v4 room, or watches smaller rosters without competing.
4. In each other context, preview the code and choose Alpha/Beta. For approval testing set Beta to Approval required, request admission and verify the applicant cannot open the private room until the host or Beta lead approves. Initially the host can approve the first Beta member and assign that member as lead.
5. Host assigns a lead from each team's own members. Every competitor clicks Mark ready in their own context. Each lead separately clicks Confirm Team Ready. The host starts. To test partially filled teams, repeat a 4v4 with only the host on Alpha and one account on Beta: both ready/confirmed teams can start despite six open optional slots.
6. Before start, add a member, switch teams, change a lead/policy, become unready or save configuration. Verify the affected Team Ready indicators reset and the displayed Start reasons match. Leave as a non-host lead and verify reassignment is necessary.
7. During battle, type distinct code in each account, wait for Saved locally, disconnect/reconnect and refresh. Verify account/team/problem drafts remain separate and the same deadline remains. A second editor tab for the same account/room/team must remain locked by existing single-tab ownership. Other users' code must not appear in activity or host monitoring.
8. Run public examples, Submit and recover status. Wait for expiry (use a one-minute room for a quick completion check). Verify completion prevents new submissions and shows history without fabricated score/winner. Existing test scripts are preferable to changing your stored database clock/deadline by hand.

## Remaining limits and deployment considerations

- C++ only, per-user private drafts, no collaborative editing, Monaco, Yjs, scoring, public matchmaking, host transfer, pause/resume or new spectator roles. These were explicitly excluded. There are no draggable split panels.
- Random availability is read from the live eligible catalogue; adding real judge-backed problems is necessary when a requested difficulty is unavailable. Saving problem configuration intentionally redraws random questions; refresh/start never does.
- Admission request history is bounded, recent room list is 20 and source-free recent submission activity/history is 100 entries; aggregate solved progress uses all room submissions. No new paginated room-history API was introduced.
- Limits use the existing process-local memory store; they are not a distributed quota service and restart with the server. Socket presence/expiry remain the existing single-server foundation. Multi-instance deployment needs a separately reviewed shared limiter/socket adapter and timer coordination design.
- Apply backend and frontend together when later approved. Allow creation of the one additive room admission index (or build it through the normal production index rollout if autoIndex is disabled). No database or volume reset is necessary. Back up through your normal process; do not run migrations that replace data. Restart backend to load the selected rate-limit environment.
- No deployment/migration was performed. Do not enable development rate policies on public development instances without understanding their higher finite quotas. In production `NODE_ENV=production` prevents activation even if the opt-in flag is accidentally set.

## Exact changed files

Backend:

1. `backend/src/controllers/submission.controller.js`
2. `backend/src/middlewares/rateLimiter.middleware.js`
3. `backend/src/middlewares/rateLimitPolicy.js` (new)
4. `backend/src/models/BattleRoom.js`
5. `backend/src/routes/battleRoom.routes.js`
6. `backend/src/services/battleRoom.service.js`
7. `backend/src/services/roomProblemSelection.js` (new)
8. `backend/src/services/judge.service.js`
9. `backend/tests/battleRooms.scenarios.cjs`
10. `backend/tests/battleExperience.scenarios.cjs` (new)
11. `backend/tests/rateLimits.test.cjs` (new)
12. `backend/tests/resilience.integration.cjs`

Frontend:

13. `frontend/src/components/Navbar.jsx`
14. `frontend/src/components/RoomConfiguration.jsx`
15. `frontend/src/components/RoomCodeEditor.jsx`
16. `frontend/src/hooks/useSubmissionRecovery.js`
17. `frontend/src/pages/BattleRoom.jsx`
18. `frontend/src/pages/BattleRoomsLobby.jsx`
19. `frontend/src/pages/BattleRooms.css`
20. `frontend/src/services/battleRoomService.js`
21. `frontend/src/services/submissionRecovery.js`
22. `frontend/tests/browser/battleRooms.spec.js`

Documentation / screenshots:

23. `docs/BATTLE-EXPERIENCE-REPORT.md` (new)
24. `docs/screenshots/battle-lobby.png` (new)
25. `docs/screenshots/battle-waiting.png` (new)
26. `docs/screenshots/battle-active.png` (new)
