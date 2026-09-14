#!/usr/bin/env bash
#
# ZBT USB 3.2 Flash Drive Setup & Mounting Script for Raspberry Pi
#
# This script formats (optional) and sets up automated, safe mounting for your
# 128GB USB Flash Drive at /mnt/usb-backup, initializes the directory hierarchy,
# and configures the automated backup schedule.
#
# Usage (run as root on the Raspberry Pi):
#   sudo bash setup-usb-drive.sh
#

set -euo pipefail

MOUNT_POINT="/mnt/usb-backup"
BACKUP_LABEL="ZBT_BACKUP"

BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; CYAN=$'\e[36m'; OFF=$'\e[0m'
step() { echo "${CYAN}${BOLD}==>${OFF} $*"; }
ok()   { echo "    ${GREEN}ok${OFF} $*"; }
warn() { echo "    ${YELLOW}!${OFF} $*"; }
die()  { echo "${RED}✗ $*${OFF}" >&2; exit 1; }

[ "$(id -u)" -ne 0 ] && die "Please run this script as root (e.g. sudo bash setup-usb-drive.sh)"

step "1. Detecting connected USB block devices"
echo "${DIM}"
lsblk -o NAME,SIZE,TYPE,FSTYPE,LABEL,MOUNTPOINT,MODEL
echo "${OFF}"

# Look for drive with label ZBT_BACKUP or search for non-root disk (e.g. /dev/sda)
TARGET_DEV=""
if blkid -L "$BACKUP_LABEL" >/dev/null 2>&1; then
  TARGET_DEV=$(blkid -L "$BACKUP_LABEL")
  ok "Found existing partition with label $BACKUP_LABEL at $TARGET_DEV"
else
  # Find candidates (usually sda or sdb, not mmcblk)
  CANDIDATES=($(lsblk -dpno NAME,TYPE | awk '$2=="disk" && $1!~/mmcblk/ {print $1}'))
  if [ ${#CANDIDATES[@]} -eq 0 ]; then
    die "No USB storage devices found. Please plug in the 128GB USB flash drive and try again."
  elif [ ${#CANDIDATES[@]} -eq 1 ]; then
    DEV="${CANDIDATES[0]}"
    echo "Found USB drive: $DEV ($(lsblk -bno SIZE "$DEV" | awk '{printf "%.1f GB", $1/1073741824}'))"
    read -r -p "Do you want to format $DEV as ext4 with label $BACKUP_LABEL? (y/N): " CONFIRM
    if [[ "$CONFIRM" =~ ^[Yy]$ ]]; then
      step "Partitioning and formatting $DEV..."
      wipefs -a "$DEV"
      parted -s "$DEV" mklabel gpt mkpart primary ext4 0% 100%
      sleep 2
      PART="${DEV}1"
      [ ! -b "$PART" ] && PART="${DEV}p1"
      mkfs.ext4 -F -L "$BACKUP_LABEL" "$PART"
      TARGET_DEV="$PART"
      ok "Formatted $TARGET_DEV with ext4 and label $BACKUP_LABEL"
    else
      # If already partitioned, look for first partition
      TARGET_DEV="${DEV}1"
      [ ! -b "$TARGET_DEV" ] && TARGET_DEV="${DEV}p1"
      [ ! -b "$TARGET_DEV" ] && die "No usable partition found on $DEV."
    fi
  else
    echo "Multiple external drives detected:"
    select DEV in "${CANDIDATES[@]}"; do
      if [ -n "$DEV" ]; then
        TARGET_DEV="${DEV}1"
        [ ! -b "$TARGET_DEV" ] && TARGET_DEV="${DEV}p1"
        break
      fi
    done
  fi
fi

step "2. Creating mount point and configuring /etc/fstab"
mkdir -p "$MOUNT_POINT"

# Get UUID of target device
UUID=$(blkid -s UUID -o value "$TARGET_DEV" || true)
[ -z "$UUID" ] && die "Could not determine UUID for $TARGET_DEV"

FSTYPE=$(blkid -s TYPE -o value "$TARGET_DEV" || echo "ext4")

# Update /etc/fstab with nofail so Pi boot NEVER fails if USB is detached
if grep -q "$MOUNT_POINT" /etc/fstab; then
  sed -i "\|${MOUNT_POINT}|d" /etc/fstab
fi

echo "UUID=$UUID $MOUNT_POINT $FSTYPE defaults,nofail,noatime,x-systemd.device-timeout=5 0 2" >> /etc/fstab
ok "Added persistent entry to /etc/fstab (UUID=$UUID, nofail safe mode)"

# Mount
systemctl daemon-reload
mount "$MOUNT_POINT" || mount -a
ok "Mounted $TARGET_DEV at $MOUNT_POINT"

step "3. Setting up directory hierarchy on USB flash drive"
mkdir -p "$MOUNT_POINT/kitchen-tv/latest/data"
mkdir -p "$MOUNT_POINT/kitchen-tv/archives"
mkdir -p "$MOUNT_POINT/sober-portal/latest"
mkdir -p "$MOUNT_POINT/sober-portal/archives"
mkdir -p "$MOUNT_POINT/kitchen-tracker/latest"
mkdir -p "$MOUNT_POINT/kitchen-tracker/archives"
mkdir -p "$MOUNT_POINT/system-configs/systemd"
mkdir -p "$MOUNT_POINT/logs"

# Ensure regular user (e.g. zbt / pi / kitchen) can write to backups
chmod -R 777 "$MOUNT_POINT"
ok "Created directory trees for all 3 apps"

step "4. Installing master backup orchestrator and scheduled cron"
HERE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cp "$HERE_DIR/backup-all.sh" /usr/local/bin/zbt-backup-all
chmod +x /usr/local/bin/zbt-backup-all

cp "$HERE_DIR/restore-all.sh" /usr/local/bin/zbt-restore-all
chmod +x /usr/local/bin/zbt-restore-all

# Also copy restore script directly to the USB drive root for standalone disaster recovery
cp "$HERE_DIR/restore-all.sh" "$MOUNT_POINT/restore-all.sh"
chmod +x "$MOUNT_POINT/restore-all.sh"

# Install nightly automated cron at 3:00 AM + hourly checkpoint
cat > /etc/cron.d/zbt-usb-backup <<'CRONEOF'
# Automated ZBT Kitchen Systems USB Backup
0 3 * * * root /usr/local/bin/zbt-backup-all >> /mnt/usb-backup/logs/backup.log 2>&1
CRONEOF
chmod 644 /etc/cron.d/zbt-usb-backup

ok "Installed /usr/local/bin/zbt-backup-all and /etc/cron.d/zbt-usb-backup"

step "5. Disabling desktop USB insertion popups for kiosk mode"
for UDIR in /home/*; do
  if [ -d "$UDIR" ]; then
    mkdir -p "$UDIR/.config/pcmanfm/default" "$UDIR/.config/pcmanfm/LXDE-pi" "$UDIR/.config/pcmanfm-pi/default" "$UDIR/.config/pcmanfm-pi/LXDE-pi"
    cat > "$UDIR/.config/pcmanfm/default/pcmanfm.conf" <<'PCFMANEOF'
[config]
bm_open_method=0

[volume]
mount_on_startup=0
mount_removable=0
autorun=0

[desktop]
wallpaper_mode=0
desktop_bg=#000000
desktop_fg=#ffffff
desktop_shadow=#000000
show_wm_menu=0
PCFMANEOF
    cp "$UDIR/.config/pcmanfm/default/pcmanfm.conf" "$UDIR/.config/pcmanfm/LXDE-pi/pcmanfm.conf"
    cp "$UDIR/.config/pcmanfm/default/pcmanfm.conf" "$UDIR/.config/pcmanfm-pi/default/pcmanfm.conf"
    cp "$UDIR/.config/pcmanfm/default/pcmanfm.conf" "$UDIR/.config/pcmanfm-pi/LXDE-pi/pcmanfm.conf"
    chown -R "$(basename "$UDIR")":"$(basename "$UDIR")" "$UDIR/.config/pcmanfm" "$UDIR/.config/pcmanfm-pi" 2>/dev/null || true
  fi
done
killall pcmanfm 2>/dev/null || true
ok "Desktop insertion dialogs suppressed"

step "6. Running initial master backup to populate USB flash drive"
/usr/local/bin/zbt-backup-all

echo ""
echo "${GREEN}${BOLD}==============================================================${OFF}"
echo "${GREEN}${BOLD} USB Flash Drive Backup System Successfully Initialized!      ${OFF}"
echo "${GREEN}${BOLD}==============================================================${OFF}"
echo "Mount point:   $MOUNT_POINT"
echo "Capacity:      $(df -h "$MOUNT_POINT" | awk 'NR==2 {print $4 " available (" $2 " total)"}')"
echo "Backup cron:   Nightly at 3:00 AM (and on every deploy)"
echo "Restore tool:  $MOUNT_POINT/restore-all.sh (or 'zbt-restore-all')"
echo ""
