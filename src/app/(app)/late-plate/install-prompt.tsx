'use client';

import { useState, useEffect } from 'react';

export function InstallPrompt() {
  const [isStandalone, setIsStandalone] = useState(true); // Default true to avoid flash
  const [isIOS, setIsIOS] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    // Check if running in standalone mode
    const checkStandalone = () => {
      return (
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true
      );
    };

    setIsStandalone(checkStandalone());

    // Check if iOS
    const checkIOS = () => {
      const userAgent = window.navigator.userAgent.toLowerCase();
      return /iphone|ipad|ipod/.test(userAgent);
    };
    setIsIOS(checkIOS());

    if (!checkStandalone()) {
      setIsVisible(true);
    }

    // Listen for beforeinstallprompt for Chrome/Android
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
      if (!checkStandalone()) {
        setIsVisible(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    };
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
        setIsVisible(false);
      }
    } else if (isIOS) {
      alert('To install ZBT Kitchen, tap the Share icon at the bottom of Safari, then select "Add to Home Screen".');
    } else {
      alert('To install ZBT Kitchen, use your browser menu and select "Add to Home Screen" or "Install App".');
    }
  };

  if (isStandalone || !isVisible) {
    return null;
  }

  return (
    <div className="alert info" style={{ marginBottom: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <div>
        <span className="alert-title">📱 Get ZBT Kitchen on your Home Screen!</span>
        <span className="alert-body">
          Install this app to your home screen for one-tap access to late plates.
        </span>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn sm gold" onClick={handleInstallClick}>
          Install App
        </button>
        <button className="btn sm ghost" onClick={() => setIsVisible(false)}>
          Later
        </button>
      </div>
    </div>
  );
}

export function InstallButton() {
  const [isStandalone, setIsStandalone] = useState(true);
  const [isIOS, setIsIOS] = useState(false);
  const [deferredPrompt, setDeferredPrompt] = useState<any>(null);

  useEffect(() => {
    setIsStandalone(
      window.matchMedia('(display-mode: standalone)').matches ||
      (window.navigator as any).standalone === true
    );

    setIsIOS(/iphone|ipad|ipod/.test(window.navigator.userAgent.toLowerCase()));

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    return () => window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  }, []);

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else if (isIOS) {
      alert('To install ZBT Kitchen, tap the Share icon at the bottom of Safari, then select "Add to Home Screen".');
    } else {
      alert('To install ZBT Kitchen, use your browser menu and select "Add to Home Screen" or "Install App".');
    }
  };

  if (isStandalone) return null;

  return (
    <button className="btn sm gold" onClick={handleInstallClick}>
      📱 Add to Home Screen
    </button>
  );
}
