'use client';

import { useState } from 'react';

/**
 * Copies the week as plain text for pasting into a group chat.
 *
 * The house is used to a screenshot of a list landing in a chat every Sunday,
 * and that habit is worth keeping rather than fighting - this just makes the
 * pasted version always match what the app actually says.
 */
export function CopyWeekButton({ text }: { text: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
      setTimeout(() => setState('idle'), 2500);
    } catch {
      setState('failed');
    }
  }

  return (
    <div className="copy-week">
      <button className="btn sm" onClick={copy}>
        {state === 'copied' ? '✓ Copied' : 'Copy for group chat'}
      </button>

      {state === 'failed' && (
        <details className="copy-fallback">
          <summary>Copy failed — tap to select manually</summary>
          <textarea readOnly value={text} rows={12} onFocus={(e) => e.target.select()} />
        </details>
      )}
    </div>
  );
}
