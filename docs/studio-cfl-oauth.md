# CFL MCP OAuth connection

This integration is disabled by default. It supports only the approved CFL resource
`https://dashboard.coachforlife.in/api/mcp`, with `list_datasets` and
`browse_records`. It does not grant arbitrary SQL or database write access.

## Private operator setup

1. Preserve Waply's existing `/app/data` persistent volume and database backup.
2. The operator must generate and enter a stable, random 32-byte base64
   `STUDIO_VAULT_KEY` as a private runtime environment variable. Never paste it
   into chat or rotate an existing vault key: rotation makes saved secrets unreadable.
3. Complete CFL's dedicated read-only database credential setup privately.
   Do not replace its owner `DATABASE_URL`.
4. With explicit authorization, add this public client to CFL's existing
   `MCP_OAUTH_CLIENTS` configuration, preserving other registrations:

```json
{"id":"waply_studio","name":"Waply Automation Studio","redirectUris":["https://wa.yogeshaihub.in/automation-studio"]}
```

5. Enable CFL MCP only after its private runtime configuration is ready.
   Set Waply `STUDIO_CFL_OAUTH_ENABLED=true` and redeploy after the vault is ready.
6. An administrator saves an enabled MCP connection with the CFL resource URL,
   selects OAuth, and clicks Connect. The administrator completes CFL login and
   read-only consent personally. Return in the same browser tab and Waply session.
   Saving a connection alone does not authorize access.

## Safety and recovery

PKCE, issuer/resource binding, exact redirect matching, five-minute one-use state,
administrator/session binding, encrypted token storage, and database compare-and-swap
protect authorization and refresh. Access tokens last at most 15 minutes; CFL grants
last seven days and refresh rotates. No tokens or authorization codes are returned
to the dashboard API or written to application logs. Configure proxy/access logs
not to retain OAuth callback query parameters.

Disconnect clears local credentials first and attempts upstream revocation. If CFL
is offline, revoke the grant there manually. An interrupted token exchange fails
closed: Disconnect, then Connect again; do not replay refresh tokens. Disable the
feature flag to stop OAuth use, and revoke grants at CFL when withdrawing access.

Rollback uses the prior Coolify image/commit and preserves `/app/data`; this change
adds no database columns or migration. Do not publish or run WhatsApp workflows as
part of connection setup without separate authorization.

## Verification

The targeted backend/security suites pass 243 tests, and the backend/dashboard
production build passes. Two pre-existing structural route-coverage suites fail
identically on baseline commit `f180c4d`; they were not disabled or changed.
Existing dependency advisories require separate maintenance; this integration
adds no dependencies. OAuth remains disabled until private setup and consent.
