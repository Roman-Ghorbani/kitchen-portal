'use client';

import { useState, useEffect } from 'react';

export function CalendarSyncButton({ feedToken }: { feedToken: string }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      setIsMobile(/iPhone|iPad|iPod|Android/i.test(navigator.userAgent));
    }
  }, []);

  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  const icsHttpsUrl = `${origin}/api/calendar/${feedToken}.ics`;
  const webcalUrl = `${origin.replace(/^https?:/, 'webcal:')}/api/calendar/${feedToken}.ics`;
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
    setTimeout(() => setCopied(false), 8000);
  }

  // The Google Calendar phone app cannot subscribe to a feed by itself; the
  // link has to be added once from Google Calendar on the web.
  function handleGoogleClick(e: React.MouseEvent) {
    if (isMobile) {
      e.preventDefault();
      copyFeedLink();
    }
  }

  return (
    <div className="cal-popover-wrap">
      <button
        type="button"
        className="shift-btn is-soft"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
          <path d="M3.5 10h17M8 3v4M16 3v4" />
        </svg>
        Add to calendar
        <svg className={`shift-btn-caret${open ? ' is-open' : ''}`} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="cal-popover-menu">
          <a
            className="cal-menu-item"
            href={webcalUrl}
            onClick={() => setOpen(false)}
          >
                        <div>
              <div className="cal-title">iPhone, iPad or Mac</div>
              <div className="cal-sub">Subscribes in one tap</div>
            </div>
          </a>
          <a
            className="cal-menu-item"
            href={googleDesktopUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleGoogleClick}
          >
                        <div>
              <div className="cal-title">Google Calendar</div>
              <div className="cal-sub">
                {copied
                  ? 'Link copied. In Google Calendar on the web: Other calendars → + → From URL, and paste.'
                  : 'Adds it to Google Calendar'}
              </div>
            </div>
          </a>
          <a
            className="cal-menu-item"
            href={outlookCalUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
          >
                        <div>
              <div className="cal-title">Outlook</div>
              <div className="cal-sub">Outlook on the web and desktop</div>
            </div>
          </a>
          <a
            className="cal-menu-item"
            href={icsHttpsUrl}
            download="kitchen-duty.ics"
            onClick={() => setOpen(false)}
          >
                        <div>
              <div className="cal-title">Download .ics file</div>
              <div className="cal-sub">A one-off copy for any calendar app</div>
            </div>
          </a>
        </div>
      )}
    </div>
  );
}
