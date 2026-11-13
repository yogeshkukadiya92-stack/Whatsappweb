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

## Production rollout outcome

Combined release `0e18395ef0da639346e19d54a8c05a6d3f3895a7` deployed on 2026-11-13. Coolify deployment `mmwugmc6dk3ayftodcxbfgzb` completed its rolling update at 07:33:37 UTC. Public readiness returns HTTP 200 with both databases up; the public frontend serves `/assets/index-XS67D7XX.js`. Authenticated Reports loads sessions and the new schedule summary (HTTP 200, 569 bytes, five pending, three previews, no details). Chart assets load only after scrolling toward analytics.

Shared-host CPU contention delayed the initial build and startup. This application's HTTP readiness override now checks `/api/health/ready` on port 2785, with 180-second start period, 30-second interval, 10-second timeout, and ten retries. Health checking remains enabled. No Docker daemon restart, server reboot, unrelated application restart, or global server configuration change was performed. Some live requests returned transient 502 responses under host load; no controlled before/after speed measurement is claimed.

Final live analytics check: scrolling triggered the deferred chart assets (HTTP 200) and the 24-hour message stats request, but the UI eventually displayed “Couldn't load message analytics.” Sessions and schedule summary remained available. This is an unresolved live limitation; the release must not be described as fully healthy or as a verified speed improvement.

## Remaining-check follow-up

A fresh authenticated Reports load renders message analytics again. The earlier chart failure was transient during shared-host pressure; no dialect/schema error was observed. The current overview request returned 200 in approximately 7.6 seconds, so this is recovery verification, not a speed claim. Added an explicit Retry action for chart errors without automatic retry/polling load.

Fixed strict boolean conversion for cloud-menu enabled and lead-flow native buttons. Updated stale plugin/integration fixtures to enforce the existing single-account activation policy rather than re-enable wildcard access. Updated authentication fixtures with account provisioning and active trial dependencies; retained feature, permission, mapping, and rollback assertions. Corrected schema naming documentation for scheduled_messages.

Portable export is a subset, not a complete database backup. AI, lead-flow, Cloud API, Studio, and schedule tables are explicitly excluded with reasons (credentials, dependent execution state, or replayable jobs). Excluded tables are listed in skippedTables. Portable replacement refuses to proceed when any excluded table contains data, inside the restore transaction, preventing silent cascade loss. Use native database backup/restore for these features.

The follow-up clears the original 35 backend failures: a complete backend run passed 6,552 tests (13 existing skips). Expanded documentation checks exposed six additional issues, addressed by documenting 73 existing app/CSV operations, marking the implemented poll-vote listener, declaring the document-extraction path parameter and nullable authorization scope, and reconciling migration metadata.

Migration audit found no missing data columns or nullability mismatches. Lead-entry and Studio-job metadata incorrectly described standalone indices where the migration already provides the intended compound indices; declarations now match those existing query shapes. One genuinely missing AI agent lookup index is added by migration 1794569400000 (CREATE INDEX only, reversible/idempotent). No table rebuild or data rewrite is introduced. A new chain test independently checks every data table, column, nullability, and index shape before the verbatim SQLite cosmetic-drift snapshot is compared. The snapshot was reconciled with the existing later automation/owner migrations; it still pins the date-affinity/index-name differences rather than running destructive cosmetic rebuilds.

Final follow-up validation: backend 6,552 passed, 13 existing skips; documentation 277 passed; full dashboard 437 passed with no skips. The restore preflight refinement additionally passes all 76 import/export tests. API/dashboard builds, dashboard type checking, OpenAPI consistency, and 333 SDK wire-shape comparisons pass. Fixed the billing poll cleanup to clear the same window timer API that created it; component tests now use JSDOM Event constructors and browser scroll/canvas stubs. No production authentication logic was changed by the test harness repair.
