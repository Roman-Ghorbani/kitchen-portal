import { generateWeek } from '@/lib/scheduler.ts';

export default function Page() {
  const result = generateWeek({
    weekStart: '2026-08-24',
    members: [],
  });
  return <pre>{JSON.stringify(result.unfilled.length)}</pre>;
}
