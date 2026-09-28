/**
 * Who is on the other end of a request, as far as the network can tell us.
 *
 * In production the app listens on 127.0.0.1 only and is reached through a
 * Cloudflare Tunnel, so every connection arrives from cloudflared on the same
 * machine and the socket address is useless. Cloudflare puts the real client
 * address in `CF-Connecting-IP`, and because nothing but the tunnel can reach
 * the port, nothing but Cloudflare can set that header. That is the only
 * reason it is trusted - see SECURITY.md before binding the app to a public
 * interface.
 */

import { headers } from 'next/headers.js';

export interface RequestContext {
  ip: string;
  userAgent: string;
}

export function contextFrom(h: Headers): RequestContext {
  const forwarded = h.get('x-forwarded-for')?.split(',')[0]?.trim();
  const ip = h.get('cf-connecting-ip') ?? h.get('x-real-ip') ?? forwarded ?? 'local';
  const userAgent = (h.get('user-agent') ?? '').slice(0, 160);
  return { ip, userAgent };
}

/** For server actions and server components. */
export async function requestContext(): Promise<RequestContext> {
  return contextFrom(await headers());
}
