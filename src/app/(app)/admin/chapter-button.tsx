'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

import {
  runChapter,
  approveProposedReplacement,
} from '../../actions/chapter-actions.ts';

interface Proposal {
  assignmentId: string;
  date: string;
  meal: string;
  suggested: string;
}

export function ChapterButton() {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const router = useRouter();

  function run() {
    startTransition(async () => {
      const res = await runChapter();
      setMessage(res.message);
      setFailed(!res.ok);
      setProposals(res.proposals ?? []);
      router.refresh();
    });
  }

  function approve(id: string) {
    startTransition(async () => {
      const res = await approveProposedReplacement(id);
      setMessage(res.message);
      setFailed(!res.ok);
      if (res.ok) {
        setProposals((prev) => prev.filter((p) => p.assignmentId !== id));
      }
      router.refresh();
    });
  }

  return (
    <div>
      <button className="btn violet" onClick={run} disabled={pending}>
        {pending ? 'Running…' : 'Run Sunday chapter'}
      </button>

      {message && (
        <div
          className="note"
          style={failed ? { color: 'var(--red-600)' } : undefined}
        >
          {message}
        </div>
      )}

      {proposals.length > 0 && (
        <div className="card card-pad" style={{ marginTop: 12 }}>
          <h2 className="section-title" style={{ marginTop: 0 }}>
            Needs your approval
          </h2>
          <div className="detail-hint" style={{ marginBottom: 10 }}>
            Nobody volunteered for these, so the scheduler picked the
            lowest-points eligible person. Approve or handle it yourself.
          </div>
          {proposals.map((p) => (
            <div key={p.assignmentId} className="shift-row">
              <div className="shift-when">
                <div className="shift-day">
                  {p.date} · {p.meal}
                </div>
                <div className="shift-crew">Suggested: {p.suggested}</div>
              </div>
              <button
                className="btn primary sm"
                onClick={() => approve(p.assignmentId)}
                disabled={pending}
              >
                Approve
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
