// Section mesher: turns an 18x18x18 padded block/light region into vertex
// buffers for three buckets (opaque, cutout, water). Pure function, used by
// the mesh workers and synchronously on the main thread for player edits.
import {
  SHAPES, SHAPE, OPAQUE, BUCKETS, TINTS, TINT, WAVES, LO, AOCC, CULLSELF, MATF,
  LIQUID, LEVEL, FACE_TEX, FACE_ROT, FACE_OVERLAY, BLOCKS, B, TEX, SOLID,
} from '../core/blocks.js';

export const P = 18;
const P2 = P * P;
export const pidx = (x, y, z) => ((y + 1) * P + (z + 1)) * P + (x + 1);

// Per-face constants: normal, u axis, v axis.
const N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const U = [[0, 0, -1], [0, 0, 1], [1, 0, 0], [1, 0, 0], [1, 0, 0], [-1, 0, 0]];
const V = [[0, 1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [0, 1, 0], [0, 1, 0]];
const CU = [0, 1, 1, 0], CV = [0, 0, 1, 1];
const d3 = (a) => a[1] * P2 + a[2] * P + a[0];

// Precomputed cube face corners and neighbour deltas.
const CORNER = [];   // [dir][c] -> [x,y,z]
const NB = [];       // [dir][c] -> [side1, side2, corner] padded deltas (relative to outer cell)
for (let d = 0; d < 6; d++) {
  CORNER[d] = []; NB[d] = [];
  for (let c = 0; c < 4; c++) {
    const u = CU[c], v = CV[c];
    const pos = [0, 0, 0];
    for (let k = 0; k < 3; k++) pos[k] = 0.5 + N[d][k] * 0.5 + U[d][k] * (u - 0.5) + V[d][k] * (v - 0.5);
    CORNER[d][c] = pos;
    const su = u ? 1 : -1, sv = v ? 1 : -1;
    const du = [U[d][0] * su, U[d][1] * su, U[d][2] * su];
    const dv = [V[d][0] * sv, V[d][1] * sv, V[d][2] * sv];
    NB[d][c] = [d3(du), d3(dv), d3([du[0] + dv[0], du[1] + dv[1], du[2] + dv[2]])];
  }
}
const NDELTA = N.map(d3);

const BIRCH_TINT = [128, 167, 85], SPRUCE_TINT = [97, 135, 98];

class Buf {
  constructor(cap = 4096) { this.n = 0; this.alloc(cap); }
  alloc(cap) {
    const pos = new Float32Array(cap * 3), a = new Uint8Array(cap * 4), b = new Uint8Array(cap * 4), t = new Uint8Array(cap * 4);
    if (this.pos) { pos.set(this.pos); a.set(this.a); b.set(this.b); t.set(this.t); }
    this.pos = pos; this.a = a; this.b = b; this.t = t; this.cap = cap;
  }
  vert(x, y, z, nrm, ao, sky, blk, layer, u, v, flags, tr, tg, tb, tw) {
    if (this.n >= this.cap) this.alloc(this.cap * 2);
    const i = this.n++;
    const p = i * 3, q = i * 4;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
    this.a[q] = nrm; this.a[q + 1] = ao; this.a[q + 2] = sky; this.a[q + 3] = blk;
    this.b[q] = layer; this.b[q + 1] = u; this.b[q + 2] = v; this.b[q + 3] = flags;
    this.t[q] = tr; this.t[q + 1] = tg; this.t[q + 2] = tb; this.t[q + 3] = tw;
  }
  out() {
    const n = this.n;
    return { n, pos: this.pos.slice(0, n * 3), a: this.a.slice(0, n * 4), b: this.b.slice(0, n * 4), t: this.t.slice(0, n * 4) };
  }
}

const bufs = [new Buf(), new Buf(), new Buf()];
// temp per-quad storage
const qx = new Float32Array(4), qy = new Float32Array(4), qz = new Float32Array(4);
const qao = new Uint8Array(4), qs = new Uint8Array(4), qb = new Uint8Array(4), qu = new Uint8Array(4), qv = new Uint8Array(4);

function pushQuad(buf, nrm, layer, flags, tr, tg, tb, tw, flip) {
  // two triangles; choose the diagonal that keeps AO gradients smooth
  const order = flip ? [1, 2, 3, 1, 3, 0] : [0, 1, 2, 0, 2, 3];
  for (let k = 0; k < 6; k++) {
    const c = order[k];
    buf.vert(qx[c], qy[c], qz[c], nrm, qao[c], qs[c], qb[c], layer, qu[c], qv[c], flags, tr, tg, tb, tw);
  }
}

// blocks/light: padded Uint8Arrays (18^3). tints: padded 18*18*9 colour table.
// yBase: world y of the section. hash: per-cell jitter seed.
export function meshSection(blocks, light, tints, yBase, sx, sz) {
  for (const b of bufs) b.n = 0;

  const lightAt = (p) => {
    const id = blocks[p];
    if (LO[id] >= 15 && !OPAQUE[id]) {
      // light blockers that are not full cubes (slabs, farmland): borrow neighbours
      let m = 0;
      for (let d = 0; d < 6; d++) {
        const q = p + NDELTA[d];
        if (q < 0 || q >= blocks.length) continue;
        const L = light[q];
        if ((L >> 4) > (m >> 4)) m = (L & 0xf0) | (m & 15);
        if ((L & 15) > (m & 15)) m = (m & 0xf0) | (L & 15);
      }
      return m;
    }
    return light[p];
  };

  for (let y = 0; y < 16; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const p = ((y + 1) * P + (z + 1)) * P + (x + 1);
        const id = blocks[p];
        if (id === 0) continue;
        const shape = SHAPES[id];
        const wy = yBase + y;
        const ti = ((z + 1) * P + (x + 1)) * 9;
        let tr = 255, tg = 255, tb = 255;
        const tint = TINTS[id];
        if (tint === TINT.GRASS) { tr = tints[ti]; tg = tints[ti + 1]; tb = tints[ti + 2]; }
        else if (tint === TINT.FOLIAGE) { tr = tints[ti + 3]; tg = tints[ti + 4]; tb = tints[ti + 5]; }
        else if (tint === TINT.WATER) { tr = tints[ti + 6]; tg = tints[ti + 7]; tb = tints[ti + 8]; }
        else if (tint === TINT.BIRCH) { tr = BIRCH_TINT[0]; tg = BIRCH_TINT[1]; tb = BIRCH_TINT[2]; }
        else if (tint === TINT.SPRUCE) { tr = SPRUCE_TINT[0]; tg = SPRUCE_TINT[1]; tb = SPRUCE_TINT[2]; }
        const bucket = BUCKETS[id];
        const buf = bufs[bucket];
        const wave = WAVES[id];
        const mat = MATF[id];

        if (shape === SHAPE.CUBE) {
          const above = blocks[p + P2];
          const snowy = id === B.grass && (above === B.snow_layer || above === B.snow);
          for (let d = 0; d < 6; d++) {
            const o = p + NDELTA[d];
            const n = blocks[o];
            if (OPAQUE[n]) continue;
            if (n === id && (CULLSELF[id] || bucket === 0)) continue;
            if (d === 2 && n === B.snow_layer) continue;
            let layer = FACE_TEX[id * 6 + d];
            let overlay = FACE_OVERLAY[id * 6 + d];
            let fr = tr, fg = tg, fb = tb;
            if (id === B.grass) {
              if (d === 3) { fr = fg = fb = 255; }
              else if (d !== 2 && snowy) { layer = TEX.grass_side_snow; overlay = 0; fr = fg = fb = 255; }
            }
            const rot = FACE_ROT[id * 6 + d];
            const nb = NB[d], cr = CORNER[d];
            const outerOpaqueAO = AOCC; // alias for speed
            for (let c = 0; c < 4; c++) {
              const s1 = o + nb[c][0], s2 = o + nb[c][1], cc = o + nb[c][2];
              const a1 = outerOpaqueAO[blocks[s1]], a2 = outerOpaqueAO[blocks[s2]], ac = outerOpaqueAO[blocks[cc]];
              qao[c] = (a1 && a2) ? 0 : 3 - (a1 + a2 + ac);
              const Lo = lightAt(o);
              let sky = Lo >> 4, bl = Lo & 15, cnt = 1;
              if (!OPAQUE[blocks[s1]]) { const L = light[s1]; sky += L >> 4; bl += L & 15; cnt++; }
              if (!OPAQUE[blocks[s2]]) { const L = light[s2]; sky += L >> 4; bl += L & 15; cnt++; }
              if (!OPAQUE[blocks[cc]] && !(OPAQUE[blocks[s1]] && OPAQUE[blocks[s2]])) { const L = light[cc]; sky += L >> 4; bl += L & 15; cnt++; }
              qs[c] = Math.round(sky * 17 / cnt); qb[c] = Math.round(bl * 17 / cnt);
              const pc = cr[c];
              qx[c] = x + pc[0]; qy[c] = wy + pc[1]; qz[c] = z + pc[2];
              const u = CU[c], v = CV[c];
              qu[c] = (rot ? v : u) * 16; qv[c] = (rot ? 1 - u : v) * 16;
            }
            const b0 = qao[0] * 16 + qs[0] + qb[0], b1 = qao[1] * 16 + qs[1] + qb[1];
            const b2 = qao[2] * 16 + qs[2] + qb[2], b3 = qao[3] * 16 + qs[3] + qb[3];
            const flags = wave | (overlay << 2) | (mat << 4);
            pushQuad(buf, d, layer, flags, fr, fg, fb, 255, b0 + b2 < b1 + b3);
          }
        } else if (shape === SHAPE.CROSS || shape === SHAPE.CROP) {
          const L = light[p];
          const sky = (L >> 4) * 17, bl = (L & 15) * 17;
          const layer = FACE_TEX[id * 6];
          const flags = wave | (mat << 4);
          // jitter position like real grass
          let ox = 0, oz = 0, sh = 1;
          if (shape === SHAPE.CROSS && wave !== 3 && id !== B.crystal_cluster) {
            const h = ((sx * 16 + x) * 73856093) ^ ((sz * 16 + z) * 19349663) ^ (wy * 83492791);
            ox = (((h >>> 0) & 15) / 15 - 0.5) * 0.4;
            oz = ((((h >>> 4) >>> 0) & 15) / 15 - 0.5) * 0.4;
            if (id === B.short_grass || id === B.tall_fern) sh = 0.8 + (((h >>> 8) & 7) / 7) * 0.35;
          }
          const quads = shape === SHAPE.CROSS
            ? [[0.15, 0.15, 0.85, 0.85], [0.15, 0.85, 0.85, 0.15]]
            : [[0.25, 0, 0.25, 1], [0.75, 0, 0.75, 1], [0, 0.25, 1, 0.25], [0, 0.75, 1, 0.75]];
          for (const [x0, z0, x1, z1] of quads) {
            const X0 = x + x0 + ox, Z0 = z + z0 + oz, X1 = x + x1 + ox, Z1 = z + z1 + oz;
            qx[0] = X0; qz[0] = Z0; qy[0] = wy;
            qx[1] = X1; qz[1] = Z1; qy[1] = wy;
            qx[2] = X1; qz[2] = Z1; qy[2] = wy + sh;
            qx[3] = X0; qz[3] = Z0; qy[3] = wy + sh;
            for (let c = 0; c < 4; c++) { qao[c] = 3; qs[c] = sky; qb[c] = bl; qu[c] = CU[c] * 16; qv[c] = CV[c] * 16; }
            pushQuad(buf, 6, layer, flags, tr, tg, tb, 255, false);
          }
        } else if (shape === SHAPE.BOXES) {
          const def = BLOCKS[id];
          const boxes = def.boxes;
          for (let bi = 0; bi < boxes.length; bi++) {
            const bx = boxes[bi];
            const mn = [bx[0] / 16, bx[1] / 16, bx[2] / 16], mx = [bx[3] / 16, bx[4] / 16, bx[5] / 16];
            for (let d = 0; d < 6; d++) {
              const nd = N[d];
              const axis = nd[0] ? 0 : nd[1] ? 1 : 2;
              const pos = nd[axis] > 0;
              const onEdge = pos ? mx[axis] >= 1 : mn[axis] <= 0;
              const o = p + NDELTA[d];
              if (onEdge && OPAQUE[blocks[o]]) continue;
              if (onEdge && blocks[o] === id && def.slab && d !== 2 && d !== 3) continue;
              const L = onEdge ? lightAt(o) : lightAt(p) || light[p + P2];
              const sky = (L >> 4) * 17, bl = (L & 15) * 17;
              const layer = FACE_TEX[id * 6 + d];
              const ua = U[d], va = V[d];
              for (let c = 0; c < 4; c++) {
                const u = CU[c], v = CV[c];
                let px = 0, py = 0, pz = 0;
                const pc = [0, 0, 0];
                for (let k = 0; k < 3; k++) {
                  const half = (mx[k] - mn[k]) * 0.5, ctr = (mx[k] + mn[k]) * 0.5;
                  pc[k] = ctr + nd[k] * half + ua[k] * (u - 0.5) * 2 * half + va[k] * (v - 0.5) * 2 * half;
                }
                px = pc[0]; py = pc[1]; pz = pc[2];
                qx[c] = x + px; qy[c] = wy + py; qz[c] = z + pz;
                // MC-style projected UVs
                const tu = (px - 0.5) * ua[0] + (py - 0.5) * ua[1] + (pz - 0.5) * ua[2] + 0.5;
                const tv = (px - 0.5) * va[0] + (py - 0.5) * va[1] + (pz - 0.5) * va[2] + 0.5;
                qu[c] = Math.round(tu * 16); qv[c] = Math.round(tv * 16);
                qao[c] = 3; qs[c] = sky; qb[c] = bl;
              }
              pushQuad(buf, d, layer, wave | (mat << 4), tr, tg, tb, 255, false);
            }
          }
        } else if (shape === SHAPE.LIQUID) {
          meshLiquid(blocks, light, p, x, y, z, wy, id, buf, tr, tg, tb, mat);
        }
      }
    }
  }
  return bufs.map(b => b.out());
}

function liquidHeight(id) {
  const l = LEVEL[id];
  if (l === 0 || l === 8) return 0.889;
  return Math.max(0.12, (8 - l) / 9);
}

function meshLiquid(blocks, light, p, x, y, z, wy, id, buf, tr, tg, tb, mat) {
  const liq = LIQUID[id];
  const above = blocks[p + P2];
  const fullTop = LIQUID[above] === liq;
  // corner heights at (x,z) corners 00, 10, 11, 01
  const ch = (cx, cz) => {
    if (fullTop) return 1;
    let sum = 0, w = 0;
    for (let dz = -1; dz <= 0; dz++) for (let dx = -1; dx <= 0; dx++) {
      const q = p + (cx + dx) + (cz + dz) * P;
      const b = blocks[q];
      if (LIQUID[b] === liq) {
        if (LIQUID[blocks[q + P2]] === liq) return 1;
        const h = liquidHeight(b);
        const wt = (LEVEL[b] === 0 || LEVEL[b] === 8) ? 4 : 1;
        sum += h * wt; w += wt;
      } else if (!SOLID[b]) { w += 1; }
    }
    return w ? sum / w : liquidHeight(id);
  };
  const h00 = ch(0, 0), h10 = ch(1, 0), h11 = ch(1, 1), h01 = ch(0, 1);
  const L = light[p];
  const sky = (L >> 4) * 17, bl = (L & 15) * 17;
  const layer = FACE_TEX[id * 6];
  const flags = mat << 4;
  const tw = liq === 1 ? 255 : 0;
  const set = (c, X, Y, Z, u, v) => { qx[c] = x + X; qy[c] = wy + Y; qz[c] = z + Z; qu[c] = u * 16; qv[c] = v * 16; qao[c] = 3; qs[c] = sky; qb[c] = bl; };
  // top: corner (u,v) -> pos (u, h, 1-v)
  if (!fullTop) {
    set(0, 0, h01, 1, 0, 0); set(1, 1, h11, 1, 1, 0); set(2, 1, h10, 0, 1, 1); set(3, 0, h00, 0, 0, 1);
    pushQuad(buf, 2, layer, flags, tr, tg, tb, tw, false);
  }
  // bottom
  const below = blocks[p - P2];
  if (LIQUID[below] !== liq && !OPAQUE[below]) {
    set(0, 0, 0, 0, 0, 0); set(1, 1, 0, 0, 1, 0); set(2, 1, 0, 1, 1, 1); set(3, 0, 0, 1, 0, 1);
    pushQuad(buf, 3, layer, flags, tr, tg, tb, tw, false);
  }
  // sides
  const sides = [
    [0, 1, 0, [1, 1, h11], [1, 0, h10]],   // +X : u=0 at z=1, u=1 at z=0
    [1, -1, 0, [0, 0, h00], [0, 1, h01]],  // -X : u=0 at z=0, u=1 at z=1
    [4, 0, 1, [0, 1, h01], [1, 1, h11]],   // +Z : u=0 at x=0, u=1 at x=1
    [5, 0, -1, [1, 0, h10], [0, 0, h00]],  // -Z : u=0 at x=1, u=1 at x=0
  ];
  for (const [d, dx, dz, a, b] of sides) {
    const n = blocks[p + dx + dz * P];
    if (LIQUID[n] === liq || OPAQUE[n]) continue;
    const nl = light[p + dx + dz * P];
    const s2 = Math.max(sky, (nl >> 4) * 17), b2 = Math.max(bl, (nl & 15) * 17);
    qx[0] = x + a[0]; qy[0] = wy; qz[0] = z + a[1];
    qx[1] = x + b[0]; qy[1] = wy; qz[1] = z + b[1];
    qx[2] = x + b[0]; qy[2] = wy + b[2]; qz[2] = z + b[1];
    qx[3] = x + a[0]; qy[3] = wy + a[2]; qz[3] = z + a[1];
    qu[0] = 0; qv[0] = 0; qu[1] = 16; qv[1] = 0; qu[2] = 16; qv[2] = Math.round(b[2] * 16); qu[3] = 0; qv[3] = Math.round(a[2] * 16);
    for (let c = 0; c < 4; c++) { qao[c] = 3; qs[c] = s2; qb[c] = b2; }
    pushQuad(buf, d, layer, flags, tr, tg, tb, tw, false);
  }
}
