import { NextRequest, NextResponse } from 'next/server';
import { getMemberById, getMyShifts } from '../../../../lib/member-queries.ts';
import { todayInEastern } from '../../../../lib/dates.ts';

function formatLocalICSDate(dateIso: string, hour: number, minute: number): string {
  const cleanDate = dateIso.replace(/-/g, '');
  const hh = hour.toString().padStart(2, '0');
  const mm = minute.toString().padStart(2, '0');
  return `${cleanDate}T${hh}${mm}00`;
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
    'X-WR-TIMEZONE:America/New_York',
    'REFRESH-INTERVAL;VALUE=DURATION:PT2H',
    'X-PUBLISHED-TTL:PT2H',
    'BEGIN:VTIMEZONE',
    'TZID:America/New_York',
    'X-LIC-LOCATION:America/New_York',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'TZNAME:EDT',
    'DTSTART:19700308T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'TZNAME:EST',
    'DTSTART:19701101T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
    'END:STANDARD',
    'END:VTIMEZONE',
  ];

  const todayIso = todayInEastern();
  const nowStamp = formatLocalICSDate(todayIso, 12, 0) + 'Z';

  for (const shift of shifts) {
    if (shift.status === 'covered') continue;

    const isLunch = shift.meal === 'lunch';
    // Lunch: 2:30 PM (14:30) to 3:00 PM (15:00)
    // Dinner: 7:30 PM (19:30) to 9:00 PM (21:00)
    const startHour = isLunch ? 14 : 19;
    const startMin = 30;
    const endHour = isLunch ? 15 : 21;
    const endMin = 0;

    const dtStart = formatLocalICSDate(shift.date, startHour, startMin);
    const dtEnd = formatLocalICSDate(shift.date, endHour, endMin);
    const title = `ZBT Kitchen Duty — ${isLunch ? 'Lunch Cleanup' : 'Dinner Cleanup'}`;

    const crewText =
      shift.crew.length > 0
        ? `Working with: ${shift.crew.join(', ')}`
        : `Single duty shift`;

    let roleText = `Duty: Regular assigned shift for ${member.name}`;
    if (shift.role === 'covering') {
      roleText = `Duty: Covering shift for ${shift.coveringForName}`;
    } else if (shift.isMakeup) {
      roleText = `Duty: Make-up shift for ${member.name}`;
    }

    const pointsText =
      shift.multiplier > 1
        ? `Bonus Value: ${shift.multiplier}x points`
        : `Value: 1 point`;

    const descriptionParts = [
      roleText,
      crewText,
      pointsText,
      `Time: ${isLunch ? '2:30 PM – 3:00 PM' : '7:30 PM – 9:00 PM'}`,
      'Location: ZBT Chapter House Kitchen',
      'Manage / Flag: https://kitchen.zbtaa.online/schedule',
    ];

    lines.push(
      'BEGIN:VEVENT',
      `UID:shift-${shift.assignmentId}@kitchen.zbtaa.online`,
      `DTSTAMP:${nowStamp}`,
      `DTSTART;TZID=America/New_York:${dtStart}`,
      `DTEND;TZID=America/New_York:${dtEnd}`,
      `SUMMARY:${title}`,
      `DESCRIPTION:${descriptionParts.join('\\n')}`,
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
