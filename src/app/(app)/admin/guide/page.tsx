/**
 * The kitchen manager's handbook, rendered from docs/HANDBOOK.md so the copy
 * in the repository and the copy in the app can never drift apart.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { redirect } from 'next/navigation';

import { getSession } from '../../../../lib/session.ts';
import { renderMarkdown } from '../../../../lib/mini-markdown.ts';
import { AppShell } from '../../shell.tsx';

export const dynamic = 'force-dynamic';

export default async function GuidePage() {
  const session = await getSession();
  if (!session) redirect('/signin');
  if (session.role !== 'admin') redirect('/');

  const md = await readFile(join(process.cwd(), 'docs', 'HANDBOOK.md'), 'utf8').catch(() => null);
  if (!md) {
    return (
      <AppShell session={session} active="/admin/guide" title="Handbook">
        <div className="card card-pad">docs/HANDBOOK.md is missing from this install.</div>
      </AppShell>
    );
  }

  // The file's own title and intro become the page header.
  const { html, headings } = renderMarkdown(md.replace(/^# .*\n/, ''));
  const sections = headings.filter((h) => h.level === 2);

  return (
    <AppShell session={session} active="/admin/guide" title="Handbook" subtitle="Running the kitchen without asking anyone">
      <nav className="card card-pad guide-toc" aria-label="Sections">
        {sections.map((h) => (
          <a key={h.id} href={`#${h.id}`}>
            {h.text}
          </a>
        ))}
      </nav>
      <article className="card card-pad guide" dangerouslySetInnerHTML={{ __html: html }} />
    </AppShell>
  );
}
