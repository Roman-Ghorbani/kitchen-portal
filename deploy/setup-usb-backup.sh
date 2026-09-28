#!/usr/bin/env bash
#
# One-time: prepare the USB drive that holds backups, and schedule them.
#
#   sudo bash deploy/setup-usb-backup.sh
#
#  1. Finds the drive labelled KP_BACKUP (or offers to format the single
#     external disk it finds - never the SD card).
#  2. Mounts it at /mnt/usb-backup via fstab with `nofail`, so the Pi still
#     boots if the drive is unplugged.
#  3. Gives the service user sole ownership of the backup directory (0700).
#     Archives are encrypted anyway; this keeps the drive's contents private to
#     the app account as well.
#  4. Installs and starts the nightly backup timer.

set -euo pipefail

MOUNT=/mnt/usb-backup
LABEL=KP_BACKUP
APP_USER=${APP_USER:-zbt}
APP_DIR=${APP_DIR:-/home/$APP_USER/kitchen-portal}

die() { echo "error: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "run as root (sudo)"

dev=$(blkid -L "$LABEL" 2>/dev/null || true)
if [ -z "$dev" ]; then
  mapfile -t disks < <(lsblk -dpno NAME,TYPE,TRAN | awk '$2=="disk" && $3=="usb" {print $1}')
  [ "${#disks[@]}" -eq 1 ] || die "expected exactly one USB disk, found ${#disks[@]}; label the right one $LABEL and re-run"
  disk=${disks[0]}
  lsblk "$disk"
  read -r -p "Format $disk as ext4 labelled $LABEL? Everything on it is erased. [y/N] " ok
  [[ "$ok" =~ ^[Yy]$ ]] || die "cancelled"
  wipefs -a "$disk"
  parted -s "$disk" mklabel gpt mkpart primary ext4 0% 100%
  sleep 2
  part=$(lsblk -lpno NAME "$disk" | sed -n 2p)
  mkfs.ext4 -F -L "$LABEL" "$part"
  dev=$part
fi

uuid=$(blkid -s UUID -o value "$dev")
mkdir -p "$MOUNT"
sed -i "\|[[:space:]]$MOUNT[[:space:]]|d" /etc/fstab
echo "UUID=$uuid $MOUNT ext4 defaults,nofail,noatime,x-systemd.device-timeout=5 0 2" >> /etc/fstab
systemctl daemon-reload
mount "$MOUNT" 2>/dev/null || mount -a

install -d -o "$APP_USER" -g "$APP_USER" -m 0700 "$MOUNT/kitchen-portal"

install -m 0644 "$APP_DIR/deploy/systemd/kitchen-portal-backup.service" /etc/systemd/system/
install -m 0644 "$APP_DIR/deploy/systemd/kitchen-portal-backup.timer" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now kitchen-portal-backup.timer

echo "Backups go to $MOUNT/kitchen-portal nightly at 03:15."
echo "Run one now:  sudo systemctl start kitchen-portal-backup && journalctl -u kitchen-portal-backup -n 20"
grep -q '^BACKUP_PASSPHRASE=' "$APP_DIR/.env.production" 2>/dev/null \
  || echo "WARNING: set BACKUP_PASSPHRASE in $APP_DIR/.env.production, and keep a copy in your password manager."
