'use client';

import { useState } from 'react';

export function CalendarSubscriptionCard({ memberId }: { memberId: string }) {
  const [copied, setCopied] = useState(false);

  // Construct origin-relative or absolute URL
  const baseUrl =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://kitchen.zbtaa.online';
  const icsPath = `/api/calendar/${memberId}.ics`;
  const httpUrl = `${baseUrl}${icsPath}`;
  const webcalUrl = httpUrl.replace(/^https?:/, 'webcal:');

  // Outlook 1-click web subscription URL
  const outlookUrl = `https://outlook.office.com/calendar/0/addcalendar?url=${encodeURIComponent(httpUrl)}&name=ZBT%20Kitchen%20Duty`;

  // Google Calendar 1-click web subscription URL (requires https:// URL)
  const googleUrl = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(httpUrl)}`;

  function copyLink() {
    navigator.clipboard.writeText(httpUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  }

  return (
    <div
      className="card card-pad"
      style={{ marginBottom: 24, border: '1px solid var(--gold-500-20)' }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          flexWrap: 'wrap',
        }}
      >
        <div>
          <div
            style={{
              fontWeight: 700,
              fontSize: 15,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              color: 'var(--gold-500)',
            }}
          >
            📅 Sync Shifts to Your Phone or Web Calendar
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-400)', marginTop: 4 }}>
            Shifts update live on Google Calendar, Apple Calendar, and Outlook.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <a
            href={googleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn sm"
            style={{ fontWeight: 600, background: '#4285F4', color: '#ffffff', borderColor: '#4285F4' }}
          >
            🌐 Google Calendar
          </a>
          <a
            href={outlookUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn sm"
            style={{ fontWeight: 600, background: '#0078d4', color: '#ffffff', borderColor: '#0078d4' }}
          >
            📧 Outlook
          </a>
          <a
            href={webcalUrl}
            className="btn gold sm"
            style={{ fontWeight: 600 }}
          >
            📲 Apple / Phone
          </a>
          <a
            href={httpUrl}
            download={`kitchen-duty-${memberId}.ics`}
            className="btn sm"
            style={{ fontSize: 12 }}
          >
            📥 Download .ics
          </a>
          <button
            className="btn sm"
            onClick={copyLink}
            style={{ fontSize: 12 }}
          >
            {copied ? '✓ Link Copied!' : 'Copy Link'}
          </button>
        </div>
      </div>
    </div>
  );
}
