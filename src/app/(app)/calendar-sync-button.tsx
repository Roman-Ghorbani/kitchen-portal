'use client';

export function CalendarSyncButton({ memberId }: { memberId: string }) {
  const origin =
    typeof window !== 'undefined'
      ? window.location.origin
      : 'https://kitchen.zbtaa.online';
  const webcalUrl = `${origin.replace(/^https?:/, 'webcal:')}/api/calendar/${memberId}.ics`;

  return (
    <a className="btn gold sm" href={webcalUrl}>
      📱 Connect to Calendar
    </a>
  );
}
