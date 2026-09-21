import Link from 'next/link';

import { signOut } from '../actions/auth-actions.ts';
import { stopViewingAs } from '../actions/preview-actions.ts';
import type { SessionPayload } from '../../lib/auth.ts';
import { NavIcon } from './nav-icons.tsx';

/*
 * Four destinations, and every one of them answers a different question.
 * Availability is deliberately not here: it is set once a semester, so it
 * lives on Home as a card rather than spending a permanent slot.
 */
const BROTHER_NAV = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/schedule', label: 'Board', icon: 'schedule' },
  { href: '/late-plate', label: 'Plate', icon: 'late-plate' },
  { href: '/menu', label: 'Menu', icon: 'menu' },
  { href: '/standings', label: 'Standings', icon: 'standings' },
];

/*
 * Five, down from eight. The three that went were duplicates: Stats and the
 * roster's own tiles both folded into the dashboard, week creation folded into
 * Weeks, and the TV console moved under Settings where the rest of the
 * hardware lives.
 */
const ADMIN_NAV = [
  { href: '/admin', label: 'Dashboard', icon: 'dashboard' },
  { href: '/admin/week', label: 'Weeks', icon: 'schedule' },
  { href: '/admin/roster', label: 'Roster', icon: 'roster' },
  { href: '/admin/late-plates', label: 'Late plates', icon: 'late-plate' },
  { href: '/admin/settings', label: 'Settings', icon: 'settings' },
];

/** Signed out, the only thing worth showing is the schedule itself. */
const PUBLIC_NAV = [{ href: '/schedule', label: 'Schedule', icon: 'schedule' }];

export function AppShell({
  session,
  active,
  title,
  subtitle,
  viewingAs,
  children,
}: {
  session: SessionPayload | null;
  active: string;
  title: string;
  subtitle?: string;
  /** Set when a manager is looking through a brother's account. */
  viewingAs?: string | null;
  children: React.ReactNode;
}) {
  // While previewing, the manager gets the brother's four tabs - the point is
  // to see what the house sees, and his own sidebar would defeat that.
  const nav = !session
    ? PUBLIC_NAV
    : session.role === 'admin' && !viewingAs
      ? ADMIN_NAV
      : session.role === 'admin'
        ? BROTHER_NAV
        : BROTHER_NAV;

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          <div className="brand-mark">ZBT</div>
          <div className="brand-text">
            <div className="t1">Kitchen Portal</div>
            <div className="t2">Fall 2026</div>
          </div>
        </div>

        <div className="nav">
          {nav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`nav-item${active === item.href ? ' active' : ''}`}
            >
              <NavIcon name={item.icon} />
              <span>{item.label}</span>
            </Link>
          ))}

          {!session && (
            <Link href="/signin" className="nav-item nav-signin">
              <NavIcon name="signin" />
              <span>Sign in</span>
            </Link>
          )}
        </div>
      </nav>

      <div className="main">
        {viewingAs && (
          <div className="preview-bar">
            <span className="preview-dot" aria-hidden="true" />
            <span className="preview-text">
              You are looking at <strong>{viewingAs}</strong>&apos;s account.
              Nothing here can be changed.
            </span>
            <form action={stopViewingAs}>
              <button className="btn sm" type="submit">
                Back to the dashboard
              </button>
            </form>
          </div>
        )}

        <header className="topbar">
          <div>
            <h1>{title}</h1>
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>

          {session ? (
            <form action={signOut}>
              <button className="btn sm" type="submit">
                {session.name} · Sign out
              </button>
            </form>
          ) : (
            <Link className="btn gold sm" href="/signin">
              Sign in
            </Link>
          )}
        </header>

        <div className="content">{children}</div>
      </div>

      <nav className="mobile-bottom-nav" aria-label="Mobile Navigation">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`mobile-nav-item${active === item.href ? ' active' : ''}`}
          >
            <NavIcon name={item.icon} />
            <span>{item.label}</span>
          </Link>
        ))}
        {!session && (
          <Link href="/signin" className="mobile-nav-item nav-signin">
            <NavIcon name="signin" />
            <span>Sign in</span>
          </Link>
        )}
      </nav>
    </div>
  );
}
