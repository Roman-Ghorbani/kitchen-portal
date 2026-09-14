/**
 * The kitchen's own screen. No sign-in.
 *
 * Lives outside the (app) group deliberately: no sidebar, no nav, no session.
 * The chefs open one bookmarked URL carrying a device token and see the day's
 * queue. That URL is the whole interaction — anything they have to log into,
 * they will stop using.
 *
 * Works on any browser, so it is useful on a laptop or the TV today and needs
 * no hardware bought before it earns its place.
 */

import { headers } from 'next/headers';
import { timingSafeEqual } from 'node:crypto';

import { todayInEastern, parseISO } from '../../../lib/dates.ts';
import { currentKitchenMeal } from '../../../lib/late-plate-service.ts';
import { getActiveSemester } from '../../../lib/week-service.ts';
import { KitchenQueue } from './kitchen-queue.tsx';
import { TokenRecovery } from './token-recovery.tsx';

export const dynamic = 'force-dynamic';

async function tokenMatches(provided: string | undefined): Promise<boolean> {
  const semester = await getActiveSemester().catch(() => null);
  const expected = semester?.kioskToken || process.env.LATE_PLATE_DEVICE_TOKEN;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default async function KitchenLatePlatesPage({
  searchParams,
}: {
  searchParams: Promise<{ device?: string; date?: string }>;
}) {
  const params = await searchParams;
  // Touch headers so this can never be statically rendered with a token baked in.
  await headers();

  if (!(await tokenMatches(params.device))) {
    return (
      <div className="kq-shell kq-locked" data-theme="light">
        <div className="kq-locked-card">
          <h1>Kitchen late plates</h1>
          <p>
            This screen needs the kitchen link. If this tablet has been here
            before, it will let itself back in a moment.
          </p>
          <p className="kq-locked-sub">Otherwise ask Roman for the link.</p>
          <TokenRecovery />
        </div>
      </div>
    );
  }

  const isExplicitDate = !!params.date;
  const initialDate = params.date ?? todayInEastern();

  return (
    <div className="kq-shell" data-theme="light">
      <KitchenQueue
        device={params.device!}
        initialDate={initialDate}
        isExplicitDate={isExplicitDate}
        // Opens on whatever the kitchen is working on now, so nobody has to
        // pick a meal before they can see their work.
        initialMeal={currentKitchenMeal()}
      />
    </div>
  );
}
