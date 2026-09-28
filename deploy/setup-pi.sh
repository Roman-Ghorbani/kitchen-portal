#!/usr/bin/env bash
#
# First-time install of the Kitchen Portal on a Raspberry Pi (Pi OS, Node 20+).
#
#   git clone <repo> ~/kitchen-portal && cd ~/kitchen-portal
#   cp .env.example .env.production   # fill it in - see README
#   sudo bash deploy/setup-pi.sh
#
# Builds the app, creates the database, and installs the service and the
# reminder timer. Cloudflare Tunnel and the USB backup drive are set up
# separately (README, "Deploying").

set -euo pipefail

APP_USER=${APP_USER:-zbt}
APP_DIR=${APP_DIR:-/home/$APP_USER/kitchen-portal}

die() { echo "error: $*" >&2; exit 1; }
[ "$(id -u)" -eq 0 ] || die "run as root (sudo)"
[ -f "$APP_DIR/.env.production" ] || die "create $APP_DIR/.env.production first"
chmod 600 "$APP_DIR/.env.production"
chown "$APP_USER:$APP_USER" "$APP_DIR/.env.production"

as_app() { sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && $*"; }

as_app "npm ci"
as_app "mkdir -p data && chmod 700 data"
as_app "npm run db:migrate"
as_app "npm run build"

for unit in kitchen-portal.service kitchen-portal-reminder.service kitchen-portal-reminder.timer; do
  install -m 0644 "$APP_DIR/deploy/systemd/$unit" /etc/systemd/system/
done
systemctl daemon-reload
systemctl enable --now kitchen-portal.service kitchen-portal-reminder.timer

sleep 5
curl -fsS http://127.0.0.1:3000/api/health && echo " - kitchen-portal is up on 127.0.0.1:3000"
