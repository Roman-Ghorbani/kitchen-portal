# Security

## What is being protected

| Asset | Why it matters |
|---|---|
| Each brother's identity | Flagging, covering and requesting are done *as* someone, and the audit log is used to settle disputes. An impersonated action poisons the record. |
| The manager account | It can post and delete weeks, move points, reset any PIN, and read everyone's dietary flags. |
| Dietary and allergy flags | Health-adjacent information about named people. Shown to the chefs, who must acknowledge it; shown to nobody else. |
| The audit log | The authoritative history. Append-only by design. |
| Where people will be | The schedule says who is in the kitchen at what time. |

## Who the attacker is

The app is on a public hostname, but the realistic adversary is **somebody
who knows the house**: a resident or a friend of one, who can read the
sign-in page's roster, sit near the kitchen tablet, and has a laptop. Not a
nation state. The design goal is that knowing names, watching people sign in,
or getting on the house Wi-Fi gets that person nothing.

## Trust boundaries

```
Internet ──TLS──▶ Cloudflare ──tunnel (outbound from the Pi)──▶ cloudflared ──▶ 127.0.0.1:3000  kitchen-portal
Tailnet  ─────────────────────────────────────────────────────▶ :8080 (gated)   house-display
House LAN ────────────────────────────────────────────────────▶ nothing
```

- `kitchen-portal` binds **127.0.0.1**. The Pi opens no inbound port for it.
  Because only cloudflared (and the house display, locally) can reach the
  port, the `CF-Connecting-IP` header can be trusted as the client address;
  that is what the attempt limiter keys on. **Do not bind the app to a public
  interface** without also removing that trust, or anyone could forge their
  address and dodge the IP limit.
- `house-display` refuses every connection that is not loopback or a Tailscale
  address, by socket address, before any route runs.
- Deploys and shell access go over Tailscale SSH.

## Controls

### Brothers

- **Enrollment.** An account without a PIN can only be claimed with a one-time
  setup code the manager issues and hands over in person or by DM. Codes are
  8 characters of Crockford base-32 (40 bits), stored as an HMAC-SHA-256, valid
  for 7 days, single use, and superseded by any newer code. This closes the
  old hole where the first person to pick a name set its PIN.
- **PINs.** scrypt (N=2^14, 16-byte salt). New PINs are six digits and refuse
  repeats, runs and a short list of the most common choices. Four-digit PINs
  set before this change keep working and can be upgraded from Home.
- **Attempt limiting.** Five free failures per account, then a lock of 1, 2,
  4 ... minutes, capped at 24 hours; separately, 25 failures from one IP across
  all accounts. Counters live in SQLite (`auth_throttle`), so restarting the
  process does not reset them. A script gets about fifteen guesses at one
  account on the first day and one a day after that.
  *Trade-off:* someone can deliberately lock another brother out for up to a
  day. The manager can clear it by resetting the PIN, and every failure is in
  the audit log with its IP.
- **Sessions.** HMAC-SHA-256 signed cookie (httpOnly, Secure, SameSite=Lax),
  one year, renewed on use. Each carries the member's `session_version`,
  compared on every request, so a PIN change, a reset, or *sign out on every
  device* ends all older sessions at once. Deactivating a member signs him out.

### Kitchen manager

- Password stored as an scrypt hash in `ADMIN_PASSWORD_HASH`.
- **TOTP** (RFC 6238, SHA-1, 30 s, ±1 step). The last accepted step is stored,
  so a code cannot be replayed within its window.
- Session is 12 hours and never extended. It carries a fingerprint of the
  configured credentials and a version number: rotating the password or TOTP
  secret, or pressing *Sign out every manager session*, ends every session.
- Stricter lockout than brothers (5-minute base).

### Chef tablet

- Paired once from a 15-minute, single-use code shown to the manager. The
  tablet receives an httpOnly cookie `<device id>.<secret>`; only an HMAC of the
  secret is stored. Each tablet is listed with when it was last seen and can be
  revoked individually. Pairing attempts are rate-limited and logged.
- Before this, the tablet's credential was a token in its bookmarked URL - in
  the address bar, the history and localStorage, shared by every device and
  unrevocable. A tablet still on that bookmark is converted to a paired device
  on its next load, after which the manager retires the old token.

### House display

- Reads `/api/tv/schedule` and `/api/tv/late-plates` with `TV_API_KEY` in a
  header (never a query string). The key is read-only and the payloads carry
  names, statuses and counts - no notes, no allergens, no member ids. The key
  lives in the display's systemd environment; the kiosk browser never sees it.
- Previously the display held the kitchen tablet's write-capable token.

### Everywhere

- **Authorization is on the server.** Every server action and route checks
  the caller; hidden buttons are a courtesy. The manager's "view as brother"
  mode is read-only by construction, because every write compares the acting
  member to the row it changes and `admin` never matches one.
- **CSRF.** Server actions check `Origin`; JSON endpoints need a cookie that
  SameSite=Lax will not send cross-site on a POST, PATCH or PUT. No endpoint
  sends CORS headers.
- **Headers.** Content-Security-Policy (`default-src 'self'`,
  `frame-ancestors 'none'`, `object-src 'none'`), `X-Frame-Options: DENY`,
  `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP. HSTS is set at
  Cloudflare.
- **Calendar feeds** are addressed by an HMAC-signed member id, not the bare
  id the sign-in page exposes.
- **CSV export** prefixes cells that start with `= + - @` so a spreadsheet
  cannot execute them, and the export itself is logged.
- **Secrets** come from the environment and are refused if missing or short;
  there are no defaults in the code.
- **systemd sandboxing**: `ProtectSystem=strict`, read-only home except the
  data directory, `NoNewPrivileges`, restricted address families, `UMask=0077`.

## Data at rest

- The database and `.env.production` are `0600`, owned by the service user.
- Backups are AES-256-GCM with a scrypt-derived key (`BACKUP_PASSPHRASE`). GCM
  authenticates the archive, so a damaged or altered backup fails to decrypt
  instead of restoring bad data. Without a passphrase, the environment file is
  left out of the backup rather than written in the clear.
- The passphrase is on the Pi (to write backups) and in the owner's password
  manager (to restore after losing the Pi). Anyone who can read the Pi's
  environment already has the live database, so this protects the removable
  drive, which is the part that can walk out of the house.

## Audit

`events` is append-only in application code. Authentication events record the
IP and a truncated user agent. The log is readable in full at `/admin/audit`.

## Known limits

- A PIN is a short secret. The limiter, not the PIN, is what makes it safe.
- The roster of names is public on the sign-in page by design; the enrollment
  code is what makes that harmless.
- SQLite cannot enforce append-only at the database level for a process that
  owns the file. Backups are the tamper-evidence of last resort.

## Reporting

If you find a problem, email the maintainer rather than opening a public issue.
