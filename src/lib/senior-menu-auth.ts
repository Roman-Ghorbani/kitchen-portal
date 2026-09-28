/**
 * The Senior Week menu (/menu): one shared password for out-of-house seniors
 * and alumni who have no roster account.
 *
 * The password is stored as a scrypt hash in `app_settings`. There is no
 * default: until the manager sets one, the page stays locked. A correct
 * password earns a signed cookie that carries the password's version number,
 * so changing the password signs every device out.
 *
 * Attempt limiting goes through the same throttle as the other credentials.
 */

import { createHmac } from 'node:crypto';

import { hashSecret, verifySecret, safeEqual, sessionSecret } from './auth.ts';
import { getSetting, setSetting, SETTING } from './app-settings.ts';

export const MENU_AUTH_COOKIE = 'zbt_senior_menu';
/** Browsers cap cookie lifetimes at 400 days. */
export const MENU_AUTH_TTL_SECONDS = 60 * 60 * 24 * 400;
export const MIN_MENU_PASSWORD_LENGTH = 8;

export async function seniorMenuPasswordSet(): Promise<boolean> {
  return Boolean(await getSetting<string | null>(SETTING.seniorMenuPasswordHash, null));
}

export async function setSeniorMenuPassword(password: string): Promise<void> {
  await setSetting(SETTING.seniorMenuPasswordHash, hashSecret(password));
  await setSetting(SETTING.seniorMenuVersion, (await menuVersion()) + 1);
}

export async function verifySeniorMenuPassword(candidate: string): Promise<boolean> {
  if (!candidate) return false;
  const stored = await getSetting<string | null>(SETTING.seniorMenuPasswordHash, null);
  if (!stored) return false;

  // Carried over in plaintext by migration 0011; upgraded on first use.
  if (stored.startsWith('plain$')) {
    const ok = safeEqual(candidate.trim(), stored.slice('plain$'.length).trim());
    if (ok) await setSetting(SETTING.seniorMenuPasswordHash, hashSecret(candidate.trim()));
    return ok;
  }
  return verifySecret(candidate.trim(), stored);
}

async function menuVersion(): Promise<number> {
  return getSetting<number>(SETTING.seniorMenuVersion, 1);
}

const sign = (body: string) =>
  createHmac('sha256', sessionSecret()).update(`senior-menu:${body}`).digest('base64url');

export async function signMenuToken(): Promise<string> {
  const payload = { v: await menuVersion(), exp: Math.floor(Date.now() / 1000) + MENU_AUTH_TTL_SECONDS };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

export async function verifyMenuToken(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const [body, sig] = token.split('.');
  if (!body || !sig || !safeEqual(sig, sign(body))) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return (
      typeof payload.exp === 'number' &&
      payload.exp > Math.floor(Date.now() / 1000) &&
      payload.v === (await menuVersion())
    );
  } catch {
    return false;
  }
}
