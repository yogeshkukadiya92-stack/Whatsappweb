# Automation Studio — Phase 5: AI Workflow Builder

Phase 5 adds a natural-language, review-only workflow generator to the existing builder. No separate Phase 5 specification was present in the repository; this implements the AI-generated workflow drafts explicitly left as later work in the Phase 1–4 notes. This is not autonomous operation or full n8n/Pabbly/Make parity. OAuth, write tools and app-specific connector catalogs remain unimplemented.

## User flow

Select a session → open **Build with AI** → describe the task in Gujarati/Hindi/English → optionally select existing connections → **Generate workflow draft** → review explanation, warnings, steps and all settings → **Use reviewed draft** → edit/save/test → explicitly publish if satisfied.

Include exact public HTTPS website/API URLs in the request. Example: `https://example.com/ પરથી માહિતી લઈ info પૂછનારને ગુજરાતીમાં જવાબ આપો.` Use only publicly accessible sources; login pages, JavaScript-only content and document extraction retain Phase 3 limitations. Supplying a URL does not guarantee it is reachable or contains the requested facts.

Generation does not save a workflow, create a job/execution, call a connection/MCP tool, fetch a website, send WhatsApp messages, pause another workflow or publish anything. It does make one potentially paid request to the session AI provider. **Use reviewed draft** creates a new disabled, unsaved editor draft, never overwrites a saved workflow, and confirms before replacing unsaved editor changes. Existing published workflows continue running. **Save & test** is a separate real-read/provider action with its existing cost and privacy implications; WhatsApp sends remain preview-only during testing.

Unreviewed suggestions and prompt text are not persisted by this feature. Session/tab unmounting or reload discards them. A request already submitted may still finish and incur provider charges after leaving the page, but its late response cannot populate a different session's editor. Discarding a suggestion leaves the current editor unchanged.

## Backend safety boundary

`POST /sessions/:sessionId/studio-workflows/generate` requires the existing operator role and session scope. Body: `prompt` (10–3000 characters), optional `connectionIds` (at most 5). The server resolves only enabled connections in that session. Only ID/name/kind/approved MCP tool names are sent as connection context; saved credentials, ciphertext, headers and private connection endpoints are not included. Do not enter secrets or unnecessary customer data in the prompt itself.

The owner request and approved metadata are JSON-encoded separately from fixed planning instructions. OpenAI and Gemini use their existing session AI configuration and JSON-output mode, a 3000-token completion budget, 20-second timeout, 256 KB provider-response bound and 12000-character accepted draft-output limit. The fallback chatbot need not be enabled. Unsupported providers or absent credentials fail. Legacy AI credentials still use their existing storage; Phase 4's vault is not silently substituted.

Every model response is parsed and validated as untrusted data before it is returned:

- Exact root review schema; typed/nested workflow DTOs, no unknown workflow/node fields, and only implemented string-valued node settings.
- One to six steps, nonempty trigger keywords, incoming direct WhatsApp trigger only, and minimum 60-second cooldown. No generated webhook/schedule trigger, recipient override, POST request, arbitrary headers or hidden credential setting.
- Public website/API URLs must match URLs explicitly supplied in the owner request, not model-invented endpoints. Connected APIs retain fixed-origin/path containment and read-only GET behavior; a generated escaping path is rejected.
- Connection IDs must be selected and enabled; MCP tools must already be explicitly approved. Permissions are rechecked after provider completion to catch revocation during generation. Runtime approval, read-only annotations and outbound SSRF protections still apply when the separately saved workflow is executed.
- Existing graph validation rejects duplicate IDs, backward routes, invalid variables and malformed iterator/aggregator structures. MCP arguments must be a JSON-object template; runtime string-value interpolation prevents customer text from injecting extra argument fields.
- Invalid, incomplete, blocked or unsafe output is rejected without automatically retrying, executing or repairing it. Provider/model response fragments are not included in errors. Simplify the request or build manually if generation cannot produce a supported graph.

The system supports draft nodes for variables, filters, routers, delays, iterators/aggregators, website text, AI processing, API reads, approved MCP tools and replies. AI may still choose incorrect trigger words, mappings or business instructions. Prompt separation and schema validation do not prove correctness or immunity to prompt injection/hallucination: inspect settings, test, and avoid high-impact decisions without human verification. Unsupported integrations should result in an honest reply-only limitation draft, not a fictional working connector.

## Usage limits and deployment

One in-flight generation/session and six attempts/hour/session **per API process**; failed paid attempts also count. There are no automatic paid retries. This is an in-memory guard, not a distributed billing quota: restarts reset it and multiple API processes have separate buckets. Provider/account budgets and production-wide rate limits must be configured separately. Existing workflow-run AI limits are unchanged.

No new dependency, table or migration is introduced. Phase 1–4 migrations and session AI configuration remain prerequisites. Phase 4 connection credentials still require a stable `STUDIO_VAULT_KEY` on the participating servers. No commit/push/production deployment or live WhatsApp/paid provider test is included.

## QA

The local flow under test is `/automation-studio` → prompt and approved connection selection → review → explicit use → separate save/test → rejection/discard/reload, plus prior Phase 1–4 regressions. Tests use temporary SQLite, real planning/AI/workflow services and deterministic OpenAI/Gemini/API/MCP fixtures. The dedicated Browser plugin is unavailable and Playwright is not installed; the existing Puppeteer/native-Chrome harness is the documented fallback. Desktop 1440×1050 and mobile 390×844 are exercised; screenshots are temporary local QA artifacts, not customer data.

Coverage includes URL allowlists, hidden settings, wrong connection/tool, unsafe triggers, cooldown, graph validation, metadata confidentiality, generation without database writes, concurrency/rate limits, malformed output, permission revocation, Gemini headers and preservation of unsaved editor changes. PostgreSQL, live external MCP servers, paid models, distributed quotas and all possible generated graphs have not been tested.

Local results: 138 Studio/auth tests plus 108 SSRF tests pass (246 total), production backend/dashboard builds pass, targeted Phase 5 backend/frontend lint and whitespace checks pass. Browser review/apply/save/test, expected invalid-output rejection, discard, reload and declined unsaved-change overwrite pass; no unexpected console errors or horizontal mobile overflow were observed. QA screenshots: `/private/tmp/studio-phase5-builder.png`, `/private/tmp/studio-phase5-review.png`, `/private/tmp/studio-phase5-mobile.png`, `/private/tmp/studio-phase5-mobile-review.png`.

Pre-existing deployment gates remain unresolved: the older lead-flow migration-chain failure, main-database drift, `user-auth.controller.ts/getProfile` route fence, unrelated API-client lint errors and existing dependency advisories. Passing isolated Studio checks does not waive them. See the Phase 4 notes for details.

A whole-repository test-source type check also encounters existing auth, session-scheduler and earlier Studio fixture typing errors. Production backend/dashboard builds and targeted Phase 5 lint are separate checks; passing them is not a claim that the entire repository type-checks or deploys cleanly.
