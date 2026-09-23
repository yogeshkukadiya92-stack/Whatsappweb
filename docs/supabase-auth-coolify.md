# Supabase email authentication in Coolify

The Waply API-key system remains the source of roles and WhatsApp account scope. Supabase verifies email/password and issues access tokens. A verified Supabase user must link an existing Waply API key once; subsequent logins use email/password.

## Prepared Coolify resource

The `Waply Supabase` service belongs to the same Coolify project and environment as Waply. It has not been started. Its one-click template creates a Kong endpoint and a PostgreSQL database. Public signup was disabled in Coolify with `DISABLE_SIGNUP=true`; keep `ENABLE_EMAIL_AUTOCONFIRM=false`. The user chose admin-created accounts because SMTP is unavailable. Waply's `SUPABASE_SIGNUP_ENABLED` stays `false`.

Set these Waply runtime variables after the Supabase service is healthy:

| Variable | Value |
| --- | --- |
| `SUPABASE_AUTH_URL` | The reachable Supabase Kong base URL, without `/auth/v1` |
| `SUPABASE_ANON_KEY` | The Supabase service's anon key, stored as a secret |
| `SUPABASE_SIGNUP_ENABLED` | `false` for admin-created accounts |

Do not configure Waply with the Supabase service-role key. Avoid displaying either key in logs or a public URL. Apply the main database migration `1789900000000-AddSupabaseIdentityToApiKeys` before enabling Supabase authentication if automatic migrations are disabled.

## Account transition

1. Create confirmed users in Supabase Auth as an administrator. Credential entry must be done by the account owner or administrator.
2. Each existing Waply account holder signs in with their Supabase email/password. On the first login, enter their existing Waply API key in the link prompt.
3. Verify an operator can access only their assigned sessions. Keep API-key login available for service clients and as an operator recovery route.

Enabling Supabase invalidates Waply's legacy email-login JWTs, so schedule the cutover with account holders. Existing API keys continue to work.

## Two upstreams

Do not set Waply to two replicas yet. `docs/13-horizontal-scaling.md` records incomplete cross-replica session fencing, WebSocket key eviction and rate limits, and in-process batch state. The main auth/audit database is always SQLite at `MAIN_DATABASE_NAME`, and the existing Coolify deployment has a local persistent volume. Two containers sharing that live volume or using separate copies of the database would be unsafe. Migrate shared state and complete the session ownership work before adding two healthy Waply upstreams to Coolify's Traefik load balancer.
