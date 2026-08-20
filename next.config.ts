import type { NextConfig } from 'next';

const config: NextConfig = {
  // Standalone output keeps the door open for the move to a droplet over
  // fall break - it emits a self-contained server that runs on any Node host.
  output: 'standalone',
};

export default config;
