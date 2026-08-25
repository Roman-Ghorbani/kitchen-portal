'use client';

import { useState, useEffect } from 'react';

export function CalendarSyncButton({ memberId }: { memberId: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
    }
  }, []);

  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://kitchen.zbtaa.online';

  const icsHttpsUrl = `${origin}/api/calendar/${memberId}.ics`;
  const webcalUrl = `${origin.replace(/^https?:/, 'webcal:')}/api/calendar/${memberId}.ics`;
  const googleDesktopUrl = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(icsHttpsUrl)}`;
  const outlookCalUrl = `https://outlook.office.com/calendar/0/addcalendar?url=${encodeURIComponent(icsHttpsUrl)}&name=ZBT%20Kitchen%20Duty`;

  function copyFeedLink() {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(icsHttpsUrl);
    } else {
      const el = document.createElement('textarea');
      el.value = icsHttpsUrl;
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
      copyFeedLink();
      alert('✓ Feed Link Copied to Clipboard!\n\nGoogle Calendar App requires adding web links via URL in Google Calendar Web Settings.\n\nOpen Google Calendar in your browser, click "+" next to Other Calendars, select "From URL", and paste!');
      setOpen(false);
    }
  }

  return (
    <div className="cal-popover-wrap">
      <button
        type="button"
        className="btn gold sm"
        onClick={() => setOpen(!open)}
      >
        📅 Connect Calendar {open ? '▲' : '▼'}
      </button>

      {open && (
        <div className="cal-popover-menu">
          <a
            className="cal-menu-item"
            href={webcalUrl}
            onClick={() => setOpen(false)}
          >
            <span className="cal-icon">📱</span>
            <div>
              <div className="cal-title">Apple / Phone 1-Tap Sync</div>
              <div className="cal-sub">Syncs to iPhone, iPad &amp; Mac</div>
            </div>
          </a>
          <a
            className="cal-menu-item"
            href={googleDesktopUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleGoogleClick}
          >
            <span className="cal-icon">🌐</span>
            <div>
              <div className="cal-title">Google Calendar</div>
              <div className="cal-sub">{copied ? '✓ Link Copied!' : 'Adds to Google Calendar Web / App'}</div>
            </div>
          </a>
          <a
            className="cal-menu-item"
            href={outlookCalUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
          >
            <span className="cal-icon">📧</span>
            <div>
              <div className="cal-title">Outlook Calendar</div>
              <div className="cal-sub">Syncs to Outlook Web &amp; Desktop</div>
            </div>
          </a>
          <a
            className="cal-menu-item"
            href={icsHttpsUrl}
            download={`kitchen-duty-${memberId}.ics`}
            onClick={() => setOpen(false)}
          >
            <span className="cal-icon">📥</span>
            <div>
              <div className="cal-title">Download .ics File</div>
              <div className="cal-sub">Import into any calendar app</div>
            </div>
          </a>
        </div>
      )}
    </div>
  );
}
