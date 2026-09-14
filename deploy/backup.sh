#!/usr/bin/env bash
#
# ZBT KitchenTracker Database & App Config Backup
#
# Backs up SQLite database (using atomic .backup), uploads directory, and .env.production
# to the USB flash drive (/mnt/usb-backup/kitchen-tracker) with fallback to /srv/kitchen-backups.
#
# Usage:
#   /usr/local/bin/kitchen-backup
#

set -euo pipefail

# Discover database path
DB="${DATABASE_FILE:-}"
if [ -z "$DB" ] || [ ! -f "$DB" ]; then
  for candidate in \
    "/srv/kitchen-data/kitchen.db" \
    "/home/zbt/KitchenTracker/data/kitchen.db" \
    "/srv/kitchen/data/kitchen.db" \
    "$HOME/KitchenTracker/data/kitchen.db" \
    "./data/kitchen.db"; do
    if [ -f "$candidate" ]; then
      DB="$candidate"
      break
    fi
  done
fi

if [ -z "$DB" ] || [ ! -f "$DB" ]; then
  echo "$(date -Is) [ERROR] KitchenTracker database file not found!" >&2
  exit 1
fi

# Prefer USB backup mount if available
if [ -d "/mnt/usb-backup" ]; then
  DEST="/mnt/usb-backup/kitchen-tracker"
else
  DEST="${BACKUP_DIR:-/srv/kitchen-backups}"
fi

KEEP_DAYS=60
LATEST="$DEST/latest"
ARCHIVES="$DEST/archives"

mkdir -p "$LATEST" "$ARCHIVES"

stamp=$(date +%Y-%m-%d_%H%M)
out_db="$LATEST/kitchen.db"
archive_tar="$ARCHIVES/kitchen-$stamp.tar.gz"

echo "$(date -Is) [kitchen-tracker backup] Backing up $DB to $DEST..."

# 1. Hot snapshot via sqlite3 CLI
sqlite3 "$DB" ".backup '$out_db'"

# 2. Verify snapshot integrity
if command -v sqlite3 >/dev/null 2>&1; then
  INTEGRITY=$(sqlite3 "$out_db" "PRAGMA integrity_check;")
  if [ "$INTEGRITY" != "ok" ]; then
    echo "$(date -Is) BACKUP FAILED integrity check: $INTEGRITY" >&2
    exit 1
  fi
  MEMBERS_COUNT=$(sqlite3 "$out_db" "SELECT COUNT(*) FROM members;" 2>/dev/null || echo "0")
  echo "$(date -Is) [kitchen-tracker backup] Verified snapshot: $MEMBERS_COUNT members, integrity $INTEGRITY"
fi

# 3. Backup uploads directory
UPLOADS_DIR="$(dirname "$DB")/uploads"
if [ -d "$UPLOADS_DIR" ]; then
  mkdir -p "$LATEST/uploads"
  cp -r "$UPLOADS_DIR"/* "$LATEST/uploads/" 2>/dev/null || true
fi

# 4. Backup environment & systemd files
APP_DIR="$(dirname "$(dirname "$DB")")"
for envfile in "$APP_DIR/.env.production" "$APP_DIR/.env.local" "$APP_DIR/.env" "/srv/kitchen/.env.production"; do
  if [ -f "$envfile" ]; then
    cp "$envfile" "$LATEST/.env.production"
    break
  fi
done

if [ -f "/etc/systemd/system/kitchen.service" ]; then
  cp "/etc/systemd/system/kitchen.service" "$LATEST/kitchen.service" 2>/dev/null || true
fi
if [ -f "/etc/caddy/Caddyfile" ]; then
  cp "/etc/caddy/Caddyfile" "$LATEST/Caddyfile" 2>/dev/null || true
fi

# 5. Create compressed archive
tar -czf "$archive_tar" -C "$DEST" latest

# Prove archive is valid
if ! gzip -t "$archive_tar"; then
  echo "$(date -Is) BACKUP FAILED verification: $archive_tar" >&2
  exit 1
fi

# 6. Prune archives older than KEEP_DAYS
find "$ARCHIVES" -name 'kitchen-*.tar.gz' -mtime +$KEEP_DAYS -delete 2>/dev/null || true

echo "$(date -Is) backed up to $archive_tar ($(du -h "$archive_tar" | cut -f1))"
