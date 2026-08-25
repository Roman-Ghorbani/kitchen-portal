'use client';

import { useState, useEffect } from 'react';

export function CalendarSubscriptionCard({ memberId }: { memberId: string }) {
  const [copied, setCopied] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showGoogleModal, setShowGoogleModal] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
    }
  }, []);

  const baseUrl =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://kitchen.zbtaa.online';
  const icsPath = `/api/calendar/${memberId}.ics`;
  const httpUrl = `${baseUrl}${icsPath}`;
  const webcalUrl = httpUrl.replace(/^https?:/, 'webcal:');

  const outlookUrl = `https://outlook.office.com/calendar/0/addcalendar?url=${encodeURIComponent(httpUrl)}&name=ZBT%20Kitchen%20Duty`;
  const googleDesktopUrl = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(httpUrl)}`;

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

  function handleGoogleClick(e: React.MouseEvent) {
    if (isMobile) {
      e.preventDefault();
      copyLink();
      setShowGoogleModal(true);
    }
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
            style={{ fontWeight: 700, padding: '8px 14px' }}
            title="1-tap subscription for iPhone, iPad, Mac & native phone calendar"
          >
            📲 Phone 1-Tap Sync
          </a>
          <a
            href={googleDesktopUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleGoogleClick}
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
            {showHelp ? 'Hide Mobile Tips' : '❓ Setup Tips'}
          </button>
        </div>
      </div>

      {showGoogleModal && (
        <div
          style={{
            marginTop: 14,
            padding: 14,
            borderRadius: 8,
            background: 'var(--ink-800)',
            border: '1px solid var(--gold-500-40)',
            fontSize: 13,
            color: 'var(--ink-100)',
          }}
        >
          <div style={{ fontWeight: 700, color: 'var(--gold-500)', fontSize: 14, marginBottom: 6 }}>
            ✓ Feed URL Copied to Clipboard!
          </div>
          <div style={{ color: 'var(--ink-300)', marginBottom: 10, lineHeight: 1.5 }}>
            Google Calendar Mobile App requires adding web links via Google Calendar Web settings.
            <br />
            <strong>How to complete setup:</strong>
            <ol style={{ paddingLeft: 18, margin: '6px 0' }}>
              <li>Open Google Calendar in your browser (or computer).</li>
              <li>Click <strong>"+" next to Other Calendars</strong> → select <strong>From URL</strong>.</li>
              <li>Paste your copied link and tap Add!</li>
            </ol>
            <em>Or on iPhone, simply tap <strong>📲 Phone 1-Tap Sync</strong> above for instant 1-tap setup in Apple Calendar!</em>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <a
              href="https://calendar.google.com/calendar/r/settings/addbyurl"
              target="_blank"
              rel="noopener noreferrer"
              className="btn sm primary"
              style={{ fontSize: 12 }}
            >
              🌐 Open Google Calendar Web Settings
            </a>
            <button
              className="btn sm"
              onClick={() => setShowGoogleModal(false)}
              style={{ fontSize: 12 }}
            >
              Got it
            </button>
          </div>
        </div>
      )}

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
            📱 Mobile Calendar Setup Guide:
          </div>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            <li>
              <strong>iPhone / iOS Users:</strong> Tap <strong>📲 Phone 1-Tap Sync</strong>. iOS will open Apple Calendar with an instant 1-tap "Subscribe" prompt.
            </li>
            <li>
              <strong>Google Calendar App Users:</strong> Tap <strong>📋 Copy Feed Link</strong>, then open Google Calendar in browser/desktop → click <em>"+" next to Other calendars</em> → select <em>From URL</em> → paste.
            </li>
            <li>
              <strong>Android Users:</strong> Tap <strong>📲 Phone 1-Tap Sync</strong> or <strong>📥 Download .ics</strong> to import shifts into your device calendar.
            </li>
          </ul>
        </div>
      )}
    </div>
  );
}
