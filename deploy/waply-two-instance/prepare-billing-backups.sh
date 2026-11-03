#!/usr/bin/env bash
# Run on the existing Coolify host before the billing release. Does not deploy or restart services.
set -euo pipefail
umask 077

pg_container="${WAPLY_POSTGRES_CONTAINER:-4rh6hbpaev359gdjfxjg4h6q}"
backup_root="${WAPLY_BILLING_BACKUP_ROOT:-/data/coolify/backups}"
release_ref="${1:-}"
if [[ ! "$release_ref" =~ ^[a-f0-9]{7,40}$ ]]; then
  echo 'Usage: prepare-billing-backups.sh <reviewed-git-commit>' >&2
  exit 2
fi
if [[ ! "$pg_container" =~ ^[a-zA-Z0-9_.-]+$ || "$backup_root" != /* ]]; then
  echo 'Use a valid PostgreSQL container name and an absolute backup directory.' >&2
  exit 2
fi
for executable in docker sha256sum df date; do
  command -v "$executable" >/dev/null || { echo "Missing required program: $executable" >&2; exit 1; }
done
[[ "$(docker inspect --format '{{.State.Running}}' "$pg_container")" == true ]] || {
  echo 'The configured PostgreSQL container is not running.' >&2
  exit 1
}
docker exec "$pg_container" sh -ceu 'command -v pg_dump >/dev/null; command -v pg_restore >/dev/null'
mkdir -p -- "$backup_root"
backup_dir="$(mktemp -d "$backup_root/waply-billing-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")"
chmod 700 "$backup_dir"
printf '%s\n' "$release_ref" > "$backup_dir/release-commit.txt"
echo "Creating private PostgreSQL backups in: $backup_dir"
df -h "$backup_root"
for database in waply_main waply_data; do
  dump_file="$backup_dir/$database.dump"
  # Resolve the existing PostgreSQL username inside the container; no credentials enter shell output.
  docker exec "$pg_container" sh -ceu 'export PGPASSWORD="${PGPASSWORD:-${POSTGRES_PASSWORD:-}}"; exec pg_dump --no-password -U "${POSTGRES_USER:-postgres}" --format=custom --no-owner --no-acl "$1"' sh "$database" > "$dump_file.partial"
  [[ -s "$dump_file.partial" ]] || { echo "Empty dump for $database; stop the release." >&2; exit 1; }
  docker exec -i "$pg_container" pg_restore --list < "$dump_file.partial" > "$backup_dir/$database.contents.txt"
  docker exec -i "$pg_container" pg_restore --exit-on-error --file=/dev/null < "$dump_file.partial" > /dev/null
  [[ -s "$backup_dir/$database.contents.txt" ]] || { echo "Invalid archive for $database; stop the release." >&2; exit 1; }
  mv -- "$dump_file.partial" "$dump_file"
  (cd "$backup_dir" && sha256sum "$database.dump") >> "$backup_dir/SHA256SUMS"
done
(cd "$backup_dir" && sha256sum --check SHA256SUMS)
printf 'Validated backup archives for waply_main and waply_data.\nNo deployment or service restart was performed.\n'
printf 'Before deploying, also record both current Waply image references and verify the separate secret/SMTP configuration checklist.\n'
