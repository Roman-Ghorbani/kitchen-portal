/**
 * Navigation icons.
 *
 * Inline SVG rather than an icon package: there are seven of them, they never
 * change, and a dependency that ships thousands of glyphs to render seven is
 * not worth the weight.
 */

const common = {
  width: 20,
  height: 20,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.9,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
};

export function NavIcon({ name }: { name: string }) {
  switch (name) {
    case 'my-shifts':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M9 11.5l2 2 4-4" />
          <path d="M12 3l8 3.5v5c0 4.6-3.2 7.9-8 8.5-4.8-.6-8-3.9-8-8.5v-5z" />
        </svg>
      );
    case 'schedule':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="3" y="5" width="18" height="16" rx="2.5" />
          <path d="M3 10h18M8 3v4M16 3v4" />
        </svg>
      );
    case 'availability':
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7.5V12l3 2" />
        </svg>
      );
    case 'dashboard':
      return (
        <svg {...common} aria-hidden="true">
          <rect x="3" y="3" width="7.5" height="9" rx="1.6" />
          <rect x="13.5" y="3" width="7.5" height="5.5" rx="1.6" />
          <rect x="13.5" y="12" width="7.5" height="9" rx="1.6" />
          <rect x="3" y="15.5" width="7.5" height="5.5" rx="1.6" />
        </svg>
      );
    case 'roster':
      return (
        <svg {...common} aria-hidden="true">
          <circle cx="9" cy="8" r="3.4" />
          <path d="M2.8 20c0-3.4 2.8-5.8 6.2-5.8s6.2 2.4 6.2 5.8" />
          <path d="M17 5.2a2.7 2.7 0 010 5.4M18.5 14.4c2.3.5 3.7 2.3 3.7 4.6" />
        </svg>
      );
    case 'manage':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
          <path d="M19.4 15a1.7 1.7 0 00.3 1.9l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.9-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1A1.7 1.7 0 008.9 19a1.7 1.7 0 00-1.9.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.9 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1A1.7 1.7 0 005 8.9a1.7 1.7 0 00-.3-1.9l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.9.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.9-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.9V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" />
        </svg>
      );
    case 'settings':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M4 6h16M4 12h16M4 18h16" />
          <circle cx="9" cy="6" r="2" />
          <circle cx="15" cy="12" r="2" />
          <circle cx="8" cy="18" r="2" />
        </svg>
      );
    case 'signin':
      return (
        <svg {...common} aria-hidden="true">
          <path d="M15 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
          <path d="M10 17l5-5-5-5M15 12H3" />
        </svg>
      );
    default:
      return null;
  }
}
