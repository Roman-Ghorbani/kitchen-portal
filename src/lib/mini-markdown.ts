/**
 * Just enough Markdown to show docs/HANDBOOK.md inside the app, so the
 * handbook has one source: headings (with {#anchor}), paragraphs, bullet and
 * numbered lists, pipe tables, **bold**, *italic*, `code` and [links](url).
 *
 * The input is a file in this repository, not user content, but everything is
 * escaped first anyway and links are limited to relative paths, anchors and
 * https.
 */

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function inline(raw: string): string {
  let s = escape(raw);
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>');
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, text: string, href: string) =>
    /^(https:\/\/|\/|#)/.test(href) ? `<a href="${href}">${text}</a>` : text,
  );
  return s;
}

export interface Heading {
  level: number;
  id: string;
  text: string;
}

export function renderMarkdown(md: string): { html: string; headings: Heading[] } {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  const headings: Heading[] = [];
  let i = 0;

  const slug = (t: string) =>
    t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i++;
      continue;
    }

    const h = /^(#{1,4})\s+(.*?)(?:\s*\{#([a-z0-9-]+)\})?\s*$/.exec(line);
    if (h) {
      const level = h[1].length;
      const text = h[2];
      const id = h[3] ?? slug(text);
      headings.push({ level, id, text });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    if (line.startsWith('|')) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith('|')) {
        const cells = lines[i].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!cells.every((c) => /^:?-+:?$/.test(c))) rows.push(cells);
        i++;
      }
      const [head, ...body] = rows;
      out.push(
        '<div class="md-table"><table><thead><tr>' +
          head.map((c) => `<th>${inline(c)}</th>`).join('') +
          '</tr></thead><tbody>' +
          body.map((r) => '<tr>' + r.map((c) => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
          '</tbody></table></div>',
      );
      continue;
    }

    const list = /^(\s*)(-|\d+\.)\s+/.exec(line);
    if (list) {
      const ordered = list[2] !== '-';
      const items: string[] = [];
      while (i < lines.length && /^(-|\d+\.)\s+/.test(lines[i])) {
        let item = lines[i].replace(/^(-|\d+\.)\s+/, '');
        i++;
        // Continuation lines indented under the item.
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }

    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#|\||-\s|\d+\.\s)/.test(lines[i])) para.push(lines[i++].trim());
    out.push(`<p>${inline(para.join(' '))}</p>`);
  }

  return { html: out.join('\n'), headings };
}
