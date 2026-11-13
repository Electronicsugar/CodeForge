# Battle readiness and admission notifications

Completed 13 November 2026 on `feature/collaboration-profiles`. Existing uncommitted work remains alongside these targeted changes. Nothing was committed, merged, pushed or deployed.

## Root causes

The old server `startReasons()` rejected any team containing a personally unready member. The `team-ready` mutation separately refused a lead's confirmation until every member was personally ready. The frontend also disabled Confirm Team Ready under that same all-members condition and instructed leads to mark everyone ready first. These combined gates prevented the confirmation state from being reached and blocked Start. The button itself is intentionally shown only to the assigned lead; hosts do not automatically become leads.

Capacity was already treated as a maximum in the current server. The defect was the obsolete personal-readiness prerequisite, not a requirement to fill all slots. Existing HTTP DTOs, revision guards, Socket.IO notifications and refetches already carried `teamReady` correctly.

Admission requests already reached authorized clients through `battle_room_updated` followed by a permission-filtered room refetch. They were rendered as ordinary inline roster text, without a dedicated notification or request-specific progress/error/success state.

## Corrected rules

Start now requires at least one admitted competitor on each team, a valid member assigned as each team's lead, both independent Team Ready confirmations and valid problem configuration. Full teams and personal Ready flags are not required. Additional personally unready members do not block start. Personal flags/API/UI remain available as optional signals; changing them does not clear the lead's independent confirmation.

Only that team's lead can confirm or withdraw Team Ready. A host who is not that lead cannot impersonate the confirmation. Joining/admission, leaving, switching teams, lead changes, team policy changes, configuration changes, explicit withdrawal and explicit host reset retain their applicable invalidation rules. Reads, polling and rerenders do not mutate readiness. The host's Start button uses the server's `canStart` and exact `startReasons`.

## Notification experience

An accessible, bounded-height notification stack appears near the top of the waiting room. Cards display applicant name, target team, room code, pending/processing/approved/rejected status and descriptive Approve/Reject controls. The count is derived from current server-pending requests. The host and relevant lead are eligible; unrelated leads and ordinary members are filtered out defensively in the component as well as by the existing backend DTO permissions.

Actions use the existing admission API. A synchronous guard prevents duplicate submissions; controls disable while processing. Failures remain on the affected card and allow retry. A 409 triggers a room refresh so another actor's decision is reflected. Successful decisions retain a dismissible confirmation while the pending count updates. Pending cards are keyed/deduplicated by request ID, and reconnect/refetch does not manufacture extra cards. Decisions received from another actor remove the pending card. Existing applicant-side status polling remains unchanged.

Cards have keyboard focus styles, labelled buttons, a polite live region, explicit text statuses, responsive layout, bounded scrolling and reduced-motion-aware transitions. No browser alert/confirm, additional socket connection or admission system was introduced.

## Files changed

- `backend/src/services/battleRoom.service.js`
- `backend/tests/battleExperience.scenarios.cjs`
- `frontend/src/pages/BattleRoom.jsx`
- `frontend/src/pages/BattleRooms.css`
- `frontend/src/components/AdmissionNotifications.jsx` (new)
- `frontend/tests/browser/battleRooms.spec.js`
- `docs/READINESS-ADMISSION-FIX-REPORT.md` (new)

UI regression fixtures also regenerate the existing collaboration/profile test screenshots. Their implementation was not changed. No model migration, `.env` replacement, application database reset or existing-container operation was performed. Backend tests created/removed only their own disposable test fixtures.

## Actual verification

| Check | Result |
|---|---|
| Backend integration runner, final run | 45/45 Node test entries passed (44 scenarios plus parent), including admission races, lead-only readiness, actual Docker judging, collaboration persistence/snapshots, profile privacy and legacy 1v1 |
| Full Playwright regression run | 51/51 passed, including existing collaboration, profile and draft-recovery tests |
| Final focused battle-room Playwright run | 23/23 passed, including two added notification tests; this is separate from the earlier 51-test run |
| Frontend production build | Passed; existing large-chunk warnings remain |
| Targeted oxlint | Passed |
| `git diff --check` | Passed |

Commands: `powershell -NoProfile -ExecutionPolicy Bypass -File backend/tests/run-integration.ps1` from root; `npm run test:browser`, `npx playwright test tests/browser/battleRooms.spec.js`, and `npm run build` from frontend. Targeted lint covered the changed service, component, page and tests. One attempted overlapping browser run found the local test port busy; it was rerun successfully after the full suite finished. The previously documented unrelated full-project lint error in `EditProblem.jsx` was not changed or claimed fixed.

Focused coverage includes one lead alone per team for all formats, 4v4 with optional empty slots, additional personally unready members, missing confirmation, opposite-team confirmation denial, host impersonation denial, membership/lead invalidation, personal-unready/start concurrency, notification deduplication, unauthorized-request hiding, another actor's decision after refetch, processing state, retryable error, success count and dismissal. Collaboration, behavioural analytics, authoritative submissions, recovery and team isolation remain intact, with their regressions passing. No unrelated functionality was added.
