import type { NextConfig } from 'next';

/**
 * Response headers for every route.
 *
 * The CSP allows inline scripts and styles because Next's App Router inlines
 * its bootstrap data and this codebase uses React inline styles; everything
 * else is locked to this origin, plus Google Fonts for the typefaces. Framing
 * is refused outright - nothing here should ever render inside another site.
 *
 * HSTS is left to Cloudflare, which terminates TLS for the tunnel.
 */
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CONTENT_SECURITY_POLICY },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
];

const config: NextConfig = {
  poweredByHeader: false,

  async headers() {
    return [{ source: '/:path*', headers: SECURITY_HEADERS }];
  },

  // better-sqlite3 is a native module compiled on the Pi itself, so the app
  // runs with `next start` against the real node_modules rather than a
  // standalone bundle that would have to trace the .node binary.
  serverExternalPackages: ['better-sqlite3'],
};

export default config;
