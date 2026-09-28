#!/usr/bin/env bash
#
# Ship the current commit to the Raspberry Pi.
#
#   ./deploy.sh              check, push, back up, build, restart, verify
#   ./deploy.sh --rollback   put the previously deployed commit back
#
# Order of operations, each one a gate for the next:
#   1. Refuse if the working tree is dirty. What ships is a commit, never
#      whatever happens to be on disk.
#   2. Typecheck and run the test suite locally.
#   3. Push the branch.
#   4. On the Pi: take a verified backup, record the running commit, fetch
#      and check out the new one, install if the lockfile changed, migrate,
#      build, restart the service.
#   5. Hit /api/health on the Pi until it answers; if it never does, roll back.
#
# The Pi is reached over Tailscale by SSH; nothing about deploying goes
# through the public tunnel. Override the defaults with environment variables.

set -euo pipefail

HOST="${KP_HOST:-zbt@zbt-kitchen-tv}"
APP_DIR="${KP_APP_DIR:-/home/zbt/kitchen-portal}"
SERVICE="${KP_SERVICE:-kitchen-portal}"
SSH="ssh -o ConnectTimeout=10 $HOST"

say()  { printf '\033[1m==>\033[0m %s\n' "$*"; }
ok()   { printf '    \033[32mok\033[0m %s\n' "$*"; }
die()  { printf '\033[31merror:\033[0m %s\n' "$*" >&2; exit 1; }

health() {
  for _ in $(seq 1 30); do
    $SSH "curl -fsS -o /dev/null http://127.0.0.1:3000/api/health" 2>/dev/null && return 0
    sleep 2
  done
  return 1
}

if [ "${1:-}" = "--rollback" ]; then
  say "Rolling back to the previously deployed commit"
  $SSH bash -s <<REMOTE
set -euo pipefail
cd "$APP_DIR"
prev=\$(cat .deploy-previous)
git checkout --quiet "\$prev"
npm ci --silent
npm run db:migrate
npm run build
sudo systemctl restart "$SERVICE"
echo "now at \$(git rev-parse --short HEAD)"
REMOTE
  health && ok "healthy after rollback" || die "still unhealthy - check: ssh $HOST journalctl -u $SERVICE -n 80"
  exit 0
fi

say "Checking the working tree"
[ -z "$(git status --porcelain)" ] || die "uncommitted changes. Commit or stash them first."
BRANCH=$(git rev-parse --abbrev-ref HEAD)
COMMIT=$(git rev-parse HEAD)
ok "$BRANCH @ ${COMMIT:0:7}"

say "Typecheck and tests"
npm run --silent typecheck || die "typecheck failed"
npm test >/dev/null 2>&1 || die "tests failed - run 'npm test' to see why"
ok "clean"

say "Pushing"
git push --quiet origin "$BRANCH"
ok "pushed"

say "Deploying to $HOST"
$SSH bash -s <<REMOTE
set -euo pipefail
cd "$APP_DIR"
node scripts/backup.mjs
git rev-parse HEAD > .deploy-previous
git fetch --quiet origin
git checkout --quiet "$COMMIT"
if ! git diff --quiet "\$(cat .deploy-previous)" HEAD -- package-lock.json; then npm ci --silent; fi
npm run db:migrate
npm run build
sudo systemctl restart "$SERVICE"
REMOTE
ok "built and restarted"

say "Verifying"
if health; then
  ok "healthy at ${COMMIT:0:7}"
else
  printf '    health check failed - rolling back\n'
  exec "$0" --rollback
fi
