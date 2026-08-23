'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { adminSetMemberAvailability } from '../../../../actions/availability-actions.ts';

const DAYS = [
  { index: 0, name: 'Monday' },
  { index: 1, name: 'Tuesday' },
  { index: 2, name: 'Wednesday' },
  { index: 3, name: 'Thursday' },
  { index: 4, name: 'Friday' },
  { index: 5, name: 'Saturday' },
  { index: 6, name: 'Sunday' },
];

export function AdminAvailabilityEditor({
  memberId,
  memberName,
  initialConflicts,
}: {
  memberId: string;
  memberName: string;
  initialConflicts: { dayIndex: number; note: string | null }[];
}) {
  const [pending, startTransition] = useTransition();
  const [editingDay, setEditingDay] = useState<number | null>(null);
  const [noteInput, setNoteInput] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();

  const conflictMap = new Map(initialConflicts.map((c) => [c.dayIndex, c.note]));

  function toggleDay(dayIndex: number, currentBlocked: boolean, note: string = '') {
    setMsg(null);
    startTransition(async () => {
      const res = await adminSetMemberAvailability(
        memberId,
        dayIndex,
        !currentBlocked,
        note,
      );
      setMsg(res.message);
      setEditingDay(null);
      setNoteInput('');
      router.refresh();
    });
  }

  function saveNote(dayIndex: number) {
    setMsg(null);
    startTransition(async () => {
      const res = await adminSetMemberAvailability(
        memberId,
        dayIndex,
        true,
        noteInput,
      );
      setMsg(res.message);
      setEditingDay(null);
      setNoteInput('');
      router.refresh();
    });
  }

  return (
    <div className="card card-pad">
      <div className="admin-avail-head" style={{ marginBottom: 14 }}>
        <span style={{ fontSize: 13, color: 'var(--ink-400)' }}>
          Click any day to toggle availability for {memberName}. Blocked days will be automatically skipped when generating schedules.
        </span>
      </div>

      <div
        className="admin-avail-grid"
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        {DAYS.slice(0, 6).map((day) => {
          const isBlocked = conflictMap.has(day.index);
          const currentNote = conflictMap.get(day.index);
          const isEditing = editingDay === day.index;

          return (
            <div
              key={day.index}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                padding: '8px 12px',
                borderRadius: 8,
                background: isBlocked ? 'rgba(239, 68, 68, 0.08)' : 'var(--navy-50)',
                border:
                  '1px solid ' +
                  (isBlocked ? 'rgba(239, 68, 68, 0.25)' : 'var(--navy-100)'),
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1 }}>
                <span style={{ fontWeight: 700, fontSize: 14, minWidth: 90 }}>
                  {day.name}
                </span>

                {isBlocked ? (
                  <span className="tag bad" style={{ fontSize: 11 }}>
                    Blocked (Standing Conflict)
                    {currentNote && ` — ${currentNote}`}
                  </span>
                ) : (
                  <span className="tag ok" style={{ fontSize: 11 }}>
                    Available
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {isBlocked && !isEditing && (
                  <button
                    className="btn sm"
                    style={{ fontSize: 11, padding: '3px 8px' }}
                    onClick={() => {
                      setEditingDay(day.index);
                      setNoteInput(currentNote ?? '');
                    }}
                  >
                    Edit Note
                  </button>
                )}

                <button
                  className={`btn sm ${isBlocked ? 'gold' : 'danger'}`}
                  style={{ fontSize: 11, padding: '4px 10px' }}
                  disabled={pending}
                  onClick={() => toggleDay(day.index, isBlocked, currentNote ?? '')}
                >
                  {isBlocked ? 'Make Available' : 'Block Day'}
                </button>
              </div>

              {isEditing && (
                <div
                  style={{
                    width: '100%',
                    marginTop: 8,
                    display: 'flex',
                    gap: 6,
                    flexBasis: '100%',
                  }}
                >
                  <input
                    className="field"
                    style={{ fontSize: 12, padding: '4px 8px' }}
                    placeholder="Reason (e.g. Class, Chapter, Work)"
                    value={noteInput}
                    onChange={(e) => setNoteInput(e.target.value)}
                  />
                  <button
                    className="btn gold sm"
                    disabled={pending}
                    onClick={() => saveNote(day.index)}
                  >
                    Save
                  </button>
                  <button
                    className="btn sm"
                    onClick={() => {
                      setEditingDay(null);
                      setNoteInput('');
                    }}
                  >
                    Cancel
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {msg && (
        <div className="note" style={{ marginTop: 10, color: 'var(--gold-500)' }}>
          {msg}
        </div>
      )}
    </div>
  );
}
