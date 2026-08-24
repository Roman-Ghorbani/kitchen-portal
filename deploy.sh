#!/usr/bin/env bash
#
# Push whatever is on your laptop to the droplet.
#
#   ./deploy.sh                 test, push to GitHub, deploy, verify
#   ./deploy.sh --skip-tests    same but faster, when you are sure
#   ./deploy.sh --rollback      put the previous version back
#
# Run it from Git Bash on Windows (right-click in the project folder ->
# "Open Git Bash here"), or any terminal on Mac/Linux.
#
# What it does, in order:
#   1. Runs the tests here, and stops if they fail. Nothing broken leaves
#      your laptop.
#   2. Commits and pushes anything uncommitted, after showing you what.
#   3. Backs up the live database before touching anything.
#   4. On the droplet: pulls, installs, migrates, builds, restarts.
#   5. Checks the site actually responds, and rolls back if it does not.
#
# The build happens on the droplet rather than here, because better-sqlite3
# compiles against the machine it runs on - a Windows build will not run on
# Linux.

set -euo pipefail

# ---- your settings -------------------------------------------------------
DROPLET="${KITCHEN_HOST:-kitchen@203.0.113.10}"
APP_DIR=/srv/kitchen
SITE="${KITCHEN_URL:-https://kitchen.zbtaa.online}"
SSH_CMD="ssh -o ControlMaster=auto -o ControlPath=~/.ssh/cm-%r@%h:%p -o ControlPersist=60s -o ConnectTimeout=10"
# --------------------------------------------------------------------------

BOLD=$'\e[1m'; DIM=$'\e[2m'; RED=$'\e[31m'; GREEN=$'\e[32m'; YELLOW=$'\e[33m'; OFF=$'\e[0m'
step() { echo "${BOLD}==>${OFF} $*"; }
ok()   { echo "    ${GREEN}ok${OFF} $*"; }
warn() { echo "    ${YELLOW}!${OFF} $*"; }
die()  { echo "${RED}✗ $*${OFF}" >&2; exit 1; }

SKIP_TESTS=false
ROLLBACK=false
for arg in "$@"; do
  case "$arg" in
    --skip-tests) SKIP_TESTS=true ;;
    --rollback)   ROLLBACK=true ;;
    *) die "unknown option: $arg" ;;
  esac
done

if [[ "$DROPLET" == *YOUR.DROPLET.IP* ]]; then
  die "Edit deploy.sh and set DROPLET to your droplet, or export KITCHEN_HOST."
fi

# ---- rollback ------------------------------------------------------------
if [ "$ROLLBACK" = true ]; then
  step "Rolling back to the previous version"
  $SSH_CMD "$DROPLET" "cd $APP_DIR && git reset --hard HEAD@{1} && npm ci --silent && npm run build && sudo systemctl restart kitchen"
  sleep 4
  code=$(curl -s -o /dev/null -w '%{http_code}' "$SITE/schedule" || echo 000)
  [ "$code" = "200" ] && ok "rolled back, site is up" || die "rolled back but site returns $code"
  exit 0
fi

# ---- 1. tests ------------------------------------------------------------
if [ "$SKIP_TESTS" = true ]; then
  warn "skipping tests"
else
  step "Running tests"
  npm test >/dev/null 2>&1 || die "tests failed - run 'npm test' to see why. Nothing was deployed."
  npx tsc --noEmit >/dev/null 2>&1 || die "typecheck failed - run 'npx tsc --noEmit' to see why."
  ok "tests and typecheck pass"
fi

# ---- 2. push -------------------------------------------------------------
step "Pushing your changes"
if [ -n "$(git status --porcelain)" ]; then
  echo "${DIM}"
  git status --short
  echo "${OFF}"
  read -r -p "    Commit these and deploy? Message (blank to cancel): " msg
  [ -z "$msg" ] && die "cancelled"
  git add -A
  git commit -q -m "$msg"
  ok "committed"
fi

BRANCH=$(git rev-parse --abbrev-ref HEAD)
git push -q origin "$BRANCH"
ok "pushed $BRANCH ($(git rev-parse --short HEAD))"

# ---- 3. back up the live database first ----------------------------------
step "Backing up the live database"
$SSH_CMD "$DROPLET" "sudo /usr/local/bin/kitchen-backup" >/dev/null 2>&1 \
  && ok "snapshot taken" \
  || warn "backup step failed - continuing, but check the droplet"

# ---- 4. deploy -----------------------------------------------------------
step "Deploying to $DROPLET"
$SSH_CMD "$DROPLET" bash -s <<REMOTE
set -euo pipefail
cd $APP_DIR
git fetch --all --quiet
git reset --hard "origin/$BRANCH" --quiet
if git diff --name-only HEAD@{1} HEAD 2>/dev/null | grep -qE "package(-lock)?\.json"; then
  npm ci --silent
fi
npm run db:migrate
npm run build
sudo systemctl restart kitchen
REMOTE
ok "built and restarted on the droplet"

# ---- 5. verify -----------------------------------------------------------
step "Checking the site"
for i in 1 2 3 4 5 6 7 8 9 10; do
  code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$SITE/schedule" || echo 000)
  [ "$code" = "200" ] && break
  sleep 2
done

if [ "$code" = "200" ]; then
  ok "$SITE is up"
  echo ""
  echo "${GREEN}${BOLD}Deployed.${OFF} $(git log -1 --pretty='%s')"
else
  echo ""
  die "site returned $code. Run './deploy.sh --rollback' to put the last version back,
   then 'ssh $DROPLET \"sudo journalctl -u kitchen -n 50\"' to see what broke."
fi
