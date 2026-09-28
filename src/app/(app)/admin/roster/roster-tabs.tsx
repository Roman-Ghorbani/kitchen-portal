import Link from 'next/link';

export type RosterView = 'everyone' | 'days' | 'readiness' | 'import';

const TABS: { key: RosterView; label: string; href: string }[] = [
  { key: 'everyone', label: 'Everyone', href: '/admin/roster' },
  { key: 'days', label: 'Day by day', href: '/admin/roster?view=days' },
  { key: 'readiness', label: 'Not ready', href: '/admin/roster?view=readiness' },
  { key: 'import', label: 'Import', href: '/admin/roster/import' },
];

/** The roster's tabs, shared by the roster page and the import page. */
export function RosterTabs({ view, counts }: { view: RosterView; counts?: Partial<Record<RosterView, number>> }) {
  return (
    <div className="adm-tabs">
      {TABS.map((t) => (
        <Link key={t.key} href={t.href} className={`adm-tab${view === t.key ? ' active' : ''}`}>
          {t.label}
          {counts?.[t.key] !== undefined && <span className="adm-tab-count mono">{counts[t.key]}</span>}
        </Link>
      ))}
    </div>
  );
}
