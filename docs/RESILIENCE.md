# Reliability and draft recovery

Implemented on `feature/codeforge-resilience`, starting from `3707d80cca6fc6435409c71c5ef0048c1a205e45`. The original text-area editors and Docker C++ executor remain in place. This work has not been deployed to the public demo.

## Behaviour

- Drafts are stored in native IndexedDB after 750 ms of typing inactivity. “Saved locally” means the transaction completed, not merely that a request was issued.
- Identity is `[userId, context, problemId, language, battleId]`. Contest context includes the contest ID. Draft records contain schema version 1, source, revision, timestamp and tab writer ID.
- Initial local recovery completes before autosave is enabled. Late starter-code responses never replace current edits or restored code. Empty code is a valid draft.
- Each save compares and increments the revision atomically. BroadcastChannel, or storage-event notifications with focus rechecks, warns other tabs. A losing tab retains its text until the user explicitly loads the saved version or keeps its version. Download is available before replacement. There is no elaborate version history.
- Storage failures and quota exhaustion leave the editor usable and offer download. A failed initial read blocks writes to avoid accidentally replacing an unread draft.
- Drafts survive normal logout and browser restart. Logout clears account/socket state; another account does not query those drafts. Browser storage is not encrypted against someone controlling the browser profile.
- Browser connectivity, backend health and socket state are monitored separately. The indicator displays Online, Offline, Reconnecting or Server unavailable. Health checks have a five-second timeout, bounded backoff, no overlap and a 30-second healthy interval.
- Session-verification failures caused by outages preserve the token and local drafts. 401 expires the session; 403 does not sign out. Mutating protected HTTP requests and new sockets require verified authentication. Redis blacklist-verification outages return 503 instead of falsely invalidating credentials.
- One Socket.IO instance is reused. Reconnection rejoins/refetches the active battle; obsolete fetches and other-battle events are ignored. Recovery does not set editor source. Battle submissions use the existing authenticated REST creation endpoint with the same battle context; socket result notifications are preserved.

## Submission safety

Before sending, the browser atomically persists an immutable submission intent and UUID. Submission also flushes the current local draft. An unresolved intent cannot be silently replaced with different source. Recovery reuses its original key, payload and submission ID; final results can be restored after refresh. Stale intent updates cannot overwrite a newer intent.

`POST /api/v1/submissions` accepts `Idempotency-Key` (the body field remains supported for socket/legacy integration). A partial unique MongoDB index covers `(user, operation, idempotencyKey)`. Repeated identical payloads return the original ID; changed payloads return 409. Existing response fields and IDs remain; `enqueueState` and `enqueueError` are additive. Older unkeyed callers remain compatible but do not receive duplicate-request protection. Runs and other writes are not automatically retried.

New submissions include minimal enqueue metadata: `waiting`, `queued` or `enqueue_failed`, attempts, next attempt and a safe error message. Producer waits are bounded. Jobs use `submission-<id>` as their deterministic BullMQ ID. A 15-second reconciler retries pending dispatch failures, checks missing/failed jobs, and does not rejudge final records. Automatic enqueue recovery is limited to five attempts; exhausted failures remain explicitly visible for maintainer review. Historical unfinished records without metadata are reported by the index script rather than automatically rejudged.

This is basic deduplication and queue recovery, not a transactional outbox or exactly-once distributed execution guarantee. Existing BullMQ worker retry behaviour is retained. Advanced worker fencing and battle rating settlement reconciliation are deferred.

## Setup and start

Use Node 22 or newer and a working Docker Linux engine. MongoDB and Redis must be reachable by the backend; do not expose their ports publicly. Existing backend `.env` variables remain: `MONGO_URI`, `REDIS_URL`, `JWT_SECRET`, and optionally `PORT`, `FRONTEND_URL`. No new environment variables are required.

From the repository root, using PowerShell:

```powershell
cd backend
npm ci
# Run against the intended database only during an approved rollout.
node src/scripts/prepareResilienceIndexes.js
npm start
```

In another terminal:

```powershell
cd frontend
npm ci
npm run dev
```

Frontend development defaults to backend `http://localhost:3000`. For a different deployment, set the existing Vite build variables `VITE_API_URL` (ending `/api/v1`) and `VITE_SOCKET_URL`. Reverse proxies must forward `/health`, `/api/` and `/socket.io/`. Cross-origin requests must allow `Idempotency-Key`. Configure the frontend only after backend/index support is ready.

This repository has no Compose configuration. The earlier Docker deployment is a separate copy and must be updated/rebuilt explicitly after deployment approval. No production containers or database records were changed for this implementation.

## Database rollout

The schema adds `operation`, `idempotencyKey`, `payloadHash`, `enqueueState`, `enqueueAttempts`, `nextEnqueueAt`, `enqueueError` to submissions, plus unique partial/idempotency and dispatch indexes. Existing source/verdict records are retained. Server startup calls `Submission.init()` before listening; use the explicit index preparation script when automatic index creation is disabled. Do not accept keyed traffic before the unique index exists.

If dispatch recovery exhausts its attempts, inspect the submission and its deterministic queue job first. Do not create a replacement submission. A maintainer can reset the original pending record's enqueue attempts/state after fixing Redis; this is an operational repair and is not performed automatically against historical data.

## Tests actually executed

- `npm run build`: passed.
- `node --test tests/draftStorage.test.js`: 5 tests passed. Identity separation, exact-source/revision persistence, concurrent writes, corruption handling, durable intents, same-key preparation and protection against stale intent updates.
- `npx playwright test`: 12 browser tests passed in Edge. Covered late initialization, language/problem/account isolation, refresh, closing and restarting the browser with a persistent profile, simulated offline editing, 503 session recovery, native/fallback multi-tab notifications, unavailable IndexedDB, quota errors, lost acknowledgements, restored verdicts, battle UI reconnect/refetch, 401/403 handling, and socket instance reuse.
- `backend/tests/run-integration.ps1`: 4 integration scenarios plus their parent passed (5 Node test entries). Real registration/login/problem reads; concurrent keyed REST submissions and changed-payload rejection; actual BullMQ + Docker C++ judging; stopping/restarting a disposable Redis container and recovering the original submission; real socket reauthentication, battle rejoin and outsider rejection. Disposable databases and containers were removed afterward.
- Changed frontend modules passed targeted oxlint with two Fast Refresh export warnings. Repository-wide `npm run lint` fails on the pre-existing conditional `useEffect` in `frontend/src/pages/EditProblem.jsx:121`; that file was not changed. Other baseline warnings remain.
- Browser offline state was simulated; physical Wi-Fi unplugging was not performed. The browser restart test did close and reopen an isolated headless Edge profile.

Tests exposed and fixed an unbounded BullMQ enqueue wait, the submit/debounce refresh gap, completed-verdict refresh recovery and stale intent replacement. No failing acceptance test remains in the final targeted suites.

### Reproduce frontend checks

```powershell
cd frontend
npm ci
npm test
npm run build
npm run test:browser
```

Browser tests use installed Microsoft Edge, mock application APIs, and a dedicated Vite server on port 5180. Battle UI tests inject controlled socket events; the backend integration suite separately verifies real Socket.IO.

### Reproduce backend integration checks

Ensure Docker is running and `codeforge-cpp-runner:1.1` exists. If necessary, build the unchanged runner:

```powershell
docker build -t codeforge-cpp-runner:1.1 backend/src/services/executor/docker
.\backend\tests\run-integration.ps1
```

The script creates only named disposable test containers, with MongoDB on localhost 17017 and Redis on localhost 16379. It refuses existing fixtures, restores prior environment variables, and removes fixtures on exit. Tests require the database name `codeforge_resilience_test` and never load the production `.env`.

## Short demonstration

1. Log in and open a problem. Type distinctive code, wait for “Saved locally”, refresh and compare it exactly.
2. Close and reopen the same browser/profile and URL. The draft returns after authentication/problem loading.
3. Open the same problem in two tabs. Save in one; the other retains its text and displays explicit conflict choices.
4. In browser developer tools, simulate offline. Continue typing and wait for a local save. Reconnect; the indicator recovers.
5. Submit, then refresh while judging. The stored submission ID/key is recovered; no new logical submission is created.

## Limits and deferrals

- Full offline shell support, service workers, offline first navigation/refresh, and cached problem metadata are explicitly deferred. Existing open editors work offline; fetching the application, session and problem after a refresh still requires connectivity. A backend outage during a fresh load may prevent the editor from opening until connectivity returns; stored drafts remain intact.
- Unsaved edits inside the 750 ms debounce interval can be lost on abrupt browser termination. Page hiding/navigation attempts a flush, and submission explicitly waits for one; operating-system crashes cannot guarantee final writes.
- IndexedDB is browser/profile/origin-specific and can be cleared or evicted. Different temporary Cloudflare URLs have different draft storage. No cross-device draft sync is included.
- Corrupt drafts require manual recovery/download and browser storage repair; the editor will not silently overwrite them.
- No full distributed outbox, leases/fencing, settlement reconciliation, collaborative editing, automatic historical rejudging or general write retries were added.
- Backend health remains a reachability/liveness check, not a comprehensive readiness dashboard. Dependency failures appear through actual API/auth errors.

## Merge after review

```powershell
git switch main
git merge --no-ff feature/codeforge-resilience
```

Do this only after reviewing the feature branch and its tests. Public deployment requires separate approval; rebuild both backend and frontend from the merged source and prepare indexes before enabling the updated frontend.

## Changed-file inventory

Created: `frontend/src/services/draftStorage.js`, `draftChannel.js`, `sessionState.js`, `submissionRecovery.js`; `frontend/src/hooks/useCodeDraft.js`, `useSubmissionRecovery.js`; `frontend/src/components/DraftStatus.jsx`; `frontend/src/context/ConnectionContext.jsx`; `frontend/playwright.config.js`; `frontend/tests/draftStorage.test.js`, `tests/browser/drafts.spec.js`, `tests/browser/harness.jsx`; `backend/src/services/submissionEnqueue.service.js`; `backend/src/scripts/prepareResilienceIndexes.js`; `backend/tests/resilience.integration.cjs`, `tests/run-integration.ps1`; this document.

Modified: `.gitignore`; `frontend/package.json`, `package-lock.json`; `frontend/src/App.jsx`; `context/AuthContext.jsx`; `services/api.js`, `socket.js`, `submissionService.js`; `pages/ProblemDetail.jsx`, `BattleArena.jsx`, `BattleLobby.jsx`; `backend/server.js`; `backend/src/models/Submission.js`; `controllers/submission.controller.js`; `middlewares/auth.middleware.js`; `services/submission.service.js`; `sockets/socket.js`, `battle.socket.js`; `workers/submission.worker.js`.

Only test dependencies were added: `fake-indexeddb` and `@playwright/test`. No runtime dependency was added.
