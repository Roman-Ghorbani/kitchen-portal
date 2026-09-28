/**
 * Cookie names and lifetimes, with no crypto imports.
 *
 * Kept apart from auth.ts so middleware can use them: middleware runs on the
 * edge runtime, where node:crypto is unavailable.
 */

export const SESSION_COOKIE = 'zbt_session';
export const KIOSK_COOKIE = 'zbt_kiosk';

/**
 * A brother signs in once a year.
 *
 * The cookie is renewed on every visit, and the session is still checked
 * against his credential version on every request, so a long lifetime costs
 * nothing in revocability: resetting his PIN ends it immediately.
 */
export const BROTHER_SESSION_TTL_SECONDS = 60 * 60 * 24 * 365;

/**
 * The manager's session is a working day, and is never extended. His account
 * can post weeks, move points and reset anybody's PIN; it should not sit
 * signed in on a shared laptop in the chapter room.
 */
export const ADMIN_SESSION_TTL_SECONDS = 60 * 60 * 12;

/** Browsers cap cookie lifetimes at 400 days; the kiosk renews on each load. */
export const KIOSK_COOKIE_TTL_SECONDS = 60 * 60 * 24 * 400;
