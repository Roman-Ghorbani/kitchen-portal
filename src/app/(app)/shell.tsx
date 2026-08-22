import Link from 'next/link';

import { signOut } from '../actions/auth-actions.ts';
import type { SessionPayload } from '../../lib/auth.ts';

const BROTHER_NAV = [
  { href: '/my-shifts', label: 'My Shifts' },
  { href: '/schedule', label: 'Schedule' },
  { href: '/availability', label: 'Availability' },
];

const ADMIN_NAV = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/roster', label: 'Roster' },
  { href: '/schedule', label: 'Schedule' },
  { href: '/admin/week', label: 'Manage week' },
  { href: '/admin/settings', label: 'Settings' },
];

/** Signed out, the only thing worth showing is the schedule itself. */
const PUBLIC_NAV = [{ href: '/schedule', label: 'Schedule' }];

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
              {item.label}
            </Link>
          ))}

          {!session && (
            <Link href="/signin" className="nav-item nav-signin">
              Sign in
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
    </div>
  );
}
