// World saves in IndexedDB (one record per world) plus small settings in localStorage.
const DB = 'lumencraft';
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => { const d = r.result; if (!d.objectStoreNames.contains('worlds')) d.createObjectStore('worlds', { keyPath: 'id' }); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction('worlds', mode);
    const s = t.objectStore('worlds');
    const out = fn(s);
    t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
    t.onerror = () => rej(t.error);
  });
}

export async function listWorlds() {
  try {
    const all = await tx('readonly', s => s.getAll());
    return (all || []).map(w => ({ id: w.id, name: w.meta.name, seed: w.meta.seedText ?? w.meta.seed, gamemode: w.meta.gamemode, played: w.meta.played || 0, created: w.meta.created, thumb: w.thumb || null }))
      .sort((a, b) => b.played - a.played);
  } catch (e) { return []; }
}
export async function loadWorld(id) { try { return await tx('readonly', s => s.get(id)); } catch (e) { return null; } }
export async function saveWorld(rec) { try { await tx('readwrite', s => s.put(rec)); return true; } catch (e) { console.warn('save failed', e); return false; } }
export async function deleteWorld(id) { try { await tx('readwrite', s => s.delete(id)); } catch (e) { /* ignore */ } }

// edits Map(colKey -> Map(index -> id)) <-> compact arrays
export function packEdits(edits) {
  const out = [];
  for (const [k, m] of edits) {
    if (!m.size) continue;
    const a = new Int32Array(m.size * 2);
    let i = 0;
    for (const [idx, id] of m) { a[i++] = idx; a[i++] = id; }
    out.push([k, a]);
  }
  return out;
}
export function unpackEdits(arr, into) {
  for (const [k, a] of arr || []) {
    const m = new Map();
    for (let i = 0; i < a.length; i += 2) m.set(a[i], a[i + 1]);
    into.set(k, m);
  }
}

const SKEY = 'lumencraft.settings.v1';
export function loadSettings(defaults) {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(SKEY) || '{}') }; } catch (e) { return { ...defaults }; }
}
export function saveSettings(s) { try { localStorage.setItem(SKEY, JSON.stringify(s)); } catch (e) { /* ignore */ } }
export function loadLocal(key, def) { try { const v = localStorage.getItem('lumencraft.' + key); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
export function saveLocal(key, v) { try { localStorage.setItem('lumencraft.' + key, JSON.stringify(v)); } catch (e) { /* ignore */ } }
