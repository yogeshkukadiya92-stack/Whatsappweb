# Waply: two full instances on Coolify

Status: preparation only. Production still has one Waply instance. Do not route production to this topology until the migration and two-process acceptance checks below pass.

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
6. Verify email/password login and logout, roles/session scopes and dashboard realtime delivery through the public domain. Confirm both upstreams receive requests and an unhealthy upstream is excluded.

MCP/agent tools still need ownership-aware routing before enabling them in a cluster. Interrupted bulk sends are failed on takeover, never automatically resumed, because previously sent messages cannot safely be inferred. Two containers on one server provide process redundancy, not server redundancy.

## Verified during preparation

- Shared PostgreSQL main schema migration and concurrent last-admin protection passed on a disposable PostgreSQL 16 instance.
- The full data migration chain was exercised against a fresh PostgreSQL database; historical lead-flow and AI-agent migration ordering errors were repaired.
- 702 session tests passed after adding local lease expiry and reconnect/watchdog ownership checks.
- 162 auth/config/WebSocket tests passed, including peer key eviction.
- Two complete app processes reached readiness against the shared PostgreSQL databases. The same API key authenticated on both and both returned identical account records (`scripts/two-instance-auth-smoke.cjs`). The optional Redis run also proved that revoking a key on node A disconnects its authenticated WebSocket on node B. These isolated checks use no real WhatsApp sessions and do not yet exercise Traefik or Redis failure recovery.

Still required: production data migration, Redis outage coverage, actual two-process/load-balancer acceptance, and live cutover. The main auth changes alone do not constitute a completed load-balanced deployment.
