# Putting the droplet on the tailnet

Goal: `kitchen.zbtaa.online` (the droplet, `zbt-kitchen`) can read the day's
menu from the kitchen TV Pi (`zbt-kitchen-tv`), which is where menus are
actually entered.

The Pi is already on the tailnet. The droplet is not. Everything below runs on
the droplet except where it says otherwise.

## Why not just open a port on the Pi

Because the alternative is port-forwarding a Raspberry Pi on the house router to
the public internet, and that Pi has an admin console with no authentication on
it. Tailscale gives the two machines a private link with nothing exposed, and
the Pi's firewall stays shut. It is also less work.

## 1. Get an auth key

On [login.tailscale.com](https://login.tailscale.com) → **Settings** → **Keys**
→ **Generate auth key**.

- **Reusable**: off (one machine, one key)
- **Ephemeral**: off — the droplet is permanent and should keep its name
- **Tags**: `tag:server` if you use tags; otherwise skip
- Copy the `tskey-auth-...` value. It is shown once.

## 2. Install Tailscale on the droplet

```bash
ssh root@YOUR.DROPLET.IP

curl -fsSL https://tailscale.com/install.sh | sh
tailscale up --authkey=tskey-auth-XXXXXXXX --hostname=zbt-kitchen --accept-dns=true
```

`--authkey` matters: a bare `tailscale up` blocks waiting for a browser login
that a headless droplet cannot show you. That one cost an evening on the Pi
already (see `kitchen-tv-pi-setup.md`, gotcha 6).

`--accept-dns=true` is what makes the bare name `zbt-kitchen-tv` resolve. Without
it you would have to hardcode the Pi's `100.x.y.z` address, which changes if the
machine is ever re-added.

Check it worked:

```bash
tailscale status
ping -c 2 zbt-kitchen-tv
curl -s "http://zbt-kitchen-tv:8080/api/menu" | head -c 300
```

That last command is the whole point — if it prints JSON, you are done with the
network half.

## 3. Do NOT expose the Pi through Caddy

It will be tempting to proxy `kitchen.zbtaa.online/menu` straight through to the
Pi. Don't. That puts an unauthenticated admin console on the public internet by
one config line, and the app already fetches the menu server-side, so there is
nothing to gain.

## 4. Point the app at it

Add to `/srv/kitchen/.env.production`:

```
MENU_SOURCE_URL=http://zbt-kitchen-tv:8080/api/menu
```

Then restart:

```bash
sudo systemctl restart kitchen
```

The systemd unit hardens the service (`ProtectSystem=full`, `NoNewPrivileges`),
none of which blocks outbound network, so no unit change is needed.

Leave `MENU_SOURCE_URL` unset on your laptop. The menu section then simply does
not render, which is the right behaviour off the tailnet — you do not need
Tailscale on your dev machine to work on this app.

## 5. Confirm

Open the late-plate page as a brother. Today's meals should carry an
**On the menu** line. If they don't:

```bash
# Is the app actually trying?
sudo journalctl -u kitchen -n 50 --no-pager | grep menu
```

A line reading `[menu] could not reach the kitchen TV` means the fetch failed —
network, not code. Re-run the `curl` from step 2 as the `kitchen` user.

## How it behaves when the Pi is off

By design, invisibly:

- One second timeout, then the page renders without a menu. The Pi being down
  never makes the site slow.
- The last good menu is served from an in-process cache and labelled
  *(last known)*.
- No cache and no Pi means no menu section at all, rather than an empty card —
  an empty card reads as "no food", which is worse than saying nothing.

Cache is one minute, so a menu corrected at 4:25 is on the site before dinner,
and a page refresh doesn't hit the Pi again.

## The Pi side

`GET /api/menu?date=YYYY-MM-DD` on the Pi (added to `server.js` on branch
`roman-v1`), defaulting to today on the house clock:

```json
{ "success": true, "date": "2026-08-26", "hasMenu": true,
  "timezone": "America/Indiana/Indianapolis",
  "lunch":  { "label": "Lunch",  "serve": "11:00 AM – 2:30 PM", "items": ["…"] },
  "dinner": { "label": "Dinner", "serve": "4:30 PM – 7:30 PM",  "items": ["…"] } }
```

Kept separate from `/api/announcements` on purpose: that one is the TV's 1 Hz
poll and its shape belongs to the display. This one is a contract with another
machine and should not change every time the board gets a new field.

Deploy it the usual way — push `roman-v1`, then on the Pi `cd ~/kitchen-tv &&
git pull && sudo systemctl restart kitchen-tv`. `server.js` changed, so a
restart is enough; no reboot needed.

## Worth doing later

- **Tailscale ACLs.** Right now anything on the tailnet can reach anything. A
  rule letting only `zbt-kitchen` reach `zbt-kitchen-tv:8080` would be a few
  lines in the admin console.
- **Put the Pi's admin console behind something.** Tailscale means only tailnet
  devices can reach it, which is a real improvement over nothing — but that
  includes every phone you ever add to the tailnet.
