import Link from 'next/link';

import { signOut } from '../actions/auth-actions.ts';
import { stopViewingAs } from '../actions/preview-actions.ts';
import type { SessionPayload } from '../../lib/auth.ts';
import { NavIcon } from './nav-icons.tsx';
import { getActiveSemester } from '../../lib/week-service.ts';

/*
 * Four destinations, and every one of them answers a different question.
 * Availability is deliberately not here: it is set once a semester, so it
 * lives on Home as a card rather than spending a permanent slot.
 */
const BROTHER_NAV = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/schedule', label: 'Board', icon: 'schedule' },
  { href: '/late-plate', label: 'Menu', icon: 'menu' },
  { href: '/standings', label: 'Standings', icon: 'standings' },
];

/*
 * The manager's six: run the week (Dashboard, Weeks), look after people
 * (Roster), the kitchen (Late plates), the record (Audit log), and the rare
 * stuff (Settings).
 */
const ADMIN_NAV = [
  { href: '/admin', label: 'Dashboard', icon: 'dashboard' },
  { href: '/admin/week', label: 'Weeks', icon: 'schedule' },
  { href: '/admin/roster', label: 'Roster', icon: 'roster' },
  { href: '/admin/late-plates', label: 'Late plates', icon: 'late-plate' },
  { href: '/admin/audit', label: 'Audit log', icon: 'audit' },
  { href: '/admin/settings', label: 'Settings', icon: 'settings' },
];

export async function AppShell({
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
  const nav = session?.role === 'admin' && !viewingAs ? ADMIN_NAV : BROTHER_NAV;
  const semester = await getActiveSemester().catch(() => null);

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          <div className="brand-mark">ZBT</div>
          <div className="brand-text">
            <div className="t1">Kitchen Portal</div>
            {semester && <div className="t2">{semester.name}</div>}
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
