'use client';

import { useEffect } from 'react';

/**
 * Ensures the kitchen / chef kiosk screen is always forced into light mode,
 * regardless of device or browser-level dark mode settings.
 */
export function KitchenTheme() {
  useEffect(() => {
    const root = document.documentElement;
    const prevTheme = root.getAttribute('data-theme');
    const prevColorScheme = root.style.colorScheme;

    root.setAttribute('data-theme', 'light');
    root.style.colorScheme = 'light';

    return () => {
      if (prevTheme) {
        root.setAttribute('data-theme', prevTheme);
      } else {
        root.removeAttribute('data-theme');
      }
      root.style.colorScheme = prevColorScheme;
    };
  }, []);

  return null;
}
