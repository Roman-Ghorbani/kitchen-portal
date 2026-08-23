import Link from 'next/link';

import { signOut } from '../actions/auth-actions.ts';
import type { SessionPayload } from '../../lib/auth.ts';
import { NavIcon } from './nav-icons.tsx';

const BROTHER_NAV = [
  { href: '/schedule', label: 'Schedule', icon: 'schedule' },
  { href: '/availability', label: 'Availability', icon: 'availability' },
  { href: '/my-shifts', label: 'My Shifts', icon: 'my-shifts' },
];

const ADMIN_NAV = [
  { href: '/admin', label: 'Dashboard', icon: 'dashboard' },
  { href: '/admin/roster', label: 'Roster', icon: 'roster' },
  { href: '/schedule', label: 'Schedule', icon: 'schedule' },
  { href: '/admin/week', label: 'Manage week', icon: 'manage' },
  { href: '/admin/settings', label: 'Settings', icon: 'settings' },
];

/** Signed out, the only thing worth showing is the schedule itself. */
const PUBLIC_NAV = [{ href: '/schedule', label: 'Schedule', icon: 'schedule' }];

export function AppShell({
  session,
  active,
  title,
  subtitle,
  children,
}: {
  session: SessionPayload | null;
  active: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const nav = !session
    ? PUBLIC_NAV
    : session.role === 'admin'
      ? ADMIN_NAV
      : BROTHER_NAV;

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="brand">
          <div className="brand-mark">ZBT</div>
          <div className="brand-text">
            <div className="t1">Kitchen Duty</div>
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
