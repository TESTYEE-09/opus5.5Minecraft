// Procedural 16x16 pixel-art textures for every block and item, painted in code.
// Produces a THREE.DataArrayTexture for the world and an icon sprite sheet for the UI.
import * as THREE from 'three';
import { TEX_NAMES, TEX, BLOCKS, ITEMS, SHAPES, SHAPE, FACE_TEX, TINTS, TINT, ITEM_COUNT, WOODS, COLORS, B } from '../core/blocks.js';
import { mulberry32, hashString } from '../core/noise.js';

const S = 16;
const hex = (h) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const shade = (c, f) => [c[0] * f, c[1] * f, c[2] * f];

class Px {
  constructor(name) {
    this.d = new Uint8ClampedArray(S * S * 4);
    this.rnd = mulberry32(hashString(name));
  }
  set(x, y, c, a = 255) {
    x = ((x % S) + S) % S; y = ((y % S) + S) % S;
    const i = (y * S + x) * 4;
    this.d[i] = c[0]; this.d[i + 1] = c[1]; this.d[i + 2] = c[2]; this.d[i + 3] = a;
  }
  get(x, y) { x = ((x % S) + S) % S; y = ((y % S) + S) % S; const i = (y * S + x) * 4; return [this.d[i], this.d[i + 1], this.d[i + 2], this.d[i + 3]]; }
  alpha(x, y) { return this.d[(((y % S) + S) % S * S + (((x % S) + S) % S)) * 4 + 3]; }
  clear(x, y) { this.set(x, y, [0, 0, 0], 0); }
  copy(o) { this.d.set(o.d); return this; }
  // tileable value noise, cells per tile
  vn(cells) {
    const g = new Float32Array(cells * cells);
    for (let i = 0; i < g.length; i++) g[i] = this.rnd();
    return (x, y) => {
      const fx = (x / S) * cells, fy = (y / S) * cells;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      let tx = fx - x0, ty = fy - y0;
      tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
      const a = g[(y0 % cells) * cells + (x0 % cells)], b = g[(y0 % cells) * cells + ((x0 + 1) % cells)];
      const c = g[((y0 + 1) % cells) * cells + (x0 % cells)], d = g[((y0 + 1) % cells) * cells + ((x0 + 1) % cells)];
      return (a + (b - a) * tx) + ((c + (d - c) * tx) - (a + (b - a) * tx)) * ty;
    };
  }
  // fill with a palette ramp driven by layered noise
  noise(pal, w = [0.5, 0.3, 0.2], cells = [4, 8]) {
    const n1 = this.vn(cells[0]), n2 = this.vn(cells[1]);
    const P = pal.map(hex);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = n1(x, y) * w[0] + n2(x, y) * w[1] + this.rnd() * w[2];
      this.set(x, y, P[Math.min(P.length - 1, Math.floor(v * P.length))]);
    }
    return this;
  }
  speckle(pal, p) {
    const P = pal.map(hex);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (this.rnd() < p) this.set(x, y, P[Math.floor(this.rnd() * P.length)]);
    return this;
  }
  tint(f) { for (let i = 0; i < this.d.length; i += 4) { this.d[i] *= f[0]; this.d[i + 1] *= f[1]; this.d[i + 2] *= f[2]; } return this; }
  // tileable voronoi: returns {id, d1, d2} per pixel
  voronoi(n) {
    const pts = [];
    for (let i = 0; i < n; i++) pts.push([this.rnd() * S, this.rnd() * S, this.rnd()]);
    const out = [];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let d1 = 1e9, d2 = 1e9, id = 0;
      for (let i = 0; i < n; i++) for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const dx = x + 0.5 - (pts[i][0] + ox * S), dy = y + 0.5 - (pts[i][1] + oy * S);
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) { d2 = d1; d1 = d; id = i; } else if (d < d2) d2 = d;
      }
      out.push({ x, y, id, d1, d2, v: pts[id][2], px: pts[id][0], py: pts[id][1] });
    }
    return out;
  }
  outline(col) {
    const o = hex(col);
    const add = [];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (this.alpha(x, y)) continue;
      const nb = (xx, yy) => xx >= 0 && yy >= 0 && xx < S && yy < S && this.alpha(xx, yy) > 0;
      if (nb(x - 1, y) || nb(x + 1, y) || nb(x, y - 1) || nb(x, y + 1)) add.push([x, y]);
    }
    for (const [x, y] of add) this.set(x, y, o);
    return this;
  }
  rect(x0, y0, x1, y1, c) { const cc = typeof c === 'string' ? hex(c) : c; for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) this.set(x, y, cc); return this; }
}

const GEN = {};
const cache = {};
function make(name) {
  if (cache[name]) return cache[name];
  const g = GEN[name];
  const p = new Px(name);
  if (g) g(p, name);
  else {
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) p.set(x, y, ((x >> 3) + (y >> 3)) & 1 ? [255, 0, 255] : [20, 20, 20]);
    console.warn('missing texture', name);
  }
  cache[name] = p;
  return p;
}
const base = (name) => new Px(name + '#copy').copy(make(name));

// ------------------------------------------------------------------ stone family
const STONE = ['#6f6f6f', '#777777', '#7f7f7f', '#868686', '#8e8e8e'];
GEN.stone = (p) => {
  p.noise(STONE, [0.45, 0.35, 0.2], [4, 8]);
  for (let k = 0; k < 5; k++) {
    let x = Math.floor(p.rnd() * 16), y = Math.floor(p.rnd() * 16);
    const len = 2 + Math.floor(p.rnd() * 3);
    for (let i = 0; i < len; i++) { p.set(x, y, hex('#616161')); x += 1; if (p.rnd() < 0.4) y += p.rnd() < 0.5 ? 1 : -1; }
  }
};
function cobble(p, pal, mortar) {
  const P = pal.map(hex), M = hex(mortar);
  const cells = p.voronoi(9);
  for (const c of cells) {
    const edge = c.d2 - c.d1;
    if (edge < 1.1) { p.set(c.x, c.y, M); continue; }
    // highlight toward the top-left of each stone
    const lx = (c.x - c.px), ly = (c.y - c.py);
    let t = c.v * 0.5 + 0.35 - (lx + ly) * 0.05 + p.rnd() * 0.15;
    if (edge < 1.8) t -= 0.2;
    p.set(c.x, c.y, P[Math.max(0, Math.min(P.length - 1, Math.floor(t * P.length)))]);
  }
}
GEN.cobblestone = (p) => cobble(p, ['#5c5c5c', '#6e6e6e', '#7c7c7c', '#8a8a8a', '#9a9a9a'], '#474747');
GEN.cobbled_slate = (p) => cobble(p, ['#36363c', '#404047', '#4a4a52', '#55555e'], '#26262b');
function moss(p, amount) {
  const n = p.vn(4);
  const G = ['#4b6a26', '#5b7a2e', '#6c8c37', '#4f7130'].map(hex);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (n(x, y) + p.rnd() * 0.25 > 1 - amount) p.set(x, y, G[Math.floor(p.rnd() * G.length)]);
}
GEN.mossy_cobblestone = (p) => { p.copy(make('cobblestone')); moss(p, 0.45); };
function bricksPattern(p, rows, faceFn, mortarCol, offsetHalf = true) {
  const M = hex(mortarCol);
  const rh = S / rows;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2 && offsetHalf) ? (rows === 2 ? 4 : 4) : 0;
    const bw = rows === 2 ? 8 : 8;
    for (let y = r * rh; y < (r + 1) * rh; y++) for (let x = 0; x < S; x++) {
      const lx = (x + off) % bw, ly = y - r * rh;
      if (ly === rh - 1 || lx === bw - 1) p.set(x, y, M);
      else faceFn(x, y, lx, ly, Math.floor((x + off) / bw) + r * 7);
    }
  }
}
GEN.stone_bricks = (p) => {
  const P = ['#6a6a6a', '#767676', '#808080', '#8a8a8a'].map(hex);
  const n = p.vn(8);
  bricksPattern(p, 2, (x, y, lx, ly) => {
    let t = n(x, y) * 0.7 + p.rnd() * 0.3;
    if (ly === 0 || lx === 0) t += 0.35;
    if (ly === 6 || lx === 6) t -= 0.25;
    p.set(x, y, P[Math.max(0, Math.min(3, Math.floor(t * 4)))]);
  }, '#4e4e4e');
};
GEN.mossy_stone_bricks = (p) => { p.copy(make('stone_bricks')); moss(p, 0.4); };
GEN.smooth_stone = (p) => {
  p.noise(['#9a9a9a', '#a1a1a1', '#a7a7a7'], [0.3, 0.3, 0.4]);
  for (let i = 0; i < S; i++) { p.set(i, 0, hex('#b3b3b3')); p.set(0, i, hex('#b3b3b3')); p.set(i, 15, hex('#828282')); p.set(15, i, hex('#828282')); }
};
GEN.smooth_stone_slab_side = (p) => {
  p.copy(make('smooth_stone'));
  for (let x = 0; x < S; x++) { p.set(x, 7, hex('#828282')); p.set(x, 8, hex('#b3b3b3')); }
};
GEN.granite = (p) => { p.noise(['#8c5a4a', '#9a6857', '#a87766', '#b5887a'], [0.3, 0.3, 0.4]); p.speckle(['#c9a296', '#6e4337', '#d8b2a6'], 0.12); };
GEN.diorite = (p) => { p.noise(['#a9a9a9', '#bdbdbd', '#cfcfcf', '#e0e0e0'], [0.3, 0.3, 0.4]); p.speckle(['#7c7c7c', '#f2f2f2', '#8f8f8f'], 0.14); };
GEN.andesite = (p) => { p.noise(['#727273', '#7d7d7e', '#88888a', '#929294'], [0.3, 0.3, 0.4]); p.speckle(['#5f5f60', '#a2a2a4'], 0.15); };
GEN.slate = (p) => {
  const n = p.vn(4);
  const P = ['#3d3d45', '#45454e', '#4e4e58', '#575762'].map(hex);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const t = n(x, y * 0.3) * 0.5 + ((y * 7 + Math.floor(x / 5)) % 3) * 0.12 + p.rnd() * 0.25;
    p.set(x, y, P[Math.min(3, Math.floor(t * 4))]);
  }
};
GEN.bedrock = (p) => p.noise(['#262626', '#3b3b3b', '#535353', '#6e6e6e', '#8c8c8c'], [0.55, 0.2, 0.25], [4, 6]);
GEN.obsidian = (p) => {
  p.noise(['#0e0a16', '#150f22', '#1d142f', '#271a3e'], [0.4, 0.3, 0.3]);
  p.speckle(['#3d2a5e', '#4b3474'], 0.06);
};

// ------------------------------------------------------------------ dirt / grass
const DIRT = ['#5b3d27', '#6a4a31', '#79573a', '#866345', '#946f4f'];
GEN.dirt = (p) => { p.noise(DIRT, [0.4, 0.3, 0.3]); p.speckle(['#a07c5c', '#4a3220'], 0.05); };
GEN.coarse_dirt = (p) => { p.noise(DIRT, [0.3, 0.3, 0.4]); p.speckle(['#a9a29a', '#7d7670', '#4a3220'], 0.12); };
GEN.grass_top = (p) => {
  const n = p.vn(4);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const v = 0.58 + n(x, y) * 0.18 + p.rnd() * 0.2;
    const g = Math.min(255, v * 255);
    p.set(x, y, [g, g, g]);
  }
  for (let k = 0; k < 12; k++) { const x = Math.floor(p.rnd() * 16), y = Math.floor(p.rnd() * 16); p.set(x, y, [235, 235, 235]); p.set(x, y + 1, [150, 150, 150]); }
};
GEN.grass_side = (p) => p.copy(make('dirt'));
GEN.grass_side_overlay = (p) => {
  for (let x = 0; x < S; x++) {
    const depth = 3 + Math.floor(p.rnd() * 2.4) + (p.rnd() < 0.2 ? 1 : 0);
    for (let y = 0; y < depth; y++) {
      const v = 0.6 + p.rnd() * 0.25 - y * 0.03;
      p.set(x, y, [v * 255, v * 255, v * 255]);
    }
  }
};
GEN.grass_side_snow = (p) => {
  p.copy(make('dirt'));
  for (let x = 0; x < S; x++) {
    const depth = 3 + Math.floor(p.rnd() * 2.2);
    for (let y = 0; y < depth; y++) p.set(x, y, hex(y === depth - 1 ? '#cfdbe4' : p.rnd() < 0.3 ? '#e6eef4' : '#f5f9fc'));
  }
};
GEN.podzol_top = (p) => { p.noise(['#4a3015', '#5a3b1b', '#6a4824', '#7a552d'], [0.35, 0.3, 0.35]); p.speckle(['#8a6a3a', '#3a2510', '#6b7a3a'], 0.12); };
GEN.podzol_side = (p) => {
  p.copy(make('dirt'));
  const t = make('podzol_top');
  for (let x = 0; x < S; x++) { const d = 2 + Math.floor(p.rnd() * 2); for (let y = 0; y < d; y++) p.set(x, y, t.get(x, y)); }
};
GEN.moss_block = (p) => { p.noise(['#4d6327', '#58702c', '#647d32', '#708a39'], [0.4, 0.3, 0.3]); p.speckle(['#7e9a43', '#435822'], 0.1); };
GEN.farmland_dry = (p) => {
  p.noise(['#5a3b23', '#664530', '#734f37'], [0.3, 0.3, 0.4]);
  for (let y = 0; y < S; y += 4) for (let x = 0; x < S; x++) { p.set(x, y, hex('#4a3020')); if (p.rnd() < 0.5) p.set(x, y + 1, hex('#7f5a3e')); }
};
GEN.farmland_wet = (p) => {
  p.noise(['#2f1e12', '#3a2617', '#45301d'], [0.3, 0.3, 0.4]);
  for (let y = 0; y < S; y += 4) for (let x = 0; x < S; x++) { p.set(x, y, hex('#22150c')); if (p.rnd() < 0.5) p.set(x, y + 1, hex('#523a26')); }
};

// ------------------------------------------------------------------ sand / snow / ice
GEN.sand = (p) => { p.noise(['#cdb57a', '#d4bd82', '#dbc58b', '#e1cc94'], [0.3, 0.3, 0.4]); p.speckle(['#bfa468', '#e8d7a4'], 0.08); };
GEN.sandstone_top = (p) => { p.noise(['#cfb97d', '#d6c086', '#dcc78f'], [0.4, 0.3, 0.3]); };
GEN.sandstone_bottom = (p) => {
  p.copy(make('sandstone_top'));
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (p.rnd() < 0.1) p.set(x, y, hex('#c9b679'));
};
GEN.sandstone_side = (p) => {
  const n = p.vn(8);
  const P = ['#c2aa70', '#cbb47a', '#d3bd84', '#dbc58e'].map(hex);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    let t = n(x, y) * 0.5 + p.rnd() * 0.3 + 0.2;
    if (y < 3) t += 0.25; if (y === 3 || y === 12) t = 0; if (y > 12) t -= 0.1;
    p.set(x, y, P[Math.max(0, Math.min(3, Math.floor(t * 4)))]);
  }
};
GEN.gravel = (p) => {
  p.noise(['#6e6966', '#7a7572', '#85807c'], [0.2, 0.2, 0.6]);
  const C = ['#9e9894', '#5c5754', '#8a8480', '#a8a19a', '#6e5f52', '#4d4946'].map(hex);
  for (let k = 0; k < 22; k++) {
    const x = Math.floor(p.rnd() * 16), y = Math.floor(p.rnd() * 16), c = C[Math.floor(p.rnd() * C.length)];
    p.set(x, y, c); p.set(x + 1, y, c); if (p.rnd() < 0.6) p.set(x, y + 1, shade(c, 0.75));
  }
};
GEN.clay = (p) => p.noise(['#9198a8', '#9aa1b1', '#a2a9b8', '#aab1c0'], [0.4, 0.4, 0.2]);
GEN.snow = (p) => p.noise(['#e6eff5', '#eef5fa', '#f5f9fc', '#ffffff'], [0.3, 0.3, 0.4]);
GEN.cloud = (p) => p.noise(['#eef3f8', '#f6f9fc', '#ffffff'], [0.5, 0.3, 0.2]);
GEN.ice = (p) => {
  p.noise(['#8fb9f0', '#9bc2f4', '#a7cbf7', '#b4d4fa'], [0.4, 0.4, 0.2]);
  for (let k = 0; k < 3; k++) { let x = Math.floor(p.rnd() * 16), y = Math.floor(p.rnd() * 16); for (let i = 0; i < 6; i++) { p.set(x + i, y - i, hex('#dbeafe')); } }
};
GEN.packed_ice = (p) => {
  p.noise(['#7ea6e0', '#8ab0e6', '#95b9ec'], [0.4, 0.4, 0.2]);
  for (let k = 0; k < 4; k++) { let x = Math.floor(p.rnd() * 16), y = Math.floor(p.rnd() * 16); for (let i = 0; i < 4; i++) { p.set(x, y, hex('#6b93cf')); x++; if (p.rnd() < 0.5) y++; } }
};
GEN.water_still = (p) => p.noise(['#2a5fbf', '#3068c8', '#3a74d2', '#4580da'], [0.5, 0.3, 0.2]);
GEN.lava_still = (p) => {
  const n = p.vn(4), m = p.vn(8);
  const P = ['#8a1e05', '#c2400a', '#e8650f', '#f99a24', '#ffcb4a', '#ffe98f'].map(hex);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const t = n(x, y) * 0.6 + m(x, y) * 0.3 + p.rnd() * 0.1;
    p.set(x, y, P[Math.min(5, Math.floor(t * 6))]);
  }
};

// ------------------------------------------------------------------ wood
const WOOD = {
  oak: { bark: ['#4a3720', '#5a432a', '#6a5034', '#7a5e3e'], plank: ['#8c6d3f', '#9c7b48', '#ab8a53', '#b9985f'], ring: '#b8945c' },
  birch: { bark: ['#cfcabc', '#dcd7ca', '#e8e4d9', '#f2efe6'], plank: ['#c2ab72', '#cfb87e', '#dbc58b', '#e5d098'], ring: '#d7c18a' },
  spruce: { bark: ['#2e2013', '#3a291a', '#463221', '#523c28'], plank: ['#5e4427', '#6a4d2d', '#765734', '#82603a'], ring: '#7d5d38' },
  cherry: { bark: ['#2b1823', '#36202d', '#432838', '#503243'], plank: ['#d39a8e', '#dca79b', '#e6b4a8', '#efc2b6'], ring: '#e2aa9e' },
  acacia: { bark: ['#504b43', '#5c564d', '#686258', '#756e63'], plank: ['#9c4f26', '#aa592d', '#b86434', '#c4703c'], ring: '#b9673a' },
};
for (const w of WOODS) {
  const W = WOOD[w];
  GEN[w + '_log'] = (p) => {
    const n = p.vn(8);
    const P = W.bark.map(hex);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const t = n(x, y * 0.15) * 0.6 + p.rnd() * 0.25 + ((x * 5) % 3 === 0 ? -0.15 : 0.1);
      p.set(x, y, P[Math.max(0, Math.min(3, Math.floor(t * 4)))]);
    }
    if (w === 'birch') {
      for (let k = 0; k < 9; k++) {
        const x = Math.floor(p.rnd() * 14), y = Math.floor(p.rnd() * 16), l = 2 + Math.floor(p.rnd() * 3);
        for (let i = 0; i < l; i++) p.set(x + i, y, hex(i === 0 || i === l - 1 ? '#5a5650' : '#2b2925'));
      }
    }
    if (w === 'cherry') p.speckle(['#5f3a50'], 0.05);
  };
  GEN[w + '_log_top'] = (p) => {
    const P = W.plank.map(hex), R = hex(W.ring), Bk = W.bark.map(hex);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (d > 6.6) { p.set(x, y, Bk[Math.floor(p.rnd() * 4)]); continue; }
      const ring = Math.floor(Math.sqrt((x - 7.5) ** 2 + (y - 7.5) ** 2) * 0.9 + p.rnd() * 0.3);
      p.set(x, y, ring % 2 ? shade(R, 0.82) : P[1 + Math.floor(p.rnd() * 3)]);
    }
  };
  GEN[w + '_planks'] = (p) => {
    const P = W.plank.map(hex);
    const n = p.vn(8);
    for (let b = 0; b < 4; b++) {
      const bs = p.rnd() * 0.3 - 0.15;
      const joint = Math.floor(p.rnd() * 16);
      for (let y = b * 4; y < b * 4 + 4; y++) for (let x = 0; x < S; x++) {
        if (y === b * 4 + 3) { p.set(x, y, shade(P[0], 0.72)); continue; }
        if (x === joint) { p.set(x, y, shade(P[0], 0.8)); continue; }
        const t = 0.45 + bs + n(x * 0.25, y * 2) * 0.35 + p.rnd() * 0.15 + (y === b * 4 ? 0.1 : 0);
        p.set(x, y, P[Math.max(0, Math.min(3, Math.floor(t * 4)))]);
      }
    }
  };
  GEN[w + '_leaves'] = (p) => {
    const n = p.vn(8);
    const pink = w === 'cherry';
    const P = pink ? ['#d9739a', '#ea8fb2', '#f5a9c7', '#fcc7dc', '#ffe2ee'].map(hex) : null;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const v = n(x, y) * 0.55 + p.rnd() * 0.45;
      if (v < (pink ? 0.3 : 0.31)) { p.clear(x, y); continue; }
      if (pink) p.set(x, y, P[Math.min(4, Math.floor(v * 5))]);
      else { const g = (0.42 + v * 0.45) * 255; p.set(x, y, [g, g, g]); }
    }
    if (!pink) for (let k = 0; k < 10; k++) { const x = Math.floor(p.rnd() * 16), y = Math.floor(p.rnd() * 16); if (p.alpha(x, y)) p.set(x, y, [70, 70, 70]); }
  };
  GEN[w + '_sapling'] = (p) => {
    const trunk = hex(W.bark[1]);
    for (let y = 9; y < 16; y++) p.set(7, y, trunk);
    p.set(8, 12, trunk); p.set(6, 11, trunk);
    const leaf = w === 'cherry' ? ['#ea8fb2', '#f5a9c7', '#d9739a'] : w === 'birch' ? ['#6c9a3e', '#80ad4b', '#5a862f'] : w === 'spruce' ? ['#2f5a33', '#3a6b3d', '#244a29'] : ['#3f7d22', '#4f922c', '#326b1a'];
    const L = leaf.map(hex);
    for (let y = 1; y < 11; y++) for (let x = 2; x < 14; x++) {
      const d = ((x - 7.5) ** 2) / 26 + ((y - 5.5) ** 2) / 22;
      if (w === 'spruce' && Math.abs(x - 7.5) > (y - 1) * 0.6 + 0.5) continue;
      if (d < 1 && p.rnd() > 0.2) p.set(x, y, L[Math.floor(p.rnd() * 3)]);
    }
  };
}

// ------------------------------------------------------------------ ores & minerals
function ore(p, main, light, dark, n = 4, baseName = 'stone') {
  p.copy(make(baseName));
  const M = hex(main), Lc = hex(light), D = hex(dark);
  for (let k = 0; k < n; k++) {
    const cx = 2 + Math.floor(p.rnd() * 12), cy = 2 + Math.floor(p.rnd() * 12);
    const cells = [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1], [2, 1], [1, 2]].slice(0, 3 + Math.floor(p.rnd() * 5));
    for (const [dx, dy] of cells) p.set(cx + dx, cy + dy, M);
    p.set(cx, cy, Lc);
    p.set(cx + 1, cy + 1, D);
  }
}
GEN.coal_ore = (p) => ore(p, '#2c2c2c', '#4a4a4a', '#141414', 5);
GEN.iron_ore = (p) => ore(p, '#d4a98a', '#ecd0b8', '#9c6e50', 4);
GEN.copper_ore = (p) => ore(p, '#d47a4c', '#f0a073', '#4fa07c', 5);
GEN.gold_ore = (p) => ore(p, '#f3d03a', '#fff29a', '#b88a12', 4);
GEN.diamond_ore = (p) => ore(p, '#4fe3e0', '#c8fffd', '#1f9d9a', 4);
GEN.emerald_ore = (p) => ore(p, '#1ed760', '#9cf7bb', '#0b8a3a', 3);
GEN.crystal_ore = (p) => ore(p, '#b07cff', '#f1dcff', '#6b3fd0', 5);
function metal(p, pal) {
  const P = pal.map(hex);
  p.noise([pal[1], pal[0], pal[1]], [0.3, 0.2, 0.5]);
  for (let i = 0; i < S; i++) {
    p.set(i, 0, P[2]); p.set(0, i, P[2]); p.set(i, 15, P[3]); p.set(15, i, P[3]);
    p.set(i, 1, mix(P[2], P[0], 0.5)); p.set(1, i, mix(P[2], P[0], 0.5));
  }
  for (let k = 0; k < 6; k++) { const x = 3 + Math.floor(p.rnd() * 10), y = 3 + Math.floor(p.rnd() * 10); p.set(x, y, P[2]); p.set(x + 1, y, mix(P[2], P[0], 0.5)); }
}
GEN.iron_block = (p) => metal(p, ['#d4d4d4', '#c2c2c2', '#f0f0f0', '#9a9a9a']);
GEN.gold_block = (p) => metal(p, ['#f5d43c', '#e6be2a', '#fff19a', '#b88a12']);
GEN.diamond_block = (p) => metal(p, ['#62e3e0', '#4fcfcc', '#c2fffc', '#2a9a97']);
GEN.emerald_block = (p) => metal(p, ['#3ce26d', '#25c556', '#a2f7bd', '#127f38']);
GEN.copper_block = (p) => metal(p, ['#c46e4b', '#b4613f', '#eba585', '#7f3f26']);
GEN.coal_block = (p) => metal(p, ['#232323', '#1b1b1b', '#3e3e3e', '#0c0c0c']);
GEN.crystal_block = (p) => {
  const P = ['#5a36c9', '#7a52e8', '#9b74ff', '#bf9cff', '#e3d0ff', '#a8f0ff'].map(hex);
  const cells = p.voronoi(6);
  for (const c of cells) {
    const t = c.v * 0.6 + ((c.x - c.px) - (c.y - c.py)) * 0.04 + 0.2;
    p.set(c.x, c.y, c.d2 - c.d1 < 0.8 ? P[4] : P[Math.max(0, Math.min(5, Math.floor(t * 6)))]);
  }
};
GEN.glowstone = (p) => {
  const P = ['#b8762a', '#e0a040', '#f6c862', '#ffe28f', '#fff4c6'].map(hex);
  const cells = p.voronoi(10);
  for (const c of cells) p.set(c.x, c.y, c.d2 - c.d1 < 0.9 ? hex('#7a4a1a') : P[Math.min(4, Math.floor((c.v * 0.7 + p.rnd() * 0.3) * 5))]);
};

// ------------------------------------------------------------------ crafted blocks
GEN.bricks = (p) => {
  const P = ['#87402f', '#96493a', '#a35340', '#b0604b'].map(hex);
  const M = hex('#b9b1a6');
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const r = Math.floor(y / 4), off = r % 2 ? 4 : 0;
    const lx = (x + off) % 8, ly = y % 4;
    if (ly === 3 || lx === 7) { p.set(x, y, shade(M, 0.9 + p.rnd() * 0.1)); continue; }
    let t = 0.4 + p.rnd() * 0.4 + (ly === 0 ? 0.2 : 0) - (lx === 6 ? 0.2 : 0);
    p.set(x, y, P[Math.max(0, Math.min(3, Math.floor(t * 4)))]);
  }
};
GEN.bookshelf = (p) => {
  p.copy(make('oak_planks'));
  const books = ['#8f2a2a', '#2a4f8f', '#2f7a3a', '#8f6a2a', '#5a2a7a', '#b8b0a0', '#2a6f6f'].map(hex);
  for (const [y0, y1] of [[1, 6], [9, 14]]) {
    let x = 1;
    while (x < 15) {
      const w = 1 + (p.rnd() < 0.4 ? 1 : 0), c = books[Math.floor(p.rnd() * books.length)], top = y0 + Math.floor(p.rnd() * 2);
      for (let xx = x; xx < Math.min(15, x + w); xx++) for (let y = top; y <= y1; y++) p.set(xx, y, y === top ? mix(c, [255, 255, 255], 0.3) : (y === y1 ? shade(c, 0.6) : c));
      x += w;
    }
    for (let x2 = 0; x2 < 16; x2++) p.set(x2, y1 + 1, hex('#5e4427'));
  }
};
GEN.crafting_table_top = (p) => {
  p.copy(make('oak_planks'));
  const D = hex('#4a3720'), Lc = hex('#c49a5a');
  for (let i = 0; i < S; i++) { p.set(i, 0, D); p.set(0, i, D); p.set(i, 15, D); p.set(15, i, D); }
  for (let i = 2; i < 14; i++) { p.set(i, 5, D); p.set(i, 10, D); p.set(5, i, D); p.set(10, i, D); }
  for (let i = 2; i < 14; i++) { p.set(i, 6, Lc); p.set(6, i, Lc); }
};
GEN.crafting_table_side = (p) => {
  p.copy(make('oak_planks'));
  const D = hex('#4a3720'), Mt = hex('#9a9a9a'), Ml = hex('#d0d0d0');
  for (let x = 0; x < S; x++) { p.set(x, 0, D); p.set(x, 1, D); p.set(x, 2, hex('#6a5034')); }
  // saw
  for (let x = 3; x < 12; x++) { p.set(x, 7, Ml); p.set(x, 8, Mt); if (x % 2) p.set(x, 9, Mt); }
  p.rect(11, 6, 13, 9, '#6a4a2a');
};
GEN.crafting_table_front = (p) => {
  p.copy(make('crafting_table_side'));
  for (let x = 3; x < 13; x++) for (let y = 6; y < 11; y++) p.set(x, y, make('oak_planks').get(x, y));
  // hammer and pliers
  p.rect(4, 6, 8, 7, '#8a8a8a'); p.rect(6, 8, 6, 12, '#6a4a2a');
  p.rect(10, 6, 10, 12, '#7a7a7a'); p.rect(12, 6, 12, 12, '#7a7a7a'); p.set(11, 9, hex('#a0a0a0'));
};
GEN.furnace_top = (p) => { p.copy(make('smooth_stone')); };
GEN.furnace_side = (p) => {
  p.copy(make('cobblestone'));
  for (let i = 0; i < S; i++) { p.set(i, 0, hex('#9a9a9a')); p.set(i, 15, hex('#4e4e4e')); }
};
GEN.furnace_front = (p) => {
  p.copy(make('furnace_side'));
  p.rect(3, 8, 12, 13, '#1c1c1c'); p.rect(4, 9, 11, 12, '#101010');
  for (let x = 3; x <= 12; x++) p.set(x, 7, hex('#5a5a5a'));
  p.rect(5, 3, 10, 4, '#3a3a3a');
};
GEN.furnace_front_lit = (p) => {
  p.copy(make('furnace_front'));
  const F = ['#7a1e05', '#d4480c', '#f58a1c', '#ffc24a', '#fff0a0'].map(hex);
  for (let y = 9; y <= 12; y++) for (let x = 4; x <= 11; x++) p.set(x, y, F[Math.min(4, Math.floor((y - 8) * 0.9 + p.rnd() * 1.8))]);
};
const CHEST = ['#7a4f22', '#8a5c29', '#9a6a31', '#a8763a'];
GEN.chest_side = (p) => {
  p.noise(CHEST, [0.2, 0.3, 0.5]);
  for (let i = 0; i < S; i++) for (const e of [1, 14]) { p.set(i, e, hex('#3d2510')); p.set(e, i, hex('#3d2510')); }
  for (let x = 1; x < 15; x++) p.set(x, 6, hex('#3d2510'));
};
GEN.chest_top = (p) => {
  p.noise(CHEST, [0.2, 0.3, 0.5]);
  for (let i = 1; i < 15; i++) for (const e of [1, 14]) { p.set(i, e, hex('#3d2510')); p.set(e, i, hex('#3d2510')); }
};
GEN.chest_front = (p) => {
  p.copy(make('chest_side'));
  p.rect(7, 5, 8, 8, '#c0c0c0'); p.set(7, 8, hex('#7a7a7a')); p.set(8, 8, hex('#7a7a7a'));
};
GEN.pumpkin_side = (p) => {
  const P = ['#c4651a', '#d8761f', '#e88a26', '#f39d34'].map(hex);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const rib = (x % 4 === 0) ? 0 : (x % 4 === 2 ? 3 : 2);
    p.set(x, y, P[Math.max(0, Math.min(3, rib - (p.rnd() < 0.2 ? 1 : 0)))]);
  }
};
GEN.pumpkin_top = (p) => {
  p.copy(make('pumpkin_side'));
  p.rect(6, 6, 9, 9, '#c4651a'); p.rect(7, 7, 8, 8, '#5a6a20');
};
GEN.jack_o_lantern = (p) => {
  p.copy(make('pumpkin_side'));
  const G = hex('#ffd04a'), G2 = hex('#ff9f1a');
  p.rect(3, 4, 5, 6, G); p.rect(10, 4, 12, 6, G);
  p.rect(3, 9, 12, 11, G); p.rect(5, 12, 10, 12, G2);
  p.set(5, 9, G2); p.set(10, 9, G2);
};
GEN.melon_side = (p) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) p.set(x, y, hex((x + Math.floor(y / 6)) % 4 < 2 ? '#5c8e23' : '#7aa82e'));
  p.speckle(['#4a751a'], 0.08);
};
GEN.melon_top = (p) => {
  p.noise(['#5c8e23', '#6a9a28', '#7aa82e'], [0.3, 0.3, 0.4]);
  p.rect(7, 7, 8, 8, '#4f6b1c');
};
GEN.tnt_side = (p) => {
  p.noise(['#b02a1c', '#c23322', '#d23c28'], [0.2, 0.2, 0.6]);
  for (let x = 0; x < S; x += 4) for (let y = 0; y < S; y++) p.set(x, y, hex('#8c1f14'));
  p.rect(0, 5, 15, 10, '#e8e4dc');
  const K = hex('#1a1a1a');
  const letters = [
    [1, 2, 3], [2], [2],
  ];
  // T N T
  const T = (ox) => { p.rect(ox, 6, ox + 2, 6, K); p.rect(ox + 1, 7, ox + 1, 9, K); };
  T(1); T(11);
  p.rect(6, 6, 6, 9, K); p.rect(9, 6, 9, 9, K); p.set(7, 7, K); p.set(8, 8, K);
  void letters;
};
GEN.tnt_top = (p) => { p.noise(['#c23322', '#d23c28'], [0.2, 0.2, 0.6]); p.rect(4, 4, 11, 11, '#d8d4cc'); p.rect(7, 7, 8, 8, '#3a3a3a'); };
GEN.tnt_bottom = (p) => { p.noise(['#c23322', '#d23c28'], [0.2, 0.2, 0.6]); p.rect(4, 4, 11, 11, '#d8d4cc'); };
GEN.hay_side = (p) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) p.set(x, y, hex(['#c9a227', '#d8b333', '#e3c246', '#b68f1e'][(x * 7 + Math.floor(p.rnd() * 3)) % 4]));
  for (const r of [3, 4, 11, 12]) for (let x = 0; x < S; x++) p.set(x, r, hex(r % 2 ? '#7a2e1a' : '#9a3e22'));
};
GEN.hay_top = (p) => {
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const a = Math.atan2(y - 7.5, x - 7.5) * 3 + Math.hypot(x - 7.5, y - 7.5);
    p.set(x, y, hex(['#c9a227', '#d8b333', '#e3c246', '#b68f1e'][Math.floor(Math.abs(a)) % 4]));
  }
};
const WOOL = {
  white: '#e9ecec', light_gray: '#8e8e86', gray: '#3e4447', black: '#141519', red: '#a12722', orange: '#f07613',
  yellow: '#f8c527', lime: '#70b919', green: '#546d1b', cyan: '#158991', light_blue: '#3aafd9', blue: '#35399d',
  purple: '#792aac', magenta: '#bd44b3', pink: '#ed8dac', brown: '#724728',
};
export const WOOL_HEX = WOOL;
for (const c of COLORS) GEN['wool_' + c] = (p) => {
  const C = hex(WOOL[c]);
  const n = p.vn(8);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const f = 0.82 + n(x, y) * 0.12 + (((x + y * 2) % 5) === 0 ? -0.06 : 0) + p.rnd() * 0.08;
    p.set(x, y, shade(C, f));
  }
};
GEN.bed_top = (p) => {
  const R = ['#8e1f1f', '#a12626', '#b32e2e'].map(hex);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) p.set(x, y, R[Math.floor(p.rnd() * 3)]);
  p.rect(1, 1, 14, 4, '#f0ece4'); p.rect(1, 4, 14, 4, '#d4cec2');
  for (let x = 0; x < S; x++) p.set(x, 6, hex('#7a1818'));
};
GEN.bed_side = (p) => {
  p.clear(0, 0);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) p.clear(x, y);
  const R = ['#8e1f1f', '#a12626', '#b32e2e'].map(hex);
  for (let y = 7; y <= 12; y++) for (let x = 0; x < S; x++) p.set(x, y, y === 7 ? hex('#c43a3a') : R[Math.floor(p.rnd() * 3)]);
  for (let y = 13; y < 16; y++) for (const x of [0, 1, 2, 13, 14, 15]) p.set(x, y, hex('#7a5a34'));
};

// ------------------------------------------------------------------ cutouts & plants
function clearAll(p) { for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) p.clear(x, y); }
GEN.glass = (p) => {
  clearAll(p);
  const F = hex('#dceff4'), F2 = hex('#a9cfd8');
  for (let i = 0; i < S; i++) { p.set(i, 0, F); p.set(0, i, F); p.set(i, 15, F2); p.set(15, i, F2); }
  for (let i = 0; i < 4; i++) { p.set(3 + i, 6 - i, F, 200); p.set(4 + i, 6 - i, F, 140); }
  p.set(11, 11, F, 200); p.set(12, 10, F, 200);
};
GEN.torch = (p) => {
  clearAll(p);
  for (let y = 9; y < 16; y++) { p.set(7, y, hex('#6b4e2c')); p.set(8, y, hex('#8a6a3c')); }
  p.set(7, 8, hex('#ffcf4a')); p.set(8, 8, hex('#ffb02e'));
  p.set(7, 7, hex('#fff4b0')); p.set(8, 7, hex('#ffd85a'));
  p.set(7, 6, hex('#fffbe0')); p.set(8, 6, hex('#ffe58a'));
  p.set(7, 5, hex('#ffcf4a'), 200); p.set(8, 5, hex('#ff9a1e'), 160);
};
GEN.lantern = (p) => {
  clearAll(p);
  const D = hex('#2e2e34'), G = ['#ffd27a', '#ffb648', '#fff0c0'].map(hex);
  for (let y = 9; y < 16; y++) for (let x = 5; x <= 10; x++) {
    const edge = x === 5 || x === 10 || y === 9 || y === 15;
    p.set(x, y, edge ? D : G[(x + y) % 3]);
  }
  p.rect(6, 7, 9, 8, '#3a3a40');
};
GEN.lantern_top = (p) => { clearAll(p); p.rect(5, 5, 10, 10, '#2e2e34'); p.rect(6, 6, 9, 9, '#3e3e46'); p.rect(7, 7, 8, 8, '#ffd27a'); };
GEN.crystal_cluster = (p) => {
  clearAll(p);
  const P = ['#6b3fd0', '#9466ff', '#c4a0ff', '#f0e2ff', '#8ee8ff'].map(hex);
  const shard = (x0, h, w) => {
    for (let y = 15; y > 15 - h; y--) {
      const t = (15 - y) / h, ww = Math.max(1, Math.round(w * (1 - t * 0.8)));
      for (let x = x0; x < x0 + ww; x++) p.set(x, y, x === x0 ? P[3] : P[Math.min(4, 1 + Math.floor(p.rnd() * 2) + (t > 0.7 ? 1 : 0))]);
    }
  };
  shard(6, 13, 3); shard(2, 8, 2); shard(11, 9, 2); shard(9, 6, 2); shard(4, 5, 2);
};
GEN.glow_mushroom = (p) => {
  clearAll(p);
  for (let y = 10; y < 16; y++) p.set(7, y, hex('#d8e8e0'));
  for (let y = 11; y < 16; y++) p.set(8, y, hex('#b0c8c0'));
  const C = ['#38e0d0', '#6ff7e8', '#b5fff6'].map(hex);
  for (let y = 5; y < 10; y++) for (let x = 3; x < 13; x++) {
    if ((x - 7.5) ** 2 / 25 + (y - 9) ** 2 / 14 > 1) continue;
    p.set(x, y, C[Math.floor(p.rnd() * 3)]);
  }
  p.set(5, 7, hex('#ffffff')); p.set(9, 6, hex('#ffffff'));
  for (let y = 12; y < 16; y++) p.set(3, y, hex('#d8e8e0'));
  p.rect(2, 10, 4, 11, '#6ff7e8');
};
GEN.short_grass = (p) => {
  clearAll(p);
  for (let b = 0; b < 9; b++) {
    let x = 1 + Math.floor(p.rnd() * 14);
    const h = 5 + Math.floor(p.rnd() * 10);
    for (let y = 15; y > 15 - h; y--) {
      const g = (0.5 + (15 - y) / h * 0.4 + p.rnd() * 0.1) * 255;
      p.set(x, y, [g, g, g]);
      if (p.rnd() < 0.15) x += p.rnd() < 0.5 ? -1 : 1;
      x = Math.max(0, Math.min(15, x));
    }
  }
};
GEN.tall_fern = (p) => {
  clearAll(p);
  for (const [x0, dir] of [[7, 0], [4, -1], [10, 1]]) {
    for (let y = 15; y > 2; y--) {
      const x = Math.round(x0 + dir * (15 - y) * 0.25);
      const g = (0.5 + (15 - y) * 0.025) * 255;
      p.set(x, y, [g, g, g]);
      if (y % 2 === 0 && y < 13) { p.set(x - 1, y, [g * 0.85, g * 0.85, g * 0.85]); p.set(x + 1, y, [g * 0.85, g * 0.85, g * 0.85]); }
    }
  }
};
GEN.dead_bush = (p) => {
  clearAll(p);
  const C = ['#6b4a26', '#8a6234', '#9c7342'].map(hex);
  const branch = (x, y, dx, len) => { for (let i = 0; i < len; i++) { p.set(Math.round(x), y, C[Math.floor(p.rnd() * 3)]); x += dx; y--; } };
  branch(7, 15, 0, 5); branch(7, 11, -0.7, 6); branch(8, 11, 0.8, 6); branch(7, 9, 0.2, 7); branch(5, 9, -0.4, 4);
};
function flower(p, petal, center, opts = {}) {
  clearAll(p);
  const stem = hex('#3c7a28'), leaf = hex('#4f9332');
  const top = opts.top ?? 5;
  for (let y = top + 3; y < 16; y++) p.set(7, y, stem);
  p.set(6, 12, leaf); p.set(5, 11, leaf); p.set(8, 13, leaf); p.set(9, 12, leaf);
  const P = petal.map(hex);
  if (opts.tulip) {
    for (let y = top; y < top + 4; y++) for (let x = 6; x <= 9; x++) p.set(x, y, P[(x + y) % P.length]);
    p.clear(7, top); p.set(6, top - 1, P[0]); p.set(9, top - 1, P[0]);
  } else if (opts.globe) {
    for (let y = top - 2; y < top + 3; y++) for (let x = 5; x <= 10; x++) if ((x - 7.5) ** 2 + (y - top) ** 2 < 7) p.set(x, y, P[Math.floor(p.rnd() * P.length)]);
  } else if (opts.bells) {
    for (let y = 4; y < 16; y++) p.set(7, y, stem);
    for (const [x, y] of [[5, 6], [9, 7], [5, 9], [9, 10]]) { p.set(x, y, P[0]); p.set(x, y + 1, P[1 % P.length]); p.set(x === 5 ? 6 : 8, y, stem); }
  } else {
    for (const [dx, dy] of [[0, -1], [-1, 0], [1, 0], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, -2], [-2, 0], [2, 0], [0, 2]])
      if (Math.abs(dx) + Math.abs(dy) < 3) p.set(7 + dx, top + 1 + dy, P[(dx + dy + 4) % P.length]);
    if (center) p.set(7, top + 1, hex(center));
  }
}
GEN.dandelion = (p) => flower(p, ['#ffe14d', '#f5c518', '#ffd030'], '#e8a812', { top: 6 });
GEN.poppy = (p) => flower(p, ['#d8242b', '#ef3a3a', '#a91a1f'], '#2a1a12');
GEN.cornflower = (p) => flower(p, ['#4f7bd8', '#6c97f0', '#3a5fbf'], '#2a3a8f');
GEN.allium = (p) => flower(p, ['#b56be0', '#d39af2', '#9a4fcf'], null, { globe: true, top: 4 });
GEN.orange_tulip = (p) => flower(p, ['#f07d1e', '#ffa040', '#d8650e'], null, { tulip: true, top: 4 });
GEN.pink_tulip = (p) => flower(p, ['#f2a0c4', '#ffc7de', '#e07ea8'], null, { tulip: true, top: 4 });
GEN.oxeye_daisy = (p) => flower(p, ['#f4f4f0', '#ffffff', '#dcdcd6'], '#f2c21a');
GEN.lily_of_the_valley = (p) => flower(p, ['#ffffff', '#e2e8e0'], null, { bells: true });
GEN.red_mushroom = (p) => {
  clearAll(p);
  p.rect(7, 10, 8, 15, '#e8dfcf');
  for (let y = 5; y < 11; y++) for (let x = 3; x < 13; x++) if ((x - 7.5) ** 2 / 24 + (y - 10) ** 2 / 25 < 1) p.set(x, y, hex('#d42a22'));
  for (const [x, y] of [[5, 7], [9, 6], [10, 9], [7, 8]]) p.set(x, y, hex('#f6efe6'));
};
GEN.brown_mushroom = (p) => {
  clearAll(p);
  p.rect(7, 10, 8, 15, '#e0d4c0');
  for (let y = 8; y < 11; y++) for (let x = 3; x < 13; x++) if ((x - 7.5) ** 2 / 25 + (y - 10.5) ** 2 / 6 < 1) p.set(x, y, hex(p.rnd() < 0.3 ? '#a17656' : '#8c6345'));
};
GEN.sugar_cane = (p) => {
  clearAll(p);
  for (const x0 of [3, 7, 11]) for (let y = 0; y < 16; y++) {
    const g = (y % 6 === 0 ? 0.6 : 0.82 + p.rnd() * 0.1) * 255;
    p.set(x0, y, [g, g, g]); p.set(x0 + 1, y, [g * 0.85, g * 0.85, g * 0.85]);
    if (y % 6 === 3) p.set(x0 + 2, y - 1, [g, g, g]);
  }
};
GEN.sweet_berry_bush = (p) => {
  clearAll(p);
  const L = ['#2f5a2a', '#3a6b33', '#4a7d3f'].map(hex);
  for (let y = 4; y < 16; y++) for (let x = 1; x < 15; x++) if ((x - 7.5) ** 2 / 50 + (y - 11) ** 2 / 40 < 1 && p.rnd() > 0.25) p.set(x, y, L[Math.floor(p.rnd() * 3)]);
  for (const [x, y] of [[4, 8], [10, 7], [7, 11], [12, 12], [3, 13]]) { p.set(x, y, hex('#c41f2a')); p.set(x + 1, y, hex('#e83a44')); }
};
GEN.cactus_side = (p) => {
  const P = ['#356b1f', '#418226', '#4f9530', '#5ca63a'].map(hex);
  clearAll(p);
  for (let y = 0; y < S; y++) for (let x = 1; x < 15; x++) {
    const stripe = x % 3 === 1 ? 0 : x % 3 === 2 ? 2 : 3;
    p.set(x, y, P[Math.max(0, stripe - (p.rnd() < 0.15 ? 1 : 0))]);
  }
  for (let k = 0; k < 8; k++) { const x = 1 + Math.floor(p.rnd() * 14), y = Math.floor(p.rnd() * 16); p.set(x, y, hex('#e8e0b0')); }
  for (let y = 0; y < S; y++) { p.set(1, y, P[0]); p.set(14, y, P[0]); }
};
GEN.cactus_top = (p) => {
  clearAll(p);
  for (let y = 1; y < 15; y++) for (let x = 1; x < 15; x++) {
    const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
    p.set(x, y, hex(d > 6 ? '#356b1f' : Math.floor(d) % 2 ? '#4f9530' : '#5ca63a'));
  }
};
GEN.cactus_bottom = (p) => { p.copy(make('cactus_top')); };
for (let s = 0; s < 8; s++) GEN['wheat_stage' + s] = (p) => {
  clearAll(p);
  const h = 3 + Math.round(s * 1.6);
  const green = hex('#4f9a2a'), gold = hex('#d8b34a'), dark = hex('#3a7a1f');
  for (const x0 of [1, 4, 7, 10, 13]) {
    const hh = h - Math.floor(p.rnd() * 2);
    for (let y = 15; y > 15 - hh; y--) {
      const t = s / 7;
      const top = y < 15 - hh + 4 && s >= 5;
      p.set(x0, y, top ? mix(gold, [140, 100, 30], p.rnd() * 0.3) : mix(green, gold, t * 0.8 * (1 - (y - (15 - hh)) / hh)));
      if (top) p.set(x0 + 1, y, shade(gold, 0.85));
    }
    p.set(x0 + 1, 15, dark);
  }
};

// ------------------------------------------------------------------ destroy stages
for (let k = 0; k < 10; k++) GEN['destroy_' + k] = (p) => {
  clearAll(p);
  const r = mulberry32(777);
  const cracks = 2 + k;
  for (let c = 0; c < cracks; c++) {
    let x = 7.5, y = 7.5;
    const a = r() * Math.PI * 2;
    const len = 2 + (k + 1) * 0.75 + r() * 2;
    for (let i = 0; i < len; i++) {
      x += Math.cos(a + (r() - 0.5) * 1.2); y += Math.sin(a + (r() - 0.5) * 1.2);
      p.set(Math.round(x), Math.round(y), [0, 0, 0], 200);
    }
  }
};

// ================================================================== ITEM ICONS
const ICON = {};
function toolSprite(p, kind, pal) {
  clearAll(p);
  const Lc = hex(pal[0]), Mc = hex(pal[1]), Dc = hex(pal[2]);
  const h1 = hex('#8b6a3e'), h2 = hex('#5e4527');
  const handleTo = kind === 'sword' ? 4 : kind === 'shovel' ? 10 : 9;
  if (kind !== 'sword') for (let t = 0; t <= handleTo; t++) { p.set(1 + t, 14 - t, h1); p.set(2 + t, 14 - t, h2); }
  if (kind === 'pickaxe') {
    for (let a = 0; a <= 20; a++) {
      const ang = -Math.PI / 2 + (a / 20) * (Math.PI / 2);
      const x = 2.5 + Math.cos(ang) * 10.5, y = 13.5 + Math.sin(ang) * 10.5;
      p.set(Math.round(x), Math.round(y), Lc);
      const x2 = 2.5 + Math.cos(ang) * 9.3, y2 = 13.5 + Math.sin(ang) * 9.3;
      p.set(Math.round(x2), Math.round(y2), a > 3 && a < 17 ? Mc : Dc);
    }
  } else if (kind === 'axe') {
    for (let y = 1; y <= 7; y++) for (let x = 4; x <= 10; x++) {
      const d = (x - 8.5) ** 2 / 14 + (y - 4) ** 2 / 9;
      if (d < 1 && x + y < 14) p.set(x, y, d < 0.35 ? Mc : (x < 7 ? Lc : Dc));
    }
  } else if (kind === 'shovel') {
    for (let y = 0; y <= 7; y++) for (let x = 8; x <= 15; x++) {
      const dx = x - 11.6, dy = y - 3.6;
      if (Math.abs(dx + dy) / 1.2 + Math.abs(dx - dy) / 2.2 < 2.6) p.set(x, y, dx - dy < -1 ? Lc : dx - dy > 1.5 ? Dc : Mc);
    }
  } else if (kind === 'hoe') {
    for (let x = 6; x <= 12; x++) { p.set(x, 2, Lc); p.set(x, 3, x > 10 ? Dc : Mc); }
    p.set(6, 4, Dc);
  } else if (kind === 'sword') {
    for (let t = 0; t <= 9; t++) { p.set(5 + t, 10 - t, Mc); p.set(6 + t, 10 - t, Dc); p.set(5 + t, 9 - t, Lc); }
    p.set(14, 1, Lc); p.set(15, 0, Lc);
    for (let t = 0; t < 5; t++) p.set(2 + t, 8 + t, hex('#4a3a2a'));
    p.set(3, 9, Dc); p.set(5, 11, Dc);
    for (let t = 0; t < 3; t++) { p.set(1 + t, 14 - t, h1); p.set(2 + t, 14 - t, h2); }
    p.set(0, 15, Dc);
  }
  p.outline('#1a1410');
}
const TIER_PAL = {
  wooden: ['#c09a5b', '#9c7b45', '#6e5530'], stone: ['#ababab', '#878787', '#5c5c5c'], iron: ['#f4f4f4', '#cfcfcf', '#949494'],
  golden: ['#fff3a0', '#f2cf3a', '#c09012'], diamond: ['#d0fffb', '#4fe0d8', '#1f9f9a'], crystal: ['#f6e8ff', '#b789ff', '#6f3fd8'],
};
function blob(p, cx, cy, rx, ry, pal, jag = 0.25) {
  const P = pal.map(hex);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
    if (d > 1 + (p.rnd() - 0.5) * jag) continue;
    const l = ((x - cx) + (y - cy)) / (rx + ry);
    p.set(x, y, P[Math.max(0, Math.min(P.length - 1, Math.floor((l + 0.6) * P.length * 0.8 + p.rnd() * 0.8)))]);
  }
}
ICON.stick = (p) => { clearAll(p); for (let t = 0; t <= 11; t++) { p.set(2 + t, 13 - t, hex('#8b6a3e')); p.set(3 + t, 13 - t, hex('#5e4527')); } p.outline('#2a1c10'); };
ICON.coal = (p) => { clearAll(p); blob(p, 7.5, 8, 5.2, 4.6, ['#5a5a5a', '#3a3a3a', '#262626', '#161616']); p.outline('#0a0a0a'); };
ICON.charcoal = (p) => { clearAll(p); blob(p, 7.5, 8, 5.2, 4.6, ['#6a5a4a', '#4a3e32', '#2e261e', '#1a1510']); p.outline('#0a0805'); };
ICON.flint = (p) => { clearAll(p); blob(p, 7.5, 8, 4.4, 5.4, ['#7a7a80', '#4a4a50', '#2e2e34', '#1c1c20'], 0.6); p.outline('#0e0e10'); };
ICON.gunpowder = (p) => { clearAll(p); blob(p, 7.5, 10, 6, 3.6, ['#8a8a8a', '#5a5a5a', '#3a3a3a'], 0.8); p.outline('#1a1a1a'); };
function ingot(p, pal) {
  clearAll(p);
  const [Lc, Mc, Dc] = pal.map(hex);
  for (let y = 5; y <= 11; y++) {
    const x0 = 2 + (11 - y), x1 = 8 + (11 - y);
    for (let x = x0; x <= x1; x++) p.set(x, y, y < 7 ? Lc : y < 9 ? Mc : Dc);
  }
  p.outline('#1a1410');
}
ICON.iron_ingot = (p) => ingot(p, ['#ffffff', '#d8d8d8', '#9a9a9a']);
ICON.gold_ingot = (p) => ingot(p, ['#fff7b0', '#f5d43c', '#b88a12']);
ICON.copper_ingot = (p) => ingot(p, ['#f5b590', '#d4805a', '#8f4a2c']);
function gem(p, pal, tall = false) {
  clearAll(p);
  const P = pal.map(hex);
  for (let y = 2; y < 15; y++) for (let x = 1; x < 15; x++) {
    const dx = Math.abs(x - 7.5), dy = (y - 8) * (tall ? 0.75 : 1);
    const inside = tall ? (dx < 4.2 && Math.abs(dy) < 4.6 && dx + Math.abs(dy) < 6.5) : (dx + Math.abs(dy) * 0.95 < 6.6 && y > 3);
    if (!inside) continue;
    const t = (x - 7.5) * 0.1 + (y - 8) * 0.12;
    p.set(x, y, t < -0.5 ? P[0] : t < 0 ? P[1] : t < 0.6 ? P[2] : P[3]);
  }
  p.set(5, 5, [255, 255, 255]); p.set(6, 5, P[0]);
  p.outline('#0e1a1a');
}
ICON.diamond = (p) => gem(p, ['#e0fffd', '#7cf2ec', '#3ccfc8', '#1a8f8a']);
ICON.emerald = (p) => gem(p, ['#c8ffd8', '#45e87a', '#1fbd52', '#0e7a32'], true);
ICON.crystal_shard = (p) => {
  clearAll(p);
  const P = ['#f6e8ff', '#c9a6ff', '#9466ff', '#6b3fd0', '#9ef0ff'].map(hex);
  for (let y = 1; y < 16; y++) {
    const t = (y - 1) / 14;
    const w = Math.round(1 + Math.sin(t * Math.PI) * 3);
    const cx = 8 + (t - 0.5) * 4;
    for (let x = Math.round(cx - w); x <= Math.round(cx + w); x++) p.set(x, y, x < cx - 1 ? P[0] : x < cx ? P[1] : x < cx + 1.5 ? P[2] : P[3]);
  }
  p.set(7, 4, P[4]); p.outline('#1c0e3a');
};
ICON.string = (p) => { clearAll(p); for (let t = 0; t < 14; t++) p.set(1 + t, Math.round(8 + Math.sin(t * 0.9) * 3), hex(t % 2 ? '#f0f0f0' : '#d0d0d0')); };
ICON.feather = (p) => {
  clearAll(p);
  for (let t = 0; t < 13; t++) { const x = 2 + t, y = 13 - t; p.set(x, y, hex('#d8d8d8')); if (t > 2) { p.set(x - 1, y - 1, hex('#ffffff')); p.set(x + 1, y + 1, hex('#e8e8e8')); if (t > 4 && t < 11) p.set(x - 2, y - 2, hex('#f4f4f4')); } }
  p.outline('#6a6a6a');
};
ICON.bone = (p) => {
  clearAll(p);
  for (let t = 0; t < 9; t++) { p.set(4 + t, 11 - t, hex('#f0ecdc')); p.set(5 + t, 11 - t, hex('#d6d0bc')); }
  for (const [x, y] of [[2, 11], [3, 13], [2, 12], [4, 13], [12, 2], [13, 3], [13, 1], [14, 2]]) p.set(x, y, hex('#f0ecdc'));
  p.outline('#5a5444');
};
ICON.wheat = (p) => {
  clearAll(p);
  for (const [x0, h] of [[5, 12], [7, 13], [9, 12], [11, 10]]) for (let y = 15; y > 15 - h; y--) {
    const x = Math.round(x0 - (15 - y) * 0.15);
    p.set(x, y, hex(y < 15 - h + 5 ? (y % 2 ? '#e2bd52' : '#c99a2e') : '#b4a046'));
  }
  p.outline('#4a3a12');
};
ICON.seeds = (p) => {
  clearAll(p);
  for (const [x, y] of [[4, 9], [8, 6], [11, 10], [6, 12], [10, 13], [7, 9]]) { p.set(x, y, hex('#5aa02c')); p.set(x + 1, y, hex('#3f7a1c')); p.set(x, y + 1, hex('#2f5e14')); }
};
ICON.bread = (p) => { clearAll(p); blob(p, 7.5, 9, 6.6, 3.8, ['#e8b366', '#c98a3a', '#a86a24', '#7a4a16'], 0.1); for (const x of [4, 7, 10]) p.set(x, 7, hex('#f5d08a')); p.outline('#3a2208'); };
function apple(p, pal) {
  clearAll(p);
  blob(p, 7.5, 9.5, 5.2, 5, pal, 0.05);
  p.set(6, 6, hex('#ffffff'));
  p.set(8, 3, hex('#5a3a1a')); p.set(8, 4, hex('#5a3a1a')); p.set(9, 3, hex('#3f8a2a')); p.set(10, 2, hex('#4f9a32'));
  p.outline('#2a0a0a');
}
ICON.apple = (p) => apple(p, ['#ff6a6a', '#e02a2a', '#b81a1a', '#7a0e0e']);
ICON.golden_apple = (p) => apple(p, ['#fff8b0', '#ffd83a', '#e0a812', '#9a6a08']);
ICON.sweet_berries = (p) => {
  clearAll(p);
  for (const [x, y] of [[5, 9], [9, 8], [7, 11], [10, 12], [4, 12]]) { blobAt(p, x, y, ['#ff5a64', '#d41f2c', '#8a0e18']); }
  p.set(8, 5, hex('#3a6b33')); p.set(7, 6, hex('#3a6b33')); p.outline('#2a0a0e');
};
function blobAt(p, x, y, pal) { const P = pal.map(hex); p.set(x, y, P[0]); p.set(x + 1, y, P[1]); p.set(x, y + 1, P[1]); p.set(x + 1, y + 1, P[2]); }
ICON.melon_slice = (p) => {
  clearAll(p);
  for (let y = 3; y < 15; y++) for (let x = 1; x < 15; x++) {
    const d = Math.hypot(x - 1, y - 15);
    if (d > 13.5 || x + 1 < 15 - y) continue;
    p.set(x, y, hex(d > 12.2 ? '#4a8a1e' : d > 11 ? '#c8e09a' : '#e83a3a'));
  }
  for (const [x, y] of [[5, 10], [8, 8], [7, 12], [10, 11]]) p.set(x, y, hex('#1a1a1a'));
  p.outline('#1a2a0a');
};
function meat(p, pal, boneEnd = true) {
  clearAll(p);
  blob(p, 8, 8, 6, 4.8, pal, 0.2);
  if (boneEnd) { p.set(2, 12, hex('#f0ecdc')); p.set(1, 13, hex('#f0ecdc')); p.set(2, 13, hex('#d6d0bc')); }
  p.outline('#2a0a08');
}
ICON.raw_porkchop = (p) => meat(p, ['#ffc4c4', '#f39a9a', '#d87070', '#b85050']);
ICON.cooked_porkchop = (p) => meat(p, ['#e8c08a', '#c8925a', '#a06a36', '#6e4420']);
ICON.raw_beef = (p) => meat(p, ['#ff8a7a', '#e04a3a', '#b8302a', '#7a1a14'], false);
ICON.steak = (p) => meat(p, ['#c8865a', '#9a5a32', '#6e3a1c', '#4a240e'], false);
ICON.raw_mutton = (p) => meat(p, ['#ff9a8a', '#e86a5a', '#c84a3e', '#8a2a22']);
ICON.cooked_mutton = (p) => meat(p, ['#d89a6a', '#b06e3e', '#8a4e26', '#5a2e12']);
function drumstick(p, pal) {
  clearAll(p);
  blob(p, 9, 7, 4.5, 4.2, pal, 0.1);
  for (let t = 0; t < 5; t++) { p.set(5 - t, 10 + t, hex('#f0ecdc')); }
  p.set(1, 15, hex('#f0ecdc')); p.set(0, 14, hex('#f0ecdc'));
  p.outline('#2a1408');
}
ICON.raw_chicken = (p) => drumstick(p, ['#fff0e8', '#f8d4c4', '#e8b4a0', '#c89480']);
ICON.cooked_chicken = (p) => drumstick(p, ['#f5c880', '#d89a4a', '#b0702a', '#7a4a16']);
ICON.rotten_flesh = (p) => meat(p, ['#9aa060', '#7a7a3e', '#5a6a2e', '#4a3a1e'], false);
function bucket(p, fill) {
  clearAll(p);
  const M = ['#e8e8e8', '#c4c4c4', '#8e8e8e'].map(hex);
  for (let y = 5; y < 15; y++) {
    const w = 6 - Math.floor((y - 5) * 0.25);
    for (let x = 8 - w; x < 8 + w; x++) p.set(x, y, x < 6 ? M[0] : x < 10 ? M[1] : M[2]);
  }
  for (let x = 2; x < 14; x++) p.set(x, 5, hex('#6a6a6a'));
  if (fill) for (let x = 3; x < 13; x++) { p.set(x, 5, hex(fill[0])); p.set(x, 6, hex(fill[1])); }
  for (let x = 3; x < 13; x++) p.set(x, 2 + Math.round(Math.abs(x - 7.5) * 0.4), hex('#7a7a7a'));
  p.outline('#1a1a1a');
}
ICON.bucket = (p) => bucket(p, null);
ICON.water_bucket = (p) => bucket(p, ['#4a8ae8', '#2a5fbf']);
ICON.lava_bucket = (p) => bucket(p, ['#ffb52e', '#e8650f']);
ICON.flint_and_steel = (p) => {
  clearAll(p);
  for (let a = 0; a < 24; a++) { const t = a / 24 * Math.PI * 1.6 + 0.3; p.set(Math.round(9 + Math.cos(t) * 4), Math.round(6 + Math.sin(t) * 4), hex(a % 3 ? '#c8c8c8' : '#8a8a8a')); }
  blob(p, 4.5, 11, 3, 3.4, ['#7a7a80', '#4a4a50', '#2e2e34'], 0.4);
  p.outline('#121212');
};
ICON.bow = (p) => {
  clearAll(p);
  for (let a = 0; a <= 24; a++) {
    const t = -Math.PI / 4 + (a / 24) * Math.PI;
    p.set(Math.round(3 + Math.cos(t - Math.PI / 4) * 11), Math.round(12 + Math.sin(t - Math.PI / 4) * 11) - 0, hex(a % 4 ? '#8b6a3e' : '#5e4527'));
  }
  for (let t = 0; t < 12; t++) p.set(2 + t, 13 - t, hex('#e8e8e8'));
  p.outline('#2a1c10');
};
ICON.arrow = (p) => {
  clearAll(p);
  for (let t = 0; t < 10; t++) p.set(3 + t, 12 - t, hex('#8b6a3e'));
  p.set(13, 2, hex('#d0d0d0')); p.set(12, 2, hex('#a0a0a0')); p.set(13, 3, hex('#a0a0a0')); p.set(14, 1, hex('#f0f0f0'));
  for (const [x, y] of [[2, 12], [3, 13], [1, 12], [3, 14], [2, 14], [1, 13]]) p.set(x, y, hex('#f4f4f4'));
  p.outline('#2a1c10');
};
ICON.shears = (p) => {
  clearAll(p);
  for (let t = 0; t < 8; t++) { p.set(7 + t, 8 - t, hex('#d8d8d8')); p.set(8 + t, 9 - t, hex('#a0a0a0')); }
  for (let t = 0; t < 8; t++) { p.set(8 - t, 7 + t, hex('#c8c8c8')); }
  p.rect(2, 12, 4, 14, '#b8302a'); p.rect(5, 13, 6, 14, '#b8302a');
  p.outline('#1a1a1a');
};
function gun(p, parts) {
  clearAll(p);
  for (const [x0, y0, x1, y1, c] of parts) p.rect(x0, y0, x1, y1, c);
  p.outline('#0a0a0c');
}
const GM = '#3a3d44', GD = '#25272c', GL = '#5a5e68', WD = '#7a5230', WL = '#9a6a3e';
ICON.pistol = (p) => gun(p, [[3, 5, 12, 7, GM], [3, 5, 12, 5, GL], [10, 8, 12, 8, GD], [4, 8, 6, 12, GD], [4, 8, 4, 12, GM], [7, 8, 8, 9, GD], [12, 6, 13, 6, GD]]);
ICON.assault_rifle = (p) => gun(p, [[0, 6, 3, 8, WD], [0, 6, 3, 6, WL], [4, 5, 11, 8, GM], [4, 5, 11, 5, GL], [12, 6, 15, 6, GD], [8, 9, 9, 12, GD], [9, 12, 10, 12, GD], [5, 9, 6, 10, GD], [7, 4, 9, 4, GD]]);
ICON.shotgun = (p) => gun(p, [[0, 7, 4, 9, WD], [0, 7, 4, 7, WL], [5, 6, 9, 8, GM], [5, 6, 9, 6, GL], [10, 6, 15, 6, GD], [10, 7, 15, 7, GM], [10, 8, 13, 8, WD], [6, 9, 7, 10, GD]]);
ICON.sniper_rifle = (p) => gun(p, [[0, 7, 4, 9, WD], [0, 7, 4, 7, WL], [5, 6, 10, 8, GM], [11, 7, 15, 7, GD], [5, 3, 9, 4, GD], [4, 3, 4, 4, '#4a90c0'], [6, 5, 7, 5, GD], [7, 9, 8, 10, GD], [8, 9, 8, 11, GD]]);
ICON.bullets = (p) => { clearAll(p); for (const x of [3, 7, 11]) { p.rect(x, 5, x + 2, 6, '#c8c8c8'); p.rect(x, 7, x + 2, 12, '#d8a840'); p.rect(x, 7, x, 12, '#f0d070'); } p.outline('#2a1a08'); };
ICON.verity = (p) => {
  clearAll(p);
  p.rect(5, 1, 10, 6, '#f0e6e0');
  p.rect(4, 1, 4, 9, '#141218'); p.rect(11, 1, 11, 9, '#141218'); p.rect(5, 0, 10, 0, '#141218'); p.rect(5, 1, 10, 1, '#141218');
  p.rect(6, 3, 6, 4, '#000000'); p.rect(9, 3, 9, 4, '#000000');
  p.rect(5, 7, 10, 13, '#f4f4f6'); p.rect(4, 8, 4, 11, '#f0e6e0'); p.rect(11, 8, 11, 11, '#f0e6e0');
  p.rect(6, 14, 6, 15, '#f0e6e0'); p.rect(9, 14, 9, 15, '#f0e6e0'); p.rect(5, 13, 10, 13, '#d8d8de');
  p.outline('#2a2430');
};
for (const tier of Object.keys(TIER_PAL)) for (const kind of ['pickaxe', 'axe', 'shovel', 'sword', 'hoe'])
  ICON[tier + '_' + kind] = (p) => toolSprite(p, kind, TIER_PAL[tier]);

const iconCache = {};
export function itemPixels(id) {
  if (iconCache[id]) return iconCache[id];
  const it = ITEMS[id];
  let p;
  if (id < 256) {
    // flat sprite of a plant / torch texture
    p = make(BLOCKS[id] && FACE_TEX[id * 6] !== undefined ? TEX_NAMES[FACE_TEX[id * 6]] : 'stone');
    if (TINTS[id] === TINT.GRASS) p = base(TEX_NAMES[FACE_TEX[id * 6]]).tint([0.49, 0.75, 0.30]);
  } else {
    p = new Px('icon_' + it.name);
    const g = ICON[it.icon || it.name];
    if (g) g(p); else { for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) p.set(x, y, [255, 0, 255]); }
  }
  iconCache[id] = p.d;
  return p.d;
}

// ================================================================== build
export function buildTextureArray() {
  const n = TEX_NAMES.length;
  if (n > 255) throw new Error('too many texture layers');
  const data = new Uint8Array(S * S * 4 * n);
  for (let i = 0; i < n; i++) data.set(make(TEX_NAMES[i]).d, i * S * S * 4);
  const tex = new THREE.DataArrayTexture(data, S, S, n);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

export function textureCanvas(name, scale = 1) {
  const p = make(name);
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const ctx = c.getContext('2d');
  ctx.putImageData(new ImageData(new Uint8ClampedArray(p.d), S, S), 0, 0);
  if (scale === 1) return c;
  const c2 = document.createElement('canvas');
  c2.width = c2.height = S * scale;
  const x2 = c2.getContext('2d'); x2.imageSmoothingEnabled = false; x2.drawImage(c, 0, 0, S * scale, S * scale);
  return c2;
}

const DEFAULT_TINT = { [TINT.GRASS]: [0.49, 0.75, 0.30], [TINT.FOLIAGE]: [0.42, 0.68, 0.24], [TINT.BIRCH]: [0.50, 0.65, 0.33], [TINT.SPRUCE]: [0.38, 0.52, 0.38], [TINT.WATER]: [0.25, 0.45, 0.85] };

function faceCanvas(id, face) {
  const name = TEX_NAMES[FACE_TEX[id * 6 + face]];
  const p = base(name);
  const t = DEFAULT_TINT[TINTS[id]];
  if (id === B.grass && face !== 2) {
    const ov = make('grass_side_overlay');
    for (let i = 0; i < p.d.length; i += 4) if (ov.d[i + 3]) { p.d[i] = ov.d[i] * t[0]; p.d[i + 1] = ov.d[i + 1] * t[1]; p.d[i + 2] = ov.d[i + 2] * t[2]; }
  } else if (t) p.tint(t);
  const c = document.createElement('canvas'); c.width = c.height = S;
  c.getContext('2d').putImageData(new ImageData(p.d, S, S), 0, 0);
  return c;
}

// Icon sprite sheet: every item in a 64px cell. Returns {url, cols, size}.
export function buildIconSheet() {
  const SZ = 64, COLS = 32;
  const rows = Math.ceil(ITEM_COUNT / COLS);
  const sheet = document.createElement('canvas');
  sheet.width = SZ * COLS; sheet.height = SZ * rows;
  const ctx = sheet.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  for (let id = 0; id < ITEM_COUNT; id++) {
    const it = ITEMS[id];
    if (!it) continue;
    const ox = (id % COLS) * SZ, oy = Math.floor(id / COLS) * SZ;
    if (id < 256) {
      const def = BLOCKS[id];
      const sh = SHAPES[id];
      if (sh === SHAPE.NONE || sh === SHAPE.LIQUID) continue;
      let hgt = 1;
      if (sh === SHAPE.BOXES) {
        if (def.torch || def.name === 'lantern') hgt = 0;
        else { let top = 0; for (const b of def.boxes) top = Math.max(top, b[4]); hgt = top / 16; }
      }
      if (sh === SHAPE.CUBE || (sh === SHAPE.BOXES && hgt > 0)) {
        drawIso(ctx, ox, oy, SZ, faceCanvas(id, 2), faceCanvas(id, 5), faceCanvas(id, 0), hgt);
        continue;
      }
    }
    const d = itemPixels(id);
    const c = document.createElement('canvas'); c.width = c.height = S;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(d), S, S), 0, 0);
    ctx.drawImage(c, ox + 4, oy + 4, SZ - 8, SZ - 8);
  }
  return { url: sheet.toDataURL('image/png'), cols: COLS, size: SZ, canvas: sheet };
}

function drawIso(ctx, ox, oy, SZ, top, left, right, h) {
  const k = SZ / 64;
  const side = 29 * k * h, drop = 29 * k * (1 - h);
  const T = [32 * k, 3 * k + drop], R = [60 * k, 17 * k + drop], Bm = [32 * k, 31 * k + drop], L = [4 * k, 17 * k + drop];
  const face = (img, P0, P1, P2, f, srcY = 0, srcH = S) => {
    ctx.save();
    ctx.setTransform((P1[0] - P0[0]) / S, (P1[1] - P0[1]) / S, (P2[0] - P0[0]) / srcH, (P2[1] - P0[1]) / srcH, ox + P0[0], oy + P0[1]);
    ctx.drawImage(img, 0, srcY, S, srcH, 0, 0, S + 0.15, srcH + 0.15);
    if (f < 1) { ctx.fillStyle = `rgba(0,0,0,${1 - f})`; ctx.globalCompositeOperation = 'source-atop'; ctx.fillRect(0, 0, S + 0.15, srcH + 0.15); }
    ctx.restore();
  };
  const srcY = Math.round(S * (1 - h)), srcH = Math.max(1, S - srcY);
  // left face (south), right face (east), then top
  const leftC = shadeCanvas(left, 0.78), rightC = shadeCanvas(right, 0.6);
  face(leftC, L, Bm, [L[0], L[1] + side], 1, srcY, srcH);
  face(rightC, Bm, R, [Bm[0], Bm[1] + side], 1, srcY, srcH);
  face(top, T, R, L, 1);
}
function shadeCanvas(c, f) {
  const o = document.createElement('canvas'); o.width = o.height = S;
  const x = o.getContext('2d'); x.drawImage(c, 0, 0);
  const id = x.getImageData(0, 0, S, S);
  for (let i = 0; i < id.data.length; i += 4) { id.data[i] *= f; id.data[i + 1] *= f; id.data[i + 2] *= f; }
  x.putImageData(id, 0, 0);
  return o;
}

export { TEX };
