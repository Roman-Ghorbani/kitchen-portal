import { redirect } from 'next/navigation';

import { getSession } from '../lib/session.ts';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const session = await getSession();
  if (!session) redirect('/signin');
  redirect(session.role === 'admin' ? '/admin' : '/my-shifts');
}
