// IndexedDB wrapper. Object stores: products, campaigns, scenarios, settings.
// Nothing here ever touches the network — purely local persistence.

const DB = 'adcalc';
const VERSION = 2;
const STORES = ['products', 'campaigns', 'scenarios', 'settings'];
// snapshots is keyed by calendar date so logging the same day overwrites.

let dbp;
function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const req = indexedDB.open(DB, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) {
          db.createObjectStore(s, { keyPath: 'id', autoIncrement: true });
        }
      }
      if (!db.objectStoreNames.contains('snapshots')) {
        db.createObjectStore('snapshots', { keyPath: 'date' });
      }
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  return dbp;
}

function tx(store, mode) {
  return open().then(db => db.transaction(store, mode).objectStore(store));
}

export async function put(store, value) {
  const os = await tx(store, 'readwrite');
  return new Promise((res, rej) => {
    const r = os.put(value);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function all(store) {
  const os = await tx(store, 'readonly');
  return new Promise((res, rej) => {
    const r = os.getAll();
    r.onsuccess = () => res(r.result || []);
    r.onerror = () => rej(r.error);
  });
}

export async function get(store, id) {
  const os = await tx(store, 'readonly');
  return new Promise((res, rej) => {
    const r = os.get(id);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export async function del(store, id) {
  const os = await tx(store, 'readwrite');
  return new Promise((res, rej) => {
    const r = os.delete(id);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
}

// settings is a single keyed record so it round-trips simply.
export async function getSettings() {
  return (await get('settings', 1)) || { id: 1, currency: '$' };
}
export async function saveSettings(s) {
  return put('settings', { ...s, id: 1 });
}
