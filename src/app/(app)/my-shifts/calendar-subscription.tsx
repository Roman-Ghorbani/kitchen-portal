'use client';

import { useState } from 'react';

export function CalendarSubscriptionCard({ memberId }: { memberId: string }) {
  const [copied, setCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

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

  // Google Calendar web subscription URL
  const googleUrl = `https://calendar.google.com/calendar/r/settings/addbyurl?cid=${encodeURIComponent(httpUrl)}`;

  function copyLink() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(httpUrl);
    } else {
      const el = document.createElement('textarea');
      el.value = httpUrl;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
    }
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
            Subscribes your phone or web calendar to auto-sync your upcoming kitchen shifts.
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <a
            href={webcalUrl}
            className="btn gold sm"
            style={{ fontWeight: 600 }}
            title="1-tap subscription for iPhone, iPad, Mac & native phone calendar"
          >
            📲 Phone 1-Tap Sync
          </a>
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
            {copied ? '✓ Link Copied!' : '📋 Copy Feed Link'}
          </button>
          <button
            className="btn sm"
            onClick={() => setShowHelp(!showHelp)}
            style={{ fontSize: 12, color: 'var(--ink-400)' }}
          >
            {showHelp ? 'Hide Mobile Tips' : '❓ Mobile Setup Tips'}
          </button>
        </div>
      </div>

      {showHelp && (
        <div
          style={{
            marginTop: 14,
            paddingTop: 12,
            borderTop: '1px solid var(--ink-700)',
            fontSize: 12,
            color: 'var(--ink-300)',
            lineHeight: 1.6,
          }}
        >
          <div style={{ fontWeight: 700, color: 'var(--ink-100)', marginBottom: 4 }}>
            📱 Mobile Calendar Setup Instructions:
          </div>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            <li>
              <strong>iPhone / iOS Users:</strong> Tap <strong>📲 Phone 1-Tap Sync</strong>. iOS will open Apple Calendar with a 1-tap "Subscribe" prompt.
            </li>
            <li>
              <strong>Google Calendar App Users:</strong> Tap <strong>📋 Copy Feed Link</strong>, then open Google Calendar in browser (or desktop) → click <em>"+" next to Other calendars</em> → select <em>From URL</em> → paste the link.
            </li>
            <li>
              <strong>Android Phone Users:</strong> Tap <strong>📥 Download .ics</strong> or <strong>📲 Phone 1-Tap Sync</strong> to import shifts into your device calendar.
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
