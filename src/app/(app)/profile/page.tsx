/**
 * A brother's own profile: what the house knows about him, the few things he
 * keeps up to date himself (room, Slack ID, allergies), and his account.
 *
 * Rotation, exemption and points are shown but not editable here - they decide
 * who cleans, so they stay with the kitchen manager.
 */

import { redirect } from 'next/navigation';

import { getSession, getViewAs } from '../../../lib/session.ts';
import { getMemberById } from '../../../lib/member-queries.ts';
import { getMemberDietary } from '../../../lib/late-plate-service.ts';
import { CLASS_YEAR_LABELS, ROTATION_LABELS, EXEMPT_REASON_LABELS, formatPoints } from '../../../lib/types.ts';
import { AppShell } from '../shell.tsx';
import { AccountCard } from '../account-card.tsx';
import { ProfileForm, DietaryForm } from './profile-forms.tsx';

export const dynamic = 'force-dynamic';

export default async function ProfilePage() {
  const session = await getSession();
  if (!session) redirect('/signin');
  const viewAs = await getViewAs();
  if (session.role === 'admin' && !viewAs) redirect('/admin');
  const memberId = viewAs ?? session.sub;
  const readOnly = session.role === 'admin';

  const [member, dietary] = await Promise.all([getMemberById(memberId), getMemberDietary(memberId)]);
  if (!member) redirect('/signin');

  const duty = member.exempt
    ? `Exempt · ${EXEMPT_REASON_LABELS[member.exemptReason ?? 'other']}`
    : ROTATION_LABELS[member.rotation];

  return (
    <AppShell
      session={session}
      active="/profile"
      viewingAs={readOnly ? member.name : null}
      title={readOnly ? member.name : 'Your profile'}
      subtitle={readOnly ? 'Profile' : member.name}
    >
      <div className="profile-grid">
        <section className="card card-pad">
          <h2 className="section-title">Kitchen duty</h2>
          <dl className="profile-facts">
            <dt>Duty</dt>
            <dd>{duty}</dd>
            <dt>Class</dt>
            <dd>{CLASS_YEAR_LABELS[member.classYear]}</dd>
            <dt>Points</dt>
            <dd className="mono">{formatPoints(member.points)}</dd>
            {member.makeupDebt > 0 && (
              <>
                <dt>Make-up owed</dt>
                <dd className="mono">{member.makeupDebt}</dd>
              </>
            )}
          </dl>
          <p className="settings-hint">
            Something wrong here - wrong crew, or you should be exempt? Tell the
            kitchen manager; he can change it.
          </p>
        </section>

        <ProfileForm room={member.room ?? ''} slackUserId={member.slackUserId ?? ''} readOnly={readOnly} />
      </div>

      <DietaryForm flags={dietary.flags} other={dietary.other ?? ''} summary={dietary.summary.lines} readOnly={readOnly} />

      {!readOnly && <AccountCard />}
    </AppShell>
  );
}
