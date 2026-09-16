'use client';

import { useState } from 'react';

import { formatPoints } from '../../lib/types.ts';

export interface HistoryEntry {
  assignmentId: string;
  label: string;
  detail: string;
  points: number;
  outcome: 'served' | 'handed-off' | 'offered' | 'no-show';
}

const SHOWN = 3;

const STATE_LABEL: Record<HistoryEntry['outcome'], string> = {
  served: 'Served',
  'handed-off': 'Somebody took it',
  offered: 'Up for grabs',
  'no-show': 'No-show',
};

export function HistoryList({ entries }: { entries: HistoryEntry[] }) {
  const [all, setAll] = useState(false);
  const shown = all ? entries : entries.slice(0, SHOWN);

  if (entries.length === 0) {
    return (
      <div className="card card-pad">
        <span className="note">
          Nothing served yet. Finished shifts show up here with what they were
          worth.
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="history">
        {shown.map((e) => (
          <div
            key={e.assignmentId}
            className={`history-row${e.outcome === 'no-show' ? ' missed' : ''}`}
          >
            <div className="history-when">
              <span className="history-date">{e.label}</span>
              <span className="history-what">{e.detail}</span>
            </div>
            <div className="history-right">
              <span
                className={`history-points${e.points > 0 ? '' : ' zero'}`}
              >
                {e.points > 0 ? `+${formatPoints(e.points)}` : '0'}
              </span>
              <span
                className={`history-state${
                  e.outcome === 'no-show'
                    ? ' bad'
                    : e.outcome === 'served'
                      ? ' done'
                      : ''
                }`}
              >
                {STATE_LABEL[e.outcome]}
              </span>
            </div>
          </div>
        ))}
      </div>

      {entries.length > SHOWN && (
        <button className="st-collapse" onClick={() => setAll((v) => !v)}>
          {all ? 'Show less' : `Show all ${entries.length}`}
        </button>
      )}
    </>
  );
}
