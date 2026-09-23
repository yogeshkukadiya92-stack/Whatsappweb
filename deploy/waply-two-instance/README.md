# Waply: two full instances on Coolify

Status: live on `https://wa.yogeshaihub.in` since 2026-09-23. Two private Waply instances serve the public domain through Coolify's Traefik proxy. Both containers are on one server, so this protects against an individual app process failure, not a host failure.

## Production state and operations

- Supabase Auth service `bynavpg0dzpr8qhf1f0woy0b` is running. Public signup is disabled; an administrator creates and confirms users. The confirmed `yogeshkukadiya92@gmail.com` identity is linked to the existing `user:Yogeshkv9200` Waply admin record. Email/password login through the public Waply domain was verified by the account owner.
- Private PostgreSQL `4rh6hbpaev359gdjfxjg4h6q` holds `waply_main` and `waply_data`. Private Redis `tduplkval5azrxfvfocq70jj` provides cross-node event fan-out. The final offline SQLite import completed successfully, including legacy dashboard users and automation reply media fields; the data database contains 28,175 messages.
- Waply A `z7ivhhdivfdpn2qjdn3s39hr` and B `aazy3ojyppu7w6otrbofbvma` run commit `3e0a8445fe41a813461d0f8789e1f4cc42da6685` with aliases `waply-a` and `waply-b`. Both use the shared existing session/media volume and private database services. The live WhatsApp session is owned by A; B is healthy and forwards owner-specific operations.
- Traefik reads `/data/coolify/proxy/dynamic/waply-cluster.yaml`. Its two upstreams are `http://waply-a:2785` and `http://waply-b:2785`, with `/api/health/ready` checks and the secure `waply_affinity` sticky cookie. Neither clone has its own public domain. The previous app `g2498rfu9oiaeg2tzvizkqh5` is stopped and its primary host route removed.
- Cutover backups are `/data/coolify/waply-cutover/main.final.sqlite`, `openwa.final.sqlite`, and `volume-files-final.tar.gz` on the server. They were copied after the original writer stopped; SQLite integrity and archive checks passed. Keep these and the original volume for rollback. They contain user data and secrets and are mode 600.
- Public checks passed for dashboard and readiness (HTTP 200), Supabase auth status (`enabled: true`, `signupEnabled: false`), admin login, Sessions and the connected WhatsApp session. A-only and B-only routing each served the signed-in dashboard and session list; the two-upstream file was restored afterward. The dashboard now uses direct WebSocket transport so realtime events do not depend on sticky HTTP polling across the two-node balancer.

To restore the full load balancer after a temporary single-node diagnostic, install the saved two-upstream file with the same permissions: `install -m 644 /data/coolify/waply-cutover/traefik-waply.yaml /data/coolify/proxy/dynamic/waply-cluster.yaml`. Check both readiness endpoints and the public host. For an emergency rollback, stop both clones, restore the old app's `wa.yogeshaihub.in` domain in Coolify, start the old app against its original volume, and remove the new Traefik host rule to avoid competing routers. Data written to PostgreSQL after cutover will not automatically appear in the old SQLite databases; assess and export those writes before rollback.

## Preparation record from 2026-09-23 (historical; superseded by live state above)

- Existing production Waply: `g2498rfu9oiaeg2tzvizkqh5`, still the sole router for `wa.yogeshaihub.in`.
- Supabase: `bynavpg0dzpr8qhf1f0woy0b`, running; public signup disabled. The initial confirmed admin user is still pending.
- Private PostgreSQL 16: `4rh6hbpaev359gdjfxjg4h6q`, running, with empty `waply_main` and `waply_data` databases. Schema and data have not been migrated.
- Private Redis 7.2: `tduplkval5azrxfvfocq70jj`, running.
- Waply A: `z7ivhhdivfdpn2qjdn3s39hr`; Waply B: `aazy3ojyppu7w6otrbofbvma`. Both are **stopped** private clones with no public domains. Both select `codex/waply-shared-database` and reference the original `g2498rfu9oiaeg2tzvizkqh5-openwa-data` volume at `/app/data`; neither has started against it. Their network aliases are `waply-a` and `waply-b`.

The clones have only partial runtime configuration. Finish and verify all PostgreSQL, Redis, Supabase, key-pepper, and proxy settings before either starts. A copied legacy admin password is still present in the clones; do not expose them directly. A read-only pre-cutover SQLite snapshot exists on the original volume under `/app/data/backups/`; take final stopped-writer snapshots and a media/session-volume backup at cutover.

## Topology

Coolify Traefik → `waply-a:2785` and `waply-b:2785`, with a sticky cookie for Socket.IO polling and `/api/health/ready` health checks. Both run the same immutable application image. Both require shared PostgreSQL auth/audit and data databases, Redis, and the existing session/media storage on the same host. Supabase remains a separate service in the same Coolify environment; email/password login uses its Auth API. Public signup stays disabled.

Each instance needs:

- `MAIN_DATABASE_TYPE=postgres`, `MAIN_DATABASE_URL` pointing to a **dedicated Waply auth database**, `MAIN_DATABASE_SYNCHRONIZE=false`.
- `DATABASE_TYPE=postgres`, shared `DATABASE_HOST`, `DATABASE_PORT`, `DATABASE_NAME`, `DATABASE_USERNAME`, `DATABASE_PASSWORD`; `DATABASE_SYNCHRONIZE=false`.
- Shared existing `API_KEY_PEPPER`, application secrets, Supabase URL and anon key. Changing the pepper invalidates existing keys.
- `REDIS_ENABLED=true`, shared private Redis host/password. No Redis or PostgreSQL public ports.
- Unique `NODE_ID` and reachable `NODE_URL`, e.g. `waply-a` / `http://waply-a:2785` and `waply-b` / `http://waply-b:2785`.
- `TRUSTED_PROXIES` limited to the actual proxy and peer addresses; never trust every address.
- `SUPABASE_SIGNUP_ENABLED=false`. Create confirmed accounts administratively, since SMTP is unavailable.

For this fixed two-instance topology, conservative per-instance WebSocket budgets can preserve the previous aggregate ceiling: frame rate 30/s, burst 60, handshake failures 5/min, sockets per key 8. Set `WS_RATE_LIMIT_FRAME_PER_SECOND=30`, `WS_RATE_LIMIT_FRAME_BURST=60`, `WS_RATE_LIMIT_HANDSHAKE_MAX=5`, `WS_MAX_SOCKETS_PER_KEY=8`. These are per-node allocations, not shared Redis counters; one node cannot borrow the other's unused capacity. Revisit before increasing beyond two instances.

## Required cutover checks

1. Build/pin the reviewed image. Complete the pending session routing, revocation outage and two-process acceptance tests before deployment.
2. Back up both SQLite databases **and** the session/media volume. Stop Waply writers for the migration; retain the original volume untouched for rollback.
3. Run main and data migrations in separate empty PostgreSQL databases. Import source data preserving identifiers, API-key hashes, credential references, dates and media paths. Verify row counts and referential integrity. Never import into Supabase's `auth` schema.

   After stopping the original writers and taking final consistent SQLite snapshots, use the bundled offline importer once for each migrated database:

   ```sh
   node scripts/migrate-sqlite-to-postgres.cjs --kind=main --sqlite=/app/data/backups/main.final.sqlite --pg-url="$WAPLY_MAIN_DATABASE_URL" --writers-stopped
   node scripts/migrate-sqlite-to-postgres.cjs --kind=data --sqlite=/app/data/backups/openwa.final.sqlite --pg-url="$WAPLY_DATA_DATABASE_URL" --writers-stopped
   ```

   It refuses nonempty destinations, unknown populated legacy tables and mismatched schema. Empty obsolete Instagram tables can be omitted; the original SQLite backup retains them. Run it from a container with both database access and the mounted volume. The `--writers-stopped` flag is an operator assertion, not an automatic lock.
4. Start the two instances privately and confirm both readiness endpoints. Verify the same credential on both nodes, cross-node revoke, session-owner forwarding, Redis outage behavior and takeover without duplicate engines. No test sends to real WhatsApp contacts.
5. Set Traefik's service upstreams to both private URLs, enable sticky cookies and active health checks, and remove the old competing host router in the same controlled cutover.
   The reviewed file-provider draft is `traefik-waply.yaml`. In Coolify, add it under Server > Proxy > Dynamic Configurations only after the old `wa.yogeshaihub.in` route is removed and both private instances are healthy. Recheck that this proxy uses the `http`/`https` entry point names and `letsencrypt` resolver shown in Coolify's current proxy configuration.
6. Verify email/password login and logout, roles/session scopes and dashboard realtime delivery through the public domain. Confirm both upstreams receive requests and an unhealthy upstream is excluded.

MCP/agent tools still need ownership-aware routing before enabling them in a cluster. Interrupted bulk sends are failed on takeover, never automatically resumed, because previously sent messages cannot safely be inferred. Two containers on one server provide process redundancy, not server redundancy.

## Verified during preparation

- Shared PostgreSQL main schema migration and concurrent last-admin protection passed on a disposable PostgreSQL 16 instance.
- The full data migration chain was exercised against a fresh PostgreSQL database; historical lead-flow and AI-agent migration ordering errors were repaired.
- 702 session tests passed after adding local lease expiry and reconnect/watchdog ownership checks.
- 162 auth/config/WebSocket tests passed, including peer key eviction.
- Two complete app processes reached readiness against the shared PostgreSQL databases. The same API key authenticated on both and both returned identical account records (`scripts/two-instance-auth-smoke.cjs`). The optional Redis run also proved that revoking a key on node A disconnects its authenticated WebSocket on node B. These isolated checks use no real WhatsApp sessions and do not yet exercise Traefik or Redis failure recovery.

The production cutover, database import, public authentication and single-node routing checks were completed as recorded above. Redis outage recovery remains an untested operational scenario; do not assume that a host-wide Redis outage preserves live updates.
