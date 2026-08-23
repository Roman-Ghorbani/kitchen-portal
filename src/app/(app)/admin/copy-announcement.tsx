'use client';

import { useState } from 'react';

export function CopyAnnouncementButton({ weekStart }: { weekStart: string }) {
  const [copied, setCopied] = useState(false);

  function copyAnnouncement() {
    const text = `🚨 ZBT KITCHEN DUTY SCHEDULE — Week of ${weekStart} 🚨\n\nBrothers, the kitchen duty schedule is posted! Check your shift and flag any conflicts before Sunday chapter.\n\n🔗 https://kitchen.zbtaa.online/schedule`;
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    }
  }

  return (
    <button className="btn gold sm" type="button" onClick={copyAnnouncement}>
      {copied ? '✓ Announcement Copied!' : '📋 Copy Chapter Announcement'}
    </button>
  );
}
