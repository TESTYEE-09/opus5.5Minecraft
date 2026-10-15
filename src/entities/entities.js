// Client-side views of server entities (mobs, items, arrows, TNT, falling blocks) and other players.
import * as THREE from 'three';
import { buildMob, buildHumanoid, paintPlayerSkin, animateModel, setModelLight, itemMesh, isBlockLike, blockGeometry } from './models.js';
import { MOB_KINDS, ETYPE } from '../server/server.js';
import { ITEMS, B } from '../core/blocks.js';
import { LAYER } from '../gfx/renderer.js';
import { rayBox } from '../world/world.js';

const TYPES = ['mob', 'item', 'arrow', 'tnt', 'falling'];
const MOB_SIZE = { pig: [0.45, 0.9], cow: [0.45, 1.4], sheep: [0.45, 1.3], chicken: [0.2, 0.7], zombie: [0.3, 1.9], skeleton: [0.3, 1.95], spider: [0.7, 0.9], verity: [0.3, 1.05], verity_demon: [0.45, 2.3] };

export class EntityViews {
  constructor(game) {
    this.game = game;
    this.r = game.renderer;
    this.root = new THREE.Group();
    this.r.scene.add(this.root);
    this.r.casterRoots.push(this.root);
    this.ents = new Map();     // id -> view
    this.players = new Map();  // id -> view
    this.clock = 0;
    this.delay = 0.1;
    this.arrowGeo = new THREE.BoxGeometry(0.05, 0.05, 0.6);
    this.arrowMat = new THREE.MeshBasicMaterial({ color: 0x6b4a2a });
  }

  lightAt(x, y, z) {
    const w = this.game.world;
    const a = w.getLight(Math.floor(x), Math.floor(y), Math.floor(z)), b = w.getLight(Math.floor(x), Math.floor(y) + 1, Math.floor(z));
    return [Math.max(a >> 4, b >> 4) / 15, Math.max(a & 15, b & 15) / 15];
  }

  // ---------------------------------------------------------------- server snapshots
  applySnapshot(list, local) {
    const now = this.clock;
    this.delay = local ? 0.06 : 0.12;
    const seen = new Set();
    for (const s of list) {
      const id = s[0];
      seen.add(id);
      let v = this.ents.get(id);
      if (v && v.kind !== s[2]) { this.removeView(id); v = null; }   // Verity changing form
      if (!v) { v = this.createView(s); if (!v) continue; this.ents.set(id, v); }
      v.owner = s[14] || 0;
      v.buf.push({ t: now, x: s[3], y: s[4], z: s[5], yaw: s[6], pitch: s[7], walk: s[8], extra: s[9], flap: s[13] });
      if (v.buf.length > 8) v.buf.shift();
      v.extra = s[9];
      v.vx = s[10]; v.vy = s[11]; v.vz = s[12];
      v.lastSeen = now;
    }
    for (const [id, v] of this.ents) if (!seen.has(id) && now - v.lastSeen > 0.25) this.removeView(id);
  }

  createView(s) {
    const type = TYPES[s[1]];
    let obj;
    const v = { id: s[0], type, kind: s[2], buf: [], lastSeen: this.clock, phase: 0, hurt: 0, age: 0 };
    if (type === 'mob') {
      v.mobKind = MOB_KINDS[s[2]];
      obj = buildMob(v.mobKind, this.r);
      const sz = MOB_SIZE[v.mobKind] || [0.4, 1];
      v.hw = sz[0]; v.h = sz[1];
      if (v.mobKind === 'skeleton') {
        const bow = itemMesh(ITEMS.findIndex(i => i && i.name === 'bow'), this.r);
        bow.scale.setScalar(0.7); bow.position.set(-0.05, -0.62, 0.05); bow.rotation.set(0, Math.PI / 2, -0.8);
        obj.userData.parts.rarm.add(bow);
      }
    } else if (type === 'item') {
      obj = new THREE.Group();
      const id = s[2];
      const m = itemMesh(id, this.r);
      const block = isBlockLike(id);
      m.scale.setScalar(block ? 0.26 : 0.4);
      obj.add(m);
      v.mesh = m; v.mat = m.userData.mat; v.block = block;
      v.copies = [m];
      v.spin = Math.random() * 6;
    } else if (type === 'arrow') {
      obj = new THREE.Mesh(this.arrowGeo, this.arrowMat);
    } else if (type === 'tnt' || type === 'falling') {
      const bid = type === 'tnt' ? B.tnt : s[2];
      const mat = this.r.blockEntityMaterial();
      obj = new THREE.Mesh(blockGeometry(bid), mat);
      v.mat = mat;
    } else return null;
    obj.traverse(o => { o.layers.set(LAYER.WORLD); });
    this.root.add(obj);
    v.obj = obj;
    return v;
  }

  removeView(id) {
    const v = this.ents.get(id);
    if (!v) return;
    this.root.remove(v.obj);
    if (v.type === 'mob') v.obj.traverse(o => { if (o.isMesh) o.geometry.dispose(); });
    this.ents.delete(id);
  }

  sample(v) {
    const t = this.clock - this.delay;
    const b = v.buf;
    if (!b.length) return null;
    if (t <= b[0].t) return b[0];
    for (let i = b.length - 1; i >= 0; i--) {
      if (b[i].t <= t) {
        const a = b[i], c = b[i + 1];
        if (!c) {
          // extrapolate briefly
          const dt = Math.min(0.15, t - a.t);
          return { ...a, x: a.x + (v.vx || 0) * dt, y: a.y + (v.vy || 0) * dt * (v.type === 'arrow' ? 1 : 0), z: a.z + (v.vz || 0) * dt };
        }
        const k = (t - a.t) / Math.max(1e-4, c.t - a.t);
        let dy = c.yaw - a.yaw;
        while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
        return { x: a.x + (c.x - a.x) * k, y: a.y + (c.y - a.y) * k, z: a.z + (c.z - a.z) * k, yaw: a.yaw + dy * k, pitch: a.pitch + (c.pitch - a.pitch) * k, walk: a.walk + (c.walk - a.walk) * k, extra: c.extra, flap: c.flap };
      }
    }
    return b[b.length - 1];
  }

  // ---------------------------------------------------------------- players
  applyPlayers(list, infos) {
    const now = this.clock;
    const seen = new Set();
    for (const s of list) {
      const id = s[0];
      seen.add(id);
      let v = this.players.get(id);
      if (!v) {
        const info = infos.get(id);
        if (!info) continue;
        v = this.createPlayerView(id, info);
        this.players.set(id, v);
      }
      v.buf.push({ t: now, x: s[1], y: s[2], z: s[3], yaw: s[4], pitch: s[5], walk: 0, extra: s[6] });
      if (v.buf.length > 8) v.buf.shift();
      v.flags = s[6]; v.held = s[7]; v.alive = s[8];
      v.lastSeen = now;
    }
    for (const [id, v] of this.players) if (!seen.has(id) && now - v.lastSeen > 1) this.removePlayer(id);
  }
  createPlayerView(id, info) {
    const skin = paintPlayerSkin(info.look || {});
    const mat = this.r.entityMaterial(skin.texture());
    const obj = buildHumanoid(skin, mat);
    obj.userData.mat = mat;
    obj.traverse(o => o.layers.set(LAYER.WORLD));
    this.root.add(obj);
    return { id, name: info.name, obj, buf: [], phase: 0, heldId: -1, heldObj: null, lastPos: null, hurt: 0, swingT: 0, type: 'player', hw: 0.3, h: 1.8 };
  }
  removePlayer(id) {
    const v = this.players.get(id);
    if (!v) return;
    this.root.remove(v.obj);
    this.players.delete(id);
  }
  setHeld(v, id) {
    if (v.heldId === id) return;
    const arm = v.obj.userData.parts.rarm;
    if (v.heldObj) { arm.remove(v.heldObj); v.heldObj = null; }
    v.heldId = id;
    if (!id || id <= 0 || !ITEMS[id]) return;
    const m = itemMesh(id, this.r);
    const block = isBlockLike(id);
    m.scale.setScalar(block ? 0.28 : 0.55);
    m.position.set(-0.06, -0.62, block ? -0.12 : -0.18);
    m.rotation.set(block ? 0 : -Math.PI / 2 + 0.3, block ? 0.6 : Math.PI / 2, 0);
    m.traverse(o => o.layers.set(LAYER.WORLD));
    arm.add(m);
    v.heldObj = m;
  }

  // ---------------------------------------------------------------- per frame
  update(dt) {
    this.clock += dt;
    for (const v of this.ents.values()) {
      const s = this.sample(v);
      if (!s) continue;
      v.age += dt;
      const o = v.obj;
      const [sky, blk] = this.lightAt(s.x, s.y + 0.3, s.z);
      if (v.type === 'mob') {
        o.position.set(s.x, s.y, s.z);
        o.rotation.y = s.yaw + Math.PI;
        v.phase += dt * 9 * s.walk;
        const hurt = (s.extra & 1) ? 1 : 0;
        v.hurt += (hurt - v.hurt) * Math.min(1, dt * 20);
        animateModel(o, { walk: s.walk, phase: v.phase, headYaw: 0, headPitch: s.pitch, swing: 0, t: v.age, zombie: v.mobKind === 'zombie' || v.mobKind === 'verity_demon', aim: v.mobKind === 'skeleton' && (s.extra & 8), flap: s.flap }, dt);
        const eerie = v.mobKind === 'verity_demon' ? 0.35 : (s.extra & 16) ? 0.3 + 0.15 * Math.sin(v.age * 9) : 0;
        setModelLight(o, sky, Math.max(blk, (s.extra & 2) ? 0.9 : 0), Math.max(v.hurt * 0.8, eerie));
        if (v.mobKind === 'verity_demon' && Math.random() < dt * 12) this.game.particles.spawn({ x: s.x + (Math.random() - 0.5) * 0.8, y: s.y + Math.random() * 2.2, z: s.z + (Math.random() - 0.5) * 0.8, vy: 0.6, life: 0.9, size: 0.18, color: [0.05, 0.02, 0.03], alpha: 0.7, grow: 1.5 });
        if ((s.extra & 2) && Math.random() < dt * 20) this.game.particles.spawn({ x: s.x + (Math.random() - 0.5) * 0.6, y: s.y + Math.random() * v.h, z: s.z + (Math.random() - 0.5) * 0.6, vy: 1.2, life: 0.4, size: 0.14, color: [6, 2.2, 0.4], glow: true, shrink: true });
      } else if (v.type === 'item') {
        v.spin += dt * 1.8;
        const bobY = Math.sin(v.age * 2.6) * 0.06 + 0.18;
        o.position.set(s.x, s.y + bobY, s.z);
        o.rotation.y = v.spin;
        const count = s.extra || 1;
        const want = count > 32 ? 3 : count > 1 ? 2 : 1;
        while (v.copies.length < want) {
          const c = v.mesh.clone(); c.position.set((Math.random() - 0.5) * 0.12, 0.06 * v.copies.length, (Math.random() - 0.5) * 0.12);
          c.layers.set(LAYER.WORLD); o.add(c); v.copies.push(c);
        }
        if (v.mat) v.mat.uniforms.uEnt.value.set(sky, blk, 0);
      } else if (v.type === 'arrow') {
        o.position.set(s.x, s.y, s.z);
        if (!(s.extra & 1)) { const vl = Math.hypot(v.vx, v.vy, v.vz); if (vl > 0.1) o.lookAt(s.x + v.vx, s.y + v.vy, s.z + v.vz); }
      } else if (v.type === 'tnt' || v.type === 'falling') {
        o.position.set(s.x, s.y + 0.5, s.z);
        let flash = 0;
        if (v.type === 'tnt') { const f = (s.extra || 0) / 10; flash = (Math.floor(f * 4) % 2 === 0 ? 0.6 : 0) * (f < 1.5 ? 1 : 0.5); const sc = f < 0.3 ? 1 + (0.3 - f) * 0.6 : 1; o.scale.setScalar(sc); }
        if (v.mat) v.mat.uniforms.uEnt.value.set(sky, blk, flash);
      }
    }
    for (const v of this.players.values()) {
      const s = this.sample(v);
      if (!s) continue;
      const o = v.obj;
      o.visible = v.alive !== 0;
      const prev = v.lastPos || s;
      const moved = Math.hypot(s.x - prev.x, s.z - prev.z);
      v.lastPos = { x: s.x, z: s.z };
      const speed = moved / Math.max(dt, 1e-3);
      v.walkAmt = (v.walkAmt || 0) + (Math.min(1, speed / 4.3) - (v.walkAmt || 0)) * Math.min(1, dt * 10);
      v.phase += moved * 2.1;
      o.position.set(s.x, s.y, s.z);
      // body follows head yaw lazily
      v.bodyYaw = v.bodyYaw ?? s.yaw;
      let d = s.yaw - v.bodyYaw;
      while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
      if (Math.abs(d) > 0.6 || v.walkAmt > 0.1) v.bodyYaw += d * Math.min(1, dt * 6);
      o.rotation.y = v.bodyYaw + Math.PI;
      let hy = s.yaw - v.bodyYaw;
      while (hy > Math.PI) hy -= Math.PI * 2; while (hy < -Math.PI) hy += Math.PI * 2;
      const flags = v.flags | 0;
      if ((flags & 4) && v.swingT <= 0) v.swingT = 0.0001;
      if (v.swingT > 0) { v.swingT += dt * 3.6; if (v.swingT >= 1) v.swingT = 0; }
      v.hurt = Math.max(0, v.hurt - dt * 2);
      if (flags & 8) v.hurt = 0.5;
      this.setHeld(v, v.held);
      animateModel(o, { walk: v.walkAmt, phase: v.phase, headYaw: -hy, headPitch: -s.pitch, swing: v.swingT, sneak: !!(flags & 1), holding: v.held > 0, t: this.clock, aim: !!(flags & 16) }, dt);
      const [sky, blk] = this.lightAt(s.x, s.y + 0.5, s.z);
      setModelLight(o, sky, blk, v.hurt);
      if (v.heldObj && v.heldObj.userData.mat) v.heldObj.userData.mat.uniforms.uEnt.value.set(sky, blk, 0);
      v.screen = { x: s.x, y: s.y + (flags & 1 ? 1.75 : 2.05), z: s.z };
    }
  }

  // nearest entity hit by a ray (for attacking / using)
  raycast(o, d, maxDist, includePlayers) {
    let best = null;
    const test = (v, x, y, z, hw, h) => {
      const hit = rayBox(o, d, x - hw, y, z - hw, x + hw, y + h, z + hw);
      if (hit && hit.t <= maxDist && (!best || hit.t < best.dist)) best = { v, dist: hit.t };
    };
    for (const v of this.ents.values()) {
      if (v.type !== 'mob' && v.type !== 'tnt') continue;
      const s = v.buf[v.buf.length - 1];
      if (!s) continue;
      test(v, s.x, s.y, s.z, (v.hw || 0.5) + 0.05, (v.h || 1) + 0.05);
    }
    if (includePlayers) for (const v of this.players.values()) {
      const s = v.buf[v.buf.length - 1];
      if (s && v.alive !== 0) test(v, s.x, s.y, s.z, 0.35, 1.85);
    }
    return best;
  }

  clear() {
    for (const id of [...this.ents.keys()]) this.removeView(id);
    for (const id of [...this.players.keys()]) this.removePlayer(id);
  }
}
export { ETYPE };
