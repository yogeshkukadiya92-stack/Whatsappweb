# Automation Studio — Phase 2

Phase 2 extends the Phase 1 builder; it is not full n8n/Pabbly/Make parity. Website extraction, AI workflow generation, credential vault/OAuth, app-specific connections and MCP actions remain later phases.

## Builder

- **Router:** up to eight ordered conditions; only the first matching path executes. Choose a later step or Finish for every path and fallback. At each branch's last step, set **Then go to** to a common continuation or Finish so other branches are skipped. This is conditional routing, not parallel fan-out.
- **Delay:** 1 second–7 days, persisted without blocking a worker. Tests simulate waits.
- **Iterator:** a JSON array or mapped array, at most 100 items. Adding an iterator also adds its aggregator. Move processing steps between them; use `{{item.field}}` and zero-based `{{index}}`. Nested loops are supported, with distinct aggregator endpoints.
- **Aggregator:** collect a templated text value for each item, combine as text or an array of strings, then reference its output after the loop.
- **Retries:** HTTP steps only, up to three retries with exponential backoff (initial 1–60 seconds, capped at 60 seconds). POST retries can repeat external writes; use a provider's idempotency mechanism where available. WhatsApp sends are not automatically retried.
- **Error handling:** stop, continue or route to a later handler; use `{{error}}` there. Missing downstream variables still require an explicit fallback. Operation/data limits and uncertain recovered sends cannot be bypassed by error policies.

Routes must point forward. Steps cannot jump into an iterator body or escape its aggregator. Reordering/removing a referenced step may require updating routes before saving. Limits: 20 configured steps, three configured API steps, 500 executed operations, 100 replies, 8000 characters per reply, 512 KB working values and 100 pending runs per session. API requests retain the existing public-HTTPS SSRF protection, 10-second timeout and 256 KB response limit.

## Triggers

**WhatsApp:** existing keyword/audience/cooldown behavior. Matching messages now enqueue a durable job instead of executing inline. Cooldown state is process-local.

**Recurring schedule:** specify destination chat ID and interval of 1–43200 minutes. Optional first-run timestamp is UTC/ISO; the builder displays the next time in the browser's local timezone. Publishing activates it; pausing cancels pending runs. Missed ticks coalesce into one run, with the next interval measured from recovery. Calendar cron rules, timezone calendars and catch-up of every missed interval are not implemented.

**Webhook:** specify a fixed, consenting WhatsApp recipient, save and generate a token, then publish. POST JSON to the displayed URL with `X-Workflow-Token`. The payload is available under `{{webhook.field}}`; it cannot override the recipient. Token rotation revokes earlier tokens. Only a SHA-256 hash is stored; the plaintext token is returned once through an operator/admin, session-scoped endpoint. Limit: 64 KB UTF-8 payload and 60 requests/minute/workflow/process, in addition to the existing global HTTP throttle and pending-run capacity. Store tokens outside workflow configuration and never put them in URLs. Rotation does not cancel already accepted jobs.

## Durable execution and history

`studio_jobs` stores a snapshot, working values, loop state, attempts, cursor and due timestamp. A lightweight database worker polls each second and handles up to five jobs per tick, one operation per job. Claims use conditional updates and 120-second leases. Workers send only jobs belonging to their node's sessions (or unassigned sessions). No new Redis requirement is introduced. PostgreSQL per-session locking serializes capacity checks; PostgreSQL behavior still needs deployment smoke testing.

Restarting resumes queued/waiting work and reclaims expired leases. Before a WhatsApp send, an “external action in progress” checkpoint is saved. If recovery finds that marker, the run fails with uncertain delivery rather than automatically replaying the message. This is **not an exactly-once guarantee**: external API calls can be repeated after a crash, and transport acknowledgement may be ambiguous. Do not blindly replay a failed financial or messaging action.

Executions refresh every three seconds while the tab is visible and include queued/waiting status, next checkpoint, retry traces and Cancel run. Pausing/deleting cancels outstanding runs. Cancellation cannot recall an already in-flight external request/message. Terminal jobs clear the definition and working state; latest 50 logs are shown and terminal retention is bounded to 200/session with incremental pruning. Live API responses and reply bodies are omitted from traces; test previews are retained. Avoid storing secrets or unnecessary personal data in pending working values.

## Added endpoints

Protected operator/admin endpoints, scoped to the session:

- `POST /api/sessions/:sessionId/studio-workflows/:id/webhook-token`
- `POST /api/sessions/:sessionId/studio-workflows/executions/:executionId/cancel`
- Existing `/test` accepts an optional JSON-object `webhook` sample.

Public but token-authenticated endpoint:

- `POST /api/studio-hooks/:id` → 202 with queued execution ID. Delivery occurs asynchronously; 202 does not mean WhatsApp delivery succeeded.

## Validation and deployment gates

New tests exercise conditional branches/fallback, empty and nested lists, graph rejection, checkpointed backoff, handled errors, hard limits, uncertain send recovery, nested DTO validation, SQLite migration upgrade/revert, delay recovery through a fresh worker, competing claims, schedules, token rotation/recipient isolation and cancellation. Browser QA uses a real isolated SQLite service, preview-only transport and local Chrome; it does not deliver a production WhatsApp message.

Migration `1786900000000-AddStudioDurableJobs` upgrades existing Studio tables on SQLite/PostgreSQL. Both new Studio migrations pass isolated SQLite upgrade/idempotence/revert tests. The repository-wide migration-chain gate currently fails earlier at the existing `AddLeadFlowCompletionMedia1786200000000` migration (`lead_flows` absent); its main-database drift snapshot also lacks the existing `users` schema. The global route-fence gate flags existing `user-auth.controller.ts :: getProfile`. These pre-existing deployment/security gates were not changed or waived. Resolve them before a fresh production deployment. No production deployment or PostgreSQL smoke test was performed in this phase.
