'use client';

import { useEffect } from 'react';

const KEY = 'zbt.latePlateDevice';

/**
 * Remembers the token and puts it back after a reload that lost it.
 *
 * A kiosk browser that restarts on a bare URL, or a chef who taps a stale
 * bookmark, would otherwise land on a locked screen with no way forward. The
 * token is stored per-origin in this browser only; it is the same secret that
 * was already sitting in the address bar.
 */
export function TokenRecovery() {
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const fromUrl = url.searchParams.get('device');

      if (fromUrl) {
        window.localStorage.setItem(KEY, fromUrl);
        return;
      }

      const stored = window.localStorage.getItem(KEY);
      if (stored) {
        url.searchParams.set('device', stored);
        window.location.replace(url.toString());
      }
    } catch {
      // Private mode, or storage blocked. The bookmarked URL still works.
    }
  }, []);

  return null;
}

/** Stores the token on a screen that already has a working one. */
export function RememberToken({ device }: { device: string }) {
  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, device);
    } catch {
      /* nothing to do */
    }
  }, [device]);

  return null;
}
