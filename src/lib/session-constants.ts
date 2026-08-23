/**
 * Session constants with no crypto imports.
 *
 * Kept separate so middleware can use them: middleware runs on the edge
 * runtime, and pulling in auth.ts would drag node:crypto along with it.
 */

export const SESSION_COOKIE = 'zbt_session';

/**
 * Sign in once and stay signed in.
 *
 * A full year, so nobody is asked for their PIN twice in the same academic
 * year, and the cookie is renewed on every visit besides. The PIN exists to
 * make actions attributable, not to guard anything worth re-proving weekly -
 * and an app that logs people out is an app they stop opening.
 */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 365;
