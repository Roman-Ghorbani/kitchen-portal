'use client';

import { useState, useEffect } from 'react';

export function InstallPrompt() {
  const [isStandalone, setIsStandalone] = useState(true); // Default true to avoid hydration flash
  const [isIOS, setIsIOS] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    // Check if dismissed previously
    try {
      if (localStorage.getItem('zbt_install_prompt_dismissed') === '1') {
        setIsVisible(false);
        return;
      }
    } catch {}

    // Check if running in standalone PWA mode
    const checkStandalone = () => {
      return (
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true
      );
    };

    const standalone = checkStandalone();
    setIsStandalone(standalone);

    // Device detection
    const userAgent = window.navigator.userAgent.toLowerCase();
    const ios = /iphone|ipad|ipod/.test(userAgent);
    const android = /android/.test(userAgent);
    setIsIOS(ios);
    setIsAndroid(android);
    setIsMobile(ios || android || window.innerWidth < 768);

    if (!standalone) {
      setIsVisible(true);
    }

    // Listen for beforeinstallprompt for Chrome / Edge / Android
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      try {
        if (localStorage.getItem('zbt_install_prompt_dismissed') !== '1' && !checkStandalone()) {
          setIsVisible(true);
        }
      } catch {}
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleDismiss = () => {
    try {
      localStorage.setItem('zbt_install_prompt_dismissed', '1');
    } catch {}
    setIsVisible(false);
  };

  const handleLaptopInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
        handleDismiss();
      }
    } else {
      alert(
        'To install on your laptop:\n\n• Chrome or Edge: Click the Install icon (🖥️ or ➕) on the right side of the address bar.\n• Mac / Windows: Pin or bookmark this tab for one-click access.'
      );
    }
  };

  if (isStandalone || !isVisible) {
    return null;
  }

  return (
    <div
      className="alert info"
      style={{
        marginBottom: 20,
        borderLeft: '4px solid var(--gold-400)',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          flexWrap: 'wrap',
          gap: 14,
        }}
      >
        <div style={{ flex: '1 1 300px' }}>
          <div
            className="alert-title"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 15,
              fontWeight: 700,
              color: 'var(--ink-900)',
            }}
          >
            <span>📱</span>
            <span>Get ZBT Kitchen on your Home Screen or Laptop</span>
          </div>

          <div
            className="alert-body"
            style={{
              marginTop: 8,
              fontSize: 13,
              lineHeight: 1.55,
              color: 'var(--ink-700)',
            }}
          >
            {isIOS ? (
              <div>
                <strong>Safari on iPhone/iPad:</strong> Tap the <strong>Share</strong> icon (
                <span style={{ fontSize: 14 }}>⎋</span> at bottom) → scroll down and tap{' '}
                <strong>&ldquo;Add to Home Screen&rdquo;</strong> (
                <span style={{ fontSize: 13 }}>➕</span>) → tap <strong>Add</strong>.
              </div>
            ) : isAndroid ? (
              <div>
                <strong>Chrome on Android:</strong> Tap the <strong>Menu</strong> (
                <span style={{ fontSize: 14 }}>⋮</span> in top-right) → tap{' '}
                <strong>&ldquo;Add to Home screen&rdquo;</strong> or{' '}
                <strong>&ldquo;Install app&rdquo;</strong>.
              </div>
            ) : (
              <div>
                <div style={{ marginBottom: 4 }}>
                  <strong>If you&apos;re on a laptop:</strong> Click the button below (or the{' '}
                  <span style={{ fontSize: 13 }}>🖥️</span> install icon in your address bar).
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--ink-400)' }}>
                  <strong>If on mobile:</strong> In Safari tap <strong>Share</strong> (
                  <span style={{ fontSize: 13 }}>⎋</span>) → <em>&ldquo;Add to Home Screen&rdquo;</em>.
                  In Chrome tap <strong>Menu</strong> (<span style={{ fontSize: 13 }}>⋮</span>) →{' '}
                  <em>&ldquo;Add to Home screen&rdquo;</em>.
                </div>
              </div>
            )}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            alignSelf: 'flex-start',
            marginTop: 2,
          }}
        >
          {!isMobile && (
            <button className="btn sm gold" onClick={handleLaptopInstallClick}>
              💻 Install App (Laptop)
            </button>
          )}
          {isMobile && deferredPrompt && (
            <button className="btn sm gold" onClick={handleLaptopInstallClick}>
              📲 Install App
            </button>
          )}
          <button className="btn sm ghost" onClick={handleDismiss}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

export function InstallButton() {
  const [isStandalone, setIsStandalone] = useState(true);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    setIsStandalone(
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true
    );

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleLaptopInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else {
      alert(
        'To install on your laptop:\n\n• In Chrome or Edge: Click the Install icon (🖥️ or ➕) in the top-right of your address bar.\n• In other browsers: Bookmark or pin this tab.'
      );
    }
  };

  if (isStandalone) {
    return (
      <div style={{ fontSize: 13.5, color: 'var(--green-600)', fontWeight: 600 }}>
        ✓ Running in installed app mode.
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        gap: 12,
        marginTop: 8,
      }}
    >
      {/* iOS Safari Guide */}
      <div
        style={{
          background: 'var(--raised)',
          padding: '12px 14px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--line)',
          fontSize: 13,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>🍎</span>
          <span>iPhone &amp; iPad (Safari)</span>
        </div>
        <ol style={{ paddingLeft: 18, margin: 0, lineHeight: 1.5, color: 'var(--ink-700)' }}>
          <li>Tap the <strong>Share</strong> button (<span style={{ fontSize: 13 }}>⎋</span> at the bottom).</li>
          <li>Scroll down and tap <strong>&ldquo;Add to Home Screen&rdquo;</strong> (<span style={{ fontSize: 13 }}>➕</span>).</li>
          <li>Tap <strong>Add</strong> in the top-right corner.</li>
        </ol>
      </div>

      {/* Android Chrome Guide */}
      <div
        style={{
          background: 'var(--raised)',
          padding: '12px 14px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--line)',
          fontSize: 13,
        }}
      >
        <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span>🤖</span>
          <span>Android (Chrome)</span>
        </div>
        <ol style={{ paddingLeft: 18, margin: 0, lineHeight: 1.5, color: 'var(--ink-700)' }}>
          <li>Tap the <strong>three dots</strong> menu (<span style={{ fontSize: 13 }}>⋮</span> in top-right).</li>
          <li>Tap <strong>&ldquo;Add to Home screen&rdquo;</strong> or <strong>&ldquo;Install app&rdquo;</strong>.</li>
          <li>Confirm by tapping <strong>Install</strong>.</li>
        </ol>
      </div>

      {/* Laptop / Desktop Guide */}
      <div
        style={{
          background: 'var(--raised)',
          padding: '12px 14px',
          borderRadius: 'var(--radius-sm)',
          border: '1px solid var(--line)',
          fontSize: 13,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
        }}
      >
        <div>
          <div style={{ fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span>💻</span>
            <span>Laptop / Desktop</span>
          </div>
          <p style={{ margin: 0, lineHeight: 1.5, color: 'var(--ink-700)' }}>
            Install as a standalone desktop app or click the <span style={{ fontSize: 13 }}>🖥️</span> icon in your address bar.
          </p>
        </div>
        <div style={{ marginTop: 10 }}>
          <button className="btn sm gold" onClick={handleLaptopInstallClick}>
            💻 Install App (Laptop)
          </button>
        </div>
      </div>
    </div>
  );
}
