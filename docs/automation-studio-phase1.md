# Automation Studio — Phase 1

Historical Phase 1 behavior is described below. For the current durable runner, branching, schedules and webhooks, see [Phase 2](automation-studio-phase2.md); its execution limits supersede the original 30-second deadline.

Open **Automation Studio** in the sidebar (`/automation-studio`) and select a WhatsApp session. Operator and admin keys can manage workflows through session-scoped endpoints.

## Build and publish

1. Name the workflow and configure its trigger keywords, audience and cooldown.
2. Click a step in the library or drag it onto the canvas. Move steps with the up/down controls.
3. Select a step to edit its settings. Use `{{message}}`, `{{chatId}}`, `{{now}}` and earlier output variables in subsequent steps.
4. Save & test to run the saved steps. API requests are real; WhatsApp replies are previewed without sending.
5. Publish to enable incoming-message execution. Pause to stop new executions.

Steps run sequentially. The first published workflow matching the message owns it, in creation order, before existing chatbot and lead-flow routing. A failed filter stops that workflow; an execution error also stops it. Cooldowns prevent repeated executions for the same workflow/chat within a process. They are not shared across replicas.

## Available steps

- **Set variable:** a named text value, optionally interpolated from earlier data.
- **Filter:** contains, equals, does not equal, not empty or greater than.
- **API request:** public HTTPS GET/POST endpoint; store its JSON or text response under an output name. Use `{{api.customer.name}}` to read nested JSON fields. POST bodies support interpolation.
- **WhatsApp reply:** a text message rendered from earlier variables. Missing variables stop execution instead of exposing placeholders.

API requests use the existing SSRF guard with pinned DNS resolution. Redirects are refused. Limits: 32 workflows/session, 20 steps/workflow, 3 API steps, 10-second request timeout, 256 KB response, 30-second workflow deadline before each step, 8000-character reply and minimum 10-second cooldown. Send pacing remains controlled by the ordinary WhatsApp send service.

## History

The Executions tab shows the most recent 50 runs, including status, step trace, duration and test/live mode. Up to 200 executions are retained per session with bounded pruning. API response bodies and live reply bodies are not recorded in traces. Test previews are retained deliberately. Test mode bypasses trigger matching to exercise the configured steps.

## API

All endpoints require operator/admin access and enforce the selected session's existing API-key scope.

- `GET /api/sessions/:sessionId/studio-workflows`
- `POST /api/sessions/:sessionId/studio-workflows`
- `PUT /api/sessions/:sessionId/studio-workflows/:id`
- `DELETE /api/sessions/:sessionId/studio-workflows/:id`
- `POST /api/sessions/:sessionId/studio-workflows/:id/test` with `{ "message": "hello" }`
- `GET /api/sessions/:sessionId/studio-workflows/executions`

Migration `1786800000000-AddAutomationStudio` creates workflow and execution tables on SQLite/PostgreSQL. Existing boot migration behavior applies when synchronization is disabled.

## Subsequent phases

Phase 1 supports linear workflows and public APIs. Branching, schedules, iterators, aggregators, credential vault/OAuth, website extraction, AI agents, MCP and shared worker execution remain in the approved later phases. Do not put API credentials in endpoint URLs or workflow variables; the later connection vault will handle secrets separately.

Validation includes runner tests and a SQLite migration test, alongside the existing automation-routing suite. Browser QA exercises real SQLite persistence, step reordering, variable mapping, publish/pause state, test previews, a public API call, execution history and desktop/mobile rendering. WhatsApp transport was validated through the existing send callback boundary, not by delivering a production message.
