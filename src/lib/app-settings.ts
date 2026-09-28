/**
 * Deployment-wide settings stored in the database (`app_settings`).
 *
 * For values that are neither per-semester nor secret enough to belong in the
 * environment: the manager's session version, the last TOTP step used, the
 * Senior Week menu password hash.
 */

import { eq } from 'drizzle-orm';

import { db } from '../db/index.ts';
import { appSettings } from '../db/schema.ts';

export const SETTING = {
  adminSessionVersion: 'admin.sessionVersion',
  adminTotpLastStep: 'admin.totpLastStep',
  seniorMenuPasswordHash: 'seniorMenu.passwordHash',
  seniorMenuVersion: 'seniorMenu.version',
} as const;

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, key));
  return row ? (row.value as T) : fallback;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db
    .insert(appSettings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: new Date() } });
}

/**
 * The manager's session version starts at 1, not 0, so any admin session
 * minted before versioning existed (which reads as version 0) is refused.
 */
export async function adminSessionVersion(): Promise<number> {
  return getSetting<number>(SETTING.adminSessionVersion, 1);
}

export async function bumpAdminSessionVersion(): Promise<number> {
  const next = (await adminSessionVersion()) + 1;
  await setSetting(SETTING.adminSessionVersion, next);
  return next;
}
