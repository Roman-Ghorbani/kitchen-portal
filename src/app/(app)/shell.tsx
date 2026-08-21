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
  { href: '/admin/settings', label: 'Settings' },
];

export function AppShell({
  session,
  active,
  title,
  subtitle,
  children,
}: {
  session: SessionPayload;
  active: string;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  const nav = session.role === 'admin' ? ADMIN_NAV : BROTHER_NAV;

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
        </div>
      </nav>

      <div className="main">
        <header className="topbar">
          <div>
            <h1>{title}</h1>
            {subtitle && <div className="sub">{subtitle}</div>}
          </div>
          <form action={signOut}>
            <button className="btn sm" type="submit">
              {session.name} · Sign out
            </button>
          </form>
        </header>

        <div className="content">{children}</div>
      </div>
    </div>
  );
}
