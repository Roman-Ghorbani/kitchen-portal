import type { NextConfig } from 'next';

const config: NextConfig = {
  /*
   * The TV console and comms studio are copies of the standalone kitchen-tv
   * app, which serves them from its own root - so they ask for /studio.css,
   * /studio.js, /ann-render.js and /post. Here they live under /tv/, and every
   * one of those requests 404s, which is why the console renders unstyled and
   * its Comms Studio button goes nowhere.
   *
   * Rewriting is the right fix rather than editing the files: the same copies
   * still have to work unchanged on the Pi.
   */
  async rewrites() {
    return [
      { source: '/studio.css', destination: '/tv/studio.css' },
      { source: '/studio.js', destination: '/tv/studio.js' },
      { source: '/ann-render.js', destination: '/tv/ann-render.js' },
      { source: '/post', destination: '/tv/post.html' },
    ];
  },

  // No 'standalone' output. better-sqlite3 is a native module, so the droplet
  // installs and builds for itself; running `next start` against the real
  // node_modules is simpler and avoids file-tracing surprises with the
  // compiled .node binary.
  serverExternalPackages: ['better-sqlite3'],
};

export default config;
