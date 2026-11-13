# Container identity during rolling deployment

Leave `NODE_ID` empty in Coolify production so the existing hostname fallback identifies each live container independently. Keep the `waply-a` network alias and `NODE_URL=http://waply-a:2785`; routing addresses and lease owner identities serve different purposes.

Never assign the same fixed `NODE_ID` to overlapping old/new containers. Otherwise the new process may reset and reclaim a live account, and the old shutdown can release the replacement claim. The 13 November 2026 incident left two accounts with persisted Ready status but no local engine.

The hostname remains stable for process restarts inside one container and changes for replacement containers. A replacement respects live old-container leases, then restores authenticated accounts after graceful handoff or expiry. A short transport reconnect during process replacement is expected; persistent unlinking or a Ready account without an engine is not.

Regression coverage uses a real SQLite repository to verify refusal of a live old lease, successful handoff, and late old-container cleanup leaving the replacement lease intact. The empty environment value is tested against the hostname fallback. No schema migration is required.

For the initial transition from fixed `waply-a`, the old container retains that identity until stopped; the new one uses its hostname. Verify the new runtime identity, database lease owner, account readiness and group listing after old-container removal and at least one subsequent heartbeat. Do not roll back the identity configuration to a shared fixed value.
