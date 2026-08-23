#!/usr/bin/env bash
#
# One-time droplet setup. Run this ONCE on a fresh Ubuntu 24.04 droplet,
# as root:
#
#   bash setup-droplet.sh github.com/YOURNAME/zbt-kitchen kitchen.yourdomain.com
#
# It installs Node, Caddy and the app, creates an unprivileged user to run it,
# sets up nightly backups, and starts everything. Safe to re-run.

set -euo pipefail

REPO="${1:-}"
DOMAIN="${2:-}"

if [ -z "$REPO" ] || [ -z "$DOMAIN" ]; then
  echo "usage: bash setup-droplet.sh <github-repo> <domain>"
  echo "   eg: bash setup-droplet.sh github.com/Garbanzobean623/zbt-kitchen kitchen.zbtpurdue.com"
  exit 1
fi

APP_DIR=/srv/kitchen
DATA_DIR=/srv/kitchen-data
BACKUP_DIR=/srv/kitchen-backups

echo "==> Updating the system"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get upgrade -y -qq

echo "==> Adding swap if the box has under 2GB of RAM"
# Building Next.js needs more memory than a 1GB droplet has. Swap makes the
# cheapest droplet work; without it the build is killed part way through.
if [ ! -f /swapfile ] && [ "$(free -m | awk '/^Mem:/{print $2}')" -lt 1900 ]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
  echo "    added 2GB swap"
else
  echo "    not needed"
fi

echo "==> Installing Node 22, git, build tools, sqlite3"
if ! command -v node >/dev/null 2>&1; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
fi
apt-get install -y -qq nodejs git build-essential python3 sqlite3 ufw

echo "==> Installing Caddy (handles HTTPS certificates automatically)"
if ! command -v caddy >/dev/null 2>&1; then
  apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    | tee /etc/apt/sources.list.d/caddy-stable.list >/dev/null
  apt-get update -qq
  apt-get install -y -qq caddy
fi

echo "==> Creating the kitchen user and directories"
id -u kitchen >/dev/null 2>&1 || useradd --system --create-home --shell /bin/bash kitchen
mkdir -p "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"
chown -R kitchen:kitchen "$APP_DIR" "$DATA_DIR" "$BACKUP_DIR"

echo "==> Fetching the app"
# SSH rather than HTTPS: the repo is private, and a deploy key scoped to just
# this repo is the right amount of access for a droplet to have - unlike a
# personal token, it cannot read anything else on the GitHub account.
REPO_SSH="git@github.com:$(echo "$REPO" | sed 's#^github.com/##').git"
BRANCH="${DEPLOY_BRANCH:-sqlite}"

if [ -d "$APP_DIR/.git" ]; then
  sudo -u kitchen git -C "$APP_DIR" fetch --all --quiet
  sudo -u kitchen git -C "$APP_DIR" reset --hard "origin/$BRANCH" --quiet
else
  sudo -u kitchen mkdir -p /home/kitchen/.ssh
  sudo -u kitchen ssh-keyscan -t ed25519 github.com >> /home/kitchen/.ssh/known_hosts 2>/dev/null
  sudo -u kitchen git clone --quiet --branch "$BRANCH" "$REPO_SSH" "$APP_DIR"
fi

echo "==> Writing the environment file"
if [ ! -f "$APP_DIR/.env.production" ]; then
  SESSION_SECRET=$(openssl rand -hex 32)
  CRON_SECRET=$(openssl rand -base64 24 | tr -d '=+/')
  ADMIN_PASSWORD=$(openssl rand -base64 12 | tr -d '=+/')

  cat > "$APP_DIR/.env.production" <<ENVEOF
DATABASE_FILE=$DATA_DIR/kitchen.db
SESSION_SECRET=$SESSION_SECRET
ADMIN_PASSWORD=$ADMIN_PASSWORD
CRON_SECRET=$CRON_SECRET
NEXT_PUBLIC_APP_URL=https://$DOMAIN
SLACK_WEBHOOK_URL=
ENVEOF
  chown kitchen:kitchen "$APP_DIR/.env.production"
  chmod 600 "$APP_DIR/.env.production"

  echo ""
  echo "    ############################################################"
  echo "    #  YOUR ADMIN PASSWORD IS:  $ADMIN_PASSWORD"
  echo "    #  Write this down now. It is not shown again."
  echo "    ############################################################"
  echo ""
else
  echo "    .env.production already exists, leaving it alone"
fi

echo "==> Installing dependencies and building (this takes a few minutes)"
cd "$APP_DIR"
sudo -u kitchen npm ci --silent
sudo -u kitchen npm run db:migrate
sudo -u kitchen npm run build

echo "==> Installing the service"
cp "$APP_DIR/deploy/kitchen.service" /etc/systemd/system/kitchen.service
systemctl daemon-reload
systemctl enable --now kitchen

echo "==> Configuring Caddy for $DOMAIN"
sed "s/kitchen.example.com/$DOMAIN/" "$APP_DIR/deploy/Caddyfile" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

echo "==> Nightly backups at 3am, keeping 30 days"
cp "$APP_DIR/deploy/backup.sh" /usr/local/bin/kitchen-backup
chmod +x /usr/local/bin/kitchen-backup
cat > /etc/cron.d/kitchen-backup <<'CRONEOF'
0 3 * * * root /usr/local/bin/kitchen-backup >> /var/log/kitchen-backup.log 2>&1
CRONEOF

echo "==> Daily shift reminder at 6pm"
CRON_SECRET_VALUE=$(grep '^CRON_SECRET=' "$APP_DIR/.env.production" | cut -d= -f2-)
cat > /etc/cron.d/kitchen-reminder <<CRONEOF
0 18 * * * root curl -fsS -H "Authorization: Bearer $CRON_SECRET_VALUE" http://127.0.0.1:3000/api/cron/reminder >/dev/null 2>&1
CRONEOF

echo "==> Firewall: allow SSH and web only"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo ""
echo "Done. https://$DOMAIN should be live once DNS has propagated."
echo ""
echo "Next: import the roster."
echo "  cd $APP_DIR"
echo "  sudo -u kitchen node --env-file=.env.production --experimental-strip-types src/db/seed.ts"
echo "  sudo -u kitchen node --env-file=.env.production --experimental-strip-types \\"
echo "    src/db/import-roster.ts /tmp/roster.csv --exempt \"Roman Ghorbani\" --commit"
echo ""
systemctl --no-pager status kitchen | head -5
