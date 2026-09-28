'use client';

import { useState, useMemo, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import { issueSetupCodesForAll, type IssuedCode } from '../../../actions/auth-actions.ts';
import { SetupCodes } from './setup-codes.tsx';

export interface MemberPreparedness {
  id: string;
  name: string;
  rotation: 'lunch' | 'dinner';
  exempt: boolean;
  hasPin: boolean;
  standingConflictsCount: number;
  isScheduled: boolean;
  upcomingShiftsCount: number;
}

type Tab = 'scheduled-no-pin' | 'all-no-pin' | 'no-conflicts' | 'all';

export function UnpreparedMembersSection({
  members,
}: {
  members: MemberPreparedness[];
}) {
  const [tab, setTab] = useState<Tab>('scheduled-no-pin');
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState(false);
  const [issued, setIssued] = useState<IssuedCode[]>([]);
  const [issueMessage, setIssueMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const scheduledNoPin = useMemo(
    () => members.filter((m) => m.isScheduled && !m.hasPin),
    [members],
  );

  const allNoPin = useMemo(
    () => members.filter((m) => !m.hasPin),
    [members],
  );

  const noConflicts = useMemo(
    () => members.filter((m) => !m.exempt && m.standingConflictsCount === 0),
    [members],
  );

  const signedInCount = members.filter((m) => m.hasPin).length;
  const signedInPct = members.length > 0 ? Math.round((signedInCount / members.length) * 100) : 0;

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list: MemberPreparedness[] = [];
    switch (tab) {
      case 'scheduled-no-pin':
        list = scheduledNoPin;
        break;
      case 'all-no-pin':
        list = allNoPin;
        break;
      case 'no-conflicts':
        list = noConflicts;
        break;
      case 'all':
        list = members;
        break;
    }
    if (q) {
      list = list.filter((m) => m.name.toLowerCase().includes(q));
    }
    return list;
  }, [tab, query, scheduledNoPin, allNoPin, noConflicts, members]);

  function copySlackNudge() {
    const targets = scheduledNoPin.length > 0 ? scheduledNoPin : allNoPin;
    const namesList = targets.map((m) => m.name).join(', ');
    const text = `Kitchen Portal reminder: these brothers are on the duty schedule but have not signed in yet: ${namesList}.\n\nYour setup code is in your DMs. Sign in at ${window.location.origin}/signin to set your PIN, check your shifts and confirm your availability.`;

    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  return (
    <div style={{ marginBottom: 32 }}>
      <div className="dossier-stats" style={{ marginBottom: 20 }}>
        <div className={`dossier-stat${scheduledNoPin.length > 0 ? ' bad' : ''}`}>
          <span className="dossier-stat-value mono">{scheduledNoPin.length}</span>
          <span className="dossier-stat-label">Scheduled & Unsigned-In</span>
        </div>
        <div className="dossier-stat">
          <span className="dossier-stat-value mono">{allNoPin.length}</span>
          <span className="dossier-stat-label">Total Unsigned-In</span>
        </div>
        <div className="dossier-stat">
          <span className="dossier-stat-value mono">{noConflicts.length}</span>
          <span className="dossier-stat-label">0 Conflicts Set</span>
        </div>
        <div className="dossier-stat">
          <span className="dossier-stat-value mono">{signedInPct}%</span>
          <span className="dossier-stat-label">App Signed-In Rate</span>
        </div>
      </div>

      <div
        className="card card-pad"
        style={{
          border: scheduledNoPin.length > 0 ? '1px solid var(--red-500-20)' : '1px solid var(--line)',
          marginBottom: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
            marginBottom: 16,
          }}
        >
          <div>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
              {scheduledNoPin.length > 0 ? '⚠️ Unprepared & Unsigned-In Members' : '✅ Member App Readiness'}
            </h3>
            <div style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 4 }}>
              Tracks brothers assigned to duty who haven&apos;t set a PIN or confirmed availability.
            </div>
          </div>

          <div className="setup-codes-actions">
            <button
              type="button"
              className="btn primary sm"
              disabled={pending || allNoPin.length === 0}
              onClick={() =>
                startTransition(async () => {
                  const res = await issueSetupCodesForAll(allNoPin.map((m) => m.id));
                  setIssued(res.issued);
                  setIssueMessage(res.message);
                  router.refresh();
                })
              }
            >
              Issue setup codes ({allNoPin.length})
            </button>
            <button type="button" className="btn sm" onClick={copySlackNudge}>
              {copied ? 'Copied' : 'Copy group reminder'}
            </button>
          </div>
        </div>

        {issueMessage && <div className="form-msg ok">{issueMessage}</div>}
        <SetupCodes codes={issued} onDone={() => setIssued([])} />

        <div className="roster-toolbar" style={{ marginBottom: 16 }}>
          <input
            className="field"
            placeholder="Search member name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ maxWidth: 240 }}
          />

          <div className="filter-chips">
            <button
              className={`filter-chip${tab === 'scheduled-no-pin' ? ' active' : ''}`}
              onClick={() => setTab('scheduled-no-pin')}
            >
              Scheduled &amp; No PIN
              <span className="chip-count mono">{scheduledNoPin.length}</span>
            </button>
            <button
              className={`filter-chip${tab === 'all-no-pin' ? ' active' : ''}`}
              onClick={() => setTab('all-no-pin')}
            >
              All Unsigned-In
              <span className="chip-count mono">{allNoPin.length}</span>
            </button>
            <button
              className={`filter-chip${tab === 'no-conflicts' ? ' active' : ''}`}
              onClick={() => setTab('no-conflicts')}
            >
              0 Conflicts Set
              <span className="chip-count mono">{noConflicts.length}</span>
            </button>
            <button
              className={`filter-chip${tab === 'all' ? ' active' : ''}`}
              onClick={() => setTab('all')}
            >
              All Roster
              <span className="chip-count mono">{members.length}</span>
            </button>
          </div>
        </div>

        {shown.length === 0 ? (
          <div style={{ padding: '16px 0', fontSize: 13, color: 'var(--ink-400)', textAlign: 'center' }}>
            {tab === 'scheduled-no-pin'
              ? '🎉 Excellent! Everyone currently scheduled on duty has signed into the app.'
              : 'No members match this filter.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {shown.map((m) => (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  padding: '10px 14px',
                  background: 'var(--navy-50)',
                  border: '1px solid var(--navy-100)',
                  borderRadius: 8,
                  flexWrap: 'wrap',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <Link
                    href={`/admin/member/${m.id}`}
                    style={{ fontWeight: 700, fontSize: 14, color: 'inherit' }}
                  >
                    {m.name}
                  </Link>

                  <span className={`tag ${m.exempt ? 'locked' : m.rotation === 'lunch' ? 'jun' : 'soph'}`}>
                    {m.exempt ? 'Exempt' : m.rotation === 'lunch' ? 'Lunch crew' : 'Dinner crew'}
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  {!m.hasPin ? (
                    <span className="tag bad" style={{ fontWeight: 600 }}>
                      🚫 Never Signed In
                    </span>
                  ) : (
                    <span className="tag ok">
                      ✓ PIN Set
                    </span>
                  )}

                  {m.standingConflictsCount === 0 ? (
                    <span className="tag locked" style={{ background: '#f59e0b20', color: '#f59e0b' }}>
                      0 Availability Set
                    </span>
                  ) : (
                    <span className="tag locked">
                      {m.standingConflictsCount} Conflict{m.standingConflictsCount === 1 ? '' : 's'} Set
                    </span>
                  )}

                  {m.isScheduled && (
                    <span className="tag ok" style={{ background: '#3b82f620', color: '#60a5fa' }}>
                      📅 {m.upcomingShiftsCount} Shift{m.upcomingShiftsCount === 1 ? '' : 's'} Scheduled
                    </span>
                  )}

                  <Link className="btn sm" href={`/admin/member/${m.id}`}>
                    Dossier →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
