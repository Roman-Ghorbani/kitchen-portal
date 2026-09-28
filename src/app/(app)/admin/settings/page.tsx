/**
 * Settings: the handful of things that change rarely.
 *
 * Organised by what the manager is trying to do, one card each:
 *   Meal service     which days the house serves (drives week generation)
 *   Senior Week menu the shareable menu link and its password
 *   Security         how the manager account is protected, and a kill switch
 *   Semester         what term this is
 *   House rules      how the scheduler decides, for reference
 *
 * Late-plate settings and the kitchen tablet live on the Late plates page,
 * next to the queue they affect. The house display is administered on the Pi
 * over Tailscale and deliberately has no link from this public app.
 */

import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getSession } from '../../../../lib/session.ts';
import { getActiveSemester } from '../../../../lib/week-service.ts';
import { adminPasswordIsHashed, adminTotpEnabled } from '../../../../lib/auth.ts';
import { seniorMenuPasswordSet } from '../../../../lib/senior-menu-auth.ts';
import { type MealDayConfig, type Meal } from '../../../../lib/types.ts';
import { signOutEverywhere } from '../../../actions/auth-actions.ts';
import { AppShell } from '../../shell.tsx';
import { MealGrid } from './meal-grid.tsx';
import { SeniorMenuSettings } from './senior-menu-settings.tsx';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const session = await getSession();
  if (!session) redirect('/signin');
  if (session.role !== 'admin') redirect('/');

  const [semester, menuPasswordSet] = await Promise.all([
    getActiveSemester(),
    seniorMenuPasswordSet(),
  ]);
  const mealDays = semester.mealDays as MealDayConfig;
  const slotSizes = semester.slotSizes as Record<Meal, number>;

  const checks = [
    {
      ok: adminPasswordIsHashed(),
      label: 'Manager password stored as a hash',
      fix: 'Run `npm run admin:credentials` and put ADMIN_PASSWORD_HASH in the environment instead of ADMIN_PASSWORD.',
    },
    {
      ok: adminTotpEnabled(),
      label: 'Authenticator code required at sign-in',
      fix: 'Run `npm run admin:credentials` and set ADMIN_TOTP_SECRET.',
    },
    {
      ok: Boolean(process.env.TV_API_KEY),
      label: 'House display key configured',
      fix: 'Set TV_API_KEY here and the same value on the Pi’s house-display service.',
    },
    {
      ok: Boolean(process.env.CRON_SECRET),
      label: 'Day-before reminder protected',
      fix: 'Set CRON_SECRET; the reminder endpoint refuses to run without it.',
    },
  ];

  return (
    <AppShell session={session} active="/admin/settings" title="Settings" subtitle={semester.name}>
      <section className="card card-pad settings-card">
        <h2 className="section-title">Meal service</h2>
        <p className="settings-lede">
          Which days the house serves. A day that is off produces no cleanup
          slots, so nobody is assigned a shift that does not exist. Changes
          apply to weeks created from now on.
        </p>
        <MealGrid initial={mealDays} />
      </section>

      <SeniorMenuSettings passwordSet={menuPasswordSet} />

      <section className="card card-pad settings-card">
        <h2 className="section-title">Security</h2>
        <p className="settings-lede">
          Brothers claim their accounts with one-time setup codes issued from{' '}
          <Link href="/admin/roster">Roster</Link>. Every sign-in, failed
          attempt and credential change is in the{' '}
          <Link href="/admin/audit?categories=auth">audit log</Link>.
        </p>

        <ul className="check-list">
          {checks.map((c) => (
            <li key={c.label} className={c.ok ? 'ok' : 'todo'}>
              <span className="check-mark" aria-hidden="true">{c.ok ? '✓' : '!'}</span>
              <span>
                <strong>{c.label}</strong>
                {!c.ok && <span className="check-fix">{c.fix}</span>}
              </span>
            </li>
          ))}
        </ul>

        <form action={signOutEverywhere} className="settings-actions">
          <button className="btn sm" type="submit">
            Sign out every manager session
          </button>
          <span className="settings-hint">
            Ends this session too. Use it after signing in on a shared computer.
          </span>
        </form>
      </section>

      <section className="card card-pad settings-card">
        <h2 className="section-title">Semester</h2>
        <div className="settings-row">
          <strong>{semester.name}</strong>
          <span className="mono">
            {semester.startsOn} → {semester.endsOn}
          </span>
        </div>
        <p className="settings-hint">
          Points reset at the start of each semester. Starting the next term is
          a deliberate action, not automatic.
        </p>
      </section>

      <section className="card card-pad settings-card">
        <h2 className="section-title">House rules</h2>
        <p className="settings-lede">How the scheduler decides. Reference only.</p>
        <dl className="rules">
          <dt>Staffing</dt>
          <dd>
            {slotSizes.lunch} juniors on lunch, {slotSizes.dinner} sophomores on dinner.
          </dd>

          <dt>Frequency</dt>
          <dd>
            Nobody is scheduled more than once a Monday–Sunday week, except for a
            make-up shift owed for a no-show.
          </dd>

          <dt>Selection</dt>
          <dd>
            Make-up debt first, then fewest points, then longest since last
            served, then a random draw seeded by the week, so a week can always
            be reproduced exactly.
          </dd>

          <dt>Cover</dt>
          <dd>
            A brother can put any shift up for grabs at any time. It stays his
            until somebody takes it; only whoever serves earns the point.
          </dd>

          <dt>Attendance</dt>
          <dd>
            Everyone is assumed present. A correction adjusts points and
            make-up debt by the difference, so changing your mind is always safe.
          </dd>
        </dl>
      </section>
    </AppShell>
  );
}
