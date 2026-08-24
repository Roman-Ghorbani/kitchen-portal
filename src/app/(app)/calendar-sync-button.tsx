'use client';

import { useState } from 'react';

export function CalendarSyncButton({ memberId }: { memberId: string }) {
  const [open, setOpen] = useState(false);

  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://kitchen.zbtaa.online';

  const icsHttpsUrl = `${origin}/api/calendar/${memberId}.ics`;
  const webcalUrl = `${origin.replace(/^https?:/, 'webcal:')}/api/calendar/${memberId}.ics`;
  const googleCalUrl = `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(icsHttpsUrl)}`;
  const outlookCalUrl = `https://outlook.office.com/calendar/0/addcalendar?url=${encodeURIComponent(icsHttpsUrl)}&name=ZBT%20Kitchen%20Duty`;

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
              <div className="cal-title">Apple / Phone Calendar</div>
              <div className="cal-sub">Syncs to iPhone, iPad &amp; Mac</div>
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
            href={googleCalUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => setOpen(false)}
          >
            <span className="cal-icon">📅</span>
            <div>
              <div className="cal-title">Google Calendar</div>
              <div className="cal-sub">Adds to Google Calendar Web / App</div>
            </div>
          </a>
        </div>
      )}
    </div>
  );
}
