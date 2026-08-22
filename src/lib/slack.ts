/**
 * Slack notifications via an incoming webhook.
 *
 * Entirely optional. With SLACK_WEBHOOK_URL unset every function here is a
 * no-op that reports why, so the app runs identically with or without it and
 * a Slack outage can never take the schedule down.
 *
 * Failures are swallowed deliberately: a notification not going out is an
 * annoyance, but it must never roll back a posted week or a claimed shift.
 */

import { parseISO } from './dates.ts';

export interface SlackResult {
  sent: boolean;
  reason?: string;
}

function webhook(): string | null {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return null;
  if (!url.startsWith('https://hooks.slack.com/')) return null;
  return url;
}

async function post(text: string, blocks?: unknown[]): Promise<SlackResult> {
  const url = webhook();
  if (!url) return { sent: false, reason: 'SLACK_WEBHOOK_URL not configured' };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(blocks ? { text, blocks } : { text }),
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      return { sent: false, reason: `Slack returned ${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    return { sent: false, reason: (err as Error).message };
  }
}

function pretty(iso: string): string {
  return parseISO(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

/** Announces a freshly posted week and when flagging closes. */
export async function announceWeekPosted(
  weekStart: string,
  locksAt: string,
  appUrl: string,
): Promise<SlackResult> {
  const text =
    `Kitchen duty for the week of ${pretty(weekStart)} is up. ` +
    `Flag conflicts before chapter on ${pretty(locksAt)}.`;

  return post(text, [
    {
      type: 'header',
      text: { type: 'plain_text', text: '🍳 Kitchen duty posted', emoji: true },
    },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `*Week of ${pretty(weekStart)}*\n` +
          `Check your shifts and flag any conflict *before chapter on ` +
          `${pretty(locksAt)}*. After that the week locks and you'll need to ` +
          `find your own cover.`,
      },
    },
    {
      type: 'actions',
      elements: [
        {
          type: 'button',
          text: { type: 'plain_text', text: 'See my shifts', emoji: true },
          url: `${appUrl}/my-shifts`,
          style: 'primary',
        },
      ],
    },
  ]);
}

/** Nudges the house as the flag deadline approaches. */
export async function announceDeadlineSoon(
  weekStart: string,
  hoursLeft: number,
  appUrl: string,
): Promise<SlackResult> {
  const text =
    `Last call: flag kitchen duty conflicts for the week of ` +
    `${pretty(weekStart)} within ${hoursLeft} hours.`;

  return post(text, [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `⏳ *${hoursLeft} hours left* to flag a conflict for the week of ` +
          `${pretty(weekStart)}.\n` +
          `After chapter the week locks — <${appUrl}/my-shifts|check your shifts>.`,
      },
    },
  ]);
}

/** Posts open shifts nobody has claimed. */
export async function announceOpenShifts(
  open: { date: string; meal: string; originalName: string }[],
  appUrl: string,
): Promise<SlackResult> {
  if (open.length === 0) return { sent: false, reason: 'nothing open' };

  const lines = open
    .map((o) => `• *${pretty(o.date)}* ${o.meal} — ${o.originalName} can't make it`)
    .join('\n');

  return post(`${open.length} kitchen shift(s) need cover`, [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `🙋 *${open.length} shift${open.length === 1 ? '' : 's'} need cover* ` +
          `— first come, and you keep the point.\n\n${lines}\n\n` +
          `<${appUrl}/schedule|Pick one up>`,
      },
    },
  ]);
}

export function slackConfigured(): boolean {
  return webhook() !== null;
}
