# CodeForge repository integration

Historical integration checkpoint at `b3da123`. See
`ROOM-LANGUAGES-AND-ENFORCEMENT-REPORT.md` for the subsequent user-requested
penalty restoration, multilingual rooms and lint fix.

## Sources and destination

- Main project: `https://github.com/Electronicsugar/CodeForge`, base `800b74d`.
- Colleague project: `https://github.com/Electronicsugar/Code_Forge`, source `494545185d6d43d44c9c620857e0031d847c2f6d`.
- Local source reference: `integration/colleague-source-20261117`.
- Combined candidate: `integration/combine-codeforge`.
- Isolated checkout: `work/integration-codeforge` in the main project.

The histories have no common Git ancestor. The colleague repository nevertheless
contains the existing battle/collaboration implementation with feature additions.
Its changes were applied as a reviewed patch on top of the main project's current
commit, preserving deployment configuration and README changes from the main repo.
Neither source repository was reset or overwritten.

## Combined functionality

1. C++, Python, JavaScript and Java judging for practice and legacy battles, plus
   language selection and language-specific starter code/drafts. Collaborative
   team rooms continue to support C++ only.
2. Additional editor interaction monitoring for legacy battles and contests.
3. Post-battle reviews and a personal coaching card. Rule-based coaching works
   without an API key; optional LLM calls were not enabled or exercised remotely.
4. A 31-problem bank and additive seed script. The seed was not run against the
   existing database; these problems are not automatically installed.

## Integration corrections

- The colleague's automatic paste/typing forfeits conflicted with the existing
  requirement for neutral analytics. The runtime service is forced to monitoring
  mode, with no automatic forfeits, rating penalties or integrity score deductions.
  Summaries use a neutral `recorded` label. Historical policy fixtures remain in
  isolated pure-policy tests; their enforcement is not enabled at runtime.
- Docker execution now invokes the Docker CLI directly on Windows, without a
  dependency on a host POSIX shell. Missing Docker/the new image fails closed.
  Explicit host execution is development-only and rejected in production.
- Paste/copy monitoring ignores unrelated controls and an unmounted editor.
  Disabled monitoring does not read paste data. Clipboard text is never persisted
  or transmitted. Listener cleanup is covered by the frontend unit tests.
- Existing room selection, Yjs collaboration, submission recovery and authentication
  source files were preserved. The existing Socket.IO server and judge pipeline
  remain in use.

## Verification on 17 November 2026

| Check | Result |
|---|---|
| Frontend unit tests | 18 passed |
| Existing Playwright browser suite | 54 passed |
| Added language-switch/draft/Run browser test | 1 passed |
| Backend policy, analytics, admission/randomness and rate-limit tests | 48 passed |
| Runner safety tests | 2 passed |
| Real Docker execution for all four languages | 33 passed; no skips |
| Problem-bank reference solutions | All 31 passed against 330 test cases; verification only |
| Existing disposable Mongo/Redis/API integration suite | 47 passed |
| Frontend production build | Passed; existing large-chunk warning |
| Targeted frontend lint | Passed |
| Full frontend lint | Existing conditional hook error at `frontend/src/pages/EditProblem.jsx:121`; unrelated warnings remain |
| `git diff --check` | Passed |

Early test attempts encountered missing worktree dependencies and restricted
localhost access. Dependencies were linked to the already-installed packages and
networked checks rerun with appropriate access. The final results above reflect
those executed reruns. A privacy test exposed Node's boolean capture-listener
cleanup behavior; explicit capture options fixed the cleanup and the tests pass.
Integration logs include intentional test Redis restarts and rejected outsider
requests; the integration suite completed successfully.

## Data and deployment status

The existing `.env`, secrets, MongoDB/Redis volumes and databases were not changed.
Only disposable test databases created by the existing integration script were
removed. The new additive Docker image `codeforge-runner:2.0` was built; the old
C++ runner image is preserved. Docker Desktop was started for testing.

This is a local review candidate. Main, GitHub, Vercel and Cloudflare deployments
were not updated as part of combining these repositories. New database indexes are
declared on BattleAnalysis (battle/user unique; user/date), CoachProfile (user
unique), and IntegrityLog (context/contextId/user unique). Existing battle/problem
documents gain optional additive fields. No data migration or reseeding was run.

## Reproduce

From the isolated checkout, install dependencies in both `backend` and `frontend`
if they are not already present. Build the runner:

```powershell
docker build -t codeforge-runner:2.0 backend/src/services/executor/docker
```

In `frontend`, run `npm test`, `npm run test:browser` and `npm run build`.
In `backend`, run:

```powershell
node --test --test-force-exit tests/antiCheat.test.cjs tests/integrityService.test.cjs tests/analysis.test.cjs tests/randomSelection.test.cjs tests/rateLimits.test.cjs tests/runnerSafety.test.cjs
$env:TEST_DOCKER='true'
node --test --test-force-exit tests/multiLanguage.test.cjs
./tests/run-integration.ps1
node src/scripts/seedProblemBank.js --verify
```

The verification command does not write to MongoDB. Seeding real data, configuring
a paid LLM provider, merging the candidate and updating deployments are separate
actions and have not been performed.

## Remaining scope and limitations

Coaching added by the colleague covers legacy individual battles and practice,
not the collaborative team-room analytics view. Its code-length/time samples are
coarse estimates, not exact keystroke measurements; the UI labels the first sync
accordingly. The existing team-room behavioural metrics remain separate.
Real external LLM requests, Git integration on Vercel, and public deployments of
this candidate were not tested or configured. The problem bank contains 31 local
problems, not a complete import of external coding platforms.
