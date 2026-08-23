# Hosting this on a DigitalOcean droplet

Start to finish, about 30 minutes, most of it waiting.

You need: a DigitalOcean account, a domain, and Git Bash on your laptop
(you already have it — right-click any folder → **Open Git Bash here**).

---

## 1. Create the droplet

1. Go to **cloud.digitalocean.com** → **Create** → **Droplets**
2. **Region**: New York or Toronto — closest to Indiana of the options
3. **Image**: Ubuntu **24.04 (LTS) x64**
4. **Size**: Basic → Regular → **$6/mo** (1 GB / 1 vCPU)
   - The setup script adds swap so the build works on 1 GB. If you'd rather
     not think about it, the $12 option has 2 GB.
5. **Authentication**: **SSH Key** → **New SSH Key**
   - In Git Bash, run: `ssh-keygen -t ed25519 -C "kitchen"` then press Enter
     three times
   - Run `cat ~/.ssh/id_ed25519.pub`, copy the whole line, paste it into
     DigitalOcean, name it `laptop`
   - **Do not choose Password.** SSH keys are both easier and safer here.
6. **Hostname**: `zbt-kitchen`
7. **Create Droplet**

Wait about a minute, then copy the **IP address** from the droplet page.

---

## 2. Point your domain at it

If you don't own a domain yet, Namecheap or Cloudflare will sell you one for
about $10/year. `.com` is fine; `.xyz` is cheaper.

At your registrar, open **DNS settings** and add one record:

| Type | Host / Name | Value | TTL |
|---|---|---|---|
| `A` | `kitchen` | *your droplet IP* | Automatic |

That gives you `kitchen.yourdomain.com`. To use the bare domain instead, set
Host to `@`.

DNS usually takes 5–30 minutes. Check with:

```bash
nslookup kitchen.yourdomain.com
```

When that returns your droplet's IP, carry on. **Don't run step 3 before DNS
resolves** — Caddy will try to get a certificate and fail.

---

## 3. Set up the server

In Git Bash:

```bash
ssh root@YOUR.DROPLET.IP
```

Type `yes` when it asks about authenticity. Then, on the droplet:

```bash
curl -fsSL https://raw.githubusercontent.com/Garbanzobean623/zbt-kitchen/sqlite/deploy/setup-droplet.sh -o setup.sh
bash setup.sh github.com/Garbanzobean623/zbt-kitchen kitchen.yourdomain.com
```

That installs Node, Caddy, the app, a firewall, nightly backups and the daily
reminder. It takes a few minutes.

**It prints your admin password once. Write it down.**

---

## 4. Load the roster

From your laptop, in the project folder:

```bash
scp "C:/Users/rsgho/Downloads/ZBT 26-27 - Names and Contacts - 26-27.csv" root@YOUR.DROPLET.IP:/tmp/roster.csv
```

Then on the droplet:

```bash
cd /srv/kitchen
sudo -u kitchen node --env-file=.env.production --experimental-strip-types src/db/seed.ts
sudo -u kitchen node --env-file=.env.production --experimental-strip-types \
  src/db/import-roster.ts /tmp/roster.csv --exempt "Roman Ghorbani" --commit
rm /tmp/roster.csv
```

The last line matters — that file has 133 people's phone numbers on it and
there's no reason to leave it lying around.

Open **https://kitchen.yourdomain.com**. You should see the schedule page.
Sign in with **I'm the kitchen manager** and the password from step 3.

---

## 5. Wire up your laptop for deploys

Edit `deploy.sh` in the project folder and change the two lines at the top:

```bash
DROPLET="kitchen@YOUR.DROPLET.IP"
SITE="https://kitchen.yourdomain.com"
```

Give the `kitchen` user your SSH key so you don't deploy as root:

```bash
ssh root@YOUR.DROPLET.IP "mkdir -p /home/kitchen/.ssh && cp ~/.ssh/authorized_keys /home/kitchen/.ssh/ && chown -R kitchen:kitchen /home/kitchen/.ssh && chmod 700 /home/kitchen/.ssh"
```

Let that user restart the app without a password:

```bash
ssh root@YOUR.DROPLET.IP "echo 'kitchen ALL=(ALL) NOPASSWD: /bin/systemctl restart kitchen, /usr/local/bin/kitchen-backup' > /etc/sudoers.d/kitchen"
```

---

## Deploying changes

Any time you change anything — a colour, a rule, a whole feature:

```bash
./deploy.sh
```

It runs your tests first and refuses to deploy if they fail, shows you what
you've changed and asks for a commit message, snapshots the live database,
then builds and restarts on the droplet and checks the site came back up.

```bash
./deploy.sh --skip-tests   # when you're sure and in a hurry
./deploy.sh --rollback     # put the previous version back
```

A deploy takes two or three minutes, almost all of it the build. The site is
down for a couple of seconds at the restart.

---

## Everyday commands

```bash
# Is it running?
ssh kitchen@YOUR.DROPLET.IP "systemctl status kitchen"

# What went wrong?
ssh kitchen@YOUR.DROPLET.IP "sudo journalctl -u kitchen -n 100 --no-pager"

# Pull a copy of the live database to your laptop
scp kitchen@YOUR.DROPLET.IP:/srv/kitchen-data/kitchen.db ./backups/live.db

# Local snapshot, verified
npm run db:backup
```

---

## Backups

A verified snapshot runs at 3am and keeps 30 days in `/srv/kitchen-backups`.

That covers "I deleted the wrong week". It does **not** cover "the droplet
died", because the backups are on the same disk. Once a month, or before
anything you care about:

```bash
scp kitchen@YOUR.DROPLET.IP:/srv/kitchen-backups/*.gz ./backups/
```

If you'd rather it were automatic, **Litestream** streams every write to
DigitalOcean Spaces continuously — about five lines of config and $5/month.
Worth it once real disputes depend on this record.

To restore:

```bash
ssh root@YOUR.DROPLET.IP
systemctl stop kitchen
gunzip -c /srv/kitchen-backups/kitchen-2026-09-01.db.gz > /srv/kitchen-data/kitchen.db
chown kitchen:kitchen /srv/kitchen-data/kitchen.db
systemctl start kitchen
```

---

## What costs what

| | |
|---|---|
| Droplet | $6/month |
| Domain | ~$10/year |
| Database | free — it's a file |
| **Total** | **about $7/month** |

The GitHub Student Developer Pack usually includes $200 of DigitalOcean
credit, which would cover your whole term.

---

## If something breaks

**Site won't load.** `ssh kitchen@IP "systemctl status kitchen"`. If it's
stopped, `sudo systemctl restart kitchen`, then read the logs.

**Certificate errors.** DNS probably wasn't ready when you ran setup.
`ssh root@IP "systemctl restart caddy"` and wait a minute.

**Build killed during deploy.** Out of memory. Confirm swap exists with
`free -h`; if it's missing, re-run the setup script.

**You want to start the database over.** Stop the app, delete
`/srv/kitchen-data/kitchen.db`, run `npm run db:migrate`, then seed and import
again. Everything is recoverable from the CSV except the audit log.
