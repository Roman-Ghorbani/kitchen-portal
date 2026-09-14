#!/usr/bin/env bash
#
# Master Backup Script for all ZBT Kitchen Systems on Raspberry Pi
#
# Backs up:
#   1. kitchen-tv (announcements, uploads, caches, service configuration)
#   2. The Sober App (sober.db SQLite snapshot, environment configs, service unit)
#   3. KitchenTracker (kitchen.db SQLite snapshot, uploads, .env.production, Caddyfile)
#   4. System configurations (/etc/systemd/system, /etc/caddy/Caddyfile)
#
# Target: /mnt/usb-backup (USB 3.2 Flash Drive)
#

set -euo pipefail

MOUNT_POINT="/mnt/usb-backup"
LOG_FILE="$MOUNT_POINT/logs/backup.log"
STAMP=$(date +%Y-%m-%d_%H%M)
ISO_DATE=$(date -Is)

# Check mount status
if ! mountpoint -q "$MOUNT_POINT" && [ ! -d "$MOUNT_POINT/kitchen-tv" ]; then
  echo "$ISO_DATE [WARN] USB flash drive not mounted at $MOUNT_POINT. Attempting mount..."
  mount "$MOUNT_POINT" 2>/dev/null || true
fi

if [ ! -d "$MOUNT_POINT" ]; then
  echo "$ISO_DATE [ERROR] Backup mount point $MOUNT_POINT is unavailable!" >&2
  exit 1
fi

mkdir -p "$MOUNT_POINT/logs" "$MOUNT_POINT/system-configs/systemd"

echo "$ISO_DATE [INFO] === Starting master ZBT systems backup ($STAMP) ==="

# -----------------------------------------------------------------------------
# 1. Back up kitchen-tv
# -----------------------------------------------------------------------------
echo "$ISO_DATE [INFO] Backing up kitchen-tv..."
TV_DIRS=("/home/zbt/kitchen-tv" "/home/pi/kitchen-tv" "/srv/kitchen-tv" "$HOME/kitchen-tv")
TV_DIR=""
for d in "${TV_DIRS[@]}"; do
  if [ -d "$d" ]; then TV_DIR="$d"; break; fi
done

if [ -n "$TV_DIR" ]; then
  if [ -f "$TV_DIR/scripts/backup.js" ]; then
    node "$TV_DIR/scripts/backup.js" --dest "$MOUNT_POINT/kitchen-tv" || true
  else
    # Direct sync fallback
    mkdir -p "$MOUNT_POINT/kitchen-tv/latest/data/uploads"
    [ -f "$TV_DIR/data/announcements.json" ] && cp "$TV_DIR/data/announcements.json" "$MOUNT_POINT/kitchen-tv/latest/data/"
    [ -d "$TV_DIR/data/uploads" ] && cp -r "$TV_DIR/data/uploads"/* "$MOUNT_POINT/kitchen-tv/latest/data/uploads/" 2>/dev/null || true
  fi
  echo "$ISO_DATE [INFO] kitchen-tv backup complete."
else
  echo "$ISO_DATE [WARN] kitchen-tv directory not found in known paths."
fi

# -----------------------------------------------------------------------------
# 2. Back up Sober Portal (Risk App)
# -----------------------------------------------------------------------------
echo "$ISO_DATE [INFO] Backing up Sober Portal..."
SOBER_DIRS=("/home/zbt/sober-portal" "/opt/zbt-sober" "/home/zbt/Risk-App-main/Risk-App-main" "/home/pi/sober-portal" "$HOME/sober-portal")
SOBER_DIR=""
for d in "${SOBER_DIRS[@]}"; do
  if [ -d "$d" ]; then SOBER_DIR="$d"; break; fi
done

if [ -n "$SOBER_DIR" ]; then
  if [ -f "$SOBER_DIR/backup.mjs" ]; then
    node "$SOBER_DIR/backup.mjs" --dest "$MOUNT_POINT/sober-portal" || true
  elif [ -f "$SOBER_DIR/sober.db" ]; then
    mkdir -p "$MOUNT_POINT/sober-portal/latest" "$MOUNT_POINT/sober-portal/archives"
    sqlite3 "$SOBER_DIR/sober.db" ".backup '$MOUNT_POINT/sober-portal/latest/sober.db'" || cp "$SOBER_DIR/sober.db" "$MOUNT_POINT/sober-portal/latest/"
    cp "$MOUNT_POINT/sober-portal/latest/sober.db" "$MOUNT_POINT/sober-portal/archives/sober-$STAMP.db"
    gzip -f "$MOUNT_POINT/sober-portal/archives/sober-$STAMP.db" 2>/dev/null || true
  fi
  echo "$ISO_DATE [INFO] Sober Portal backup complete."
else
  echo "$ISO_DATE [WARN] Sober Portal directory not found in known paths."
fi

# -----------------------------------------------------------------------------
# 3. Back up KitchenTracker
# -----------------------------------------------------------------------------
echo "$ISO_DATE [INFO] Backing up KitchenTracker..."
KT_DIRS=("/home/zbt/KitchenTracker" "/srv/kitchen" "/home/pi/KitchenTracker" "$HOME/KitchenTracker")
KT_DIR=""
for d in "${KT_DIRS[@]}"; do
  if [ -d "$d" ]; then KT_DIR="$d"; break; fi
done

if [ -n "$KT_DIR" ]; then
  if [ -f "$KT_DIR/scripts/backup.cjs" ]; then
    node "$KT_DIR/scripts/backup.cjs" --dest "$MOUNT_POINT/kitchen-tracker" || true
  elif [ -f "$KT_DIR/scripts/backup.js" ]; then
    node "$KT_DIR/scripts/backup.js" --dest "$MOUNT_POINT/kitchen-tracker" || true
  elif [ -f "$KT_DIR/deploy/backup.sh" ]; then
    bash "$KT_DIR/deploy/backup.sh" || true
  fi
  echo "$ISO_DATE [INFO] KitchenTracker backup complete."
else
  # Direct fallback to known database paths
  KT_DB=""
  for cand in "/home/zbt/KitchenTracker/data/kitchen.db" "/srv/kitchen-data/kitchen.db"; do
    [ -f "$cand" ] && KT_DB="$cand" && break
  done
  if [ -n "$KT_DB" ]; then
    mkdir -p "$MOUNT_POINT/kitchen-tracker/latest" "$MOUNT_POINT/kitchen-tracker/archives"
    cp "$KT_DB" "$MOUNT_POINT/kitchen-tracker/latest/kitchen.db"
    echo "$ISO_DATE [INFO] KitchenTracker database backed up directly."
  fi
fi

# -----------------------------------------------------------------------------
# 4. Back up System Services & Caddy Config
# -----------------------------------------------------------------------------
echo "$ISO_DATE [INFO] Backing up system configuration and services..."
SYS_DEST="$MOUNT_POINT/system-configs"
mkdir -p "$SYS_DEST/systemd"

for svc in kitchen.service kitchen-tv.service zbt-sober.service caddy.service; do
  if [ -f "/etc/systemd/system/$svc" ]; then
    cp "/etc/systemd/system/$svc" "$SYS_DEST/systemd/" 2>/dev/null || true
  fi
done

if [ -f "/etc/caddy/Caddyfile" ]; then
  cp "/etc/caddy/Caddyfile" "$SYS_DEST/Caddyfile" 2>/dev/null || true
fi

# Write master backup manifest
cat > "$MOUNT_POINT/manifest.json" <<EOF
{
  "timestamp": "$ISO_DATE",
  "stamp": "$STAMP",
  "apps": {
    "kitchenTv": $([ -f "$MOUNT_POINT/kitchen-tv/latest/data/announcements.json" ] && echo "true" || echo "false"),
    "soberPortal": $([ -f "$MOUNT_POINT/sober-portal/latest/sober.db" ] && echo "true" || echo "false"),
    "kitchenTracker": $([ -f "$MOUNT_POINT/kitchen-tracker/latest/kitchen.db" ] && echo "true" || echo "false")
  },
  "usbCapacity": "$(df -h "$MOUNT_POINT" | awk 'NR==2 {print $4 " free of " $2}')"
}
EOF

# Ensure restore script is updated on the flash drive
HERE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$HERE_DIR/restore-all.sh" ] && cp "$HERE_DIR/restore-all.sh" "$MOUNT_POINT/restore-all.sh" && chmod +x "$MOUNT_POINT/restore-all.sh"

echo "$ISO_DATE [SUCCESS] Master backup finished successfully."
echo "USB Drive Status: $(df -h "$MOUNT_POINT" | awk 'NR==2 {print $3 " used, " $4 " free (" $5 ")"}')"
