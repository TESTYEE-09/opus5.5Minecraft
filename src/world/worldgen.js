// Deterministic terrain generation. Runs inside the generation workers.
// Every column is generated from world-aligned noise so neighbouring chunks
// agree on terrain, trees and waterfalls that cross chunk borders.
import { CS, H, SEA, idx } from '../core/config.js';
import { Simplex, hash2, hash3, mulberry32, smoothstep, lerp, clamp } from '../core/noise.js';
import { B, LO, EMIT, OPAQUE, LIQUID } from '../core/blocks.js';

export const BIOMES = [
  { name: 'Ocean', rain: true },
  { name: 'Frozen Ocean', snow: true },
  { name: 'Beach', rain: true },
  { name: 'Plains', rain: true, flowers: true },
  { name: 'Forest', rain: true, fireflies: true },
  { name: 'Birch Forest', rain: true, fireflies: true },
  { name: 'Cherry Grove', rain: true, petals: true, fireflies: true },
  { name: 'Taiga', rain: true },
  { name: 'Snowy Plains', snow: true, aurora: true },
  { name: 'Desert', dry: true },
  { name: 'Savanna', dry: true },
  { name: 'Swamp', rain: true, fireflies: true },
  { name: 'Stony Peaks', rain: true },
  { name: 'Snowy Peaks', snow: true, aurora: true },
  { name: 'River', rain: true, fireflies: true },
];
export const BI = {};
BIOMES.forEach((b, i) => { BI[b.name.replace(/ /g, '_').toUpperCase()] = i; });

const M = 8;            // margin around the chunk for cross-border features
const PW = CS + 2 * M;  // padded width (32)
const GX = PW / 4 + 1;  // 3D grid points horizontally (9)
const GY = H / 8 + 1;   // 3D grid points vertically (25)

export class WorldGen {
  constructor(seed) {
    this.seed = seed >>> 0;
    const s = this.seed;
    this.nCont = new Simplex(s + 1);
    this.nEros = new Simplex(s + 2);
    this.nRidge = new Simplex(s + 3);
    this.nHill = new Simplex(s + 4);
    this.nDetail = new Simplex(s + 5);
    this.nTemp = new Simplex(s + 6);
    this.nHum = new Simplex(s + 7);
    this.nWeird = new Simplex(s + 8);
    this.nRiver = new Simplex(s + 9);
    this.nDens = new Simplex(s + 10);
    this.nCheese = new Simplex(s + 11);
    this.nSpag1 = new Simplex(s + 12);
    this.nSpag2 = new Simplex(s + 13);
    this.nIsland = new Simplex(s + 14);
    this.nIslandH = new Simplex(s + 15);
    this.nPatch = new Simplex(s + 16);
    this.nFlower = new Simplex(s + 17);
    this.nLush = new Simplex(s + 18);
    // scratch buffers for the padded region
    const n = PW * PW;
    this.h2 = new Float32Array(n);
    this.amp = new Float32Array(n);
    this.mount = new Float32Array(n);
    this.temp = new Float32Array(n);
    this.hum = new Float32Array(n);
    this.riv = new Float32Array(n);
    this.cont = new Float32Array(n);
    this.biome = new Uint8Array(n);
    this.top = new Int16Array(n);
    this.itop = new Float32Array(n);
    this.ibot = new Float32Array(n);
    const g = GX * GX * GY;
    this.gD = new Float32Array(g);
    this.gC = new Float32Array(g);
    this.gS1 = new Float32Array(g);
    this.gS2 = new Float32Array(g);
  }

  // ---- 2D climate and height (pure functions of x,z) ----
  climate(x, z, out) {
    const wx = x + this.nDetail.noise2(x / 90, z / 90) * 18;
    const wz = z + this.nDetail.noise2(x / 90 + 50, z / 90 + 50) * 18;
    const cont = this.nCont.fbm2(wx / 1100, wz / 1100, 4);
    const eros = this.nEros.fbm2(wx / 620, wz / 620, 3);
    const ridge = this.nRidge.ridged2(wx / 300, wz / 300, 5);
    const hill = this.nHill.fbm2(wx / 150, wz / 150, 4);
    const det = this.nDetail.fbm2(x / 36, z / 36, 3);
    const temp = this.nTemp.fbm2(wx / 900, wz / 900, 3) * 1.25;
    const hum = this.nHum.fbm2(wx / 760, wz / 760, 3) * 1.25;
    const weird = this.nWeird.fbm2(wx / 420, wz / 420, 2);
    const rn = this.nRiver.fbm2(wx / 720, wz / 720, 4);

    // continentalness spline -> base land height
    let base;
    if (cont < -0.38) base = lerp(30, 40, smoothstep(-0.7, -0.38, cont));
    else if (cont < -0.16) base = lerp(40, 54, smoothstep(-0.38, -0.16, cont));
    else if (cont < -0.06) base = lerp(54, 63, smoothstep(-0.16, -0.06, cont));
    else if (cont < 0.18) base = lerp(63.5, 70, smoothstep(-0.06, 0.18, cont));
    else base = lerp(70, 82, smoothstep(0.18, 0.6, cont));

    const inland = smoothstep(-0.12, 0.2, cont);
    const mount = smoothstep(0.02, -0.42, eros) * inland;
    const flat = smoothstep(-0.1, 0.5, eros);
    let h = base + hill * (3 + 9 * (1 - flat) * inland) + det * 1.6;
    h += mount * (Math.pow(ridge, 1.7) * 92 + 6);
    // cherry groves sit on soft hills
    const cherry = smoothstep(0.35, 0.55, weird) * inland * (1 - mount);
    h += cherry * (hill * 0.5 + 0.5) * 10;

    // rivers
    const riverness = (1 - smoothstep(0.0, 0.032, Math.abs(rn))) * smoothstep(-0.12, -0.02, cont);
    const riverCut = riverness * (1 - mount * 0.7);
    if (riverCut > 0) h = lerp(h, SEA - 3, riverCut * smoothstep(SEA - 6, SEA + 12, h) + riverCut * 0.2);

    out.h = h; out.mount = mount; out.temp = temp; out.hum = hum; out.weird = weird;
    out.river = riverness; out.cont = cont; out.amp = 1.2 + mount * 24;
    out.biome = this.pickBiome(h, temp, hum, weird, mount, cont, riverness);
    return out;
  }

  pickBiome(h, T, Hm, W, mount, cont, river) {
    if (h < SEA - 3) {
      if (river > 0.5 && cont > -0.1) return T < -0.55 ? BI.FROZEN_OCEAN : BI.RIVER;
      return T < -0.55 ? BI.FROZEN_OCEAN : BI.OCEAN;
    }
    if (mount > 0.5 && h > 104) return (h > 124 || T < -0.3) ? BI.SNOWY_PEAKS : BI.STONY_PEAKS;
    if (h < SEA + 2.5 && cont < 0.02 && river < 0.3) return T < -0.55 ? BI.SNOWY_PLAINS : BI.BEACH;
    if (river > 0.55) return T < -0.55 ? BI.SNOWY_PLAINS : BI.RIVER;
    if (T < -0.5) return Hm > 0.1 ? BI.TAIGA : BI.SNOWY_PLAINS;
    if (T < -0.18) return BI.TAIGA;
    if (W > 0.42 && T < 0.45 && Hm > -0.35) return BI.CHERRY_GROVE;
    if (T > 0.42 && Hm < -0.05) return BI.DESERT;
    if (T > 0.3 && Hm < 0.22) return BI.SAVANNA;
    if (Hm > 0.42 && T > 0.05 && h < SEA + 7) return BI.SWAMP;
    if (Hm > 0.32 && T < 0.3) return BI.BIRCH_FOREST;
    if (Hm > 0.05) return BI.FOREST;
    return BI.PLAINS;
  }

  islandAt(x, z, out) {
    // floating islands: masked patches high in the sky
    const m = this.nIsland.fbm2(x / 230, z / 230, 3) + this.nIsland.noise2(x / 40, z / 40) * 0.08;
    const t = 0.4;
    if (m < t) { out.top = 0; out.bot = 0; return false; }
    const k = m - t;
    const yc = 138 + this.nIslandH.fbm2(x / 260, z / 260, 2) * 18;
    out.top = yc + 1.5 + Math.min(k * 30, 4) + this.nIslandH.noise2(x / 18, z / 18) * 1.2;
    out.bot = yc - Math.pow(k * 9, 1.15) * 7 - Math.abs(this.nIslandH.noise2(x / 9, z / 9)) * 3;
    return out.top - out.bot > 1.5;
  }

  // ---- tints (biome colours) ----
  tintFor(T, Hm, biome, out, o) {
    const t = smoothstep(-0.7, 0.7, T), h = smoothstep(-0.7, 0.7, Hm);
    let gr = lerp(lerp(0.74, 0.40, h), 0.47, 0.35), gg = lerp(lerp(0.71, 0.77, h), 0.75, 0.35), gb = lerp(lerp(0.33, 0.22, h), 0.28, 0.35);
    gr = lerp(0.50, gr, t); gg = lerp(0.70, gg, t); gb = lerp(0.56, gb, t);
    if (biome === BI.SWAMP) { gr = 0.42; gg = 0.47; gb = 0.24; }
    if (biome === BI.CHERRY_GROVE) { gr = 0.50; gg = 0.80; gb = 0.32; }
    if (biome === BI.SAVANNA || biome === BI.DESERT) { gr = 0.75; gg = 0.71; gb = 0.34; }
    out[o] = gr * 255; out[o + 1] = gg * 255; out[o + 2] = gb * 255;
    // foliage slightly deeper
    out[o + 3] = gr * 0.86 * 255; out[o + 4] = gg * 0.92 * 255; out[o + 5] = gb * 0.8 * 255;
    // water
    let wr = 0.20, wg = 0.46, wb = 0.82;
    if (biome === BI.SWAMP) { wr = 0.30; wg = 0.42; wb = 0.30; }
    else if (T > 0.4) { wr = 0.18; wg = 0.62; wb = 0.78; }
    else if (T < -0.4) { wr = 0.22; wg = 0.34; wb = 0.72; }
    out[o + 6] = wr * 255; out[o + 7] = wg * 255; out[o + 8] = wb * 255;
  }

  // ---- 3D grid sampling ----
  buildGrids(ox, oz) {
    const { gD, gC, gS1, gS2 } = this;
    let i = 0;
    for (let iy = 0; iy < GY; iy++) {
      const y = iy * 8;
      for (let iz = 0; iz < GX; iz++) {
        const z = oz + iz * 4;
        for (let ix = 0; ix < GX; ix++, i++) {
          const x = ox + ix * 4;
          gD[i] = this.nDens.fbm3(x / 52, y / 34, z / 52, 2);
          gC[i] = this.nCheese.fbm3(x / 80, y / 44, z / 80, 2);
          gS1[i] = this.nSpag1.noise3(x / 70, y / 46, z / 70);
          gS2[i] = this.nSpag2.noise3(x / 70 + 31, y / 46, z / 70 - 17);
        }
      }
    }
  }

  // trilinear sample of a grid at padded-local px,pz and y
  sampleGrid(g, px, y, pz) {
    const ix = px >> 2, iz = pz >> 2, iy = y >> 3;
    const fx = (px & 3) * 0.25, fz = (pz & 3) * 0.25, fy = (y & 7) * 0.125;
    const i000 = (iy * GX + iz) * GX + ix;
    const i010 = i000 + GX * GX;
    const a = g[i000] + (g[i000 + 1] - g[i000]) * fx;
    const b = g[i000 + GX] + (g[i000 + GX + 1] - g[i000 + GX]) * fx;
    const c = g[i010] + (g[i010 + 1] - g[i010]) * fx;
    const d = g[i010 + GX] + (g[i010 + GX + 1] - g[i010 + GX]) * fx;
    const ab = a + (b - a) * fz, cd = c + (d - c) * fz;
    return ab + (cd - ab) * fy;
  }

  solidAt(p, px, y, pz) {
    if (y <= 0) return true;
    const h = this.h2[p];
    const d = h - y + this.amp[p] * this.sampleGrid(this.gD, px, y, pz);
    if (d <= 0) return false;
    return !this.caveAt(p, px, y, pz, h);
  }

  caveAt(p, px, y, pz, h) {
    if (y < 4) return false;
    // keep the sea floor and river beds intact
    if (h < SEA + 3 && y > h - 6) return false;
    const depthT = smoothstep(h - 2, h - 18, y);
    const ch = this.sampleGrid(this.gC, px, y, pz);
    const thr = 0.6 - 0.12 * smoothstep(50, 10, y);
    if (ch > thr + (1 - depthT) * 0.25) return true;
    const s1 = this.sampleGrid(this.gS1, px, y, pz);
    if (Math.abs(s1) > 0.07) return false;
    const s2 = this.sampleGrid(this.gS2, px, y, pz);
    const w = 0.055 * (0.55 + 0.45 * depthT) + 0.012;
    return Math.abs(s1) < w && Math.abs(s2) < w;
  }

  generate(cx, cz, edits) {
    const blocks = new Uint8Array(CS * CS * H);
    const tints = new Uint8Array(CS * CS * 9);
    const biomes = new Uint8Array(CS * CS);
    const ox = cx * CS - M, oz = cz * CS - M;
    const c = {};
    const isl = {};
    // 2D pass over the padded region
    for (let pz = 0; pz < PW; pz++) for (let px = 0; px < PW; px++) {
      const p = pz * PW + px;
      this.climate(ox + px, oz + pz, c);
      this.h2[p] = c.h; this.amp[p] = c.amp; this.mount[p] = c.mount; this.temp[p] = c.temp;
      this.hum[p] = c.hum; this.riv[p] = c.river; this.cont[p] = c.cont; this.biome[p] = c.biome;
      if (c.h < 115 && this.islandAt(ox + px, oz + pz, isl)) { this.itop[p] = isl.top; this.ibot[p] = isl.bot; }
      else { this.itop[p] = 0; this.ibot[p] = 0; }
    }
    this.buildGrids(ox, oz);

    // top solid for every padded column (used by trees that cross borders)
    for (let pz = 0; pz < PW; pz++) for (let px = 0; px < PW; px++) {
      const p = pz * PW + px;
      const yStart = Math.min(H - 2, Math.ceil(this.h2[p] + this.amp[p] + 2));
      let t = -1;
      for (let y = yStart; y > 0; y--) if (this.solidAt(p, px, y, pz)) { t = y; break; }
      this.top[p] = t;
    }

    // ---- interior: solid terrain ----
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      const px = lx + M, pz = lz + M, p = pz * PW + px;
      const yMax = Math.min(H - 2, Math.ceil(this.h2[p] + this.amp[p] + 2));
      const col = lz * CS + lx;
      biomes[col] = this.biome[p];
      this.tintFor(this.temp[p], this.hum[p], this.biome[p], tints, col * 9);
      for (let y = 0; y <= yMax; y++) {
        if (this.solidAt(p, px, y, pz)) blocks[idx(lx, y, lz)] = B.stone;
      }
      // bedrock
      blocks[idx(lx, 0, lz)] = B.bedrock;
      for (let y = 1; y < 4; y++) if (hash3(this.seed, ox + px, y, oz + pz) < 0.6 - y * 0.15) blocks[idx(lx, y, lz)] = B.bedrock;
      // deep slate below ~16 with a wavy border
      const slateTop = 14 + Math.floor(hash2(this.seed + 99, ox + px, oz + pz) * 4);
      for (let y = 1; y < slateTop; y++) if (blocks[idx(lx, y, lz)] === B.stone) blocks[idx(lx, y, lz)] = B.slate;
      // lava in deep caves, water below sea level
      for (let y = 1; y <= 10; y++) if (blocks[idx(lx, y, lz)] === 0) blocks[idx(lx, y, lz)] = B.lava;
    }

    this.surface(blocks, ox, oz);
    this.ores(blocks, cx, cz);
    this.caveDecor(blocks, ox, oz);
    this.islands(blocks, ox, oz);
    this.trees(blocks, ox, oz);
    this.plants(blocks, ox, oz);
    this.snowCover(blocks);

    if (edits) for (let i = 0; i < edits.length; i += 2) blocks[edits[i]] = edits[i + 1];

    const light = new Uint8Array(CS * CS * H);
    const heights = new Uint8Array(CS * CS);
    computeColumnLight(blocks, light, heights);
    const counts = new Uint16Array(H / CS);
    for (let i = 0; i < blocks.length; i++) if (blocks[i]) counts[(i / (CS * CS * CS)) | 0]++;
    return { blocks, light, tints, biomes, heights, counts };
  }

  surface(blocks, ox, oz) {
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      const px = lx + M, pz = lz + M, p = pz * PW + px;
      const bio = this.biome[p];
      const wx = ox + px, wz = oz + pz;
      // slope from neighbouring 2D heights
      const slope = Math.max(
        Math.abs(this.h2[p + 1] - this.h2[p - 1]),
        Math.abs(this.h2[p + PW] - this.h2[p - PW]),
      );
      const patch = this.nPatch.noise2(wx / 22, wz / 22);
      const frozen = bio === BI.FROZEN_OCEAN || (BIOMES[bio].snow && bio !== BI.SNOWY_PEAKS);
      let state = 0, depth = 0, topId = 0;
      for (let y = H - 2; y > 0; y--) {
        const i = idx(lx, y, lz);
        const id = blocks[i];
        if (state === 0) {
          if (id === 0) {
            if (y <= SEA) blocks[i] = (y === SEA && frozen) ? B.ice : B.water;
            continue;
          }
          if (id !== B.stone) break;
          const above = blocks[i + CS * CS];
          const underwater = above === B.water || above === B.ice;
          let top = B.grass;
          if (underwater || y < SEA - 1) {
            top = patch > 0.45 ? B.clay : patch < -0.35 ? B.gravel : (bio === BI.SWAMP ? B.dirt : B.sand);
            if (bio === BI.RIVER) top = patch > 0.2 ? B.gravel : B.sand;
          } else if (bio === BI.DESERT || bio === BI.BEACH) top = B.sand;
          else if (bio === BI.RIVER && y <= SEA + 1) top = B.sand;
          else if (bio === BI.STONY_PEAKS) top = (y > 118 && patch > -0.2) ? B.snow : patch > 0.3 ? B.gravel : B.stone;
          else if (bio === BI.SNOWY_PEAKS) top = slope > 4 ? (patch > 0.5 ? B.packed_ice : B.stone) : B.snow;
          else if (slope > 5.5 && this.mount[p] > 0.35) top = patch > 0.4 ? B.gravel : B.stone;
          else if (bio === BI.TAIGA && patch > 0.35) top = B.podzol;
          else if (bio === BI.TAIGA && patch < -0.55) top = B.coarse_dirt;
          else if (bio === BI.SAVANNA && patch > 0.6) top = B.coarse_dirt;
          if (y <= SEA && !underwater && top === B.grass && this.h2[p] < SEA + 0.5) top = B.sand;
          blocks[i] = top; topId = top; state = 1; depth = 1;
        } else {
          if (id !== B.stone || depth >= 4) break;
          let f;
          if (topId === B.sand) f = depth < 3 ? B.sand : B.sandstone;
          else if (topId === B.gravel) f = B.gravel;
          else if (topId === B.clay) f = depth < 2 ? B.clay : B.dirt;
          else if (topId === B.stone || topId === B.packed_ice) f = B.stone;
          else if (topId === B.snow) f = depth < 2 ? B.snow : B.stone;
          else f = B.dirt;
          if (bio === BI.DESERT && depth >= 3) f = B.sandstone;
          blocks[i] = f;
          depth++;
        }
      }
    }
  }

  ores(blocks, cx, cz) {
    const rnd = mulberry32((this.seed ^ Math.imul(cx, 73856093) ^ Math.imul(cz, 19349663)) >>> 0);
    const blob = (id, size, yMin, yMax, replace) => {
      const x0 = rnd() * 16, z0 = rnd() * 16, y0 = yMin + rnd() * (yMax - yMin);
      const r = Math.max(0.8, Math.cbrt(size) * 0.72);
      const ri = Math.ceil(r);
      for (let dy = -ri; dy <= ri; dy++) for (let dz = -ri; dz <= ri; dz++) for (let dx = -ri; dx <= ri; dx++) {
        const x = Math.floor(x0 + dx), y = Math.floor(y0 + dy), z = Math.floor(z0 + dz);
        if (x < 0 || x >= CS || z < 0 || z >= CS || y < 1 || y >= H) continue;
        const d = (dx * dx + dy * dy * 1.3 + dz * dz) / (r * r);
        if (d > 0.75 + rnd() * 0.35) continue;
        const i = idx(x, y, z);
        const b = blocks[i];
        if (replace ? replace(b) : (b === B.stone || b === B.slate)) blocks[i] = (b === B.slate && id === B.stone) ? B.slate : id;
      }
    };
    const rock = b => b === B.stone;
    for (let n = 0; n < 3; n++) blob(B.granite, 34, 1, 90, rock);
    for (let n = 0; n < 3; n++) blob(B.diorite, 34, 1, 90, rock);
    for (let n = 0; n < 3; n++) blob(B.andesite, 34, 1, 90, rock);
    for (let n = 0; n < 2; n++) blob(B.gravel, 26, 1, 90, rock);
    for (let n = 0; n < 2; n++) blob(B.dirt, 26, 1, 90, rock);
    for (let n = 0; n < 22; n++) blob(B.coal_ore, 9, 5, 130);
    for (let n = 0; n < 12; n++) blob(B.iron_ore, 6, 5, 72);
    for (let n = 0; n < 9; n++) blob(B.copper_ore, 7, 20, 96);
    for (let n = 0; n < 4; n++) blob(B.gold_ore, 5, 3, 34);
    for (let n = 0; n < 2; n++) blob(B.diamond_ore, 4, 2, 16);
    if (rnd() < 0.5) blob(B.diamond_ore, 3, 2, 14);
    const mx = M + 8, mz = M + 8;
    if (this.mount[mz * PW + mx] > 0.4) for (let n = 0; n < 4; n++) blob(B.emerald_ore, 1, 40, 120);
  }

  caveDecor(blocks, ox, oz) {
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      const p = (lz + M) * PW + lx + M;
      const wx = ox + lx + M, wz = oz + lz + M;
      const lush = this.nLush.noise2(wx / 70, wz / 70) > 0.45;
      const top = Math.min(this.top[p] - 6, H - 2);
      for (let y = 6; y < top; y++) {
        const i = idx(lx, y, lz);
        if (blocks[i] !== 0) continue;
        const below = blocks[i - CS * CS];
        if (below === B.stone || below === B.slate || below === B.granite || below === B.andesite || below === B.diorite || below === B.dirt) {
          const r = hash3(this.seed + 7, wx, y, wz);
          if (lush) {
            blocks[i - CS * CS] = B.moss_block;
            if (r < 0.05) blocks[i] = B.glow_mushroom;
            else if (r < 0.25) blocks[i] = B.short_grass;
          } else if (r < 0.008) blocks[i] = B.glow_mushroom;
          else if (r < 0.012 && y < 40) blocks[i] = B.brown_mushroom;
        }
        const above = blocks[i + CS * CS];
        if ((above === B.stone || above === B.slate) && y < 40 && hash3(this.seed + 8, wx, y, wz) < 0.0025) {
          // glowstone cluster hanging from the ceiling
          blocks[i + CS * CS] = B.glowstone;
          if (lx > 0) blocks[i + CS * CS - 1] = blocks[i + CS * CS - 1] ? B.glowstone : 0;
          blocks[i] = B.glowstone;
        }
      }
    }
  }

  islands(blocks, ox, oz) {
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      const px = lx + M, pz = lz + M, p = pz * PW + px;
      const t = this.itop[p], b = this.ibot[p];
      if (t - b <= 1.5) continue;
      const wx = ox + px, wz = oz + pz;
      const yt = Math.floor(t), yb = Math.ceil(b);
      for (let y = yb; y <= yt && y < H - 1; y++) {
        const d = yt - y;
        let id = d === 0 ? B.grass : d < 3 ? B.dirt : B.stone;
        if (id === B.stone && hash3(this.seed + 21, wx, y, wz) < 0.035) id = B.crystal_ore;
        blocks[idx(lx, y, lz)] = id;
      }
      // crystals hanging under the island
      if (hash2(this.seed + 22, wx, wz) < 0.04 && yb - 1 > 0) blocks[idx(lx, yb - 1, lz)] = B.crystal_cluster;
      // waterfalls pour off island rims
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const q = p + dx + dz * PW;
        if (this.itop[q] - this.ibot[q] > 1.5) continue;
        if (hash2(this.seed + 23, wx, wz) > 0.012) continue;
        blocks[idx(lx, yt, lz)] = B.water;
      }
    }
    // falling water columns (may start from an island cell in a neighbouring chunk)
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      const px = lx + M, pz = lz + M, p = pz * PW + px;
      if (this.itop[p] - this.ibot[p] > 1.5) continue;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const q = p - dx - dz * PW; // island cell next to us
        if (this.itop[q] - this.ibot[q] <= 1.5) continue;
        const wx = ox + px - dx, wz = oz + pz - dz;
        // the island cell's own rim test must point at us
        const r = q + dx + dz * PW;
        if (r !== p) continue;
        if (hash2(this.seed + 23, wx, wz) > 0.012) continue;
        const yt = Math.floor(this.itop[q]);
        let y = yt;
        while (y > 1 && blocks[idx(lx, y, lz)] === 0) { blocks[idx(lx, y, lz)] = B.water_falling; y--; }
        if (y > 1 && blocks[idx(lx, y, lz)] !== B.water) blocks[idx(lx, y, lz)] = B.water;
      }
    }
  }

  // --------------------------------------------------------------- trees
  trees(blocks, ox, oz) {
    const set = (x, y, z, id, force) => {
      const lx = x - ox - M, lz = z - oz - M;
      if (lx < 0 || lx >= CS || lz < 0 || lz >= CS || y < 1 || y >= H) return;
      const i = idx(lx, y, lz);
      const cur = blocks[i];
      if (force) { if (cur === 0 || !OPAQUE[cur] || isLeaf(cur) || cur === B.grass || cur === B.dirt) blocks[i] = id; return; }
      if (cur === 0 || cur === B.short_grass || cur === B.snow_layer || cur === B.tall_fern) blocks[i] = id;
    };
    const STEP = 3;
    const gx0 = Math.floor(ox / STEP) * STEP, gz0 = Math.floor(oz / STEP) * STEP;
    for (let gz = gz0; gz < oz + PW; gz += STEP) for (let gx = gx0; gx < ox + PW; gx += STEP) {
      const r0 = hash2(this.seed + 31, gx, gz);
      const x = gx + Math.floor(hash2(this.seed + 32, gx, gz) * STEP);
      const z = gz + Math.floor(hash2(this.seed + 33, gx, gz) * STEP);
      const px = x - ox, pz = z - oz;
      if (px < 1 || pz < 1 || px >= PW - 1 || pz >= PW - 1) continue;
      const p = pz * PW + px;
      // island trees
      const onIsland = this.itop[p] - this.ibot[p] > 3;
      const bio = this.biome[p];
      let dens;
      switch (bio) {
        case BI.FOREST: dens = 0.5; break;
        case BI.BIRCH_FOREST: dens = 0.5; break;
        case BI.TAIGA: dens = 0.42; break;
        case BI.CHERRY_GROVE: dens = 0.16; break;
        case BI.SWAMP: dens = 0.16; break;
        case BI.SAVANNA: dens = 0.035; break;
        case BI.PLAINS: dens = 0.018; break;
        case BI.SNOWY_PLAINS: dens = 0.03; break;
        case BI.RIVER: dens = 0.04; break;
        case BI.STONY_PEAKS: dens = 0.01; break;
        default: dens = 0;
      }
      if (onIsland) dens = 0.12;
      // forests thin out in clearings
      if (!onIsland && (bio === BI.FOREST || bio === BI.TAIGA || bio === BI.BIRCH_FOREST)) {
        dens *= smoothstep(-0.55, 0.0, this.nPatch.noise2(x / 50, z / 50));
      }
      if (r0 > dens) continue;
      let y;
      if (onIsland) y = Math.floor(this.itop[p]);
      else {
        y = this.top[p];
        if (y <= SEA || Math.abs(y - this.h2[p]) > this.amp[p] + 3) continue;
        if (this.mount[p] > 0.45 && y > 110) continue;
        // only on dirt-like ground: approximate the surface rule
        if (bio === BI.DESERT || bio === BI.BEACH || bio === BI.SNOWY_PEAKS) continue;
        if (bio === BI.RIVER && y <= SEA + 1) continue;
        const slope = Math.max(Math.abs(this.h2[p + 1] - this.h2[p - 1]), Math.abs(this.h2[p + PW] - this.h2[p - PW]));
        if (slope > 5.5 && this.mount[p] > 0.35) continue;
      }
      const rnd = mulberry32((Math.imul(x, 341873128) ^ Math.imul(z, 132897987) ^ this.seed) >>> 0);
      let kind;
      if (onIsland) kind = rnd() < 0.55 ? 'cherry' : 'oak';
      else switch (bio) {
        case BI.BIRCH_FOREST: kind = rnd() < 0.85 ? 'birch' : 'oak'; break;
        case BI.FOREST: kind = rnd() < 0.22 ? 'birch' : rnd() < 0.08 ? 'fancy' : rnd() < 0.08 ? 'bush' : 'oak'; break;
        case BI.TAIGA: case BI.SNOWY_PLAINS: kind = 'spruce'; break;
        case BI.CHERRY_GROVE: kind = 'cherry'; break;
        case BI.SAVANNA: kind = 'acacia'; break;
        case BI.SWAMP: kind = 'swamp'; break;
        case BI.STONY_PEAKS: kind = 'spruce'; break;
        default: kind = rnd() < 0.15 ? 'fancy' : 'oak';
      }
      // ground under trunk becomes dirt
      set(x, y, z, B.dirt, true);
      growTree(kind, x, y + 1, z, rnd, set);
    }
  }

  plants(blocks, ox, oz) {
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      const px = lx + M, pz = lz + M, p = pz * PW + px;
      const wx = ox + px, wz = oz + pz;
      const bio = this.biome[p];
      // find the top block
      let y = H - 2;
      while (y > 0 && blocks[idx(lx, y, lz)] === 0) y--;
      const ground = blocks[idx(lx, y, lz)];
      const ai = idx(lx, y + 1, lz);
      if (y + 1 >= H - 1 || blocks[ai] !== 0) continue;
      const r = hash2(this.seed + 41, wx, wz);
      const r2 = hash2(this.seed + 42, wx, wz);
      if (ground === B.grass || ground === B.podzol) {
        const fl = this.nFlower.noise2(wx / 14, wz / 14);
        let grassP = 0.18, flowerP = 0;
        if (bio === BI.PLAINS) { grassP = 0.34; flowerP = fl > 0.45 ? 0.35 : 0.01; }
        else if (bio === BI.FOREST) { grassP = 0.16; flowerP = fl > 0.5 ? 0.2 : 0.004; }
        else if (bio === BI.BIRCH_FOREST) { grassP = 0.2; flowerP = fl > 0.4 ? 0.18 : 0.004; }
        else if (bio === BI.CHERRY_GROVE) { grassP = 0.25; flowerP = fl > 0.2 ? 0.3 : 0.02; }
        else if (bio === BI.SAVANNA) grassP = 0.4;
        else if (bio === BI.TAIGA) grassP = 0.22;
        else if (bio === BI.SWAMP) grassP = 0.12;
        else if (bio === BI.SNOWY_PLAINS) grassP = 0.03;
        else if (bio === BI.RIVER) grassP = 0.2;
        if (r < flowerP) {
          const k = this.nFlower.noise2(wx / 60 + 9, wz / 60 - 3);
          let f;
          if (bio === BI.CHERRY_GROVE) f = r2 < 0.6 ? B.pink_tulip : r2 < 0.8 ? B.allium : B.oxeye_daisy;
          else if (bio === BI.BIRCH_FOREST) f = r2 < 0.5 ? B.lily_of_the_valley : r2 < 0.8 ? B.allium : B.poppy;
          else if (bio === BI.FOREST) f = r2 < 0.5 ? B.poppy : r2 < 0.8 ? B.dandelion : B.lily_of_the_valley;
          else f = k < -0.4 ? B.cornflower : k < -0.1 ? B.dandelion : k < 0.2 ? B.poppy : k < 0.45 ? B.oxeye_daisy : (r2 < 0.5 ? B.orange_tulip : B.pink_tulip);
          blocks[ai] = f;
        } else if (r < flowerP + grassP) {
          blocks[ai] = (bio === BI.TAIGA && r2 < 0.5) ? B.tall_fern : B.short_grass;
        } else if (bio === BI.TAIGA && r < flowerP + grassP + 0.01) blocks[ai] = B.sweet_berry_bush;
        else if ((bio === BI.FOREST || bio === BI.SWAMP) && r < flowerP + grassP + 0.006) blocks[ai] = r2 < 0.5 ? B.red_mushroom : B.brown_mushroom;
        else if ((bio === BI.PLAINS || bio === BI.FOREST) && r > 0.9985) blocks[ai] = B.pumpkin + Math.floor(r2 * 4);
        else if (bio === BI.FOREST && r > 0.9975 && r <= 0.9985) blocks[ai] = B.melon;
      } else if (ground === B.sand && bio === BI.DESERT) {
        if (r < 0.006) {
          const hgt = 1 + Math.floor(r2 * 3);
          for (let k = 0; k < hgt; k++) if (blocks[ai + k * CS * CS] === 0) blocks[ai + k * CS * CS] = B.cactus;
        } else if (r < 0.014) blocks[ai] = B.dead_bush;
      } else if (ground === B.coarse_dirt && r < 0.02) blocks[ai] = B.dead_bush;
      // sugar cane beside water
      if ((ground === B.sand || ground === B.grass || ground === B.dirt) && y === SEA && r2 > 0.86) {
        let water = false;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = lx + dx, nz = lz + dz;
          if (nx < 0 || nz < 0 || nx >= CS || nz >= CS) continue;
          if (blocks[idx(nx, y, nz)] === B.water) water = true;
        }
        if (water) {
          const hgt = 1 + Math.floor(r * 37 % 3);
          for (let k = 0; k < hgt; k++) blocks[ai + k * CS * CS] = B.sugar_cane;
        }
      }
    }
  }

  snowCover(blocks) {
    for (let lz = 0; lz < CS; lz++) for (let lx = 0; lx < CS; lx++) {
      const p = (lz + M) * PW + lx + M;
      const bio = this.biome[p];
      const snowy = BIOMES[bio].snow || this.temp[p] < -0.5;
      if (!snowy) continue;
      let y = H - 2;
      while (y > 0 && blocks[idx(lx, y, lz)] === 0) y--;
      const g = blocks[idx(lx, y, lz)];
      if (g === B.short_grass || g === B.tall_fern) { blocks[idx(lx, y, lz)] = B.snow_layer; continue; }
      if (OPAQUE[g] || isLeaf(g)) {
        if (g === B.ice || g === B.packed_ice || LIQUID[g]) continue;
        blocks[idx(lx, y + 1, lz)] = B.snow_layer;
      }
    }
  }
}

function isLeaf(id) {
  return id === B.oak_leaves || id === B.birch_leaves || id === B.spruce_leaves || id === B.cherry_leaves || id === B.acacia_leaves;
}

// -------------------------------------------------------------- tree shapes
// set(x,y,z,id,force): force=true lets logs replace leaves.
export function growTree(kind, x, y, z, rnd, set) {
  const blob = (cx, cy, cz, rx, ry, rz, leaf, holes = 0.12) => {
    const ix = Math.ceil(rx), iy = Math.ceil(ry), iz = Math.ceil(rz);
    for (let dy = -iy; dy <= iy; dy++) for (let dz = -iz; dz <= iz; dz++) for (let dx = -ix; dx <= ix; dx++) {
      const d = (dx * dx) / (rx * rx) + (dy * dy) / (ry * ry) + (dz * dz) / (rz * rz);
      if (d > 1) continue;
      if (d > 0.6 && rnd() < holes) continue;
      set(Math.round(cx + dx), Math.round(cy + dy), Math.round(cz + dz), leaf);
    }
  };
  if (kind === 'oak' || kind === 'birch' || kind === 'swamp') {
    const log = kind === 'birch' ? B.birch_log : B.oak_log;
    const leaf = kind === 'birch' ? B.birch_leaves : B.oak_leaves;
    const h = kind === 'birch' ? 5 + Math.floor(rnd() * 3) : 4 + Math.floor(rnd() * 3);
    const wide = kind === 'swamp' ? 3 : 2;
    for (let dy = h - 3; dy <= h; dy++) {
      const r = dy >= h - 1 ? 1 : wide;
      for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
        const corner = Math.abs(dx) === r && Math.abs(dz) === r;
        if (corner && (dy === h || rnd() < 0.5)) continue;
        set(x + dx, y + dy, z + dz, leaf);
      }
    }
    for (let dy = 0; dy < h; dy++) set(x, y + dy, z, log, true);
  } else if (kind === 'bush') {
    set(x, y, z, B.oak_log, true);
    blob(x, y + 0.5, z, 2.2, 1.4, 2.2, B.oak_leaves, 0.2);
  } else if (kind === 'fancy') {
    const h = 7 + Math.floor(rnd() * 4);
    for (let dy = 0; dy < h; dy++) set(x, y + dy, z, B.oak_log, true);
    blob(x, y + h, z, 2.6, 2.0, 2.6, B.oak_leaves);
    const branches = 2 + Math.floor(rnd() * 3);
    for (let b = 0; b < branches; b++) {
      const a = rnd() * Math.PI * 2, len = 2 + rnd() * 2.2, by = y + Math.floor(h * (0.45 + rnd() * 0.35));
      let px = x, pz = z, py = by;
      for (let s = 1; s <= len; s++) {
        px = x + Math.cos(a) * s; pz = z + Math.sin(a) * s; py = by + s * 0.5;
        const ax = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? B.oak_log_x : B.oak_log_z;
        set(Math.round(px), Math.round(py), Math.round(pz), ax, true);
      }
      blob(px, py + 1, pz, 2.2, 1.6, 2.2, B.oak_leaves);
    }
  } else if (kind === 'spruce') {
    const h = 7 + Math.floor(rnd() * 5);
    let r = 1 + Math.floor(rnd() * 2);
    const start = 2 + Math.floor(rnd() * 2);
    let up = true;
    for (let dy = h; dy >= start; dy--) {
      const rr = dy === h ? 0 : dy === h - 1 ? 1 : up ? Math.min(r, 1) : r;
      for (let dz = -rr; dz <= rr; dz++) for (let dx = -rr; dx <= rr; dx++) {
        if (rr > 0 && Math.abs(dx) === rr && Math.abs(dz) === rr) continue;
        set(x + dx, y + dy, z + dz, B.spruce_leaves);
      }
      if (dy < h - 1) { up = !up; if (up) r = Math.min(3, r + 1); }
    }
    set(x, y + h + 1, z, B.spruce_leaves);
    for (let dy = 0; dy < h; dy++) set(x, y + dy, z, B.spruce_log, true);
  } else if (kind === 'cherry') {
    const trunk = 3 + Math.floor(rnd() * 2);
    for (let dy = 0; dy < trunk; dy++) set(x, y + dy, z, B.cherry_log, true);
    const arms = 2 + (rnd() < 0.35 ? 1 : 0);
    const a0 = rnd() * Math.PI * 2;
    for (let b = 0; b < arms; b++) {
      const a = a0 + (b / arms) * Math.PI * 2 + (rnd() - 0.5) * 0.6;
      const len = 2 + Math.floor(rnd() * 2);
      let px = x, pz = z, py = y + trunk - 1;
      for (let s = 1; s <= len; s++) {
        px = x + Math.round(Math.cos(a) * s); pz = z + Math.round(Math.sin(a) * s); py += 1;
        const ax = Math.abs(Math.cos(a)) > Math.abs(Math.sin(a)) ? B.cherry_log_x : B.cherry_log_z;
        set(px, py, pz, ax, true);
      }
      set(px, py + 1, pz, B.cherry_log, true);
      // wide, flat canopy
      blob(px, py + 2.2, pz, 3.6, 1.7, 3.6, B.cherry_leaves, 0.18);
      // hanging fringe
      for (let k = 0; k < 7; k++) {
        const ang = rnd() * Math.PI * 2, rr = 2 + rnd() * 1.5;
        set(Math.round(px + Math.cos(ang) * rr), py + 1, Math.round(pz + Math.sin(ang) * rr), B.cherry_leaves);
      }
    }
  } else if (kind === 'acacia') {
    const h = 4 + Math.floor(rnd() * 2);
    for (let dy = 0; dy < h; dy++) set(x, y + dy, z, B.acacia_log, true);
    const a = Math.floor(rnd() * 4);
    const ddx = [1, -1, 0, 0][a], ddz = [0, 0, 1, -1][a];
    let px = x, pz = z, py = y + h - 1;
    const bend = 2 + Math.floor(rnd() * 2);
    for (let s = 0; s < bend; s++) { px += ddx; pz += ddz; py += 1; set(px, py, pz, B.acacia_log, true); }
    for (let dz = -3; dz <= 3; dz++) for (let dx = -3; dx <= 3; dx++) {
      if (Math.abs(dx) + Math.abs(dz) > 4) continue;
      set(px + dx, py + 1, pz + dz, B.acacia_leaves);
    }
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) set(px + dx, py + 2, pz + dz, B.acacia_leaves);
    // second smaller crown
    if (rnd() < 0.6) {
      let qx = x, qz = z, qy = y + h - 2;
      for (let s = 0; s < 2; s++) { qx -= ddx; qz -= ddz; qy += 1; set(qx, qy, qz, B.acacia_log, true); }
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (Math.abs(dx) + Math.abs(dz) <= 3) set(qx + dx, qy + 1, qz + dz, B.acacia_leaves);
    }
  }
}

// ------------------------------------------------------------ light (column)
// Sky light: straight down from the top, then spread sideways inside the column.
// Block light: flood from emitters. Packed as sky<<4 | block.
export function computeColumnLight(blocks, light, heights) {
  const AREA = CS * CS;
  const QM = (1 << 17) - 1;
  const q = new Int32Array(QM + 1);
  let qh = 0, qt = 0;
  for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
    let level = 15;
    let hTop = 0;
    for (let y = H - 1; y >= 0; y--) {
      const i = (y * CS + z) * CS + x;
      const id = blocks[i];
      if (id && !hTop) hTop = y;
      if (level === 15 && LO[id] !== 0) level = 0; // direct sun stops at the first non-clear block
      light[i] = (level << 4) | (EMIT[id] & 15);
    }
    if (heights) heights[z * CS + x] = hTop;
  }
  // seed: sky cells that can brighten a darker horizontal/below neighbour, plus emitters
  for (let i = 0; i < blocks.length; i++) {
    const L = light[i];
    if (L === 0) continue;
    const s = L >> 4;
    if ((L & 15) > 1) { q[qt++ & QM] = i; continue; }
    if (s < 2) continue;
    const x = i & 15, z = (i >> 4) & 15;
    if ((x > 0 && (light[i - 1] >> 4) < s - 1 && LO[blocks[i - 1]] < 15) ||
        (x < 15 && (light[i + 1] >> 4) < s - 1 && LO[blocks[i + 1]] < 15) ||
        (z > 0 && (light[i - CS] >> 4) < s - 1 && LO[blocks[i - CS]] < 15) ||
        (z < 15 && (light[i + CS] >> 4) < s - 1 && LO[blocks[i + CS]] < 15) ||
        (i >= AREA && (light[i - AREA] >> 4) < s - 1 && LO[blocks[i - AREA]] < 15)) q[qt++ & QM] = i;
  }
  while (qh < qt) {
    const i = q[qh++ & QM];
    const L = light[i];
    const s = L >> 4, b = L & 15;
    const x = i & 15, z = (i >> 4) & 15;
    for (let d = 0; d < 6; d++) {
      let n;
      if (d === 0) { if (x === 15) continue; n = i + 1; }
      else if (d === 1) { if (x === 0) continue; n = i - 1; }
      else if (d === 2) { if (z === 15) continue; n = i + CS; }
      else if (d === 3) { if (z === 0) continue; n = i - CS; }
      else if (d === 4) { n = i + AREA; if (n >= light.length) continue; }
      else { n = i - AREA; if (n < 0) continue; }
      const lo = LO[blocks[n]];
      if (lo >= 15) continue;
      const nl = light[n];
      let ns = nl >> 4, nb = nl & 15, changed = false;
      const cs = s - 1 - lo;
      if (cs > ns) { ns = cs; changed = true; }
      const cb = b - 1 - lo;
      if (cb > nb) { nb = cb; changed = true; }
      if (changed) { light[n] = (ns << 4) | nb; if (qt - qh < QM) q[qt++ & QM] = n; }
    }
  }
}
