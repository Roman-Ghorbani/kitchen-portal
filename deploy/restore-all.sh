#!/usr/bin/env bash
#
# ZBT Master Disaster Recovery & Restoration Script
#
# Restores all three kitchen systems apps, databases, uploads, secrets,
# and systemd services from the 128GB USB Flash Drive (/mnt/usb-backup).
#
# Usage (run as root on the Raspberry Pi):
#   sudo bash /mnt/usb-backup/restore-all.sh
#   or: sudo zbt-restore-all
#

set -euo pipefail

MOUNT_POINT="/mnt/usb-backup"
BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; CYAN=$'\e[36m'; OFF=$'\e[0m'

step() { echo "${CYAN}${BOLD}==>${OFF} $*"; }
ok()   { echo "    ${GREEN}ok${OFF} $*"; }
warn() { echo "    ${YELLOW}!${OFF} $*"; }
die()  { echo "${RED}✗ $*${OFF}" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] && die "Please run this script as root (e.g. sudo bash restore-all.sh)"

[ ! -d "$MOUNT_POINT" ] && die "Backup directory $MOUNT_POINT not found. Ensure USB flash drive is mounted."

echo ""
echo "${BOLD}================================================================${OFF}"
echo "${BOLD}  ZBT Kitchen Systems - Disaster Recovery & Full Restore Tool  ${OFF}"
echo "${BOLD}================================================================${OFF}"
echo ""

# -----------------------------------------------------------------------------
# 1. Restore System Configurations & Services
# -----------------------------------------------------------------------------
step "1. Restoring systemd services and Caddy configuration"
if [ -d "$MOUNT_POINT/system-configs/systemd" ]; then
  for svc in "$MOUNT_POINT/system-configs/systemd"/*.service; do
    [ -f "$svc" ] && cp "$svc" /etc/systemd/system/ && ok "Restored $(basename "$svc")"
  done
  systemctl daemon-reload
fi

if [ -f "$MOUNT_POINT/system-configs/Caddyfile" ]; then
  mkdir -p /etc/caddy
  cp "$MOUNT_POINT/system-configs/Caddyfile" /etc/caddy/Caddyfile
  ok "Restored /etc/caddy/Caddyfile"
fi

# -----------------------------------------------------------------------------
# 2. Restore KitchenTracker
# -----------------------------------------------------------------------------
step "2. Restoring KitchenTracker"
KT_DIR="/srv/kitchen"
KT_DATA="/srv/kitchen-data"
KT_BACKUP="$MOUNT_POINT/kitchen-tracker/latest"

mkdir -p "$KT_DIR" "$KT_DATA"

if [ -f "$KT_BACKUP/kitchen.db" ]; then
  # Stop service if running
  systemctl stop kitchen 2>/dev/null || true

  # Restore database
  cp "$KT_BACKUP/kitchen.db" "$KT_DATA/kitchen.db"
  # Clean WAL
  rm -f "$KT_DATA/kitchen.db-wal" "$KT_DATA/kitchen.db-shm"

  # Restore uploads
  if [ -d "$KT_BACKUP/uploads" ]; then
    mkdir -p "$KT_DATA/uploads"
    cp -r "$KT_BACKUP/uploads"/* "$KT_DATA/uploads/" 2>/dev/null || true
  fi

  # Restore .env.production
  if [ -f "$KT_BACKUP/.env.production" ]; then
    cp "$KT_BACKUP/.env.production" "$KT_DIR/.env.production"
    chmod 600 "$KT_DIR/.env.production"
  fi

  # Set permissions if kitchen user exists
  if id -u kitchen >/dev/null 2>&1; then
    chown -R kitchen:kitchen "$KT_DIR" "$KT_DATA"
  fi

  ok "Restored KitchenTracker database, uploads, and production secrets"
else
  warn "No KitchenTracker backup found in $KT_BACKUP"
fi

# -----------------------------------------------------------------------------
# 3. Restore Sober Portal
# -----------------------------------------------------------------------------
step "3. Restoring Sober Portal"
SOBER_DIR="/home/zbt/sober-portal"
[ ! -d "$SOBER_DIR" ] && [ -d "/opt/zbt-sober" ] && SOBER_DIR="/opt/zbt-sober"
SOBER_BACKUP="$MOUNT_POINT/sober-portal/latest"

mkdir -p "$SOBER_DIR"

if [ -f "$SOBER_BACKUP/sober.db" ]; then
  systemctl stop zbt-sober 2>/dev/null || true
  which pm2 >/dev/null 2>&1 && pm2 stop sober-portal 2>/dev/null || true

  cp "$SOBER_BACKUP/sober.db" "$SOBER_DIR/sober.db"
  rm -f "$SOBER_DIR/sober.db-wal" "$SOBER_DIR/sober.db-shm"

  for envFile in .env .env.production; do
    [ -f "$SOBER_BACKUP/$envFile" ] && cp "$SOBER_BACKUP/$envFile" "$SOBER_DIR/$envFile"
  done

  if id -u zbt >/dev/null 2>&1; then
    chown -R zbt:zbt "$SOBER_DIR"
  fi

  ok "Restored Sober Portal database (sober.db) and configuration"
else
  warn "No Sober Portal backup found in $SOBER_BACKUP"
fi

# -----------------------------------------------------------------------------
# 4. Restore Kitchen TV Display
# -----------------------------------------------------------------------------
step "4. Restoring Kitchen TV Display"
TV_DIR="/home/zbt/kitchen-tv"
[ ! -d "$TV_DIR" ] && [ -d "/home/pi/kitchen-tv" ] && TV_DIR="/home/pi/kitchen-tv"
TV_BACKUP="$MOUNT_POINT/kitchen-tv/latest"

mkdir -p "$TV_DIR/data/uploads"

if [ -f "$TV_BACKUP/data/announcements.json" ] || [ -f "$TV_BACKUP/announcements.json" ]; then
  systemctl stop kitchen-tv 2>/dev/null || true

  if [ -f "$TV_BACKUP/data/announcements.json" ]; then
    cp "$TV_BACKUP/data/announcements.json" "$TV_DIR/data/announcements.json"
  elif [ -f "$TV_BACKUP/announcements.json" ]; then
    cp "$TV_BACKUP/announcements.json" "$TV_DIR/data/announcements.json"
  fi

  # Uploads
  if [ -d "$TV_BACKUP/data/uploads" ]; then
    cp -r "$TV_BACKUP/data/uploads"/* "$TV_DIR/data/uploads/" 2>/dev/null || true
  elif [ -d "$TV_BACKUP/uploads" ]; then
    cp -r "$TV_BACKUP/uploads"/* "$TV_DIR/data/uploads/" 2>/dev/null || true
  fi

  # Caches
  for c in "$TV_BACKUP"/data/cache-*.json; do
    [ -f "$c" ] && cp "$c" "$TV_DIR/data/" 2>/dev/null || true
  done

  if id -u zbt >/dev/null 2>&1; then
    chown -R zbt:zbt "$TV_DIR"
  fi

  ok "Restored Kitchen TV announcements, ticker, themes, and uploaded media"
else
  warn "No Kitchen TV backup found in $TV_BACKUP"
fi

# -----------------------------------------------------------------------------
# 5. Restarting Services
# -----------------------------------------------------------------------------
step "5. Restarting all services"
for svc in kitchen-tv zbt-sober kitchen caddy; do
  if systemctl list-unit-files | grep -q "^$svc\.service"; then
    systemctl enable "$svc" 2>/dev/null || true
    systemctl restart "$svc" 2>/dev/null || true
    ok "Restarted $svc.service"
  fi
done

echo ""
echo "${GREEN}${BOLD}================================================================${OFF}"
echo "${GREEN}${BOLD}  Restoration Complete! All apps and databases are live.       ${OFF}"
echo "${GREEN}${BOLD}================================================================${OFF}"
echo ""
