# Operations

Everything runs on one Raspberry Pi (`zbt-kitchen-tv` on the tailnet, user
`zbt`):

| Unit | What |
|---|---|
| `kitchen-portal.service` | this app, `127.0.0.1:3000` |
| `kitchen-portal-backup.timer` | nightly encrypted backup to the USB drive, 03:15 |
| `kitchen-portal-reminder.timer` | day-before Slack reminder, 19:00 |
| `cloudflared.service` | the tunnel that publishes the app |
| `house-display.service` | the dining room board, `:8080`, tailnet and loopback only |

## Environment

`/home/zbt/kitchen-portal/.env.production`, mode `0600`. Every variable is
described in [`.env.example`](../.env.example). The ones that matter most:

- `SESSION_SECRET` - changing it signs everyone out and breaks calendar links.
- `ADMIN_PASSWORD_HASH`, `ADMIN_TOTP_SECRET` - from `npm run admin:credentials`.
- `TV_API_KEY` - also in `/etc/house-display.env` as `KITCHEN_PORTAL_API_KEY`.
- `BACKUP_PASSPHRASE` - **also keep it in a password manager.** A backup
  cannot be restored without it.

## Deploying

From a clean working tree on the laptop:

```bash
./deploy.sh              # typecheck, test, push, back up, migrate, build, restart, verify
./deploy.sh --rollback   # the previously deployed commit
```

The Pi needs one sudoers line so the deploy can restart the service:

```
zbt ALL=(root) NOPASSWD: /usr/bin/systemctl restart kitchen-portal
```

## Backups

```bash
npm run backup                         # now, to the USB drive
npm run restore -- --verify            # prove the newest archive is good
npm run backup:drill                   # full backup → destroy → restore → compare, on a copy
journalctl -u kitchen-portal-backup -n 30
```

### Restoring after a failure

```bash
sudo systemctl stop kitchen-portal
cd ~/kitchen-portal
BACKUP_PASSPHRASE='...' npm run restore -- --from /mnt/usb-backup/kitchen-portal/<archive>.tar.gz.enc
sudo systemctl start kitchen-portal
```

The damaged database is kept as `data/kitchen.db.pre-restore-<time>`. On a
brand-new Pi, clone the repo, restore with `--with-env` to get
`.env.production` back, then run `deploy/setup-pi.sh`.

Archives from the backup scripts this replaced (a bare `kitchen.db`) restore
with `npm run restore -- --from path/to/kitchen.db`; older schemas are
migrated forward automatically.

## Moving the existing Pi install to this layout

The Pi currently runs the app from `~/KitchenTracker` under pm2, with backups
from `/usr/local/bin/zbt-backup-all`. To move it over, once, in this order:

1. **Back up with the old tooling first**
   `cd ~/KitchenTracker && node scripts/backup.cjs`
2. **Credentials.** On the laptop, `npm run admin:credentials`. Generate
   `TV_API_KEY`, `CRON_SECRET` and `BACKUP_PASSPHRASE` too (see `.env.example`).
3. **Move the checkout.**
   ```bash
   pm2 stop all && pm2 delete all && pm2 save
   mv ~/KitchenTracker ~/kitchen-portal && cd ~/kitchen-portal
   git remote set-url origin <kitchen-portal repo>
   git fetch && git checkout <release branch>
   ```
4. **Edit `.env.production`**: add the new variables, delete
   `ADMIN_PASSWORD`, `LATE_PLATE_DEVICE_TOKEN`, `MENU_API_TOKEN`,
   `MENU_SOURCE_URL`, `TV_DISPLAY_TOKEN`, `SENIOR_MENU_PASSWORD`.
   Leave `SESSION_SECRET` unchanged so brothers stay signed in.
5. `sudo bash deploy/setup-pi.sh` - migrates (moves menus and the Senior Week
   password out of the old TV settings, then drops them), builds, installs the
   service. Check `curl -s 127.0.0.1:3000/api/health`.
6. `sudo bash deploy/setup-usb-backup.sh`, then
   `sudo systemctl start kitchen-portal-backup` and read its journal.
7. **Retire the old backup cron** once the new timer has run:
   `sudo rm /etc/cron.d/zbt-usb-backup`. It also backed up the Sober Portal;
   give that app its own timer first if it is still in use.
8. **Kitchen tablet.** It converts itself on its next load. When it shows on
   the Late plates page as paired, press *Retire old link*.
9. **House display.** Deploy the matching `house-display` release and put the
   key in `/etc/house-display.env`.
10. **Tell the house:** brothers with a PIN are unaffected. Anyone who never
    set one needs a setup code (Roster → *Not ready* → *Issue setup codes*).
    Calendar subscriptions need re-adding from Home, because feed links are
    now signed.

Migration `0010` is a one-off data correction that had already run on the Pi;
its body was removed from the published history. If it had not run there,
re-apply that correction by hand.
