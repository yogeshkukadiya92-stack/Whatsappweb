# Dashboard performance changes — 13 November 2026

This document records release preparation and verification. The rollout result is recorded in Coolify; these changes require no infrastructure update or data migration.

## Changes in this release

- Load the analytics component and its data only when its section comes within 200px of the viewport. Keep it mounted after first use.
- Remove continuous dashboard decoration animations, backdrop blurs, and mouse-follow card tilting. Disable chart entrance animation and respect reduced-motion preferences.
- Use React Query for schedule request coalescing and a 30-second freshness window. Ignore unrelated storage events; invalidate the schedule summary when schedules change.
- Replace the dashboard's full scheduled-message history download with `GET /api/scheduled-messages/summary`: an exact pending count and the next three previews. Select only preview columns in SQL; do not hydrate media/details JSON. Empty queues skip the preview query.
- Apply the existing schedule-list access rules to both summary queries. Only an unrestricted administrator receives global results. Other callers receive only their allowed sessions; an empty customer scope returns zero without querying the database.
- Skip administrator-only global analytics requests for operators, viewers, and session-restricted administrators. Server-side authorization remains authoritative.
- Remove one unused test import that prevented the dashboard test type check from passing.

## Evidence and checks

The SQLite integration fixture contains 20 messages with 100,000-character media payloads each, split between two sessions. For the selected session, the old list hydrates ten full records; the summary counts nine pending messages and hydrates three previews. The test verifies that serialized summary size is less than 1% of the old response, with no details/recurrence fields. This is a synthetic transfer-size result, not a production loading-time measurement.

SQLite `EXPLAIN QUERY PLAN` confirms the preview query uses the existing `IDX_scheduled_messages_status_scheduled_at` index. No new index or migration is required. Scoped counts, empty/foreign scopes, oldest-first preview ordering, and role-to-scope mapping are covered by integration/unit tests.

Passed:

- 88 backend tests across billing, authorization coverage, scheduled-message service/controller, and stats service.
- 46 frontend tests across Dashboard, Sessions, EasyWorkspace, page CSS scoping, and favorites storage.
- Backend and dashboard production builds.
- Dashboard test type check and lint for the changed dashboard components/hook/tests.
- SDK route existence check and regenerated OpenAPI snapshot consistency check.

The generated OpenAPI snapshot includes the new summary DTOs/route and synchronizes previously undocumented existing billing routes and AI-agent path parameters.

## Billing and SDK follow-up

- Setup-call requests remain bound to the caller's linked account; administrator-only list/completion routes retain both role and unrestricted-key gates. Tests cover cross-account input and unlinked keys.
- The query-scope checker now reads the TypeScript syntax tree, including inline decorated methods and nested parameter types; comment text cannot impersonate an injected API key.
- Documented SDK exclusions now name application billing and automation/callback resources explicitly in both SDK design documents. Core SDK coverage remains enforced; regression fixtures prove an undocumented exclusion or missing supported HTTP verb still fails.
- All five SDKs now implement both group CSV exports and the emergency session stop command, preserving UTF-8 text and cancellation counts.
- SDK session metadata/config types and explicit bulk opt-in fields now match the API. No SDK automatically supplies recipient consent. The dashboard config type matches the actual response as well.
- SDK route coverage, documentation, webhook events, version consistency, and all 333 checked wire-shape pairs pass. JavaScript (91 tests), Python (85 tests plus mypy), Java, Go race/vet, and PHP SDK tests pass.

## Broader baseline findings

The full backend run reports 6,512 passed tests and 35 failing tests in 12 unrelated suites (plugin loading, existing auth fixtures, strict coercion, export/schema parity, and signup feature fixtures). Running those same 12 suites in a separate worktree at the currently deployed production commit `6d97a54` reproduces exactly the same 35 failures and 237 passes. These are pre-existing, not introduced by this release.

Full repository lint and full-program test-fixture type checking also report legacy failures outside the billing/SDK fixes. Production API/dashboard builds, dashboard type checking, and the focused performance/billing/access/SDK checks pass. This is a scoped release verification, not a claim that the entire historical repository is green.

## Combined deployment

1. Compare known broader failures with the production baseline and keep unrelated local infrastructure changes out of this release.
2. Build and deploy the API and dashboard from the same revision. The new dashboard needs the summary endpoint; do not publish the frontend ahead of the API. The old dashboard remains compatible with the new API.
3. No database migration, new environment variable, additional server, or cache service is needed for these changes.
4. After deployment, check readiness, dashboard sessions, pending count and next three previews, schedule mutation refresh, role/session visibility, and analytics loading on scroll. Measure authenticated cold/warm loading time and request sizes against the prior release under comparable conditions.
5. Roll back to the previous application image/build if needed. This change has no data migration to reverse.
