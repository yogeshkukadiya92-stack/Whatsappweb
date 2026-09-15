# Automation Studio — Phase 3

Phase 3 adds **Website text**, **AI processing** and a draft **Website answer template** to the existing Automation Studio page. It is not full n8n/Pabbly/Make parity. Credential vault/OAuth, app-specific API connections, MCP actions, AI-generated workflow graphs and autonomous agents remain later work.

## Quick start

1. Select the actual WhatsApp session. In AI Chatbot, configure that same session's Gemini/OpenAI credentials and a model supported by your account. Studio uses these credentials even when the fallback bot's master toggle is disabled; publishing the workflow is the separate authorization to run it.
2. Choose **Website answer template**. It creates a new draft with a WhatsApp message trigger (`info`, `website`), Website → AI → WhatsApp steps, and a source URL in the reply. Replacing an unsaved draft asks for confirmation and resets any earlier schedule/webhook trigger.
3. Set the website URL. Select the AI task, output language and instructions. Use static owner-written instructions; map website/customer content in **Source data** or **Customer question**, not instructions.
4. **Save & test** previews replies. Website/API/AI requests are real and provider charges can apply. A preview is not WhatsApp delivery confirmation. Review facts, privacy and allowed recipients before publishing.
5. Publish, then send a message matching a configured keyword. The durable runner fetches the source, processes it and renders the reply asynchronously. Existing webhook and schedule triggers can also drive these steps when deliberately configured.

## Website text

Only one explicitly configured HTTPS URL is fetched per step, with the existing pinned-DNS SSRF guard and no redirect following. Embedded URL credentials and non-443 ports are rejected. The existing administrator-controlled SSRF hostname allowlist still applies. This is not a browser: no scripts, subresources, cookies, login, CAPTCHA bypass or link crawling. Only HTML/XHTML or plain-text responses are accepted, decoded as UTF-8. PDF, image, audio and JavaScript-rendered-only pages require later dedicated extraction methods.

The bounded HTML parser decodes entities and omits script/style/template/iframe/SVG/canvas, forms, nav/footer, `hidden`, `aria-hidden=true` and common inline hidden styles. CSS files/classes and computed browser visibility are not evaluated. Auto mode prefers article text, then main, then body. Explicit article/main mode fails when that region has no readable text. Multiple matching regions are concatenated. Title, up to 20 headings and up to 20 safe HTTP/HTTPS links are extracted from the page; links are metadata only and never fetched. Respect website terms, privacy and access permission; robots.txt is not automatically enforced.

Output example, named `site`:

```json
{
  "url": "https://example.com/",
  "title": "Example Domain",
  "text": "Readable page content",
  "headings": ["Example Domain"],
  "links": [{ "url": "https://example.org/", "text": "More information" }],
  "truncated": false,
  "characters": 129,
  "fetchedAt": "2026-09-15T00:00:00.000Z"
}
```

Use `{{site.text}}`, `{{site.title}}`, `{{site.url}}`, `{{site.links}}`, `{{site.truncated}}`. Text limit: 500–24000 characters (default 20000). Large sources are explicitly marked truncated; AI only sees the mapped text, not the full original website. HTTP timeout: 10 seconds; response limit: 256 KB after decompression; maximum nesting: 256 elements. No source body is recorded in live traces.

## AI processing

- **Summarize:** concise source-based summary.
- **Answer:** uses the supplied source and mapped customer question; instructed to acknowledge missing facts.
- **Translate:** source translation into the selected language.
- **Extract:** 1–20 unique named fields; returned values must be strings or null. Unrequested/missing keys, arrays, nested objects and invalid JSON fail validation rather than exposing a broken mapping.

Output can be customer language, Gujarati, Hindi or English. String results map as `{{answer}}`; extraction results use `{{answer.price}}`, for example. Missing values and incomplete/blocked generation fail the step; use the existing explicit error handler for a reviewed fallback or human-handoff message. Null extraction fields interpolate as `null`, so choose conditional handling before sending them to customers.

AI credentials are retrieved server-side from the exact session at execution time; they are not copied into definitions, checkpoint values or traces. Existing AI credentials storage is legacy plaintext database storage, **not** a newly implemented encrypted vault. Keep database access restricted; the vault remains later work. Gemini authentication uses a header rather than a query-string key. Endpoints are fixed to the existing Gemini/OpenAI providers and no arbitrary provider URL is accepted.

Owner instructions are static, at most 4000 characters, and are sent separately from JSON-encoded untrusted source/question content. Input plus question is limited to 40000 characters. Requests have a 20-second timeout, 256 KB response limit, a 1500-token output budget and 8000-character accepted output limit. The chosen model must support its provider's generation endpoint and requested JSON mode. There are no tools, MCP calls, function execution, autonomous actions or AI node retries in this phase. Prompt separation mitigates but does **not** guarantee immunity to prompt injection or hallucination; review high-impact results. Source/customer data is sent to the configured external provider, so obtain appropriate permission and avoid secrets or unnecessary personal information.

At most three configured Website steps and three configured AI steps are allowed, with ten website calls and ten AI attempts per execution in ordinary processing. Existing 20-step/500-operation/100-reply limits apply. The durable worker checkpoints its external-action marker before paid AI calls as well as WhatsApp sends. An interrupted action is marked uncertain and not automatically replayed after lease recovery. Provider billing or acknowledgement can still be ambiguous; this is not an exactly-once guarantee. Terminal runs clear pending source and AI output values, while test reply previews remain intentionally retained. Error messages are generic for provider bodies and invalid extraction JSON; private-address details are redacted.

## Verification

- New tests cover text/entity/Gujarati extraction, executable/hidden-text omission, source links, region selection, truncation, missing content, rejected credential URLs/ports/binary responses, bounded streams and private-address redaction.
- AI tests cover exact-session credential isolation, disabled fallback independence, fixed provider/header authentication, trusted/untrusted prompt separation, structured extraction validation, incomplete output, input/output limits, safe provider errors and interrupted paid-call recovery.
- End-to-end service tests cover Website → AI → reply previews, live send-port mapping, persisted source data and resumed workers. No production WhatsApp message or paid provider request is used.
- Local Chrome UI QA exercises the template after a schedule (trigger reset), URL/language edits, answer preview, structured extraction preview, publish, three durable operations, save/reload and desktop/mobile layout. It uses a real isolated SQLite service with deterministic website/provider fixtures. Browser plugin and Playwright are unavailable; the existing Puppeteer/native Chrome setup is used without adding browser dependencies.
- A real, read-only `https://example.com` extraction succeeded through the actual fetch/SSRF/parser stack (title Example Domain, 129 characters, one source link). Model quality, paid account quotas and live provider compatibility are not validated by fixtures.

No new database migration is required; step definitions and extra counters use existing JSON columns. Backend/dashboard builds and targeted checks are required before handoff. Production deployment, PostgreSQL smoke testing and production delivery remain unperformed. The earlier migration-chain (`lead_flows`/`users`) and authorization-route (`getProfile`) deployment gates described in [Phase 2](automation-studio-phase2.md) remain unresolved; they were not waived. Dependency installation also reports existing repository advisories; no broad dependency upgrade was performed.

## Implementation references

HTML parsing follows the parser's [official usage documentation](https://github.com/fb55/htmlparser2). Gemini requests follow the documented [generateContent request and system-instruction schema](https://ai.google.dev/api/generate-content). OpenAI integration extends the existing local Chat Completions adapter pattern rather than adding another SDK.
