import { asc, eq } from 'drizzle-orm';
import { redirect } from 'next/navigation';

import { db } from '../../db/index.ts';
import { members } from '../../db/schema.ts';
import { getSession } from '../../lib/session.ts';
import { adminTotpEnabled } from '../../lib/auth.ts';
import { getActiveSemester } from '../../lib/week-service.ts';
import { SignInForm, type PickerMember } from './signin-form.tsx';
import './signin.css';

// The roster changes rarely but must never be stale after an import.
export const dynamic = 'force-dynamic';

export default async function SignInPage() {
  const session = await getSession();
  if (session) redirect(session.role === 'admin' ? '/admin' : '/');

  const semester = await getActiveSemester().catch(() => null);
  const rows = await db
    .select({
      id: members.id,
      name: members.name,
      classYear: members.classYear,
      pinHash: members.pinHash,
    })
    .from(members)
    .where(eq(members.active, true))
    .orderBy(asc(members.name));

  // Only a boolean crosses to the client - never the hash itself.
  const roster: PickerMember[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    classYear: r.classYear,
    hasPin: r.pinHash !== null,
  }));

  return (
    <main className="signin-shell">
      <div className="signin-brand">
        <div className="brand-mark">ZBT</div>
        <div>
          <div className="signin-title">Kitchen Portal</div>
          {semester && <div className="signin-sub">{semester.name}</div>}
        </div>
      </div>

      <SignInForm roster={roster} totpEnabled={adminTotpEnabled()} />
    </main>
  );
}
