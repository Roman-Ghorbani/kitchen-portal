/** The public origin, for links that leave the app (Slack, calendar feeds). */
export function appUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
}

export function appHost(): string {
  return new URL(appUrl()).host;
}
