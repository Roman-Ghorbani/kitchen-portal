/**
 * Calendar subscription links.
 *
 * A calendar app polls the feed without cookies, so the URL itself has to be
 * the credential. It used to be the bare member id - which the sign-in page
 * hands to every visitor - so anyone could read anyone's shifts. Now the URL
 * carries an HMAC of the id: unforgeable without the server's secret, stable
 * across PIN changes so a subscription keeps working.
 */

import { keyedHash, safeEqual } from './auth.ts';

const sign = (memberId: string) => keyedHash('calendar-feed', memberId).slice(0, 22);

export function calendarFeedToken(memberId: string): string {
  return `${memberId}.${sign(memberId)}`;
}

/** The member id a feed token was issued for, or null if it was not ours. */
export function memberFromFeedToken(token: string): string | null {
  const dot = token.lastIndexOf('.');
  if (dot <= 0) return null;
  const memberId = token.slice(0, dot);
  return safeEqual(token.slice(dot + 1), sign(memberId)) ? memberId : null;
}
