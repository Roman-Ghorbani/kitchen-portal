import type { NextConfig } from 'next';

const config: NextConfig = {
  // No 'standalone' output. better-sqlite3 is a native module, so the droplet
  // installs and builds for itself; running `next start` against the real
  // node_modules is simpler and avoids file-tracing surprises with the
  // compiled .node binary.
  serverExternalPackages: ['better-sqlite3'],
};

export default config;
