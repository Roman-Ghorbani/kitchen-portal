/**
 * The kitchen's own screen: the late plate queue and the menu editor.
 *
 * Lives outside the (app) group deliberately - no sidebar, no nav, no PIN.
 * Two kinds of visitor get in:
 *
 *   - a paired chef tablet, recognised by its httpOnly pairing cookie
 *   - the kitchen manager, by his session, so he can see exactly what the
 *     chefs see ("Open kiosk view" on the Late plates page)
 *
 * Anything else gets a screen explaining how to pair. A tablet still using the
 * old `?device=` bookmark is sent to /kitchen/legacy to be converted.
 */

import { cookies } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { todayInEastern } from '../../../lib/dates.ts';
import { currentKitchenMeal } from '../../../lib/late-plate-service.ts';
import { deviceFromCookie } from '../../../lib/kiosk.ts';
import { getSession } from '../../../lib/session.ts';
import { KIOSK_COOKIE } from '../../../lib/session-constants.ts';
import { KitchenQueue } from './kitchen-queue.tsx';

export const dynamic = 'force-dynamic';

export default async function KitchenLatePlatesPage({
  searchParams,
}: {
  searchParams: Promise<{ device?: string; date?: string }>;
}) {
  const params = await searchParams;
  if (params.device) redirect(`/kitchen/legacy?token=${encodeURIComponent(params.device)}`);

  const [device, session] = await Promise.all([
    deviceFromCookie((await cookies()).get(KIOSK_COOKIE)?.value),
    getSession(),
  ]);
  const managerView = !device && session?.role === 'admin';

  if (!device && !managerView) {
    return (
      <div className="kq-shell kq-locked" data-theme="light">
        <div className="kq-locked-card">
          <h1>Kitchen late plates</h1>
          <p>This tablet is not paired with the kitchen portal yet.</p>
          <p className="kq-locked-sub">
            Ask the kitchen manager for a pairing code, then{' '}
            <Link href="/kitchen/pair">enter it here</Link>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="kq-shell" data-theme="light">
      {managerView && (
        <div className="kq-manager-bar">
          Manager view: this is the chefs&apos; screen. Anything you change here
          is logged under your name.{' '}
          <Link href="/admin/late-plates">Back to Late plates</Link>
        </div>
      )}
      <KitchenQueue
        initialDate={params.date ?? todayInEastern()}
        isExplicitDate={Boolean(params.date)}
        // Opens on whatever the kitchen is working on now, so nobody has to
        // pick a meal before they can see their work.
        initialMeal={currentKitchenMeal()}
      />
    </div>
  );
}
