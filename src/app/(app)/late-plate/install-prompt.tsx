'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

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
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 12,
      }}
    >
      <div>
        <span className="alert-title">📱 Add ZBT Kitchen Portal to your Home Screen</span>
        <span className="alert-body">
          Install this portal on your phone or laptop for 1-tap access to shifts, late plates, and weekly menus.
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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

export function LatePlateRefresher() {
  const router = useRouter();

  useEffect(() => {
    // When a brother returns to the tab or app, refresh immediately to display
    // any newly posted menus or updated plate statuses.
    const onFocus = () => {
      router.refresh();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        router.refresh();
      }
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisible);

    // Also poll every 20 seconds while actively open
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        router.refresh();
      }
    }, 20_000);

    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(interval);
    };
  }, [router]);

  return null;
}

