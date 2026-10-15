import * as THREE from 'three';
import { CS, H, SECTIONS, idx, colKey } from '../core/config.js';
import { LO, EMIT, OPAQUE, SOLID, SHAPES, SHAPE, BLOCKS, LIQUID, B } from '../core/blocks.js';
import { meshSection, P } from './mesher.js';

const AREA = CS * CS;
const SKY = 0, BLK = 1;
const DX = [1, -1, 0, 0, 0, 0], DY = [0, 0, 1, -1, 0, 0], DZ = [0, 0, 0, 0, 1, -1];

class Column {
  constructor(cx, cz, d) {
    this.cx = cx; this.cz = cz;
    this.blocks = d.blocks; this.light = d.light; this.tints = d.tints;
    this.biomes = d.biomes; this.heights = d.heights; this.counts = d.counts;
    this.meshedOnce = false;
    this.dirty = new Uint8Array(SECTIONS);
    this.sections = new Array(SECTIONS).fill(null);   // [bucket outputs] per section
    this.pending = new Int32Array(SECTIONS);           // version of in-flight mesh job
    this.version = new Int32Array(SECTIONS);
    this.meshes = [null, null, null];
    this.needsUpload = false;
    this.neighborsLinked = 0;
  }
}

export class World {
  constructor(seed, opts = {}) {
    this.seed = seed >>> 0;
    this.columns = new Map();
    this.edits = new Map();          // colKey -> Map(localIndex -> id)
    this.renderDist = opts.renderDist || 8;
    this.group = new THREE.Group();
    this.group.matrixAutoUpdate = false;
    this.materials = opts.materials || [null, null, null];
    this.listeners = [];
    this.genQueue = new Set();
    this.genInFlight = new Map();
    this.meshInFlight = 0;
    this.uploadQueue = new Set();
    this.lastCenter = null;
    this.loadOrder = [];
    this.aq = [[], []];   // add queues (flat x,y,z)
    this.rq = [];         // removal queue (x,y,z,v)
    this.stats = { gen: 0, meshes: 0 };
    this.destroyed = false;

    const cores = Math.max(2, Math.min(navigator.hardwareConcurrency || 4, 8));
    this.genWorkers = [];
    this.meshWorkers = [];
    const nGen = Math.max(1, Math.min(4, cores - 2));
    const nMesh = Math.max(1, Math.min(3, cores - nGen - 1));
    for (let i = 0; i < nGen; i++) {
      const w = new Worker(new URL('./gen.worker.js', import.meta.url), { type: 'module' });
      w.postMessage({ type: 'seed', seed: this.seed });
      w.onmessage = (e) => this.onGen(e.data);
      w.busy = 0;
      this.genWorkers.push(w);
    }
    for (let i = 0; i < nMesh; i++) {
      const w = new Worker(new URL('./mesh.worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => this.onMesh(e.data, w);
      w.busy = 0;
      this.meshWorkers.push(w);
    }
    this.maxGenInFlight = nGen * 3;
    this.maxMeshInFlight = nMesh * 4;
    // scratch for padded section data
    this.pb = new Uint8Array(P * P * P);
    this.pl = new Uint8Array(P * P * P);
    this.pt = new Uint8Array(P * P * 9);
  }

  destroy() {
    this.destroyed = true;
    for (const w of this.genWorkers) w.terminate();
    for (const w of this.meshWorkers) w.terminate();
    for (const c of this.columns.values()) this.disposeColumn(c);
    this.columns.clear();
  }

  // ------------------------------------------------------------ access
  col(cx, cz) { return this.columns.get(colKey(cx, cz)); }
  getBlock(x, y, z) {
    if (y < 0) return B.bedrock;
    if (y >= H) return 0;
    const c = this.columns.get(colKey(x >> 4, z >> 4));
    return c ? c.blocks[idx(x & 15, y, z & 15)] : 0;
  }
  getLight(x, y, z) {
    if (y >= H) return 0xf0;
    if (y < 0) return 0;
    const c = this.columns.get(colKey(x >> 4, z >> 4));
    return c ? c.light[idx(x & 15, y, z & 15)] : 0xf0;
  }
  isLoaded(x, z) { return this.columns.has(colKey(x >> 4, z >> 4)); }
  isMeshed(x, z) { const c = this.columns.get(colKey(x >> 4, z >> 4)); return !!(c && c.meshedOnce); }
  heightAt(x, z) {
    const c = this.columns.get(colKey(x >> 4, z >> 4));
    return c ? c.heights[(z & 15) * CS + (x & 15)] : 0;
  }
  biomeAt(x, z) {
    const c = this.columns.get(colKey(x >> 4, z >> 4));
    return c ? c.biomes[(z & 15) * CS + (x & 15)] : 3;
  }
  // Top solid-ish block for spawning (skips leaves and liquids).
  groundAt(x, z) {
    for (let y = this.heightAt(x, z); y > 0; y--) {
      const id = this.getBlock(x, y, z);
      if (SOLID[id] && !BLOCKS[id].leaves) return y;
      if (LIQUID[id]) return -1;
    }
    return -1;
  }

  // ------------------------------------------------------------ edits
  setBlock(x, y, z, id, opts = {}) {
    if (y < 0 || y >= H) return false;
    const key = colKey(x >> 4, z >> 4);
    const c = this.columns.get(key);
    const lx = x & 15, lz = z & 15;
    const i = idx(lx, y, lz);
    // record the edit even when the column is not loaded (remote edits)
    let em = this.edits.get(key);
    if (!em) { em = new Map(); this.edits.set(key, em); }
    em.set(i, id);
    if (!c) return false;
    const old = c.blocks[i];
    if (old === id) return false;
    c.blocks[i] = id;
    const sy = y >> 4;
    if (old === 0 && id !== 0) c.counts[sy]++;
    else if (old !== 0 && id === 0) c.counts[sy]--;
    // heightmap
    const hi = lz * CS + lx;
    if (id !== 0 && y > c.heights[hi]) c.heights[hi] = y;
    else if (id === 0 && y === c.heights[hi]) {
      let h = y; while (h > 0 && c.blocks[idx(lx, h, lz)] === 0) h--; c.heights[hi] = h;
    }
    this.markDirty(x, y, z);
    this.relight(x, y, z, old, id);
    for (const l of this.listeners) l(x, y, z, old, id, opts);
    if (opts.immediate) this.flushNear(x, y, z);
    return true;
  }

  markDirty(x, y, z) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = this.columns.get(colKey((x + dx) >> 4, (z + dz) >> 4));
      if (!c || !c.meshedOnce) continue;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        c.dirty[yy >> 4] = 1;
      }
    }
  }

  // Remesh dirty sections around a point right now (player edits feel instant).
  flushNear(x, y, z) {
    const touched = new Set();
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const c = this.columns.get(colKey((x + dx) >> 4, (z + dz) >> 4));
      if (!c || !c.meshedOnce || touched.has(c)) continue;
      touched.add(c);
      for (let sy = 0; sy < SECTIONS; sy++) {
        if (!c.dirty[sy]) continue;
        if (Math.abs(sy * 16 + 8 - y) > 40) continue;
        c.dirty[sy] = 0;
        this.meshNow(c, sy);
      }
    }
    for (const c of touched) this.upload(c);
  }

  // ------------------------------------------------------------ lighting
  getChan(ch, x, y, z) {
    if (y < 0 || y >= H) return ch === SKY && y >= H ? 15 : 0;
    const c = this.columns.get(colKey(x >> 4, z >> 4));
    if (!c) return -1;
    const L = c.light[idx(x & 15, y, z & 15)];
    return ch === SKY ? L >> 4 : L & 15;
  }
  setChan(ch, x, y, z, v) {
    const c = this.columns.get(colKey(x >> 4, z >> 4));
    if (!c) return;
    const i = idx(x & 15, y, z & 15);
    const L = c.light[i];
    c.light[i] = ch === SKY ? (v << 4) | (L & 15) : (L & 0xf0) | v;
    if (c.meshedOnce) this.markDirty(x, y, z);
  }

  relight(x, y, z, oldId, newId) {
    const loOld = LO[oldId], loNew = LO[newId];
    // block light
    if (EMIT[oldId] > 0 || loNew > loOld || EMIT[newId] < EMIT[oldId]) this.removeLight(BLK, x, y, z);
    if (EMIT[newId] > 0) { this.setChan(BLK, x, y, z, Math.max(EMIT[newId], this.getChan(BLK, x, y, z))); this.aq[BLK].push(x, y, z); }
    // sky light
    if (loNew > loOld) this.removeLight(SKY, x, y, z);
    if (loNew < loOld || newId === 0) {
      for (let d = 0; d < 6; d++) {
        const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
        if (ny < 0 || ny >= H) continue;
        if (this.getChan(SKY, nx, ny, nz) > 0) this.aq[SKY].push(nx, ny, nz);
        if (this.getChan(BLK, nx, ny, nz) > 0) this.aq[BLK].push(nx, ny, nz);
      }
      if (y === H - 1 && loNew === 0) { this.setChan(SKY, x, y, z, 15); this.aq[SKY].push(x, y, z); }
    }
    this.propagate(BLK);
    this.propagate(SKY);
  }

  removeLight(ch, x, y, z) {
    const rq = this.rq; rq.length = 0;
    const v0 = this.getChan(ch, x, y, z);
    if (v0 <= 0) return;
    this.setChan(ch, x, y, z, 0);
    rq.push(x, y, z, v0);
    const aq = this.aq[ch];
    for (let h = 0; h < rq.length; h += 4) {
      const px = rq[h], py = rq[h + 1], pz = rq[h + 2], v = rq[h + 3];
      for (let d = 0; d < 6; d++) {
        const nx = px + DX[d], ny = py + DY[d], nz = pz + DZ[d];
        if (ny < 0 || ny >= H) continue;
        const nv = this.getChan(ch, nx, ny, nz);
        if (nv <= 0) continue;
        if (nv < v || (ch === SKY && d === 3 && v === 15 && nv === 15)) {
          this.setChan(ch, nx, ny, nz, 0);
          rq.push(nx, ny, nz, nv);
        } else aq.push(nx, ny, nz);
      }
    }
  }

  propagate(ch) {
    const aq = this.aq[ch];
    for (let h = 0; h < aq.length; h += 3) {
      const x = aq[h], y = aq[h + 1], z = aq[h + 2];
      const v = this.getChan(ch, x, y, z);
      if (v <= 1) continue;
      for (let d = 0; d < 6; d++) {
        const nx = x + DX[d], ny = y + DY[d], nz = z + DZ[d];
        if (ny < 0 || ny >= H) continue;
        const c = this.columns.get(colKey(nx >> 4, nz >> 4));
        if (!c) continue;
        const lo = LO[c.blocks[idx(nx & 15, ny, nz & 15)]];
        if (lo >= 15) continue;
        const nv = (ch === SKY && d === 3 && v === 15 && lo === 0) ? 15 : v - 1 - lo;
        if (nv <= 0) continue;
        if (this.getChan(ch, nx, ny, nz) < nv) { this.setChan(ch, nx, ny, nz, nv); aq.push(nx, ny, nz); }
      }
    }
    aq.length = 0;
  }

  // Exchange light across the border between two freshly linked columns.
  linkBorder(a, b) {
    const dx = b.cx - a.cx, dz = b.cz - a.cz;
    const ax0 = a.cx * CS, az0 = a.cz * CS;
    const sq = this.aq[SKY], bq = this.aq[BLK];
    for (let y = 0; y < H; y++) for (let k = 0; k < CS; k++) {
      let ia, ib, wx, wz, nx, nz;
      if (dx === 1) { ia = idx(15, y, k); ib = idx(0, y, k); wx = ax0 + 15; wz = az0 + k; nx = wx + 1; nz = wz; }
      else if (dx === -1) { ia = idx(0, y, k); ib = idx(15, y, k); wx = ax0; wz = az0 + k; nx = wx - 1; nz = wz; }
      else if (dz === 1) { ia = idx(k, y, 15); ib = idx(k, y, 0); wx = ax0 + k; wz = az0 + 15; nx = wx; nz = wz + 1; }
      else { ia = idx(k, y, 0); ib = idx(k, y, 15); wx = ax0 + k; wz = az0; nx = wx; nz = wz - 1; }
      const La = a.light[ia], Lb = b.light[ib];
      if (La === Lb) continue;
      const loA = LO[a.blocks[ia]], loB = LO[b.blocks[ib]];
      if ((La >> 4) > (Lb >> 4) + 1 + loB && loB < 15) sq.push(wx, y, wz);
      else if ((Lb >> 4) > (La >> 4) + 1 + loA && loA < 15) sq.push(nx, y, nz);
      if ((La & 15) > (Lb & 15) + 1 + loB && loB < 15) bq.push(wx, y, wz);
      else if ((Lb & 15) > (La & 15) + 1 + loA && loA < 15) bq.push(nx, y, nz);
    }
  }

  // ------------------------------------------------------------ streaming
  setRenderDistance(d) { this.renderDist = d; this.lastCenter = null; }

  update(px, pz) {
    if (this.destroyed) return;
    const ccx = Math.floor(px / CS), ccz = Math.floor(pz / CS);
    const R = this.renderDist + 1;
    const centerKey = ccx + ',' + ccz + ',' + R;
    if (centerKey !== this.lastCenter) {
      this.lastCenter = centerKey;
      const order = [];
      for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > (R + 0.5) * (R + 0.5)) continue;
        order.push([d2, ccx + dx, ccz + dz]);
      }
      order.sort((a, b) => a[0] - b[0]);
      this.loadOrder = order;
      // unload far columns
      const U = R + 2;
      for (const [k, c] of this.columns) {
        const dx = c.cx - ccx, dz = c.cz - ccz;
        if (dx * dx + dz * dz > U * U) { this.disposeColumn(c); this.columns.delete(k); }
      }
    }
    // request generation
    if (this.genInFlight.size < this.maxGenInFlight) {
      for (const [, cx, cz] of this.loadOrder) {
        const k = colKey(cx, cz);
        if (this.columns.has(k) || this.genInFlight.has(k)) continue;
        this.requestGen(cx, cz);
        if (this.genInFlight.size >= this.maxGenInFlight) break;
      }
    }
    // meshing: first-time meshes and dirty sections, nearest first
    const R2 = this.renderDist;
    let budget = this.maxMeshInFlight - this.meshInFlight;
    for (const [d2, cx, cz] of this.loadOrder) {
      if (budget <= 0) break;
      if (d2 > (R2 + 0.5) * (R2 + 0.5)) break;
      const c = this.columns.get(colKey(cx, cz));
      if (!c) continue;
      if (!c.meshedOnce) {
        if (!this.hasAllNeighbors(cx, cz)) continue;
        c.meshedOnce = true;
        for (let sy = 0; sy < SECTIONS; sy++) c.dirty[sy] = 1;
      }
      for (let sy = 0; sy < SECTIONS && budget > 0; sy++) {
        if (!c.dirty[sy]) continue;
        c.dirty[sy] = 0;
        if (c.counts[sy] === 0) {
          if (c.sections[sy]) { c.sections[sy] = null; this.uploadQueue.add(c); }
          continue;
        }
        this.requestMesh(c, sy);
        budget--;
      }
    }
    // upload a few columns per frame
    let up = 0;
    for (const c of this.uploadQueue) {
      this.uploadQueue.delete(c);
      if (this.columns.get(colKey(c.cx, c.cz)) !== c) continue;
      this.upload(c);
      if (++up >= 8) break;
    }
  }

  hasAllNeighbors(cx, cz) {
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++)
      if (!this.columns.has(colKey(cx + dx, cz + dz))) return false;
    return true;
  }

  requestGen(cx, cz) {
    const k = colKey(cx, cz);
    let w = this.genWorkers[0];
    for (const g of this.genWorkers) if (g.busy < w.busy) w = g;
    w.busy++;
    this.genInFlight.set(k, w);
    const em = this.edits.get(k);
    let edits = null;
    if (em && em.size) {
      edits = new Int32Array(em.size * 2);
      let i = 0;
      for (const [a, b] of em) { edits[i++] = a; edits[i++] = b; }
    }
    w.postMessage({ type: 'gen', cx, cz, edits });
  }

  onGen(d) {
    if (this.destroyed) return;
    const k = colKey(d.cx, d.cz);
    const w = this.genInFlight.get(k);
    if (w) w.busy--;
    this.genInFlight.delete(k);
    if (this.columns.has(k)) return;
    // discard columns that went out of range while generating
    const c = new Column(d.cx, d.cz, d);
    // edits that arrived while generating
    const em = this.edits.get(k);
    if (em) for (const [i, id] of em) {
      if (c.blocks[i] !== id) {
        const old = c.blocks[i];
        c.blocks[i] = id;
        const sy = (i / 4096) | 0;
        if (old === 0 && id) c.counts[sy]++; else if (old && !id) c.counts[sy]--;
      }
    }
    this.columns.set(k, c);
    this.stats.gen++;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = this.columns.get(colKey(d.cx + dx, d.cz + dz));
      if (n) this.linkBorder(c, n);
    }
    this.propagate(BLK);
    this.propagate(SKY);
    if (this.onColumnLoaded) this.onColumnLoaded(c);
  }

  fillPadded(c, sy) {
    const pb = this.pb, pl = this.pl, pt = this.pt;
    const yBase = sy * CS;
    const cols = [];
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) cols.push(this.columns.get(colKey(c.cx + dx, c.cz + dz)));
    let o = 0;
    for (let py = -1; py <= 16; py++) {
      const wy = yBase + py;
      for (let pz = -1; pz <= 16; pz++) {
        const cz = pz < 0 ? 0 : pz > 15 ? 2 : 1, lz = (pz + 16) & 15;
        for (let px = -1; px <= 16; px++, o++) {
          const cx = px < 0 ? 0 : px > 15 ? 2 : 1, lx = (px + 16) & 15;
          if (wy < 0) { pb[o] = B.bedrock; pl[o] = 0; continue; }
          if (wy >= H) { pb[o] = 0; pl[o] = 0xf0; continue; }
          const col = cols[cz * 3 + cx];
          if (!col) { pb[o] = 0; pl[o] = 0xf0; continue; }
          const i = (wy * CS + lz) * CS + lx;
          pb[o] = col.blocks[i]; pl[o] = col.light[i];
        }
      }
    }
    let t = 0;
    for (let pz = -1; pz <= 16; pz++) {
      const cz = pz < 0 ? 0 : pz > 15 ? 2 : 1, lz = (pz + 16) & 15;
      for (let px = -1; px <= 16; px++) {
        const cx = px < 0 ? 0 : px > 15 ? 2 : 1, lx = (px + 16) & 15;
        const col = cols[cz * 3 + cx] || c;
        const s = (lz * CS + lx) * 9;
        for (let k = 0; k < 9; k++) pt[t++] = col.tints[s + k];
      }
    }
  }

  requestMesh(c, sy) {
    this.fillPadded(c, sy);
    let w = this.meshWorkers[0];
    for (const m of this.meshWorkers) if (m.busy < w.busy) w = m;
    w.busy++;
    this.meshInFlight++;
    const ver = ++c.version[sy];
    c.pending[sy] = ver;
    w.postMessage({ blocks: this.pb.slice(), light: this.pl.slice(), tints: this.pt.slice(), yBase: sy * CS, cx: c.cx, cz: c.cz, sy, ver });
  }

  meshNow(c, sy) {
    if (c.counts[sy] === 0) { c.sections[sy] = null; return; }
    this.fillPadded(c, sy);
    const out = meshSection(this.pb, this.pl, this.pt, sy * CS, c.cx, c.cz);
    c.version[sy]++;
    c.pending[sy] = c.version[sy];
    c.sections[sy] = out;
  }

  onMesh(d, w) {
    w.busy--;
    this.meshInFlight--;
    if (this.destroyed) return;
    const c = this.columns.get(colKey(d.cx, d.cz));
    if (!c) return;
    if (d.ver !== c.version[d.sy]) return; // stale
    c.sections[d.sy] = d.out;
    this.uploadQueue.add(c);
    this.stats.meshes++;
  }

  upload(c) {
    for (let b = 0; b < 3; b++) {
      let n = 0, minY = H, maxY = 0;
      for (let sy = 0; sy < SECTIONS; sy++) {
        const s = c.sections[sy];
        if (s && s[b].n) { n += s[b].n; minY = Math.min(minY, sy * 16); maxY = Math.max(maxY, sy * 16 + 16); }
      }
      const old = c.meshes[b];
      if (n === 0) {
        if (old) { this.group.remove(old); old.geometry.dispose(); c.meshes[b] = null; }
        continue;
      }
      const pos = new Float32Array(n * 3), A = new Uint8Array(n * 4), Bb = new Uint8Array(n * 4), T = new Uint8Array(n * 4);
      let o = 0;
      for (let sy = 0; sy < SECTIONS; sy++) {
        const s = c.sections[sy];
        if (!s || !s[b].n) continue;
        const q = s[b];
        pos.set(q.pos, o * 3); A.set(q.a, o * 4); Bb.set(q.b, o * 4); T.set(q.t, o * 4);
        o += q.n;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('aA', new THREE.BufferAttribute(A, 4));
      g.setAttribute('aB', new THREE.BufferAttribute(Bb, 4));
      g.setAttribute('aT', new THREE.BufferAttribute(T, 4, true));
      g.boundingBox = new THREE.Box3(new THREE.Vector3(0, minY, 0), new THREE.Vector3(16, maxY, 16));
      g.boundingSphere = new THREE.Sphere(new THREE.Vector3(8, (minY + maxY) / 2, 8), Math.sqrt(128 + ((maxY - minY) / 2) ** 2));
      if (old) {
        old.geometry.dispose();
        old.geometry = g;
      } else {
        const m = new THREE.Mesh(g, this.materials[b]);
        m.position.set(c.cx * CS, 0, c.cz * CS);
        m.updateMatrix(); m.matrixAutoUpdate = false;
        m.matrixWorldAutoUpdate = true;
        m.userData.bucket = b;
        m.layers.set(b === 2 ? 1 : 0);
        m.frustumCulled = true;
        this.group.add(m);
        m.updateMatrixWorld();
        c.meshes[b] = m;
      }
    }
  }

  disposeColumn(c) {
    for (let b = 0; b < 3; b++) {
      const m = c.meshes[b];
      if (m) { this.group.remove(m); m.geometry.dispose(); c.meshes[b] = null; }
    }
    this.uploadQueue.delete(c);
  }

  // Count of columns ready around a point (loading screen progress).
  readiness(px, pz, radius) {
    const ccx = Math.floor(px / CS), ccz = Math.floor(pz / CS);
    let total = 0, ready = 0;
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      total++;
      const c = this.columns.get(colKey(ccx + dx, ccz + dz));
      if (c && c.meshedOnce && !c.dirty.some(Boolean) && !this.uploadQueue.has(c)) ready++;
    }
    return ready / total;
  }

  // ------------------------------------------------------------ queries
  // Selection box of a block in 1/16 units, or null.
  static selBox(id) {
    const s = SHAPES[id];
    if (s === SHAPE.NONE || s === SHAPE.LIQUID) return null;
    if (s === SHAPE.CUBE) return [0, 0, 0, 16, 16, 16];
    if (s === SHAPE.CROSS) return [3, 0, 3, 13, 13, 13];
    if (s === SHAPE.CROP) return [0, 0, 0, 16, 4, 16];
    const bx = BLOCKS[id].boxes;
    const r = [16, 16, 16, 0, 0, 0];
    for (const b of bx) for (let k = 0; k < 3; k++) { r[k] = Math.min(r[k], b[k]); r[k + 3] = Math.max(r[k + 3], b[k + 3]); }
    return r;
  }

  // Voxel DDA raycast. Returns {x,y,z,id,nx,ny,nz,dist} or null.
  raycast(o, d, maxDist, fluids = false) {
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const sx = Math.sign(d.x) || 1, sy = Math.sign(d.y) || 1, sz = Math.sign(d.z) || 1;
    const tdx = Math.abs(1 / d.x), tdy = Math.abs(1 / d.y), tdz = Math.abs(1 / d.z);
    let tmx = d.x > 0 ? (x + 1 - o.x) * tdx : (o.x - x) * tdx;
    let tmy = d.y > 0 ? (y + 1 - o.y) * tdy : (o.y - y) * tdy;
    let tmz = d.z > 0 ? (z + 1 - o.z) * tdz : (o.z - z) * tdz;
    if (!isFinite(tmx)) tmx = Infinity; if (!isFinite(tmy)) tmy = Infinity; if (!isFinite(tmz)) tmz = Infinity;
    let nx = 0, ny = 0, nz = 0, t = 0;
    for (let i = 0; i < 256 && t <= maxDist; i++) {
      const id = this.getBlock(x, y, z);
      if (id) {
        if (fluids && LIQUID[id] && BLOCKS[id].level === 0) return { x, y, z, id, nx, ny, nz, dist: t };
        const box = World.selBox(id);
        if (box) {
          const hit = rayBox(o, d, x + box[0] / 16, y + box[1] / 16, z + box[2] / 16, x + box[3] / 16, y + box[4] / 16, z + box[5] / 16);
          if (hit && hit.t <= maxDist) return { x, y, z, id, nx: hit.nx, ny: hit.ny, nz: hit.nz, dist: hit.t };
        }
      }
      if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; nx = -sx; ny = 0; nz = 0; }
      else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; nx = 0; ny = -sy; nz = 0; }
      else { z += sz; t = tmz; tmz += tdz; nx = 0; ny = 0; nz = -sz; }
    }
    return null;
  }

  // Collision boxes (world units) overlapping an AABB; pushes [x0,y0,z0,x1,y1,z1].
  collide(minX, minY, minZ, maxX, maxY, maxZ, out) {
    out.length = 0;
    const x0 = Math.floor(minX), x1 = Math.floor(maxX), y0 = Math.floor(minY) - 1, y1 = Math.floor(maxY);
    const z0 = Math.floor(minZ), z1 = Math.floor(maxZ);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const id = this.getBlock(x, y, z);
      if (!SOLID[id]) {
        // unloaded columns are walls so nothing falls out of the world
        if (y >= 0 && y < H && !this.columns.has(colKey(x >> 4, z >> 4))) out.push([x, y, z, x + 1, y + 1, z + 1]);
        continue;
      }
      const def = BLOCKS[id];
      const boxes = def.collide || (SHAPES[id] === SHAPE.BOXES ? def.boxes : null);
      if (!boxes) { out.push([x, y, z, x + 1, y + 1, z + 1]); continue; }
      for (const b of boxes) out.push([x + b[0] / 16, y + b[1] / 16, z + b[2] / 16, x + b[3] / 16, y + b[4] / 16, z + b[5] / 16]);
    }
    return out;
  }
}

export function rayBox(o, d, x0, y0, z0, x1, y1, z1) {
  let tmin = -Infinity, tmax = Infinity, nx = 0, ny = 0, nz = 0;
  const axes = [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]];
  for (let a = 0; a < 3; a++) {
    const [oo, dd, lo, hi] = axes[a];
    if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) return null; continue; }
    let t1 = (lo - oo) / dd, t2 = (hi - oo) / dd;
    let n = -Math.sign(dd);
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    if (t1 > tmin) { tmin = t1; nx = a === 0 ? n : 0; ny = a === 1 ? n : 0; nz = a === 2 ? n : 0; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return { t: Math.max(0, tmin), nx, ny, nz };
}
