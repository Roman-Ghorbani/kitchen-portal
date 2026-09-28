/**
 * Chef tablets.
 *
 * The chefs will not log in, so the tablet has to be trusted as a device. It
 * used to be trusted by a token in its bookmarked URL, which meant the secret
 * sat in the address bar, the browser history and localStorage, and a single
 * token covered every tablet with no way to cut one off.
 *
 * Now a tablet is *paired*. The manager starts a pairing from the Late plates
 * page and gets a short code that is valid for fifteen minutes; the tablet
 * opens /kitchen/pair and types it. The server answers with an httpOnly
 * cookie holding `<device id>.<secret>`, stores only a hash of the secret, and
 * from then on the tablet is simply signed in. Each tablet is listed with when
 * it was last seen and can be revoked on its own.
 */

import { randomBytes } from 'node:crypto';
import { and, desc, eq, gt, isNull, isNotNull } from 'drizzle-orm';

import { db } from '../db/index.ts';
import { kioskDevices, semesters } from '../db/schema.ts';
import { keyedHash, normaliseCode, randomCode, safeEqual } from './auth.ts';

export const PAIRING_TTL_MINUTES = 15;
/** Don't write last-seen on every poll; once a minute is plenty. */
const TOUCH_INTERVAL_MS = 60_000;

export interface KioskDevice {
  id: string;
  label: string;
}

const secretHash = (secret: string) => keyedHash('kiosk-device', secret);
const codeHash = (code: string) => keyedHash('kiosk-pairing', normaliseCode(code));

export async function startPairing(label: string): Promise<{ id: string; code: string; expiresAt: Date }> {
  const code = randomCode();
  const expiresAt = new Date(Date.now() + PAIRING_TTL_MINUTES * 60_000);
  const [row] = await db
    .insert(kioskDevices)
    .values({
      label: label.trim().slice(0, 60) || 'Chef tablet',
      pairingCodeHash: codeHash(code),
      pairingExpiresAt: expiresAt,
    })
    .returning({ id: kioskDevices.id });
  return { id: row.id, code, expiresAt };
}

/** Returns the cookie value for the newly paired tablet, or null. */
export async function completePairing(code: string): Promise<{ device: KioskDevice; cookie: string } | null> {
  const pending = await db
    .select()
    .from(kioskDevices)
    .where(
      and(
        isNotNull(kioskDevices.pairingCodeHash),
        gt(kioskDevices.pairingExpiresAt, new Date()),
        isNull(kioskDevices.revokedAt),
      ),
    );

  const wanted = codeHash(code);
  const match = pending.find((d) => safeEqual(d.pairingCodeHash!, wanted));
  if (!match) return null;

  return activate(match.id, match.label);
}

async function activate(id: string, label: string) {
  const secret = randomBytes(32).toString('base64url');
  await db
    .update(kioskDevices)
    .set({
      secretHash: secretHash(secret),
      pairingCodeHash: null,
      pairingExpiresAt: null,
      pairedAt: new Date(),
      lastSeenAt: new Date(),
    })
    .where(eq(kioskDevices.id, id));
  return { device: { id, label }, cookie: `${id}.${secret}` };
}

/** Resolves a kiosk cookie to its device, or null if unknown or revoked. */
export async function deviceFromCookie(value: string | undefined): Promise<KioskDevice | null> {
  if (!value) return null;
  const dot = value.indexOf('.');
  if (dot <= 0) return null;
  const id = value.slice(0, dot);
  const secret = value.slice(dot + 1);

  const [row] = await db.select().from(kioskDevices).where(eq(kioskDevices.id, id)).limit(1);
  if (!row || row.revokedAt || !row.secretHash) return null;
  if (!safeEqual(row.secretHash, secretHash(secret))) return null;

  if (!row.lastSeenAt || Date.now() - row.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.update(kioskDevices).set({ lastSeenAt: new Date() }).where(eq(kioskDevices.id, id));
  }
  return { id: row.id, label: row.label };
}

export async function revokeDevice(id: string): Promise<KioskDevice | null> {
  const [row] = await db
    .update(kioskDevices)
    .set({ revokedAt: new Date(), pairingCodeHash: null })
    .where(and(eq(kioskDevices.id, id), isNull(kioskDevices.revokedAt)))
    .returning({ id: kioskDevices.id, label: kioskDevices.label });
  return row ?? null;
}

export async function listDevices() {
  const rows = await db
    .select({
      id: kioskDevices.id,
      label: kioskDevices.label,
      pairedAt: kioskDevices.pairedAt,
      lastSeenAt: kioskDevices.lastSeenAt,
      pairingExpiresAt: kioskDevices.pairingExpiresAt,
      createdAt: kioskDevices.createdAt,
    })
    .from(kioskDevices)
    .where(isNull(kioskDevices.revokedAt))
    .orderBy(desc(kioskDevices.createdAt));
  const now = Date.now();
  // A pairing nobody completed is noise once it has expired.
  return rows.filter((r) => r.pairedAt || (r.pairingExpiresAt && r.pairingExpiresAt.getTime() > now));
}

/* ------------------------------------------------------------------ */
/* The old bookmarked link                                             */
/* ------------------------------------------------------------------ */

/**
 * A tablet still on the old `?device=` bookmark gets converted rather than
 * locked out: if the token matches the semester's legacy token it is paired
 * on the spot and the token is dropped from the URL. The manager retires the
 * legacy token from the Late plates page once the tablet shows up as paired.
 */
export async function exchangeLegacyToken(token: string): Promise<{ device: KioskDevice; cookie: string } | null> {
  const [semester] = await db
    .select({ id: semesters.id, kioskToken: semesters.kioskToken })
    .from(semesters)
    .where(eq(semesters.active, true))
    .limit(1);
  if (!semester?.kioskToken || !safeEqual(semester.kioskToken, token)) return null;

  const [row] = await db
    .insert(kioskDevices)
    .values({ label: 'Chef tablet (converted from old link)' })
    .returning({ id: kioskDevices.id, label: kioskDevices.label });
  return activate(row.id, row.label);
}

export async function legacyTokenActive(): Promise<boolean> {
  const [row] = await db
    .select({ kioskToken: semesters.kioskToken })
    .from(semesters)
    .where(eq(semesters.active, true))
    .limit(1);
  return Boolean(row?.kioskToken);
}

export async function retireLegacyToken(): Promise<void> {
  await db.update(semesters).set({ kioskToken: null }).where(eq(semesters.active, true));
}
