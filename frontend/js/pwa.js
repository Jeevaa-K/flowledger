// FlowLedger PWA & Hybrid App Registration & Installation Handler
(function () {
  'use strict';

  let deferredInstallPrompt = null;

  // 1. Register Service Worker
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then(reg => {
          console.log('✅ FlowLedger ServiceWorker active with scope:', reg.scope);
        })
        .catch(err => {
          console.warn('⚠️ FlowLedger ServiceWorker registration failed:', err);
        });
    });
  }

  // 2. Mobile / Desktop Install Prompt (beforeinstallprompt)
  window.addEventListener('beforeinstallprompt', e => {
    // Prevent the default browser mini-infobar from appearing on mobile
    e.preventDefault();
    deferredInstallPrompt = e;

    // Show custom Install button in sidebar and mobile header
    const installBtns = document.querySelectorAll('.pwa-install-action');
    installBtns.forEach(btn => {
      btn.style.display = 'flex';
      btn.onclick = async () => {
        if (!deferredInstallPrompt) return;
        deferredInstallPrompt.prompt();
        const choice = await deferredInstallPrompt.userChoice;
        if (choice.outcome === 'accepted') {
          console.log('User installed FlowLedger');
        }
        deferredInstallPrompt = null;
        installBtns.forEach(b => (b.style.display = 'none'));
      };
    });
  });

  // 3. Track successful installation
  window.addEventListener('appinstalled', () => {
    console.log('🎉 FlowLedger successfully installed as app');
    deferredInstallPrompt = null;
    document.querySelectorAll('.pwa-install-action').forEach(b => (b.style.display = 'none'));
    if (window.UI && typeof window.UI.toast === 'function') {
      window.UI.toast('✓ FlowLedger installed on your device!', 'success');
    }
  });

  // 4. Online / Offline status monitoring
  window.addEventListener('offline', async () => {
    if (window.UI && typeof window.UI.toast === 'function') {
      let hasCachedData = false;
      try {
        if ('caches' in window) {
          const cacheKeys = await caches.keys();
          for (const key of cacheKeys) {
            const cache = await caches.open(key);
            const requests = await cache.keys();
            if (requests.some(r => r.url.includes('/api/'))) {
              hasCachedData = true;
              break;
            }
          }
        }
      } catch (_) {}

      if (hasCachedData) {
        window.UI.toast('⚡ You are offline. Cached data is available.', 'warning');
      } else {
        window.UI.toast('⚡ You are offline. Check your internet connection.', 'warning');
      }
    }
  });

  window.addEventListener('online', () => {
    if (window.UI && typeof window.UI.toast === 'function') {
      window.UI.toast('✓ Back online! Syncing...', 'success');
    }
  });

  // 5. Native Capacitor / Hybrid Detection
  window.FlowLedgerHybrid = {
    isNative: !!window.Capacitor,
    platform: window.Capacitor ? window.Capacitor.getPlatform() : 'web',
    promptInstall: () => {
      if (deferredInstallPrompt) deferredInstallPrompt.prompt();
    }
  };
})();
