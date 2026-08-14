// Local-first storage layer (IndexedDB). This is the single source of truth:
// every write lands here FIRST and durably, before any network sync is attempted.
// Drive sync (drive-sync.js) reads/writes through this module — it never bypasses it.

const DB_NAME = 'calorie-tracker';
const DB_VERSION = 1;

// Collections that are arrays of records merged by id+updatedAt during Drive sync.
export const COLLECTIONS = ['logs', 'weights', 'water', 'activities', 'foods'];

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of COLLECTIONS) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath: 'id' });
          store.createIndex('date', 'date', { unique: false });
          store.createIndex('updatedAt', 'updatedAt', { unique: false });
        }
      }
      if (!db.objectStoreNames.contains('profile')) {
        db.createObjectStore('profile', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('meta')) {
        db.createObjectStore('meta', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode) {
  return openDB().then(db => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

export function nowISO() {
  return new Date().toISOString();
}

// ---- generic collection CRUD (logs, weights, water, activities, foods) ----

export async function put(storeName, record) {
  const store = await tx(storeName, 'readwrite');
  await reqToPromise(store.put(record));
  await markDirty();
  return record;
}

export async function getAll(storeName) {
  const store = await tx(storeName, 'readonly');
  const all = await reqToPromise(store.getAll());
  return all.filter(r => !r.deleted);
}

export async function getAllRaw(storeName) {
  // includes soft-deleted tombstones — used by the sync engine only
  const store = await tx(storeName, 'readonly');
  return reqToPromise(store.getAll());
}

export async function getByDate(storeName, date) {
  const store = await tx(storeName, 'readonly');
  const idx = store.index('date');
  const all = await reqToPromise(idx.getAll(IDBKeyRange.only(date)));
  return all.filter(r => !r.deleted);
}

export async function softDelete(storeName, id) {
  const store = await tx(storeName, 'readwrite');
  const existing = await reqToPromise(store.get(id));
  if (!existing) return;
  existing.deleted = true;
  existing.updatedAt = nowISO();
  await reqToPromise(store.put(existing));
  await markDirty();
}

export async function replaceAll(storeName, records) {
  // used only by the sync engine after a merge — writes the full merged set
  const store = await tx(storeName, 'readwrite');
  await reqToPromise(store.clear());
  for (const r of records) {
    await reqToPromise(store.put(r));
  }
}

// ---- profile (single record, id='me') ----

export async function getProfile() {
  const store = await tx('profile', 'readonly');
  const p = await reqToPromise(store.get('me'));
  return p || defaultProfile();
}

export function defaultProfile() {
  return {
    id: 'me',
    name: '',
    sex: 'f',
    age: 30,
    heightCm: 170,
    activityLevel: 'moderate',
    goalType: 'maintain',
    calorieGoal: 2000,
    macroGoals: { protein_g: 100, carbs_g: 250, fat_g: 65 },
    waterGoalMl: 2000,
    theme: 'system',
    updatedAt: nowISO(),
  };
}

export async function saveProfile(profile) {
  profile.updatedAt = nowISO();
  const store = await tx('profile', 'readwrite');
  await reqToPromise(store.put(profile));
  await markDirty();
  return profile;
}

// ---- meta (sync bookkeeping) ----

export async function getMeta() {
  const store = await tx('meta', 'readonly');
  const m = await reqToPromise(store.get('sync'));
  return m || { id: 'sync', driveFileId: null, lastSyncedAt: null, lastBackupDate: null, dirty: false };
}

export async function saveMeta(patch) {
  const current = await getMeta();
  const next = { ...current, ...patch, id: 'sync' };
  const store = await tx('meta', 'readwrite');
  await reqToPromise(store.put(next));
  return next;
}

async function markDirty() {
  const store = await tx('meta', 'readwrite');
  const current = (await reqToPromise(store.get('sync'))) || { id: 'sync' };
  current.dirty = true;
  await reqToPromise(store.put(current));
  window.dispatchEvent(new CustomEvent('data-changed'));
}

// ---- full local snapshot (used by sync engine + manual JSON export) ----

export async function exportSnapshot() {
  const snapshot = { version: 1, updatedAt: nowISO() };
  snapshot.profile = await getProfile();
  for (const c of COLLECTIONS) {
    snapshot[c] = await getAllRaw(c);
  }
  return snapshot;
}

export async function importSnapshot(snapshot, { merge = true } = {}) {
  if (!snapshot || typeof snapshot !== 'object') throw new Error('Fichier invalide');
  if (merge) {
    const { mergeSnapshots } = await import('./drive-sync.js');
    const local = await exportSnapshot();
    const merged = mergeSnapshots(local, snapshot);
    await applySnapshot(merged);
    return merged;
  }
  await applySnapshot(snapshot);
  return snapshot;
}

export async function applySnapshot(snapshot) {
  if (snapshot.profile) await saveProfile(snapshot.profile);
  for (const c of COLLECTIONS) {
    if (Array.isArray(snapshot[c])) await replaceAll(c, snapshot[c]);
  }
}
