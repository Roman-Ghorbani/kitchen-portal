'use client';

import { useState } from 'react';

export function CalendarSyncButton({ memberId }: { memberId: string }) {
  const [copied, setCopied] = useState(false);

  function copyUrl() {
    const origin =
      typeof window !== 'undefined'
        ? window.location.origin
        : 'https://kitchen.zbtaa.online';
    const icsUrl = `${origin}/api/calendar/${memberId}.ics`;

    if (navigator.clipboard) {
      navigator.clipboard.writeText(icsUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://kitchen.zbtaa.online';
  const webcalUrl = `${origin.replace(/^https?:/, 'webcal:')}/api/calendar/${memberId}.ics`;

  return (
    <div className="cal-sync-group">
      <a className="btn gold sm" href={webcalUrl}>
        📱 Sync to Phone Calendar
      </a>
      <button className="btn sm" type="button" onClick={copyUrl}>
        {copied ? '✓ Copied Link' : 'Copy Feed Link'}
      </button>
    </div>
  );
}
