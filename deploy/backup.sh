#!/usr/bin/env bash
#
# Nightly database backup.
#
# Uses SQLite's own .backup command rather than copying the file. A plain copy
# of a live database can catch it mid-write and produce a file that will not
# open; .backup takes a consistent snapshot while the app keeps running.
#
# Installed by setup-droplet.sh as /usr/local/bin/kitchen-backup and run at 3am.

set -euo pipefail

DB=/srv/kitchen-data/kitchen.db
DEST=/srv/kitchen-backups
KEEP_DAYS=30

mkdir -p "$DEST"

stamp=$(date +%Y-%m-%d)
out="$DEST/kitchen-$stamp.db"

sqlite3 "$DB" ".backup '$out'"
gzip -f "$out"

# Prove the snapshot actually opens before trusting it.
if ! gzip -t "$out.gz"; then
  echo "$(date -Is) BACKUP FAILED verification: $out.gz"
  exit 1
fi

find "$DEST" -name 'kitchen-*.db.gz' -mtime +$KEEP_DAYS -delete

echo "$(date -Is) backed up to $out.gz ($(du -h "$out.gz" | cut -f1))"
