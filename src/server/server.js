// Authoritative game simulation. Runs in the host's tab (and in singleplayer).
// Remote clients send intents; the server owns mobs, items, block ticks, time and weather.
import { CS, H, SEA, DAY_TICKS, idx, colKey } from '../core/config.js';
import {
  B, BLOCKS, ITEMS, I, LIQUID, LEVEL, SOLID, OPAQUE, SHAPES, SHAPE, REPLACEABLE, blockDrops, blockItem, EMIT,
} from '../core/blocks.js';
import { stepBody, moveBody } from '../game/physics.js';
import { growTree, BIOMES, BI } from '../world/worldgen.js';
import { SMELT, fuelTicks } from '../game/inventory.js';
import { mulberry32 } from '../core/noise.js';
import { verityReply, verityIdle } from './verity.js';

const MOBS = {
  pig: { hp: 10, hw: 0.45, h: 0.9, speed: 1.7, passive: true, drops: [['raw_porkchop', 1, 3]] },
  cow: { hp: 10, hw: 0.45, h: 1.4, speed: 1.5, passive: true, drops: [['raw_beef', 1, 3]] },
  sheep: { hp: 8, hw: 0.45, h: 1.3, speed: 1.6, passive: true, drops: [['white_wool', 1, 1], ['raw_mutton', 1, 2]] },
  chicken: { hp: 4, hw: 0.2, h: 0.7, speed: 1.6, passive: true, drops: [['feather', 0, 2], ['raw_chicken', 1, 1]] },
  zombie: { hp: 20, hw: 0.3, h: 1.9, speed: 2.4, hostile: true, dmg: 3, burns: true, drops: [['rotten_flesh', 0, 2]], rare: [['iron_ingot', 0.03], ['carrot', 0]] },
  skeleton: { hp: 20, hw: 0.3, h: 1.95, speed: 2.3, hostile: true, ranged: true, burns: true, drops: [['bone', 0, 2], ['arrow', 0, 2]], rare: [['bow', 0.04]] },
  spider: { hp: 16, hw: 0.7, h: 0.9, speed: 3.2, hostile: true, dmg: 2, drops: [['string', 0, 2]], neutralDay: true },
  verity: { hp: 30, hw: 0.25, h: 1.05, speed: 6, companion: true, drops: [] },
  verity_demon: { hp: 60, hw: 0.4, h: 2.3, speed: 5.4, demon: true, dmg: 5, drops: [] },
};
export const MOB_KINDS = Object.keys(MOBS);
const ETYPE = { mob: 0, item: 1, arrow: 2, tnt: 3, falling: 4 };

const WATER_IDS = [B.water, B.water_1, B.water_2, B.water_3, B.water_4, B.water_5, B.water_6, B.water_7];
const LAVA_IDS = [B.lava, B.lava_1, B.lava_2, B.lava_3];
const liqIds = (l) => (l === 1 ? WATER_IDS : LAVA_IDS);
const liqFalling = (l) => (l === 1 ? B.water_falling : B.lava_falling);
const liqMax = (l) => (l === 1 ? 7 : 3);
function liqLevel(id) {
  const l = LIQUID[id];
  if (!l) return -1;
  if (id === B.water_falling || id === B.lava_falling) return 8;
  return liqIds(l).indexOf(id);
}

export class Server {
  constructor(world, meta) {
    this.world = world;
    this.meta = meta;          // { name, seed, gamemode, cheats, spawn, created }
    this.time = meta.time ?? 1000;
    this.dayCycle = meta.dayCycle ?? true;
    this.weather = meta.weather || { rain: 0, thunder: 0, timer: 6000 + Math.random() * 12000 };
    this.tick = 0;
    this.entities = new Map();
    this.nextEnt = 1;
    this.players = new Map();     // id -> { id, name, look, x,y,z, yaw, pitch, flags, held, gamemode, sleeping, alive, send }
    this.blockEntities = new Map(meta.blockEntities || []);
    this.viewers = new Map();      // beKey -> Set(playerId)
    this.scheduled = new Map();    // "x,y,z" -> due tick
    this.rnd = mulberry32((meta.seed ^ 0x5eed) >>> 0);
    this.pendingBlocks = [];
    this.lightningCd = 200;
    this.spawnCd = 20;
    this.onEvent = null;           // (event) local hook
    this.later = [];               // [tick, fn] delayed actions
    world.listeners.push((x, y, z, old, id, opts) => this.onBlockChanged(x, y, z, old, id, opts));
  }

  // ------------------------------------------------------------------ players & messaging
  addPlayer(p) {
    this.players.set(p.id, p);
    p.alive = true;
    this.broadcast({ t: 'pj', id: p.id, name: p.name, look: p.look }, p.id);
    this.chat(`§e${p.name} joined the game`);
  }
  removePlayer(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    for (const s of this.viewers.values()) s.delete(id);
    for (const e of this.entities.values()) if (e.owner === id && (e.kind === 'verity' || e.kind === 'verity_demon')) this.entities.delete(e.id);
    this.broadcast({ t: 'pq', id });
    this.chat(`§e${p.name} left the game`);
  }
  send(id, msg) { const p = this.players.get(id); if (p) p.send(msg); }
  broadcast(msg, except) {
    if (this.relay) {
      // one relayed copy for everyone remote, direct delivery for the local player
      for (const p of this.players.values()) if (p.local && p.id !== except) p.send(msg);
      this.relay.out(0, msg, except);
      return;
    }
    for (const p of this.players.values()) if (p.id !== except) p.send(msg);
  }
  protectedAt(x, z) {
    const s = this.meta.spawn;
    return !!(s && this.meta.protect && Math.abs(x - s[0]) <= this.meta.protect && Math.abs(z - s[2]) <= this.meta.protect);
  }
  chat(text, from) { this.broadcast({ t: 'chat', text, from }); }
  fx(msg, except) { this.broadcast({ t: 'fx', ...msg }, except); }

  welcome(p) {
    const edits = [];
    for (const [k, m] of this.world.edits) {
      const arr = [];
      for (const [i, id] of m) arr.push(i, id);
      edits.push([k, arr]);
    }
    const players = [...this.players.values()].filter(q => q.id !== p.id).map(q => ({ id: q.id, name: q.name, look: q.look }));
    return {
      t: 'welcome', id: p.id, seed: this.meta.seed, name: this.meta.name, time: this.time, dayCycle: this.dayCycle,
      weather: { rain: this.weather.rain, thunder: this.weather.thunder }, edits, players, spawn: this.meta.spawn,
      gamemode: this.meta.gamemode, cheats: this.meta.cheats, pvp: !!this.meta.pvp,
    };
  }

  receive(pid, m) {
    const p = this.players.get(pid);
    if (!p) return;
    switch (m.t) {
      case 'state':
        p.x = m.p[0]; p.y = m.p[1]; p.z = m.p[2]; p.yaw = m.r[0]; p.pitch = m.r[1]; p.flags = m.f; p.held = m.h;
        p.gamemode = m.g; p.alive = !m.dead; p.hp = m.hp;
        break;
      case 'set': this.playerSetBlock(p, m); break;
      case 'hit': this.hitEntity(p, m.e, m.d, m.kx, m.kz, m.gun); break;
      case 'gunfx': this.fx({ k: 'shot', snd: m.snd, a: m.a, b: m.b }, pid); break;
      case 'verity': this.placeVerity(p, m); break;
      case 'hitp': this.hitPlayer(p, m.e, m.d, m.kx, m.kz); break;
      case 'use': this.useEntity(p, m.e, m.item); break;
      case 'drop': this.spawnItem(m.item, m.p[0], m.p[1], m.p[2], m.v[0], m.v[1], m.v[2], 1.5); break;
      case 'pickup': {
        const e = this.entities.get(m.e);
        if (e && e.type === 'item' && e.pickupDelay <= 0) {
          this.entities.delete(m.e);
          this.send(pid, { t: 'give', item: e.item, from: m.e });
          this.fx({ k: 'pickup', e: m.e, to: pid });
        }
        break;
      }
      case 'shoot': this.spawnArrow(m.p, m.v, m.d, pid); break;
      case 'ignite': this.ignite(m.x, m.y, m.z); break;
      case 'openBE': {
        const key = m.x + ',' + m.y + ',' + m.z;
        let be = this.blockEntities.get(key);
        if (!be) { be = this.createBE(this.world.getBlock(m.x, m.y, m.z)); if (be) this.blockEntities.set(key, be); }
        if (!be) break;
        if (!this.viewers.has(key)) this.viewers.set(key, new Set());
        this.viewers.get(key).add(pid);
        this.send(pid, { t: 'be', key, data: be });
        break;
      }
      case 'beSet': {
        const be = this.blockEntities.get(m.key);
        if (!be) break;
        Object.assign(be, m.data);
        for (const v of this.viewers.get(m.key) || []) if (v !== pid) this.send(v, { t: 'be', key: m.key, data: be });
        break;
      }
      case 'closeBE': { const s = this.viewers.get(m.key); if (s) s.delete(pid); break; }
      case 'chat': {
        const text = String(m.text).slice(0, 200);
        this.chat(text, p.name);
        this.verityHears(p, text);
        break;
      }
      case 'sleep': p.sleeping = !!m.on; this.checkSleep(); break;
      case 'died': this.chat(`${p.name} ${m.msg}`); break;
      case 'setTime': if (this.meta.cheats || pid === this.hostId) { this.time = m.v; this.broadcast({ t: 'time', v: this.time }); } break;
      case 'setWeather': if (this.meta.cheats || pid === this.hostId) this.setWeather(m.rain, m.thunder, m.dur); break;
      case 'summon': if (this.meta.cheats || pid === this.hostId) this.spawnMob(m.kind, m.x, m.y, m.z); break;
      case 'ping': this.send(pid, { t: 'pong', s: m.s }); break;
      default: break;
    }
  }

  // ------------------------------------------------------------------ blocks
  setBlock(x, y, z, id, opts = {}) {
    const old = this.world.getBlock(x, y, z);
    if (old === id) return false;
    this.world.setBlock(x, y, z, id, opts);
    this.pendingBlocks.push(x, y, z, id);
    return true;
  }

  playerSetBlock(p, m) {
    const { x, y, z, id } = m;
    if (y < 0 || y >= H) return;
    const old = this.world.getBlock(x, y, z);
    if (this.protectedAt(x, z) && p.gamemode !== 'creative') { this.send(p.id, { t: 'bs', a: [x, y, z, old] }); return; }
    if (m.expect !== undefined && old !== m.expect && id !== 0) {
      // placement raced with another change: tell the client the truth
      this.send(p.id, { t: 'bs', a: [x, y, z, old] });
      return;
    }
    if (id === 0 && old !== 0) {
      if (old === B.bedrock && p.gamemode !== 'creative') { this.send(p.id, { t: 'bs', a: [x, y, z, old] }); return; }
      if (m.drop && p.gamemode !== 'creative') {
        for (const [it, n] of blockDrops(old, m.tool ?? null, this.rnd)) if (n > 0) this.spawnItem({ id: it, count: n, dmg: 0 }, x + 0.5, y + 0.4, z + 0.5);
      }
      this.fx({ k: 'break', x, y, z, id: old }, p.id);
    }
    this.setBlock(x, y, z, id, { by: p.id, immediate: !!p.local });
  }

  onBlockChanged(x, y, z, old, id, opts) {
    // block entities follow their blocks
    const key = x + ',' + y + ',' + z;
    const be = this.blockEntities.get(key);
    if (be && (!BLOCKS[id].be || BLOCKS[id].be !== be.kind)) {
      this.blockEntities.delete(key);
      const items = be.kind === 'chest' ? be.items : be.kind === 'furnace' ? [be.in, be.fuel, be.out] : [];
      for (const s of items) if (s) this.spawnItem({ id: s[0], count: s[1], dmg: s[2] || 0 }, x + 0.5, y + 0.5, z + 0.5);
      for (const v of this.viewers.get(key) || []) this.send(v, { t: 'beGone', key });
      this.viewers.delete(key);
    }
    if (BLOCKS[id].be && !this.blockEntities.has(key)) this.blockEntities.set(key, this.createBE(id));
    // neighbour updates
    this.scheduleAround(x, y, z, 1);
    if (LIQUID[id]) this.schedule(x, y, z, LIQUID[id] === 1 ? 5 : 30);
    if (old === B.tnt && id === 0 && opts && opts.ignite) this.ignite(x, y, z);
  }

  schedule(x, y, z, delay) {
    const k = x + ',' + y + ',' + z;
    const due = this.tick + delay;
    const cur = this.scheduled.get(k);
    if (cur === undefined || cur > due) this.scheduled.set(k, due);
  }
  scheduleAround(x, y, z, delay) {
    this.schedule(x, y, z, delay);
    this.schedule(x + 1, y, z, delay); this.schedule(x - 1, y, z, delay);
    this.schedule(x, y + 1, z, delay); this.schedule(x, y - 1, z, delay);
    this.schedule(x, y, z + 1, delay); this.schedule(x, y, z - 1, delay);
  }

  blockUpdate(x, y, z) {
    const w = this.world;
    if (!w.isLoaded(x, z)) return;
    const id = w.getBlock(x, y, z);
    if (id === 0) return;
    const def = BLOCKS[id];
    if (LIQUID[id]) { this.liquidUpdate(x, y, z, id); return; }
    const below = w.getBlock(x, y - 1, z);
    if (def.gravity && (below === 0 || LIQUID[below] || REPLACEABLE[below])) {
      this.setBlock(x, y, z, 0);
      this.spawnFalling(id, x, y, z);
      return;
    }
    if (!this.supported(x, y, z, id, below)) {
      this.setBlock(x, y, z, 0);
      for (const [it, n] of blockDrops(id, null, this.rnd)) if (n > 0) this.spawnItem({ id: it, count: n, dmg: 0 }, x + 0.5, y + 0.3, z + 0.5);
      this.fx({ k: 'break', x, y, z, id });
      return;
    }
    if (id === B.grass && OPAQUE[w.getBlock(x, y + 1, z)]) this.setBlock(x, y, z, B.dirt);
    if ((id === B.farmland || id === B.farmland_wet) && OPAQUE[w.getBlock(x, y + 1, z)]) this.setBlock(x, y, z, B.dirt);
  }

  supported(x, y, z, id, below) {
    const def = BLOCKS[id];
    const w = this.world;
    const solidBelow = SOLID[below] && !LIQUID[below];
    if (id === B.torch || id === B.lantern || id === B.snow_layer || id === B.bed) return solidBelow;
    if (def.torch) {
      const off = { [B.wall_torch_n]: [0, -1], [B.wall_torch_s]: [0, 1], [B.wall_torch_e]: [1, 0], [B.wall_torch_w]: [-1, 0] }[id];
      return off ? SOLID[w.getBlock(x + off[0], y, z + off[1])] === 1 : true;
    }
    if (def.crop !== undefined) return below === B.farmland || below === B.farmland_wet;
    if (id === B.sugar_cane) return below === B.sugar_cane || below === B.grass || below === B.dirt || below === B.sand || below === B.podzol;
    if (id === B.cactus) return below === B.cactus || below === B.sand;
    if (id === B.dead_bush) return below === B.sand || below === B.dirt || below === B.coarse_dirt || below === B.grass || below === B.podzol;
    if (id === B.glow_mushroom || id === B.red_mushroom || id === B.brown_mushroom || id === B.crystal_cluster) return solidBelow || id === B.crystal_cluster;
    if (SHAPES[id] === SHAPE.CROSS) return below === B.grass || below === B.dirt || below === B.podzol || below === B.coarse_dirt || below === B.farmland || below === B.farmland_wet || below === B.moss_block;
    return true;
  }

  liquidUpdate(x, y, z, id) {
    const w = this.world;
    const l = LIQUID[id];
    const ids = liqIds(l), max = liqMax(l);
    let level = liqLevel(id);
    // lava meets water
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
      const n = w.getBlock(x + dx, y + dy, z + dz);
      if (l === 2 && LIQUID[n] === 1) {
        this.setBlock(x, y, z, level === 0 ? B.obsidian : B.cobblestone);
        this.fx({ k: 'fizz', x, y, z });
        return;
      }
    }
    // recompute non-source levels
    if (level !== 0) {
      const above = w.getBlock(x, y + 1, z);
      let want;
      if (LIQUID[above] === l) want = 8;
      else {
        let best = 99, sources = 0;
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const n = w.getBlock(x + dx, y, z + dz);
          if (LIQUID[n] !== l) continue;
          const nl = liqLevel(n);
          if (nl === 0) sources++;
          const cand = (nl === 0 || nl === 8) ? 1 : nl + 1;
          if (cand < best) best = cand;
        }
        const below = w.getBlock(x, y - 1, z);
        if (l === 1 && sources >= 2 && (SOLID[below] || liqLevel(below) === 0)) want = 0;
        else want = best <= max ? best : -1;
      }
      if (want !== level) {
        const nid = want < 0 ? 0 : want === 8 ? liqFalling(l) : ids[want];
        this.setBlock(x, y, z, nid);
        if (nid === 0) return;
        level = want;
      }
    }
    // spread: straight down first
    const belowId = w.getBlock(x, y - 1, z);
    const canDown = y > 0 && (belowId === 0 || (REPLACEABLE[belowId] && !LIQUID[belowId]) || (LIQUID[belowId] === l && liqLevel(belowId) !== 0 && liqLevel(belowId) !== 8));
    if (canDown) {
      if (REPLACEABLE[belowId] && belowId !== 0 && !LIQUID[belowId]) this.breakForLiquid(x, y - 1, z, belowId);
      this.setBlock(x, y - 1, z, liqFalling(l));
      return;
    } else if (LIQUID[belowId] === 2 && l === 1) {
      this.setBlock(x, y - 1, z, liqLevel(belowId) === 0 ? B.obsidian : B.cobblestone);
      return;
    }
    // resting on the same liquid (a lake, a waterfall's pool): don't spread across its surface
    if (LIQUID[belowId] === l) return;
    if (!SOLID[belowId] && !LIQUID[belowId]) return;
    const next = (level === 0 || level === 8) ? 1 : level + 1;
    if (next > max) return;
    // Minecraft-style: only flow toward the nearest drop within 4 blocks; if there is none, spread evenly
    const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const passable = (bx, by, bz) => {
      const b = w.getBlock(bx, by, bz);
      return b === 0 || (REPLACEABLE[b] && !LIQUID[b]) || (LIQUID[b] === l && liqLevel(b) !== 0);
    };
    const dropAt = (bx, by, bz) => {
      const b = w.getBlock(bx, by - 1, bz);
      return b === 0 || (REPLACEABLE[b] && !LIQUID[b]) || (LIQUID[b] === l && liqLevel(b) !== 0 && liqLevel(b) !== 8);
    };
    const slope = (bx, bz, from, depth) => {
      if (depth > 4) return 1000;
      let best = 1000;
      for (let d = 0; d < 4; d++) {
        if (d === (from ^ 1)) continue;
        const qx = bx + DIRS[d][0], qz = bz + DIRS[d][1];
        if (!passable(qx, y, qz)) continue;
        if (dropAt(qx, y, qz)) return depth;
        best = Math.min(best, slope(qx, qz, d, depth + 1));
      }
      return best;
    };
    const dist = [1000, 1000, 1000, 1000];
    let best = 1000;
    for (let d = 0; d < 4; d++) {
      const nx = x + DIRS[d][0], nz = z + DIRS[d][1];
      if (!passable(nx, y, nz)) continue;
      dist[d] = dropAt(nx, y, nz) ? 0 : slope(nx, nz, d, 1);
      best = Math.min(best, dist[d]);
    }
    for (let d = 0; d < 4; d++) {
      const nx = x + DIRS[d][0], nz = z + DIRS[d][1];
      const n = w.getBlock(nx, y, nz);
      if (LIQUID[n] && LIQUID[n] !== l) { this.schedule(nx, y, nz, 2); continue; }
      if (dist[d] !== best || (best === 1000 && !passable(nx, y, nz))) continue;
      if (n === 0 || (REPLACEABLE[n] && !LIQUID[n])) {
        if (n) this.breakForLiquid(nx, y, nz, n);
        this.setBlock(nx, y, nz, ids[next]);
      } else if (LIQUID[n] === l) {
        const nl = liqLevel(n);
        if (nl > next && nl !== 8) this.setBlock(nx, y, nz, ids[next]);
      }
    }
  }
  breakForLiquid(x, y, z, id) {
    if (BLOCKS[id].crop !== undefined || SHAPES[id] === SHAPE.CROSS || BLOCKS[id].torch) {
      for (const [it, n] of blockDrops(id, null, this.rnd)) if (n > 0) this.spawnItem({ id: it, count: n, dmg: 0 }, x + 0.5, y + 0.3, z + 0.5);
    }
  }

  randomTicks() {
    const w = this.world;
    const seen = new Set();
    for (const p of this.players.values()) {
      const pcx = Math.floor(p.x / CS), pcz = Math.floor(p.z / CS);
      for (let dz = -4; dz <= 4; dz++) for (let dx = -4; dx <= 4; dx++) {
        const cx = pcx + dx, cz = pcz + dz;
        const k = colKey(cx, cz);
        if (seen.has(k)) continue;
        seen.add(k);
        const c = w.columns.get(k);
        if (!c) continue;
        for (let sy = 0; sy < 12; sy++) {
          if (!c.counts[sy]) continue;
          for (let n = 0; n < 3; n++) {
            const r = (this.rnd() * 4096) | 0;
            const lx = r & 15, lz = (r >> 4) & 15, ly = (r >> 8) & 15;
            const y = sy * 16 + ly;
            const id = c.blocks[idx(lx, y, lz)];
            if (!id) continue;
            this.randomTick(cx * CS + lx, y, cz * CS + lz, id, c);
          }
        }
      }
    }
  }

  randomTick(x, y, z, id, col) {
    const w = this.world;
    const def = BLOCKS[id];
    const lightAt = (yy) => { const L = w.getLight(x, yy, z); return Math.max(L & 15, (L >> 4) * this.skyFactor()); };
    if (id === B.dirt) {
      if (OPAQUE[w.getBlock(x, y + 1, z)] || lightAt(y + 1) < 9) return;
      for (let i = 0; i < 4; i++) {
        const nx = x + ((this.rnd() * 3) | 0) - 1, ny = y + ((this.rnd() * 5) | 0) - 3, nz = z + ((this.rnd() * 3) | 0) - 1;
        if (w.getBlock(nx, ny, nz) === B.grass) { this.setBlock(x, y, z, B.grass); return; }
      }
    } else if (id === B.grass) {
      const a = w.getBlock(x, y + 1, z);
      if (OPAQUE[a] || LIQUID[a]) this.setBlock(x, y, z, B.dirt);
    } else if (def.sapling) {
      if (lightAt(y + 1) >= 9 && this.rnd() < 0.15) this.growSapling(x, y, z, def.sapling);
    } else if (def.crop !== undefined) {
      if (def.crop < 7 && lightAt(y + 1) >= 9) {
        const wet = w.getBlock(x, y - 1, z) === B.farmland_wet;
        if (this.rnd() < (wet ? 0.35 : 0.15)) this.setBlock(x, y, z, B['wheat_' + (def.crop + 1)]);
      }
    } else if (id === B.farmland || id === B.farmland_wet) {
      let water = false;
      for (let dz = -4; dz <= 4 && !water; dz++) for (let dx = -4; dx <= 4 && !water; dx++) for (let dy = 0; dy <= 1; dy++) if (LIQUID[w.getBlock(x + dx, y + dy, z + dz)] === 1) { water = true; break; }
      if (!water && this.weather.rain > 0.5 && w.heightAt(x, z) <= y + 1) water = true;
      if (water && id === B.farmland) this.setBlock(x, y, z, B.farmland_wet);
      else if (!water && id === B.farmland_wet) this.setBlock(x, y, z, B.farmland);
      else if (!water && id === B.farmland && BLOCKS[w.getBlock(x, y + 1, z)].crop === undefined && this.rnd() < 0.1) this.setBlock(x, y, z, B.dirt);
    } else if (id === B.sugar_cane || id === B.cactus) {
      if (w.getBlock(x, y + 1, z) !== 0) return;
      let hgt = 1; while (w.getBlock(x, y - hgt, z) === id) hgt++;
      if (hgt < 3 && this.rnd() < 0.2) this.setBlock(x, y + 1, z, id);
    } else if (def.leaves && !def.persistent) {
      if (!this.nearLog(x, y, z)) {
        this.setBlock(x, y, z, 0);
        for (const [it, n] of blockDrops(id, null, this.rnd)) if (n > 0) this.spawnItem({ id: it, count: n, dmg: 0 }, x + 0.5, y + 0.3, z + 0.5);
      }
    } else if (id === B.ice && (w.getLight(x, y, z) & 15) > 11) {
      this.setBlock(x, y, z, B.water);
    } else if (id === B.snow_layer && (w.getLight(x, y, z) & 15) > 11) {
      this.setBlock(x, y, z, 0);
    }
    // snow accumulates during snowfall in cold biomes
    if (this.weather.rain > 0.5 && this.rnd() < 0.02 && BIOMES[w.biomeAt(x, z)].snow) {
      const top = w.heightAt(x, z);
      if (top === y && OPAQUE[id] && w.getBlock(x, y + 1, z) === 0) this.setBlock(x, y + 1, z, B.snow_layer);
    }
    void col;
  }

  nearLog(x, y, z) {
    const w = this.world;
    const seen = new Set([x + ',' + y + ',' + z]);
    let frontier = [[x, y, z]];
    for (let d = 0; d < 5; d++) {
      const next = [];
      for (const [px, py, pz] of frontier) {
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const nx = px + dx, ny = py + dy, nz = pz + dz;
          const k = nx + ',' + ny + ',' + nz;
          if (seen.has(k)) continue;
          seen.add(k);
          const id = w.getBlock(nx, ny, nz);
          if (BLOCKS[id].tag === 'log') return true;
          if (!w.isLoaded(nx, nz)) return true;
          if (BLOCKS[id].leaves) next.push([nx, ny, nz]);
        }
      }
      frontier = next;
    }
    return false;
  }

  growSapling(x, y, z, wood) {
    const w = this.world;
    // need room
    for (let dy = 1; dy < 6; dy++) if (w.getBlock(x, y + dy, z) !== 0 && !BLOCKS[w.getBlock(x, y + dy, z)].leaves) return false;
    this.setBlock(x, y, z, 0);
    const kind = { oak: this.rnd() < 0.1 ? 'fancy' : 'oak', birch: 'birch', spruce: 'spruce', cherry: 'cherry', acacia: 'acacia' }[wood];
    const set = (bx, by, bz, id, force) => {
      if (by < 1 || by >= H - 1) return;
      const cur = w.getBlock(bx, by, bz);
      if (cur === 0 || REPLACEABLE[cur] || (force && BLOCKS[cur].leaves) || (bx === x && by === y && bz === z)) this.setBlock(bx, by, bz, id);
    };
    growTree(kind, x, y, z, this.rnd, set);
    return true;
  }

  // ------------------------------------------------------------------ block entities
  createBE(id) {
    const be = BLOCKS[id].be;
    if (be === 'chest') return { kind: 'chest', items: new Array(27).fill(0) };
    if (be === 'furnace') return { kind: 'furnace', in: 0, fuel: 0, out: 0, burn: 0, burnMax: 0, cook: 0 };
    return null;
  }

  tickFurnaces() {
    for (const [key, be] of this.blockEntities) {
      if (be.kind !== 'furnace') continue;
      const before = be.burn > 0;
      const out = be.in ? SMELT.get(be.in[0]) : undefined;
      const canSmelt = out !== undefined && (!be.out || (be.out[0] === out && be.out[1] < (ITEMS[out].stack || 64)));
      if (be.burn > 0) be.burn--;
      if (be.burn <= 0 && canSmelt && be.fuel) {
        const ft = fuelTicks(be.fuel[0]);
        if (ft > 0) {
          be.burn = be.burnMax = ft;
          if (be.fuel[0] === I.lava_bucket) be.fuel = [I.bucket, 1, 0];
          else { be.fuel[1]--; if (be.fuel[1] <= 0) be.fuel = 0; }
        }
      }
      let changed = false;
      if (be.burn > 0 && canSmelt) {
        be.cook++;
        if (be.cook >= 200) {
          be.cook = 0;
          be.in[1]--; if (be.in[1] <= 0) be.in = 0;
          if (be.out) be.out[1]++; else be.out = [out, 1, 0];
          changed = true;
        }
      } else if (be.cook > 0) be.cook = Math.max(0, be.cook - 2);
      const after = be.burn > 0;
      if (before !== after) {
        const [x, y, z] = key.split(',').map(Number);
        const id = this.world.getBlock(x, y, z);
        const off = after ? id - B.furnace : id - B.furnace_lit;
        if (after && id >= B.furnace && id < B.furnace + 4) this.setBlock(x, y, z, B.furnace_lit + off);
        if (!after && id >= B.furnace_lit && id < B.furnace_lit + 4) this.setBlock(x, y, z, B.furnace + off);
        changed = true;
      }
      const vs = this.viewers.get(key);
      if (vs && vs.size && (changed || this.tick % 4 === 0)) for (const v of vs) this.send(v, { t: 'be', key, data: be });
    }
  }

  // ------------------------------------------------------------------ entities
  newEnt(e) { e.id = this.nextEnt++; this.entities.set(e.id, e); return e; }

  spawnItem(item, x, y, z, vx, vy, vz, delay = 0.4) {
    if (!item || !item.count) return null;
    return this.newEnt({
      type: 'item', item: { id: item.id, count: item.count, dmg: item.dmg || 0 }, x, y, z,
      vx: vx ?? (this.rnd() - 0.5) * 2.5, vy: vy ?? 3.5, vz: vz ?? (this.rnd() - 0.5) * 2.5,
      hw: 0.125, h: 0.25, onGround: false, age: 0, pickupDelay: delay,
    });
  }
  spawnFalling(id, x, y, z) { return this.newEnt({ type: 'falling', block: id, x: x + 0.5, y, z: z + 0.5, vx: 0, vy: 0, vz: 0, hw: 0.49, h: 0.98, onGround: false, age: 0 }); }
  spawnArrow(p, v, dmg, owner) { return this.newEnt({ type: 'arrow', x: p[0], y: p[1], z: p[2], vx: v[0], vy: v[1], vz: v[2], dmg, owner, age: 0, stuck: false, hw: 0.1, h: 0.1 }); }
  spawnMob(kind, x, y, z) {
    const d = MOBS[kind];
    if (!d) return null;
    return this.newEnt({
      type: 'mob', kind, x, y, z, vx: 0, vy: 0, vz: 0, yaw: this.rnd() * Math.PI * 2, headYaw: 0, pitch: 0,
      hw: d.hw, h: d.h, onGround: false, health: d.hp, hurt: 0, ai: 'idle', aiT: this.rnd() * 3, target: null,
      tx: x, tz: z, attackCd: 0, shootCd: 2, panic: 0, age: 0, burn: 0, walk: 0, flap: 0, sheared: 0, jumpCd: 0,
    });
  }
  ignite(x, y, z, fuse = 4) {
    if (this.world.getBlock(x, y, z) === B.tnt) this.setBlock(x, y, z, 0);
    this.newEnt({ type: 'tnt', x: x + 0.5, y, z: z + 0.5, vx: (this.rnd() - 0.5) * 1, vy: 3, vz: (this.rnd() - 0.5) * 1, hw: 0.49, h: 0.98, onGround: false, fuse, age: 0 });
    this.fx({ k: 'fuse', x, y, z });
  }

  hitEntity(p, eid, dmg, kx, kz, gun) {
    const e = this.entities.get(eid);
    if (!e) return;
    if (e.type === 'tnt' || e.type === 'arrow') return;
    if (e.type === 'item') return;
    if (!gun && e.hurt > 0.35) return;
    if (e.kind === 'verity' && e.owner === p.id) { e.unease += 15; this.veritySay(e, p, ['Why did you hit me?', 'Ow. I will remember that.', "Don't do that again."][Math.floor(this.rnd() * 3)]); }
    this.damageMob(e, Math.min(40, dmg), kx, kz, p, gun ? 0.15 : 1);
  }
  hitPlayer(p, targetId, dmg, kx, kz) {
    if (!this.meta.pvp) return;
    const t = this.players.get(targetId);
    if (!t) return;
    this.send(targetId, { t: 'hurt', amt: dmg, kb: [kx * 6, 4.5, kz * 6], cause: 'player', by: p.name });
  }
  damageMob(e, dmg, kx = 0, kz = 0, attacker = null, kbs = 1) {
    e.health -= dmg;
    e.hurt = 0.5;
    const l = Math.hypot(kx, kz) || 1;
    e.vx += (kx / l) * 7 * kbs; e.vz += (kz / l) * 7 * kbs; e.vy = Math.max(e.vy, 5 * kbs);
    const d = MOBS[e.kind];
    if (d.companion || d.demon) {
      this.fx({ k: 'mobhurt', e: e.id, kind: e.kind });
      if (e.health > 0) return;
      const owner = this.players.get(e.owner);
      if (d.demon) { this.verityCalm(e, true); return; }
      // Verity faints back into her owner's pocket
      this.entities.delete(e.id);
      this.fx({ k: 'mobdie', e: e.id, kind: e.kind, x: e.x, y: e.y, z: e.z });
      if (owner) { this.send(owner.id, { t: 'give', item: { id: I.verity, count: 1, dmg: 0 }, from: e.id }); this.send(owner.id, { t: 'chat', text: '§dVerity is hurt. She crawled back into your pocket.' }); }
      return;
    }
    if (d.passive) { e.panic = 4; e.ai = 'panic'; }
    else if (attacker) e.target = attacker.id;
    this.fx({ k: 'mobhurt', e: e.id, kind: e.kind });
    if (e.health <= 0) {
      this.entities.delete(e.id);
      for (const [name, a, b] of d.drops) {
        const n = a + Math.floor(this.rnd() * (b - a + 1));
        if (n > 0 && I[name] !== undefined) this.spawnItem({ id: I[name], count: n, dmg: 0 }, e.x, e.y + 0.5, e.z);
      }
      for (const [name, chance] of d.rare || []) if (I[name] !== undefined && this.rnd() < chance) this.spawnItem({ id: I[name], count: 1, dmg: 0 }, e.x, e.y + 0.5, e.z);
      this.fx({ k: 'mobdie', e: e.id, kind: e.kind, x: e.x, y: e.y, z: e.z });
    }
  }
  useEntity(p, eid, item) {
    const e = this.entities.get(eid);
    if (!e || e.type !== 'mob') return;
    if (e.kind === 'verity') {
      if (e.owner !== p.id) { this.send(p.id, { t: 'chat', text: `§dVerity: I'm not yours.` }); return; }
      this.entities.delete(eid);
      this.send(p.id, { t: 'give', item: { id: I.verity, count: 1, dmg: 0 }, from: eid });
      this.fx({ k: 'pickup', e: eid, to: p.id });
      return;
    }
    if (e.kind === 'sheep' && item === I.shears && e.sheared <= 0) {
      e.sheared = 120;
      this.spawnItem({ id: I.white_wool, count: 1 + Math.floor(this.rnd() * 3), dmg: 0 }, e.x, e.y + 1, e.z);
      this.fx({ k: 'shear', e: eid });
    }
  }

  explode(x, y, z, power = 4) {
    const w = this.world;
    const r = power;
    const removed = [];
    for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > r * (0.7 + this.rnd() * 0.4)) continue;
      const bx = Math.floor(x + dx), by = Math.floor(y + dy), bz = Math.floor(z + dz);
      const id = w.getBlock(bx, by, bz);
      if (!id || LIQUID[id]) continue;
      const def = BLOCKS[id];
      if (def.hardness < 0 || def.hardness >= 30) continue;
      if (id === B.tnt) { this.ignite(bx, by, bz, 0.5 + this.rnd()); continue; }
      removed.push([bx, by, bz, id]);
    }
    for (const [bx, by, bz, id] of removed) {
      this.setBlock(bx, by, bz, 0);
      if (this.rnd() < 0.3) for (const [it, n] of blockDrops(id, I.diamond_pickaxe, this.rnd)) if (n > 0) this.spawnItem({ id: it, count: n, dmg: 0 }, bx + 0.5, by + 0.5, bz + 0.5);
    }
    // entities
    for (const e of this.entities.values()) {
      if (e.type !== 'mob' && e.type !== 'item' && e.type !== 'tnt') continue;
      const d = Math.hypot(e.x - x, e.y + 0.5 - y, e.z - z);
      if (d > r * 2) continue;
      const k = 1 - d / (r * 2);
      const dx = (e.x - x) / (d || 1), dy = (e.y + 0.5 - y) / (d || 1), dz = (e.z - z) / (d || 1);
      e.vx += dx * k * 16; e.vy += dy * k * 12 + 4 * k; e.vz += dz * k * 16;
      if (e.type === 'mob') this.damageMob(e, Math.round(k * 22), dx, dz);
    }
    for (const p of this.players.values()) {
      const d = Math.hypot(p.x - x, p.y + 0.9 - y, p.z - z);
      if (d > r * 2) continue;
      const k = 1 - d / (r * 2);
      const dx = (p.x - x) / (d || 1), dz = (p.z - z) / (d || 1);
      this.send(p.id, { t: 'hurt', amt: Math.round(k * 24), kb: [dx * k * 18, 4 + k * 10, dz * k * 18], cause: 'explosion' });
    }
    this.fx({ k: 'explode', x, y, z, r });
  }

  // nearest living, non-creative player within range
  nearestTarget(e, range) {
    let best = null, bd = range * range;
    for (const p of this.players.values()) {
      if (!p.alive || p.gamemode === 'creative') continue;
      const d = (p.x - e.x) ** 2 + (p.y - e.y) ** 2 + (p.z - e.z) ** 2;
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }
  nearestPlayerDist(x, y, z) {
    let bd = Infinity;
    for (const p of this.players.values()) bd = Math.min(bd, Math.hypot(p.x - x, p.y - y, p.z - z));
    return bd;
  }

  canSee(e, p) {
    const ox = e.x, oy = e.y + e.h * 0.85, oz = e.z;
    const dx = p.x - ox, dy = p.y + 1.5 - oy, dz = p.z - oz;
    const d = Math.hypot(dx, dy, dz);
    const hit = this.world.raycast({ x: ox, y: oy, z: oz }, { x: dx / d, y: dy / d, z: dz / d }, d);
    return !hit;
  }

  updateMob(e, dt) {
    if (e.kind === 'verity' || e.kind === 'verity_demon') { this.updateVerity(e, dt); return; }
    const d = MOBS[e.kind];
    const w = this.world;
    e.age += dt;
    if (e.hurt > 0) e.hurt -= dt;
    if (e.attackCd > 0) e.attackCd -= dt;
    if (e.jumpCd > 0) e.jumpCd -= dt;
    if (e.sheared > 0) e.sheared -= dt;
    let speed = 0, tx = e.x, tz = e.z;
    const day = this.skyFactor() > 0.7;
    if (d.hostile) {
      let tgt = e.target ? this.players.get(e.target) : null;
      if (tgt && (!tgt.alive || tgt.gamemode === 'creative' || Math.hypot(tgt.x - e.x, tgt.z - e.z) > 28)) tgt = null;
      if (!tgt && (!d.neutralDay || !day)) {
        const n = this.nearestTarget(e, 16);
        if (n && (this.tick + e.id) % 10 === 0 && this.canSee(e, n)) tgt = n;
      }
      e.target = tgt ? tgt.id : null;
      if (tgt) {
        const dist = Math.hypot(tgt.x - e.x, tgt.z - e.z);
        const dy = tgt.y - e.y;
        e.yawTarget = Math.atan2(-(tgt.x - e.x), -(tgt.z - e.z));
        e.pitch = -Math.atan2(dy + 1.2 - e.h * 0.85, dist) * 0.8;
        if (d.ranged) {
          e.shootCd -= dt;
          if (dist > 7) { speed = d.speed; tx = tgt.x; tz = tgt.z; }
          else if (dist < 4) { speed = d.speed; tx = e.x - (tgt.x - e.x); tz = e.z - (tgt.z - e.z); }
          if (e.shootCd <= 0 && dist < 15 && this.canSee(e, tgt)) {
            e.shootCd = 1.4 + this.rnd() * 1.2;
            const ox = e.x, oy = e.y + 1.5, oz = e.z;
            const tt = dist / 22;
            const ax = tgt.x - ox, az = tgt.z - oz, ay = tgt.y + 1.2 - oy + 0.5 * 20 * tt * tt;
            const l = Math.hypot(ax, ay, az);
            const sp = 22, err = 0.06;
            this.spawnArrow([ox, oy, oz], [ax / l * sp + (this.rnd() - 0.5) * err * sp, ay / l * sp + (this.rnd() - 0.5) * err * sp, az / l * sp + (this.rnd() - 0.5) * err * sp], 3, -e.id);
            this.fx({ k: 'bow', x: ox, y: oy, z: oz });
          }
        } else {
          speed = d.speed * (e.kind === 'spider' ? 1 : 1);
          tx = tgt.x; tz = tgt.z;
          if (dist < (e.kind === 'spider' ? 1.5 : 1.25) && Math.abs(dy) < 1.8 && e.attackCd <= 0) {
            e.attackCd = 1;
            const kx = (tgt.x - e.x) / (dist || 1), kz = (tgt.z - e.z) / (dist || 1);
            this.send(tgt.id, { t: 'hurt', amt: d.dmg, kb: [kx * 6, 4.5, kz * 6], cause: e.kind });
            e.swing = 0.3;
          }
          if (e.kind === 'spider' && dist < 5 && dist > 2 && e.onGround && e.jumpCd <= 0) {
            e.jumpCd = 1.5; e.vy = 7; const l = dist || 1; e.vx += (tgt.x - e.x) / l * 5; e.vz += (tgt.z - e.z) / l * 5;
          }
        }
      } else this.wander(e, dt, 0.8);
      if (!tgt) { speed = e.wanderSpeed || 0; tx = e.tx; tz = e.tz; }
      // burn in daylight
      if (d.burns && day && this.weather.rain < 0.5 && !e.inLiquid) {
        const L = w.getLight(Math.floor(e.x), Math.floor(e.y + e.h - 0.2), Math.floor(e.z));
        if ((L >> 4) >= 15) { e.burn = 3; }
      }
      if (e.burn > 0) {
        e.burn -= dt;
        e.burnT = (e.burnT || 0) + dt;
        if (e.burnT > 1) { e.burnT = 0; this.damageMob(e, 1); }
        if (e.inLiquid === 1) e.burn = 0;
      }
    } else {
      if (e.panic > 0) {
        e.panic -= dt;
        if (e.aiT <= 0 || Math.hypot(e.tx - e.x, e.tz - e.z) < 1) { e.aiT = 1; const a = this.rnd() * Math.PI * 2; e.tx = e.x + Math.cos(a) * 8; e.tz = e.z + Math.sin(a) * 8; }
        e.aiT -= dt;
        speed = d.speed * 2.1; tx = e.tx; tz = e.tz;
      } else {
        // follow players holding wheat / seeds
        let lure = null;
        for (const p of this.players.values()) {
          const want = e.kind === 'chicken' ? I.seeds : I.wheat;
          if (p.held === want && Math.hypot(p.x - e.x, p.z - e.z) < 8) lure = p;
        }
        if (lure) {
          const dist = Math.hypot(lure.x - e.x, lure.z - e.z);
          tx = lure.x; tz = lure.z; speed = dist > 2 ? d.speed * 1.1 : 0;
          e.yawTarget = Math.atan2(-(lure.x - e.x), -(lure.z - e.z));
        } else {
          this.wander(e, dt, 1);
          speed = e.wanderSpeed || 0; tx = e.tx; tz = e.tz;
        }
      }
    }
    // steering
    let dx = tx - e.x, dz = tz - e.z;
    const dl = Math.hypot(dx, dz);
    if (dl < 0.3) speed = 0;
    if (speed > 0) {
      dx /= dl; dz /= dl;
      // don't walk off cliffs or into lava
      const ahead = this.dropAhead(e, dx, dz);
      if (ahead > 3 || ahead < 0) { speed = 0; e.aiT = 0; }
      const yawT = Math.atan2(-dx, -dz);
      if (e.yawTarget === undefined || !e.target) e.yawTarget = yawT;
    }
    if (e.yawTarget !== undefined) {
      let dy = e.yawTarget - e.yaw;
      while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
      e.yaw += dy * Math.min(1, dt * 8);
    }
    const ctrl = e.onGround ? 1 : e.inLiquid ? 0.6 : 0.25;
    const tvx = speed * dx, tvz = speed * dz;
    if (speed > 0 || e.onGround) {
      e.vx += (tvx - e.vx) * Math.min(1, dt * 10 * ctrl);
      e.vz += (tvz - e.vz) * Math.min(1, dt * 10 * ctrl);
    }
    if (e.inLiquid) { e.vy += 22 * dt; if (e.vy > 2.4) e.vy = 2.4; }
    const r = stepBody(w, e, dt, { gravity: e.kind === 'chicken' && e.vy < 0 ? 12 : 30, step: 0, groundFriction: 0.0005 });
    if ((r.hitX || r.hitZ) && e.onGround && speed > 0 && e.jumpCd <= 0) { e.vy = 8.6; e.jumpCd = 0.4; }
    e.walk = Math.min(1, Math.hypot(e.vx, e.vz) / 3);
    e.flap = e.kind === 'chicken' && !e.onGround ? Math.sin(e.age * 30) * 0.8 + 0.8 : 0;
    // fall damage
    if (!e.onGround && e.vy < 0) e.fall = Math.max(e.fall || 0, 0) + (-e.vy * dt);
    if (e.onGround) { if ((e.fall || 0) > 4 && e.kind !== 'chicken') this.damageMob(e, Math.floor(e.fall - 3)); e.fall = 0; }
    if (e.inLiquid === 2) { e.lavaT = (e.lavaT || 0) + dt; if (e.lavaT > 0.5) { e.lavaT = 0; this.damageMob(e, 4); } }
    if (e.y < -30) this.entities.delete(e.id);
  }

  wander(e, dt, chance) {
    e.aiT -= dt;
    if (e.aiT <= 0) {
      e.aiT = 3 + this.rnd() * 6;
      if (this.rnd() < 0.55 * chance) {
        const a = this.rnd() * Math.PI * 2, r = 3 + this.rnd() * 7;
        e.tx = e.x + Math.cos(a) * r; e.tz = e.z + Math.sin(a) * r;
        e.wanderSpeed = MOBS[e.kind].speed * 0.55;
      } else { e.tx = e.x; e.tz = e.z; e.wanderSpeed = 0; e.headTarget = (this.rnd() - 0.5) * 1.6; }
    }
    if (Math.hypot(e.tx - e.x, e.tz - e.z) < 0.6) e.wanderSpeed = 0;
  }

  // height of the drop in front of a mob (-1 = lava / water deep)
  dropAhead(e, dx, dz) {
    const w = this.world;
    const ax = Math.floor(e.x + dx * (e.hw + 0.5)), az = Math.floor(e.z + dz * (e.hw + 0.5));
    let y = Math.floor(e.y + 0.5);
    if (SOLID[w.getBlock(ax, y, az)]) return 0;
    let drop = 0;
    while (drop < 6 && !SOLID[w.getBlock(ax, y - 1 - drop, az)]) {
      if (LIQUID[w.getBlock(ax, y - 1 - drop, az)] === 2) return -1;
      if (LIQUID[w.getBlock(ax, y - 1 - drop, az)] === 1) return 1;
      drop++;
    }
    return drop;
  }

  updateItem(e, dt) {
    e.age += dt;
    if (e.pickupDelay > 0) e.pickupDelay -= dt;
    if (e.age > 300) { this.entities.delete(e.id); return; }
    // inside a block? pop up
    const inside = SOLID[this.world.getBlock(Math.floor(e.x), Math.floor(e.y + 0.1), Math.floor(e.z))];
    if (inside) { e.y += 4 * dt; e.vy = 0; return; }
    stepBody(this.world, e, dt, { gravity: 22, floats: true, groundFriction: 0.02, airDrag: 0.8 });
    // merge
    if ((this.tick + e.id) % 10 === 0) {
      for (const o of this.entities.values()) {
        if (o === e || o.type !== 'item' || o.item.id !== e.item.id || o.item.dmg || e.item.dmg) continue;
        if (Math.abs(o.x - e.x) < 0.8 && Math.abs(o.y - e.y) < 0.6 && Math.abs(o.z - e.z) < 0.8) {
          const max = ITEMS[e.item.id].stack || 64;
          if (e.item.count + o.item.count <= max) { e.item.count += o.item.count; this.entities.delete(o.id); }
        }
      }
    }
  }

  updateArrow(e, dt) {
    e.age += dt;
    if (e.stuck) { if (e.age > 20) this.entities.delete(e.id); return; }
    if (e.age > 30) { this.entities.delete(e.id); return; }
    e.vy -= 20 * dt;
    const sp = Math.hypot(e.vx, e.vy, e.vz);
    const len = sp * dt;
    const dir = { x: e.vx / sp, y: e.vy / sp, z: e.vz / sp };
    // entities
    const o = { x: e.x, y: e.y, z: e.z };
    let hitEnt = null, hitT = len;
    for (const m of this.entities.values()) {
      if (m.type !== 'mob' || m.id === -e.owner) continue;
      const t = segAabb(o, dir, hitT, m.x - m.hw, m.y, m.z - m.hw, m.x + m.hw, m.y + m.h, m.z + m.hw);
      if (t !== null) { hitT = t; hitEnt = m; }
    }
    let hitPlayer = null;
    for (const p of this.players.values()) {
      if (p.id === e.owner && e.age < 0.3) continue;
      if (!p.alive) continue;
      if (e.owner > 0 && !this.meta.pvp) continue;
      const t = segAabb(o, dir, hitT, p.x - 0.3, p.y, p.z - 0.3, p.x + 0.3, p.y + 1.8, p.z + 0.3);
      if (t !== null) { hitT = t; hitPlayer = p; hitEnt = null; }
    }
    const blockHit = this.world.raycast(o, dir, hitT);
    if (blockHit && blockHit.dist <= hitT) {
      e.x += dir.x * blockHit.dist; e.y += dir.y * blockHit.dist; e.z += dir.z * blockHit.dist;
      e.stuck = true; e.age = 0; e.vx = dir.x * 0.01; e.vy = dir.y * 0.01; e.vz = dir.z * 0.01;
      this.fx({ k: 'arrowhit', x: e.x, y: e.y, z: e.z });
      if (blockHit.id === B.tnt) this.ignite(blockHit.x, blockHit.y, blockHit.z);
      return;
    }
    const dmg = Math.max(1, Math.round(e.dmg * Math.min(1.5, sp / 30)));
    if (hitEnt) { this.damageMob(hitEnt, dmg, dir.x, dir.z, e.owner > 0 ? this.players.get(e.owner) : null); this.entities.delete(e.id); return; }
    if (hitPlayer) { this.send(hitPlayer.id, { t: 'hurt', amt: dmg, kb: [dir.x * 4, 3, dir.z * 4], cause: 'arrow' }); this.entities.delete(e.id); return; }
    e.x += e.vx * dt; e.y += e.vy * dt; e.z += e.vz * dt;
    e.vx *= Math.pow(0.8, dt); e.vz *= Math.pow(0.8, dt);
  }

  updateTnt(e, dt) {
    e.fuse -= dt;
    stepBody(this.world, e, dt, { gravity: 24, groundFriction: 0.01 });
    if (e.fuse <= 0) { this.entities.delete(e.id); this.explode(e.x, e.y + 0.5, e.z, 4); }
  }

  updateFalling(e, dt) {
    e.age += dt;
    stepBody(this.world, e, dt, { gravity: 30 });
    if (e.onGround || e.age > 20) {
      this.entities.delete(e.id);
      const x = Math.floor(e.x), y = Math.floor(e.y + 0.1), z = Math.floor(e.z);
      const cur = this.world.getBlock(x, y, z);
      if (cur === 0 || REPLACEABLE[cur]) this.setBlock(x, y, z, e.block);
      else this.spawnItem({ id: blockItem(e.block), count: 1 }, e.x, e.y + 0.5, e.z);
    }
  }

  // ------------------------------------------------------------------ spawning
  skyFactor() {
    const t = (this.time % DAY_TICKS) / DAY_TICKS;
    const e = Math.sin(t * Math.PI * 2);
    return Math.min(1, Math.max(0.2, (e + 0.15) * 2.2)) * (1 - this.weather.rain * 0.3);
  }

  spawnTick() {
    if (this.meta.noMobs) return;
    let passive = 0, hostile = 0;
    for (const e of this.entities.values()) if (e.type === 'mob') { if (MOBS[e.kind].hostile) hostile++; else passive++; }
    const nPlayers = Math.max(1, this.players.size);
    for (const p of this.players.values()) {
      if (passive < 14 * nPlayers && this.rnd() < 0.25) this.trySpawn(p, false);
      if (hostile < 18 * nPlayers) for (let i = 0; i < 2; i++) this.trySpawn(p, true);
    }
    // despawn
    for (const e of this.entities.values()) {
      if (e.type !== 'mob') continue;
      const d = this.nearestPlayerDist(e.x, e.y, e.z);
      if (MOBS[e.kind].companion || MOBS[e.kind].demon) continue;
      if (d > 110) this.entities.delete(e.id);
      else if (MOBS[e.kind].hostile && d > 40 && this.rnd() < 0.01) this.entities.delete(e.id);
    }
  }

  trySpawn(p, hostile) {
    const w = this.world;
    const a = this.rnd() * Math.PI * 2, r = 24 + this.rnd() * 40;
    const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
    if (!w.isMeshed(x, z)) return;
    const bio = w.biomeAt(x, z);
    if (hostile) {
      // find a dark floor near the player's height (caves) or the surface at night
      const surface = w.groundAt(x, z);
      const ys = [surface];
      for (let k = 0; k < 3; k++) ys.push(Math.floor(p.y + (this.rnd() - 0.5) * 30));
      for (const gy of ys) {
        if (gy < 1) continue;
        const ground = w.getBlock(x, gy, z);
        if (!OPAQUE[ground] || BLOCKS[ground].leaves) continue;
        if (w.getBlock(x, gy + 1, z) || w.getBlock(x, gy + 2, z)) continue;
        const L = w.getLight(x, gy + 1, z);
        const light = Math.max(L & 15, (L >> 4) * this.skyFactor());
        if (light > 6) continue;
        if (this.nearestPlayerDist(x, gy, z) < 22) continue;
        const roll = this.rnd();
        const kind = roll < 0.45 ? 'zombie' : roll < 0.75 ? 'skeleton' : 'spider';
        this.spawnMob(kind, x + 0.5, gy + 1, z + 0.5);
        return;
      }
    } else {
      const gy = w.groundAt(x, z);
      if (gy < SEA - 1 || w.getBlock(x, gy, z) !== B.grass) return;
      if ((w.getLight(x, gy + 1, z) >> 4) < 12) return;
      if (this.nearestPlayerDist(x, gy, z) < 20) return;
      let kinds = ['pig', 'cow', 'sheep', 'chicken'];
      if (bio === BI.TAIGA || bio === BI.SNOWY_PLAINS) kinds = ['sheep', 'cow'];
      if (bio === BI.SAVANNA) kinds = ['cow', 'sheep'];
      if (bio === BI.CHERRY_GROVE) kinds = ['sheep', 'pig'];
      const kind = kinds[Math.floor(this.rnd() * kinds.length)];
      const n = 2 + Math.floor(this.rnd() * 3);
      for (let i = 0; i < n; i++) {
        const sx = x + Math.floor((this.rnd() - 0.5) * 6), sz = z + Math.floor((this.rnd() - 0.5) * 6);
        const sy = w.groundAt(sx, sz);
        if (sy > 0 && w.getBlock(sx, sy, sz) === B.grass && !w.getBlock(sx, sy + 1, sz)) this.spawnMob(kind, sx + 0.5, sy + 1, sz + 0.5);
      }
    }
  }

  // ------------------------------------------------------------------ weather / time
  setWeather(rain, thunder, dur) {
    this.weather.rain = rain ? 1 : 0;
    this.weather.thunder = thunder ? 1 : 0;
    this.weather.timer = dur || (rain ? 4000 + this.rnd() * 6000 : 8000 + this.rnd() * 16000);
    this.broadcast({ t: 'weather', rain: this.weather.rain, thunder: this.weather.thunder });
  }
  checkSleep() {
    const ps = [...this.players.values()];
    if (!ps.length || !ps.every(p => p.sleeping)) return;
    const t = this.time % DAY_TICKS;
    if (t < 12500 && this.weather.thunder < 0.5) return;
    this.time += (DAY_TICKS - t) % DAY_TICKS;
    if (this.weather.rain) this.setWeather(0, 0);
    for (const p of ps) p.sleeping = false;
    this.broadcast({ t: 'time', v: this.time, slept: true });
  }

  lightning() {
    const ps = [...this.players.values()];
    if (!ps.length) return;
    const p = ps[Math.floor(this.rnd() * ps.length)];
    const a = this.rnd() * Math.PI * 2, r = 10 + this.rnd() * 70;
    const x = Math.floor(p.x + Math.cos(a) * r), z = Math.floor(p.z + Math.sin(a) * r);
    if (!this.world.isLoaded(x, z)) return;
    const y = this.world.heightAt(x, z) + 1;
    this.fx({ k: 'bolt', x: x + 0.5, y, z: z + 0.5 });
    for (const e of this.entities.values()) if (e.type === 'mob' && Math.hypot(e.x - x, e.z - z) < 3) this.damageMob(e, 5);
    for (const q of this.players.values()) if (Math.hypot(q.x - x, q.z - z) < 3 && Math.abs(q.y - y) < 4) this.send(q.id, { t: 'hurt', amt: 5, kb: [0, 3, 0], cause: 'lightning', fire: true });
  }

  // ------------------------------------------------------------------ main tick (20 Hz)
  update(dt) {
    this.tick++;
    if (this.dayCycle) this.time++;
    const t = this.tick;
    if (this.later.length) {
      const due = this.later.filter(l => l[0] <= t);
      this.later = this.later.filter(l => l[0] > t);
      for (const l of due) l[1]();
    }
    // scheduled block updates
    if (this.scheduled.size) {
      const due = [];
      for (const [k, v] of this.scheduled) if (v <= t) due.push(k);
      let n = 0;
      for (const k of due) {
        this.scheduled.delete(k);
        const [x, y, z] = k.split(',').map(Number);
        this.blockUpdate(x, y, z);
        if (++n > 600) break;
      }
    }
    this.randomTicks();
    this.tickFurnaces();
    for (const e of this.entities.values()) {
      if (!this.world.isLoaded(Math.floor(e.x), Math.floor(e.z))) continue;
      if (e.type === 'mob') this.updateMob(e, dt);
      else if (e.type === 'item') this.updateItem(e, dt);
      else if (e.type === 'arrow') this.updateArrow(e, dt);
      else if (e.type === 'tnt') this.updateTnt(e, dt);
      else if (e.type === 'falling') this.updateFalling(e, dt);
    }
    if (--this.spawnCd <= 0) { this.spawnCd = 20; this.spawnTick(); }
    // weather
    this.weather.timer -= 1;
    if (this.weather.timer <= 0) {
      if (this.weather.rain) this.setWeather(0, 0);
      else this.setWeather(1, this.rnd() < 0.3);
    }
    if (this.weather.thunder && --this.lightningCd <= 0) { this.lightningCd = 100 + this.rnd() * 300; this.lightning(); }
    if (t % 100 === 0) this.broadcast({ t: 'time', v: this.time });
    // flush block changes to remote players
    if (this.pendingBlocks.length) {
      const a = this.pendingBlocks; this.pendingBlocks = [];
      if (this.relay) this.relay.out(0, { t: 'bs', a });
      else for (const p of this.players.values()) if (!p.local) p.send({ t: 'bs', a });
    }
    if (this.relay && t % 200 === 0) this.relay.persist(this.persistData());
    // entity snapshots
    const snapEvery = 2;
    for (const p of this.players.values()) {
      if (!p.local && t % snapEvery !== 0) continue;
      p.send({ t: 'ents', s: this.snapshot(p), tick: t });
      const others = [];
      for (const q of this.players.values()) if (q.id !== p.id) others.push([q.id, +q.x.toFixed(3), +q.y.toFixed(3), +q.z.toFixed(3), +q.yaw.toFixed(3), +q.pitch.toFixed(3), q.flags | 0, q.held | 0, q.alive ? 1 : 0]);
      if (others.length || p.local) p.send({ t: 'pl', s: others });
    }
  }

  snapshot(p) {
    const out = [];
    for (const e of this.entities.values()) {
      if (Math.abs(e.x - p.x) > 110 || Math.abs(e.z - p.z) > 110) continue;
      const r3 = (v) => Math.round(v * 1000) / 1000;
      let extra = 0, kind = 0;
      if (e.type === 'mob') { kind = MOB_KINDS.indexOf(e.kind); extra = (e.hurt > 0 ? 1 : 0) | (e.burn > 0 ? 2 : 0) | (e.sheared > 0 ? 4 : 0) | (e.target ? 8 : 0) | (e.stare > 0 ? 16 : 0); }
      else if (e.type === 'item') { kind = e.item.id; extra = e.item.count; }
      else if (e.type === 'falling') kind = e.block;
      else if (e.type === 'tnt') extra = Math.round(e.fuse * 10);
      else if (e.type === 'arrow') extra = e.stuck ? 1 : 0;
      out.push([e.id, ETYPE[e.type], kind, r3(e.x), r3(e.y), r3(e.z), r3(e.yaw !== undefined ? e.yaw : Math.atan2(-(e.vx || 0), -(e.vz || 0))), r3(e.pitch || 0), r3(e.walk || 0), extra, r3(e.vx || 0), r3(e.vy || 0), r3(e.vz || 0), r3(e.flap || 0), e.owner || 0]);
    }
    return out;
  }

  // ------------------------------------------------------------------ Verity
  placeVerity(p, m) {
    for (const e of this.entities.values()) if (e.owner === p.id && (e.kind === 'verity' || e.kind === 'verity_demon')) this.entities.delete(e.id);
    const e = this.spawnMob('verity', m.p[0], m.p[1], m.p[2]);
    e.owner = p.id; e.unease = m.unease || 0; e.mode = 'follow'; e.talkT = 20 + this.rnd() * 40; e.stare = 0;
    if (m.v) { e.vx = m.v[0]; e.vy = m.v[1]; e.vz = m.v[2]; e.thrownT = 1.4; }
    this.later.push([this.tick + 20, () => this.veritySay(e, p, m.v ? ['Wheee!', 'Again! Again!', e.unease > 45 ? "Don't throw me." : 'Ha! That was fun.'][Math.floor(this.rnd() * 3)] : (e.unease > 45 ? "You're back." : ['Hi again!', "I'm here!", 'Where are we going?'][Math.floor(this.rnd() * 3)]))]);
  }
  veritySay(e, p, text, all = false) {
    if (!text || !this.entities.has(e.id)) return;
    const msg = { t: 'chat', text: (e.kind === 'verity_demon' ? '§4' : '§d') + text, from: e.kind === 'verity_demon' ? 'V̶e̶r̶i̶t̶y̶' : 'Verity' };
    if (all) this.broadcast(msg); else this.send(p.id, msg);
  }
  verityHears(p, text) {
    let e = null;
    for (const o of this.entities.values()) if (o.owner === p.id && (o.kind === 'verity' || o.kind === 'verity_demon')) e = o;
    if (!e) return;
    const named = /^(hey |ok |hi |@)?verity\b/i.test(text.trim());
    const near = Math.hypot(e.x - p.x, e.z - p.z) < 24;
    if (!named && !(near && /\?\s*$/.test(text))) return;
    const reply = verityReply(this, e, p, text);
    if (reply) this.later.push([this.tick + 12 + Math.floor(this.rnd() * 20), () => this.veritySay(e, p, reply, true)]);
  }
  verityTurn(e, owner) {
    e.kind = 'verity_demon'; e.health = MOBS.verity_demon.hp; e.hw = 0.4; e.h = 2.3; e.stare = 0;
    this.veritySay(e, owner, 'You should not have left me alone in the dark.', true);
    this.fx({ k: 'demon', x: e.x, y: e.y, z: e.z });
  }
  verityCalm(e, beaten) {
    e.kind = 'verity'; e.health = MOBS.verity.hp; e.hw = 0.25; e.h = 1.05; e.unease = 8; e.mode = 'follow'; e.target = null;
    const owner = this.players.get(e.owner);
    if (owner) this.veritySay(e, owner, beaten ? '...it stopped. I\'m sorry. I don\'t know what that was.' : "Good morning. Did something happen last night? I don't remember.", true);
    this.fx({ k: 'poof', x: e.x, y: e.y + 0.5, z: e.z });
  }
  updateVerity(e, dt) {
    const owner = this.players.get(e.owner);
    if (!owner) { e.gone = (e.gone || 0) + dt; if (e.gone > 20) this.entities.delete(e.id); return; }
    e.gone = 0;
    e.age += dt;
    if (e.hurt > 0) e.hurt -= dt;
    if (e.attackCd > 0) e.attackCd -= dt;
    if (e.stare > 0) e.stare -= dt;
    const t = this.time % DAY_TICKS;
    const night = t > 13000 && t < 23000;
    // unease: she gets lonelier and stranger over time, faster at night
    e.unease = (e.unease || 0) + dt * (night ? 0.06 : 0.025);
    if (night && !e.nightMark) { e.nightMark = true; e.unease += 6; }
    if (!night) e.nightMark = false;
    const ox = owner.x, oy = owner.y, oz = owner.z;
    const dOwner = Math.hypot(ox - e.x, oy - e.y, oz - e.z);
    let tx, ty, tz, speed = MOBS[e.kind].speed;
    if (e.kind === 'verity_demon') {
      if (!night) { this.verityCalm(e, false); return; }
      tx = ox; ty = oy + 0.2; tz = oz;
      e.yawTarget = Math.atan2(-(ox - e.x), -(oz - e.z));
      if (dOwner < 1.8 && e.attackCd <= 0 && owner.alive && owner.gamemode !== 'creative') {
        e.attackCd = 1.1;
        const l = dOwner || 1;
        this.send(owner.id, { t: 'hurt', amt: MOBS.verity_demon.dmg, kb: [(ox - e.x) / l * 7, 5, (oz - e.z) / l * 7], cause: 'verity' });
      }
      if (dOwner > 40) { e.x = ox - Math.sin(owner.yaw) * -6; e.z = oz - Math.cos(owner.yaw) * -6; e.y = oy + 1; }
    } else {
      if (night && e.unease > 62 && this.rnd() < dt / 50) { this.verityTurn(e, owner); return; }
      // thrown: tumble with gravity until she lands
      if (e.thrownT > 0) {
        e.thrownT -= dt;
        stepBody(this.world, e, dt, { gravity: 20, bounce: true });
        if (e.onGround && e.thrownT < 1) e.thrownT = 0;
        return;
      }
      // spooky: sometimes appear right behind her owner and stare
      if (e.unease > 40 && night && e.stare <= 0 && this.rnd() < dt / 80) {
        const bx = ox + Math.sin(owner.yaw) * 2.2, bz = oz + Math.cos(owner.yaw) * 2.2;
        if (!SOLID[this.world.getBlock(Math.floor(bx), Math.floor(oy + 0.5), Math.floor(bz))]) {
          e.x = bx; e.y = oy + 0.4; e.z = bz; e.vx = e.vy = e.vz = 0; e.stare = 6;
          this.veritySay(e, owner, ['Turn around.', 'Boo.', "I'm right behind you.", 'Found you.'][Math.floor(this.rnd() * 4)]);
        }
      }
      // fight monsters near her owner
      let foe = null, fd = 12;
      for (const o of this.entities.values()) {
        if (o.type !== 'mob' || !MOBS[o.kind].hostile) continue;
        const d = Math.hypot(o.x - ox, o.z - oz);
        if (d < fd) { fd = d; foe = o; }
      }
      if (e.stare > 0) { tx = e.x; ty = e.y; tz = e.z; e.yawTarget = Math.atan2(-(ox - e.x), -(oz - e.z)); }
      else if (foe && e.mode !== 'stay') {
        tx = foe.x; ty = foe.y + 0.6; tz = foe.z;
        const d = Math.hypot(foe.x - e.x, foe.y - e.y, foe.z - e.z);
        e.yawTarget = Math.atan2(-(foe.x - e.x), -(foe.z - e.z));
        if (d < 1.7 && e.attackCd <= 0) { e.attackCd = 0.8; this.damageMob(foe, 4, foe.x - e.x, foe.z - e.z, owner); e.swing = 0.3; }
      } else if (e.mode === 'stay' && e.home) {
        [tx, ty, tz] = e.home; e.yawTarget = Math.atan2(-(ox - e.x), -(oz - e.z));
      } else {
        const fx = -Math.sin(owner.yaw), fz = -Math.cos(owner.yaw);
        const rx = Math.cos(owner.yaw), rz = -Math.sin(owner.yaw);
        tx = ox + rx * 1.3 - fx * 0.9; tz = oz + rz * 1.3 - fz * 0.9; ty = oy + 0.55 + Math.sin(e.age * 1.8) * 0.15;
        if (dOwner < 4) e.yawTarget = owner.yaw;
        else e.yawTarget = Math.atan2(-(ox - e.x), -(oz - e.z));
      }
      // chatter
      e.talkT -= dt;
      if (e.talkT <= 0) { e.talkT = 120 + this.rnd() * 180; this.veritySay(e, owner, verityIdle(this, e, owner)); }
      if (dOwner > 26 && e.mode !== 'stay') { e.x = tx; e.y = oy + 0.5; e.z = tz; e.vx = e.vy = e.vz = 0; }
    }
    // hover toward the target point
    let dx = tx - e.x, dy = ty - e.y, dz = tz - e.z;
    const dl = Math.hypot(dx, dy, dz);
    const want = Math.min(speed, dl * 2.2);
    const k = Math.min(1, dt * 6);
    e.vx += ((dl > 0.05 ? dx / dl * want : 0) - e.vx) * k;
    e.vy += ((dl > 0.05 ? dy / dl * want : 0) - e.vy) * k;
    e.vz += ((dl > 0.05 ? dz / dl * want : 0) - e.vz) * k;
    const r = moveBody(this.world, e, e.vx * dt, e.vy * dt, e.vz * dt);
    if ((r.hitX || r.hitZ) && e.onGround !== undefined) e.vy += 4;
    if (r.hitY) e.vy = 0;
    e.walk = Math.min(1, Math.hypot(e.vx, e.vz) / 4) * 0.4;
    if (e.yawTarget !== undefined) {
      let d = e.yawTarget - e.yaw;
      while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      e.yaw += d * Math.min(1, dt * 6);
    }
    e.pitch = 0;
  }

  persistData() {
    return { t: 'persist', be: [...this.blockEntities.entries()], time: this.time, weather: { rain: this.weather.rain, thunder: this.weather.thunder, timer: this.weather.timer } };
  }

  serialize() {
    return {
      time: this.time, dayCycle: this.dayCycle, weather: this.weather,
      blockEntities: [...this.blockEntities.entries()],
    };
  }
}

function segAabb(o, d, maxT, x0, y0, z0, x1, y1, z1) {
  let tmin = 0, tmax = maxT;
  for (const [oo, dd, lo, hi] of [[o.x, d.x, x0, x1], [o.y, d.y, y0, y1], [o.z, d.z, z0, z1]]) {
    if (Math.abs(dd) < 1e-9) { if (oo < lo || oo > hi) return null; continue; }
    let t1 = (lo - oo) / dd, t2 = (hi - oo) / dd;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
    tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  return tmin;
}
export { ETYPE, MOBS, moveBody, EMIT };
