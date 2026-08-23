import { NextRequest, NextResponse } from 'next/server';
import { getMemberById, getMyShifts } from '../../../../lib/member-queries.ts';

function formatICSDate(dateIso: string, hour: number, minute: number): string {
  const cleanDate = dateIso.replace(/-/g, '');
  const hh = hour.toString().padStart(2, '0');
  const mm = minute.toString().padStart(2, '0');
  return `${cleanDate}T${hh}${mm}00Z`;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ memberId: string }> },
) {
  const { memberId } = await params;
  const cleanMemberId = memberId.replace(/\.ics$/, '');

  const member = await getMemberById(cleanMemberId);
  if (!member) {
    return new NextResponse('Member not found', { status: 404 });
  }

  const shifts = await getMyShifts(cleanMemberId);

  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ZBT Chapter House//Kitchen Duty Tracker//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:ZBT Kitchen Duty',
    'X-WR-TIMEZONE:UTC',
    'REFRESH-INTERVAL;VALUE=DURATION:PT2H',
    'X-PUBLISHED-TTL:PT2H',
  ];

  for (const shift of shifts) {
    if (shift.status === 'covered') continue;

    const isLunch = shift.meal === 'lunch';
    const startHour = isLunch ? 12 : 17;
    const startMin = 30;
    const endHour = isLunch ? 13 : 18;
    const endMin = isLunch ? 15 : 30;

    const dtStart = formatICSDate(shift.date, startHour, startMin);
    const dtEnd = formatICSDate(shift.date, endHour, endMin);
    const title = `ZBT Kitchen Duty — ${isLunch ? 'Lunch Cleanup' : 'Dinner Cleanup'}`;
    const description =
      shift.role === 'covering'
        ? `Covering shift for ${shift.coveringForName}`
        : `Assigned shift for ${member.name}`;

    lines.push(
      'BEGIN:VEVENT',
      `UID:shift-${shift.assignmentId}@kitchen.zbtaa.online`,
      `DTSTAMP:${formatICSDate(new Date().toISOString().slice(0, 10), 12, 0)}`,
      `DTSTART:${dtStart}`,
      `DTEND:${dtEnd}`,
      `SUMMARY:${title}`,
      `DESCRIPTION:${description}`,
      `LOCATION:ZBT Chapter House Kitchen`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');

  return new NextResponse(lines.join('\r\n'), {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="kitchen-duty-${cleanMemberId}.ics"`,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  });
}
