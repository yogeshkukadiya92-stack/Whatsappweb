# Production WhatsApp session incident — 2026-09-27

## Verified production target

- Public URL: `https://wa.yogeshaihub.in`.
- Active Coolify app: `z7ivhhdivfdpn2qjdn3s39hr` (UI name `Waply A (private staging)` is misleading: this is live).
- Current Traefik configuration `/data/coolify/proxy/dynamic/waply-cluster.yaml` routes to `http://waply-a:2785` only. B is currently stopped; do not assume the historical two-node topology is active.
- Production uses the shared PostgreSQL databases. The deployment branch and migration runbook live in the adjacent `OpenWA-live` checkout, `deploy/waply-two-instance/README.md`.

## Root cause and repair

The retired SQLite app `g2498rfu9oiaeg2tzvizkqh5` had been started and deployed again. It shared the WhatsApp authentication volume with production but used a separate SQLite session/ownership database. It opened the same WhatsApp account independently, causing production to fail with `Connection replaced by another instance (440)`.

The legacy session was stopped through its API, with `alwaysOn=false`. The legacy Coolify application was stopped without Docker cleanup. Pending legacy deployments were cancelled, automatic Git deployment was disabled, and the app was renamed `Waply LEGACY SQLite - KEEP STOPPED`. Persistent data was retained.

The existing production session was restarted on Waply A without unlinking or rescanning a QR code. The API returned `ready`, `engineLoaded=true`, and `lastError=null` after reconnecting at `2026-09-27T05:03:09.829Z`.

## Avoid recurrence

Do not deploy or start `g2498rfu9oiaeg2tzvizkqh5` as a routine production update. Its SQLite ownership records cannot coordinate with the live PostgreSQL instance. A rollback requires a deliberate stopped-writer migration procedure; simply starting the old app creates competing WhatsApp connections and stale dashboard data.

Before deployment, verify the actual public proxy upstream, application UUID, database backend, and Git branch. A successful build of this checkout on the retired app does not update the public production instance.

For recovery, inspect session state on the actual live node. Read an existing API credential locally on the server without printing it. Never delete the authentication volume or unlink the session merely to resolve a duplicate-instance error.

## Always-on scheduling follow-up

The live session's persisted `alwaysOn` setting was enabled. `AUTO_START_SESSIONS=true` was saved in the live Coolify application's environment for the next deployment. Its Docker restart policy is `unless-stopped`.

Scheduled messages are persisted on the server and polled every ten seconds, independent of browser or laptop state. The scheduled-media dispatcher incorrectly nested uploaded media under `media` although the sender requires top-level `base64`/`url`. This was corrected for images, videos, audio, documents, and stickers on production branch `codex/waply-shared-database` in commit `5b57c09`. Five regression cases exercise persisted attachments against the sender contract; all 19 scheduler tests and the production TypeScript build passed.

Deployment `14b3fe82-e6cc-47b4-b6bc-21e157c33d0e` finished successfully with exact commit `5b57c098f3f31f0be49680e5e8081f9c2aaf54c8`; Coolify's previous commit pin was advanced to this revision. The new container automatically restored the session to `ready`, with runtime `AUTO_START_SESSIONS=true` and persisted `alwaysOn=true`. The user's image schedule that had failed before sending due to the media-contract bug was requeued, then confirmed `sent` at `2026-09-27T05:22:00.975Z`. Other failed/cancelled historical schedules were not retried.
