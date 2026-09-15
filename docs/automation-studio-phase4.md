# Automation Studio — Phase 4

This release adds session-scoped API connections, encrypted credential storage and explicitly approved read-only MCP tools to `/automation-studio`. It is not full n8n, Pabbly or Make parity. OAuth provider registrations, app-specific connector catalogs, write actions and autonomous AI tool selection remain unimplemented.

## Using connections

1. Select a WhatsApp session and open **Connections**. Administrators can add, edit, disable or delete connections; operators can view metadata and use connections in workflows within their permitted sessions.
2. Choose API or MCP, supply a trusted public HTTPS base URL/endpoint and select public, Bearer, X-prefixed API-key header, or Basic authentication. Basic credentials use `username:password`.
3. For API nodes, select the connection, choose GET and provide a relative path such as `orders/123?expand=true`. Requests cannot escape the saved origin/path prefix; absolute paths, redirects, traversal and private-network targets are rejected. Public unauthenticated HTTP nodes retain their existing GET/POST behavior.
4. For MCP, save the connection, click **Discover read-only tools**, then explicitly enter approved tool names and save. Add an MCP node, select an approved tool and provide JSON-object arguments. Use `{{toolResult.text}}` in an AI input or reply; structured results are available under `toolResult.data` when returned by the server.
5. **Save & test** performs real approved API/MCP reads but does not send WhatsApp messages. Review resulting data and permissions before publishing. MCP templates are parsed as JSON first, then string values interpolated safely; customer quotes cannot create extra fields. Static numbers/booleans keep their types.

Saving an edit with a blank credential preserves the current credential only when the URL, authentication mode/header and connection kind remain unchanged. Changing these requires a fresh credential. Choosing public authentication erases the saved secret. Credentials are never returned or prefilled and are not stored in browser persistence or workflow snapshots.

Disable/delete prevents subsequent node calls; it does not abort a request already in flight. Removing a connection cannot be undone from the UI: recreate it with a new ID and update affected workflows. Cancel queued workflows separately if needed.

## Deployment requirement

Set `STUDIO_VAULT_KEY` to a securely generated base64-encoded random 32-byte key on every API/worker process. Keep it stable across restarts and back it up separately from the database. It must never be exposed through dashboard build variables, logs or public configuration. Missing/invalid keys fail closed for credential creation/decryption; public connections remain usable. AES-256-GCM uses a fresh 12-byte nonce and authenticated session/connection identity. Swapping ciphertext between rows or tampering with it fails decryption.

There is no automatic key rotation or recovery mechanism. Changing/losing the key requires re-entering every connection credential. Do not change it while runs are active. Existing chatbot AI credentials remain in their legacy storage; this release does not silently migrate or encrypt them. Database backups and retained execution traces still require access controls.

## MCP compatibility and safety

- Uses the installed official MCP SDK client with JSON-response Streamable HTTP only. Exact endpoint pinning, public DNS/IP validation and redirect refusal apply to every outbound request; credentials cannot be sent to alternate endpoints.
- No OAuth discovery/handshake, legacy SSE, streaming responses, subscriptions, reconnection, stdio, shell, sampling or elicitation capabilities. Optional SDK GET subscriptions receive a local 405 and never open a network request.
- Each operation closes its client and attempts protocol-session cleanup with an exact-endpoint DELETE within the same deadline when the server issued a session ID. Unsupported/failed cleanup is ignored; server session expiry remains necessary. This is protocol cleanup, not permission to invoke write tools.
- Catalogs must fit one page with at most 100 tools. Tools must be explicitly approved and advertise `readOnlyHint: true` without `destructiveHint: true` on the fresh catalog before invocation. Annotations are server claims, not a security guarantee: connect only trusted servers with least-privilege credentials. No write tools are supported.
- Only text content and optional structured data are accepted; binary images/audio and embedded resource fetching are unsupported. Arguments must be a JSON object within 16 KB. Source/customer data is sent to the selected external server; obtain appropriate consent and avoid sensitive data.
- At most 32 connections/session, 20 approved tool names/connection, 3 MCP nodes/workflow and 10 MCP attempts/run. API reads use 10-second timeouts; each MCP operation shares a 20-second deadline across initialize/list/call. Responses are bounded to 256 KB and working data to 512 KB.
- MCP calls checkpoint before invocation and never automatically retry. Interrupted external actions stop as uncertain instead of blindly replaying. Authenticated GET nodes retain explicit bounded retry policies. Server errors are generic, and responses echoing the credential or its Basic encoding are rejected; this is not a general secret/PII detector.

## Verification and remaining release gates

New tests cover vault isolation, wrong keys, safe paths, cross-session access, disabled connections, secret preservation/removal, API-key/Basic/Bearer headers, error/echo redaction, actual SDK initialize/list/call with deterministic fixtures, read-only permission enforcement, durable uncertainty handling and isolated SQLite migration/CRUD/cascade behavior.

Browser validation uses local Chrome and temporary SQLite with deterministic API/MCP/provider fixtures, not a live WhatsApp recipient or paid AI provider. The dedicated Browser plugin is unavailable and Playwright is not installed; the existing Puppeteer/native-Chrome harness is used as the documented fallback. The tested flow is session selection → connection creation/edit/discovery/approval → API or MCP node → preview → reload/mobile rendering. PostgreSQL and real external MCP services have not been exercised. No production deployment, commit or push is part of this phase.

Verified locally: 112 workflow/connection/auth tests and 108 SSRF tests pass (220 total); backend and dashboard builds, targeted backend/frontend lint and whitespace checks pass. Browser checks cover credential preservation without prefill, API and MCP previews, metadata redaction, save/reload, 1440px desktop and 390px mobile layouts, and prior Phase 1–3 flows. No page/console errors or horizontal mobile overflow were observed. The new credential tests also exercise durable MCP jobs and revocation before a queued call, with a test send callback only.

QA images: `/private/tmp/studio-phase4-connections.png`, `/private/tmp/studio-phase4-workflow.png`, `/private/tmp/studio-phase4-mobile.png`. These are local temporary test artifacts, not screenshots of customer data.

The pre-existing full migration-chain failure in `AddLeadFlowCompletionMedia1786200000000` (missing `lead_flows`), main-database drift, route-fence failure on `user-auth.controller.ts/getProfile`, unrelated legacy API-client lint errors and existing dependency advisories remain release blockers. Isolated Phase 4 tests/builds do not waive these gates.
