import * as db from './db.js';
import * as drive from './drive-sync.js';
import * as ui from './ui.js';

async function boot() {
  const profile = await db.getProfile();
  ui.applyTheme(profile.theme);

  document.querySelectorAll('.nav-btn[data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => ui.showScreen(btn.dataset.nav));
  });

  ui.showScreen('home');

  drive.onStatusChange(() => ui.updateSyncPill());
  ui.updateSyncPill();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch((e) => console.warn('SW registration failed', e));
  }

  wireAutoSync();

  // Silent attempt on launch — never shows a popup. If the session cannot
  // refresh silently (common on iOS Safari), the sync pill just shows
  // "Reconnecter" and the app keeps working entirely from local storage.
  if (drive.isConfigured()) drive.syncNow({ interactive: false });
}

function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

function wireAutoSync() {
  const debouncedSync = debounce(() => drive.syncNow({ interactive: false }), 4000);
  window.addEventListener('data-changed', () => {
    ui.refreshScreen();
    debouncedSync();
  });
  window.addEventListener('online', () => drive.syncNow({ interactive: false }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      drive.syncNow({ interactive: false, keepalive: true });
    } else if (document.visibilityState === 'visible') {
      drive.syncNow({ interactive: false });
      ui.refreshScreen();
    }
  });
  // extra safety net in case an event above is missed while the app stays open
  setInterval(() => drive.syncNow({ interactive: false }), 5 * 60 * 1000);
}

boot();
