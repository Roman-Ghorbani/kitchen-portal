'use client';

import { useState } from 'react';
import { generateKioskToken } from '../../../actions/settings-actions.ts';

export function KioskLink({ token }: { token: string | null }) {
  const [loading, setLoading] = useState(false);

  async function generate() {
    if (!confirm('This will invalidate any existing Chef Tablets. Continue?')) return;
    setLoading(true);
    await generateKioskToken();
    setLoading(false);
  }

  const kioskUrl = token 
    ? (typeof window !== 'undefined' ? window.location.origin : '') + '/kitchen/late-plates?device=' + token 
    : null;

  return (
    <div style={{ marginTop: '2rem' }}>
      <dt>Chef Tablet Kiosk Link</dt>
      <dd style={{ marginBottom: '1rem' }}>
        This link allows the kitchen tablet to read and manage late plates without needing to sign in with a PIN.
      </dd>
      
      {token ? (
        <div style={{ padding: '1rem', background: 'var(--bg-card-alt)', borderRadius: '6px', border: '1px solid var(--border)' }}>
          <div style={{ marginBottom: '0.5rem', fontWeight: 600 }}>Kiosk URL:</div>
          <div style={{ 
            fontFamily: 'monospace', 
            background: 'var(--bg-site)', 
            padding: '0.5rem', 
            borderRadius: '4px',
            wordBreak: 'break-all',
            marginBottom: '1rem'
          }}>
            {kioskUrl}
          </div>
          
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button 
              className="btn sm" 
              onClick={() => {
                navigator.clipboard.writeText(kioskUrl || '');
                alert('Copied to clipboard');
              }}
            >
              Copy Link
            </button>
            <button className="btn sm alt" onClick={generate} disabled={loading}>
              {loading ? 'Generating...' : 'Regenerate Token'}
            </button>
          </div>
        </div>
      ) : (
        <button className="btn sm" onClick={generate} disabled={loading}>
          {loading ? 'Generating...' : 'Generate Kiosk Link'}
        </button>
      )}
    </div>
  );
}
