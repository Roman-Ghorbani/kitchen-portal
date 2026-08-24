'use client';

import { useState } from 'react';

export function CalendarSubscriptionCard({ memberId }: { memberId: string }) {
  const [copied, setCopied] = useState(false);

  // Construct origin-relative or absolute URL
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://kitchen.zbtaa.online';
  const icsPath = `/api/calendar/${memberId}.ics`;
  const httpUrl = `${baseUrl}${icsPath}`;
  const webcalUrl = httpUrl.replace(/^https?:/, 'webcal:');

  function copyLink() {
    navigator.clipboard.writeText(httpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  return (
    <div className="card card-pad" style={{ marginBottom: 24, border: '1px solid var(--gold-500-20)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', gap: 6, color: 'var(--gold-500)' }}>
            📅 Sync Shifts to Your Phone Calendar
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 4 }}>
            Shifts update live on your Apple Calendar, Google Calendar, or Outlook.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <a
            href={webcalUrl}
            className="btn gold sm"
            style={{ fontWeight: 600 }}
          >
            📲 Add to Phone Calendar
          </a>
          <button
            className="btn sm"
            onClick={copyLink}
            style={{ fontSize: 12 }}
          >
            {copied ? '✓ Link Copied!' : 'Copy iCal Link'}
          </button>
        </div>
      </div>
    </div>
  );
}
