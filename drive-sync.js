// Google Drive sync engine.
//
// Design principle: IndexedDB (db.js) is always the source of truth and is
// written to synchronously on every user action. This module only ever
// *reconciles* that local truth with a JSON blob stored in the user's
// hidden Drive "appDataFolder" (a space only this app can see — it cannot
// browse or touch any other file in the user's Drive). A sync cycle never
// blindly overwrites one side with the other: it downloads the remote
// copy, merges it with the local copy record-by-record (last write wins,
// per record, using each record's own updatedAt), writes the merged
// result back to IndexedDB, then uploads it. That merge is what makes it
// safe to use the app offline on two devices and reconnect later without
// losing whichever device synced last.
import { COLLECTIONS, exportSnapshot, applySnapshot, getMeta, saveMeta, nowISO } from './db.js';
import { GOOGLE_CLIENT_ID, DRIVE_SCOPE, DRIVE_FILE_NAME, DRIVE_BACKUP_PREFIX, MAX_BACKUPS } from './config.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

let tokenClient = null;
let accessToken = null;
let tokenExpiresAt = 0;
let gisLoadPromise = null;

const listeners = new Set();
let status = 'idle'; // idle | syncing | synced | offline | signed-out | error | not-configured
let lastError = null;

export function onStatusChange(fn) {
  listeners.add(fn);
  fn(status, lastError);
  return () => listeners.delete(fn);
}

function setStatus(next, err = null) {
  status = next;
  lastError = err;
  for (const fn of listeners) fn(status, lastError);
}

export function getStatus() {
  return { status, lastError };
}

export function isConfigured() {
  return !!GOOGLE_CLIENT_ID && !GOOGLE_CLIENT_ID.startsWith('REPLACE_WITH');
}

// ---- Google Identity Services bootstrap ----

function loadGis() {
  if (gisLoadPromise) return gisLoadPromise;
  gisLoadPromise = new Promise((resolve, reject) => {
    if (window.google && window.google.accounts && window.google.accounts.oauth2) {
      resolve();
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Impossible de charger Google Identity Services (hors ligne ?)'));
    document.head.appendChild(s);
  });
  return gisLoadPromise;
}

async function ensureTokenClient() {
  if (tokenClient) return tokenClient;
  await loadGis();
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE,
    callback: () => {}, // overridden per-call in requestToken()
  });
  return tokenClient;
}

function requestToken(promptMode) {
  return ensureTokenClient().then(client => new Promise((resolve, reject) => {
    client.callback = (resp) => {
      if (resp && resp.error) {
        reject(Object.assign(new Error(resp.error), { needsReauth: true }));
        return;
      }
      accessToken = resp.access_token;
      tokenExpiresAt = Date.now() + (Number(resp.expires_in) || 3300) * 1000;
      resolve(accessToken);
    };
    try {
      client.requestAccessToken({ prompt: promptMode });
    } catch (e) {
      reject(e);
    }
  }));
}

/**
 * Returns a valid access token, refreshing silently when possible.
 * On iOS Safari (PWA or browser), silent refresh across app relaunches
 * often fails because Safari's Intelligent Tracking Prevention blocks the
 * third-party cookies Google's silent-reauth relies on. When that
 * happens this throws a `needsReauth` error — the UI shows a "Reconnecter
 * Google Drive" button. Nothing is lost while disconnected: local writes
 * keep landing in IndexedDB and sync resumes the moment the user taps it.
 */
async function ensureToken({ interactive = false } = {}) {
  if (accessToken && Date.now() < tokenExpiresAt - 60000) return accessToken;
  try {
    return await requestToken(interactive ? 'consent' : '');
  } catch (e) {
    if (interactive) throw e;
    // one more try, explicit consent, only if caller allows it upstream
    throw Object.assign(new Error('Reconnexion Google Drive nécessaire'), { needsReauth: true });
  }
}

export async function signIn() {
  await ensureToken({ interactive: true });
  setStatus('idle');
}

export function signOut() {
  if (accessToken && window.google?.accounts?.oauth2?.revoke) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  accessToken = null;
  tokenExpiresAt = 0;
  setStatus('signed-out');
}

export function isSignedIn() {
  return !!accessToken && Date.now() < tokenExpiresAt;
}

// ---- Drive REST helpers (appDataFolder only) ----

async function driveFetch(url, token, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) },
  });
  if (!res.ok) {
    const err = new Error(`Drive API ${res.status}`);
    err.status = res.status;
    if (res.status === 401) err.needsReauth = true;
    throw err;
  }
  return res;
}

async function findFileByName(token, name) {
  const url = `${DRIVE_API}/files?spaces=appDataFolder&q=${encodeURIComponent(`name='${name}' and trashed=false`)}&fields=files(id,name,modifiedTime)&pageSize=10`;
  const res = await driveFetch(url, token);
  const data = await res.json();
  return data.files && data.files[0] ? data.files[0].id : null;
}

async function createJsonFile(token, name, contentObj) {
  const boundary = 'calorietracker' + Date.now();
  const metadata = { name, parents: ['appDataFolder'] };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(contentObj)}\r\n` +
    `--${boundary}--`;
  const res = await driveFetch(`${DRIVE_UPLOAD_API}/files?uploadType=multipart&fields=id`, token, {
    method: 'POST',
    headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    body,
  });
  const data = await res.json();
  return data.id;
}

async function updateJsonFile(token, fileId, contentObj, { keepalive = false } = {}) {
  await driveFetch(`${DRIVE_UPLOAD_API}/files/${fileId}?uploadType=media`, token, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(contentObj),
    keepalive,
  });
}

async function downloadJsonFile(token, fileId) {
  const res = await driveFetch(`${DRIVE_API}/files/${fileId}?alt=media`, token);
  return res.json();
}

async function listBackupFiles(token) {
  const url = `${DRIVE_API}/files?spaces=appDataFolder&q=${encodeURIComponent(`name contains '${DRIVE_BACKUP_PREFIX}' and trashed=false`)}&fields=files(id,name)&orderBy=name&pageSize=100`;
  const res = await driveFetch(url, token);
  const data = await res.json();
  return data.files || [];
}

async function deleteFile(token, fileId) {
  await driveFetch(`${DRIVE_API}/files/${fileId}`, token, { method: 'DELETE' });
}

// ---- merge logic (pure — also used by manual JSON import in db.js) ----

function pickNewer(a, b) {
  if (!a) return b;
  if (!b) return a;
  return new Date(a.updatedAt || 0) >= new Date(b.updatedAt || 0) ? a : b;
}

function mergeCollection(listA = [], listB = []) {
  const map = new Map();
  for (const r of listA) map.set(r.id, r);
  for (const r of listB) {
    const existing = map.get(r.id);
    if (!existing || new Date(r.updatedAt || 0) > new Date(existing.updatedAt || 0)) {
      map.set(r.id, r);
    }
  }
  return Array.from(map.values());
}

export function mergeSnapshots(a, b) {
  const result = { version: 1, updatedAt: nowISO() };
  result.profile = pickNewer(a?.profile, b?.profile);
  for (const c of COLLECTIONS) {
    result[c] = mergeCollection(a?.[c], b?.[c]);
  }
  return result;
}

// ---- backups (dated snapshots kept in appDataFolder as an extra safety net) ----

async function maybeCreateBackup(token, snapshot) {
  const meta = await getMeta();
  const today = new Date().toISOString().slice(0, 10);
  if (meta.lastBackupDate === today) return;
  await createJsonFile(token, `${DRIVE_BACKUP_PREFIX}${today}.json`, snapshot);
  await saveMeta({ lastBackupDate: today });
  const files = await listBackupFiles(token);
  if (files.length > MAX_BACKUPS) {
    const toDelete = files.slice(0, files.length - MAX_BACKUPS);
    for (const f of toDelete) await deleteFile(token, f.id).catch(() => {});
  }
}

// ---- main sync cycle ----

let syncing = false;

export async function syncNow({ interactive = false, keepalive = false } = {}) {
  if (!isConfigured()) {
    setStatus('not-configured');
    return;
  }
  if (!navigator.onLine) {
    setStatus('offline');
    return;
  }
  if (syncing) return;
  syncing = true;
  try {
    setStatus('syncing');
    const token = await ensureToken({ interactive });

    let meta = await getMeta();
    let fileId = meta.driveFileId;
    if (!fileId) {
      fileId = await findFileByName(token, DRIVE_FILE_NAME);
    }

    const local = await exportSnapshot();

    let remote = null;
    if (fileId) {
      try {
        remote = await downloadJsonFile(token, fileId);
      } catch (e) {
        if (e.status === 404) {
          fileId = null; // file was removed remotely — recreate below
        } else {
          throw e;
        }
      }
    }

    if (!fileId) {
      fileId = await createJsonFile(token, DRIVE_FILE_NAME, local);
      await saveMeta({ driveFileId: fileId });
      remote = local;
    }

    const merged = remote ? mergeSnapshots(local, remote) : local;
    await applySnapshot(merged);
    await updateJsonFile(token, fileId, merged, { keepalive });
    await maybeCreateBackup(token, merged);
    await saveMeta({ lastSyncedAt: nowISO(), dirty: false, driveFileId: fileId });
    setStatus('synced');
  } catch (err) {
    console.error('[drive-sync] échec de synchronisation', err);
    setStatus(err && err.needsReauth ? 'signed-out' : 'error', err);
  } finally {
    syncing = false;
  }
}
