/**
 * Importing a roster: a spreadsheet, the chapter's export, or a pasted list.
 * Nothing is written until the manager has seen every change and ticked it.
 */

import { redirect } from 'next/navigation';
import { eq, sql } from 'drizzle-orm';

import { db } from '../../../../../db/index.ts';
import { members } from '../../../../../db/schema.ts';
import { getSession } from '../../../../../lib/session.ts';
import { getActiveSemester } from '../../../../../lib/week-service.ts';
import { getRosterDefaults } from '../../../../../lib/roster-defaults.ts';
import { AppShell } from '../../../shell.tsx';
import { RosterTabs } from '../roster-tabs.tsx';
import { ImportWizard } from './import-wizard.tsx';

export const dynamic = 'force-dynamic';

export default async function RosterImportPage() {
  const session = await getSession();
  if (!session) redirect('/signin');
  if (session.role !== 'admin') redirect('/');

  const [semester, defaults, [count]] = await Promise.all([
    getActiveSemester(),
    getRosterDefaults(),
    db.select({ n: sql<number>`count(*)` }).from(members).where(eq(members.active, true)),
  ]);

  return (
    <AppShell session={session} active="/admin/roster" title="Import a roster" subtitle={semester.name}>
      <RosterTabs view="import" />
      <ImportWizard
        rosterSize={count.n}
        savedPledgeYears={defaults.pledgeYears}
        crewDefaults={defaults.crewForYear}
      />
    </AppShell>
  );
}
