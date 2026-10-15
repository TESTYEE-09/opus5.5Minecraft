// Instanced billboard particles: block debris, flames, smoke, fireflies, petals, splashes, sparks.
import * as THREE from 'three';
import { PART_VERT, PART_FRAG } from './shaders.js';
import { LAYER } from './renderer.js';
import { FACE_TEX, TINTS, TINT, BLOCKS, B, SOLID, LIQUID, EMIT } from '../core/blocks.js';
import { BIOMES } from '../world/worldgen.js';

const MAX = 6000;

class Pool {
  constructor(renderer, additive) {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    this.pos = new Float32Array(MAX * 3); this.col = new Float32Array(MAX * 4); this.tex = new Float32Array(MAX * 4); this.glow = new Float32Array(MAX);
    this.aPos = new THREE.InstancedBufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.InstancedBufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aTex = new THREE.InstancedBufferAttribute(this.tex, 4).setUsage(THREE.DynamicDrawUsage);
    this.aGlow = new THREE.InstancedBufferAttribute(this.glow, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', this.aPos); g.setAttribute('iCol', this.aCol); g.setAttribute('iTex', this.aTex); g.setAttribute('iGlow', this.aGlow);
    g.instanceCount = 0;
    const m = new THREE.ShaderMaterial({
      uniforms: { ...renderer.U }, vertexShader: PART_VERT, fragmentShader: PART_FRAG,
      transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(g, m);
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(LAYER.TRANSPARENT);
    this.mesh.renderOrder = additive ? 20 : 10;
    this.g = g;
    this.list = [];
  }
}

export class Particles {
  constructor(renderer) {
    this.r = renderer;
    this.norm = new Pool(renderer, false);
    this.add = new Pool(renderer, true);
    renderer.scene.add(this.norm.mesh, this.add.mesh);
    this.ambientT = 0;
    this.scanT = 0;
    this.emitters = [];
    this.fireflies = 0;
  }

  spawn(p) {
    const pool = p.glow ? this.add : this.norm;
    if (pool.list.length >= MAX) return;
    p.age = 0;
    p.life = p.life ?? 1;
    p.vx = p.vx || 0; p.vy = p.vy || 0; p.vz = p.vz || 0;
    p.size = p.size ?? 0.1;
    p.color = p.color || [1, 1, 1];
    p.alpha = p.alpha ?? 1;
    p.layer = p.layer ?? -1;
    pool.list.push(p);
  }

  blockBreak(x, y, z, id, n = 28) {
    const layer = FACE_TEX[id * 6 + 4];
    const tint = this.tintOf(id);
    for (let i = 0; i < n; i++) {
      this.spawn({
        x: x + 0.15 + Math.random() * 0.7, y: y + 0.15 + Math.random() * 0.7, z: z + 0.15 + Math.random() * 0.7,
        vx: (Math.random() - 0.5) * 3.5, vy: Math.random() * 4 + 1, vz: (Math.random() - 0.5) * 3.5,
        life: 0.5 + Math.random() * 0.7, size: 0.09 + Math.random() * 0.07, layer, u: Math.floor(Math.random() * 3) * 0.25, v: Math.floor(Math.random() * 3) * 0.25,
        color: tint, gravity: 18, collide: true, light: true,
      });
    }
  }
  blockHit(x, y, z, id, nx, ny, nz) {
    const layer = FACE_TEX[id * 6 + 4];
    const tint = this.tintOf(id);
    for (let i = 0; i < 2; i++) {
      this.spawn({
        x: x + 0.5 + nx * 0.52 + (Math.random() - 0.5) * (1 - Math.abs(nx)) * 0.9,
        y: y + 0.5 + ny * 0.52 + (Math.random() - 0.5) * (1 - Math.abs(ny)) * 0.9,
        z: z + 0.5 + nz * 0.52 + (Math.random() - 0.5) * (1 - Math.abs(nz)) * 0.9,
        vx: nx * 1.5 + (Math.random() - 0.5), vy: 1.5 + Math.random(), vz: nz * 1.5 + (Math.random() - 0.5),
        life: 0.4 + Math.random() * 0.3, size: 0.07, layer, u: Math.floor(Math.random() * 3) * 0.25, v: Math.floor(Math.random() * 3) * 0.25,
        color: tint, gravity: 18, collide: true, light: true,
      });
    }
  }
  tintOf(id) {
    const t = TINTS[id];
    if (t === TINT.GRASS || t === TINT.FOLIAGE) return [0.45, 0.72, 0.3];
    if (t === TINT.BIRCH) return [0.5, 0.65, 0.33];
    if (t === TINT.SPRUCE) return [0.38, 0.52, 0.38];
    return [1, 1, 1];
  }
  explosion(x, y, z, r) {
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2, b = Math.random() * Math.PI - Math.PI / 2, s = Math.random() * r * 2.2;
      this.spawn({ x, y, z, vx: Math.cos(a) * Math.cos(b) * s, vy: Math.sin(b) * s + 2, vz: Math.sin(a) * Math.cos(b) * s, life: 0.8 + Math.random() * 1.6, size: 0.9 + Math.random() * 1.4, color: [0.5, 0.5, 0.5], alpha: 0.65, grow: 1.6, drag: 0.15, gravity: -1.2 });
      if (i < 40) this.spawn({ x, y, z, vx: Math.cos(a) * s * 1.5, vy: Math.sin(b) * s * 1.5, vz: Math.sin(a) * s * 1.5, life: 0.2 + Math.random() * 0.4, size: 0.7 + Math.random(), color: [8, 4, 1.2], glow: true, drag: 0.05 });
    }
  }
  splash(x, y, z, n = 14) {
    for (let i = 0; i < n; i++) this.spawn({ x: x + (Math.random() - 0.5) * 0.8, y, z: z + (Math.random() - 0.5) * 0.8, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3, vz: (Math.random() - 0.5) * 2, life: 0.5 + Math.random() * 0.4, size: 0.08, color: [0.7, 0.85, 1], alpha: 0.8, gravity: 16 });
  }
  crit(x, y, z) {
    for (let i = 0; i < 10; i++) this.spawn({ x, y, z, vx: (Math.random() - 0.5) * 4, vy: Math.random() * 3, vz: (Math.random() - 0.5) * 4, life: 0.4, size: 0.12, color: [3, 2.4, 1.2], glow: true, gravity: 6 });
  }
  poof(x, y, z) {
    for (let i = 0; i < 16; i++) this.spawn({ x: x + (Math.random() - 0.5) * 0.8, y: y + Math.random() * 1.2, z: z + (Math.random() - 0.5) * 0.8, vx: (Math.random() - 0.5), vy: Math.random() * 1.2, vz: (Math.random() - 0.5), life: 0.8 + Math.random() * 0.6, size: 0.35, color: [0.85, 0.85, 0.85], alpha: 0.75, grow: 1.4, gravity: -0.5 });
  }
  hearts(x, y, z) {
    for (let i = 0; i < 6; i++) this.spawn({ x: x + (Math.random() - 0.5), y: y + Math.random() * 0.6, z: z + (Math.random() - 0.5), vy: 0.8, life: 1.2, size: 0.18, color: [3, 0.6, 0.8], glow: true });
  }
  pickupTrail(x, y, z) { this.spawn({ x, y, z, life: 0.3, size: 0.1, color: [2, 2, 2], glow: true }); }

  // ---------------------------------------------------------------- ambient effects
  ambient(dt, game) {
    const world = game.world, cam = game.renderer.camera.position;
    const env = game.renderer.env;
    this.ambientT += dt;
    // find light emitters around the camera once a second
    this.scanT -= dt;
    if (this.scanT <= 0) {
      this.scanT = 1;
      this.emitters.length = 0;
      const cx = Math.floor(cam.x), cy = Math.floor(cam.y), cz = Math.floor(cam.z);
      for (let y = cy - 10; y <= cy + 10; y++) for (let z = cz - 14; z <= cz + 14; z++) for (let x = cx - 14; x <= cx + 14; x++) {
        const id = world.getBlock(x, y, z);
        if (!id || !EMIT[id]) continue;
        const d = BLOCKS[id];
        if (d.torch || id === B.lantern || id === B.lava || id === B.crystal_cluster || id === B.glow_mushroom || id === B.crystal_ore || id === B.furnace_lit || (id > B.furnace_lit && id < B.furnace_lit + 4)) this.emitters.push([x, y, z, id]);
        if (this.emitters.length > 300) break;
      }
    }
    for (const [x, y, z, id] of this.emitters) {
      const d = BLOCKS[id];
      if (d.torch) {
        const box = d.boxes[0];
        const fx = x + (box[0] + box[3]) / 32, fz = z + (box[2] + box[5]) / 32, fy = y + box[4] / 16 + 0.05;
        if (Math.random() < dt * 6) this.spawn({ x: fx + (Math.random() - 0.5) * 0.05, y: fy, z: fz + (Math.random() - 0.5) * 0.05, vy: 0.35, life: 0.35 + Math.random() * 0.2, size: 0.09, color: [6, 2.6, 0.6], glow: true, shrink: true });
        if (Math.random() < dt * 1.5) this.spawn({ x: fx, y: fy + 0.12, z: fz, vy: 0.6, vx: (Math.random() - 0.5) * 0.1, life: 1.2, size: 0.12, color: [0.3, 0.3, 0.3], alpha: 0.5, grow: 2 });
      } else if (id === B.lava && Math.random() < dt * 0.25 && world.getBlock(x, y + 1, z) === 0) {
        this.spawn({ x: x + Math.random(), y: y + 0.9, z: z + Math.random(), vy: 3 + Math.random() * 2, vx: (Math.random() - 0.5) * 2, vz: (Math.random() - 0.5) * 2, life: 1.2, size: 0.12, color: [6, 2, 0.3], glow: true, gravity: 12, collide: true });
      } else if ((id === B.crystal_cluster || id === B.crystal_ore) && Math.random() < dt * 0.6) {
        this.spawn({ x: x + Math.random(), y: y + Math.random(), z: z + Math.random(), vy: 0.15, life: 1.4, size: 0.06, color: [2.2, 1.4, 4], glow: true, twinkle: true });
      } else if (id === B.glow_mushroom && Math.random() < dt * 0.4) {
        this.spawn({ x: x + 0.5 + (Math.random() - 0.5) * 0.4, y: y + 0.5, z: z + 0.5 + (Math.random() - 0.5) * 0.4, vy: 0.2, vx: (Math.random() - 0.5) * 0.2, life: 2.5, size: 0.05, color: [0.4, 3, 2.6], glow: true, twinkle: true });
      } else if (d.be === 'furnace' && Math.random() < dt * 2) {
        this.spawn({ x: x + 0.5 + (Math.random() - 0.5) * 0.4, y: y + 1.05, z: z + 0.5 + (Math.random() - 0.5) * 0.4, vy: 0.7, life: 1.4, size: 0.14, color: [0.25, 0.25, 0.25], alpha: 0.45, grow: 2 });
      }
    }
    // biome ambience around the camera
    const bx = Math.floor(cam.x), bz = Math.floor(cam.z);
    const biome = BIOMES[world.biomeAt(bx, bz)] || {};
    const night = env.night || 0;
    const rain = env.rain || 0;
    if (biome.fireflies && night > 0.5 && rain < 0.3) {
      const want = 70;
      if (this.fireflies < want && Math.random() < dt * 25) {
        const a = Math.random() * Math.PI * 2, r = 4 + Math.random() * 22;
        const x = cam.x + Math.cos(a) * r, z = cam.z + Math.sin(a) * r;
        const gy = world.heightAt(Math.floor(x), Math.floor(z));
        if (gy > 0 && Math.abs(gy - cam.y) < 30 && !LIQUID[world.getBlock(Math.floor(x), gy, Math.floor(z))]) {
          this.fireflies++;
          this.spawn({ x, y: gy + 1.2 + Math.random() * 2.5, z, life: 6 + Math.random() * 6, size: 0.07, color: [2.6, 3.4, 0.9], glow: true, firefly: true, ph: Math.random() * 10, onDie: () => this.fireflies-- });
        }
      }
    }
    if (biome.petals && rain < 0.5 && Math.random() < dt * 14) {
      const a = Math.random() * Math.PI * 2, r = Math.random() * 18;
      const x = cam.x + Math.cos(a) * r, z = cam.z + Math.sin(a) * r;
      const gy = world.heightAt(Math.floor(x), Math.floor(z));
      if (BLOCKS[world.getBlock(Math.floor(x), gy, Math.floor(z))].name === 'cherry_leaves' || Math.random() < 0.3) {
        this.spawn({ x, y: Math.max(gy, cam.y) + 1 + Math.random() * 6, z, vy: -0.6, vx: 0.4, life: 7, size: 0.07, color: [1.0, 0.62, 0.78], petal: true, ph: Math.random() * 10, collide: true, light: true });
      }
    }
    // dust motes in sunbeams / underwater bubbles
    if (game.player && game.player.eyeInWater === 1 && Math.random() < dt * 5) {
      this.spawn({ x: cam.x + (Math.random() - 0.5) * 6, y: cam.y - 1 - Math.random() * 2, z: cam.z + (Math.random() - 0.5) * 6, vy: 1.2, life: 2, size: 0.06, color: [0.8, 0.9, 1], alpha: 0.7, bubble: true });
    }
  }

  update(dt, game) {
    const world = game.world;
    this.ambient(dt, game);
    for (const pool of [this.norm, this.add]) {
      const L = pool.list;
      let n = 0;
      for (let i = 0; i < L.length; i++) {
        const p = L[i];
        p.age += dt;
        if (p.age >= p.life) { if (p.onDie) p.onDie(); continue; }
        if (p.firefly) {
          p.ph += dt;
          p.vx = Math.sin(p.ph * 0.9) * 0.5; p.vy = Math.sin(p.ph * 1.3) * 0.25; p.vz = Math.cos(p.ph * 0.7) * 0.5;
        } else if (p.petal) {
          p.ph += dt;
          p.vx = 0.5 + Math.sin(p.ph * 1.7) * 0.5; p.vz = Math.cos(p.ph * 1.1) * 0.4; p.vy = -0.55 + Math.sin(p.ph * 2.3) * 0.2;
        } else if (p.bubble) {
          if (LIQUID[world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))] !== 1) { if (p.onDie) p.onDie(); continue; }
        } else {
          p.vy -= (p.gravity || 0) * dt;
          if (p.drag) { const d = Math.pow(p.drag, dt); p.vx *= d; p.vy *= d; p.vz *= d; }
        }
        let nx = p.x + p.vx * dt, ny = p.y + p.vy * dt, nz = p.z + p.vz * dt;
        if (p.collide) {
          const id = world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz));
          if (SOLID[id] || LIQUID[id]) {
            if (p.petal) { p.vx = p.vy = p.vz = 0; p.petal = false; p.life = Math.min(p.life, p.age + 2); nx = p.x; ny = p.y; nz = p.z; }
            else { if (SOLID[world.getBlock(Math.floor(p.x), Math.floor(ny), Math.floor(p.z))]) { p.vy = 0; ny = p.y; } p.vx *= 0.5; p.vz *= 0.5; nx = p.x; nz = p.z; }
          }
        }
        p.x = nx; p.y = ny; p.z = nz;
        L[n++] = p;
      }
      L.length = n;
      // upload
      const pos = pool.pos, col = pool.col, tex = pool.tex, glow = pool.glow;
      for (let i = 0; i < n; i++) {
        const p = L[i];
        const t = p.age / p.life;
        let a = p.alpha;
        if (p.firefly) a *= Math.max(0, Math.sin(p.ph * 2.2)) * Math.min(1, (p.life - p.age)) * Math.min(1, p.age);
        else if (p.twinkle) a *= Math.sin(t * Math.PI);
        else if (p.layer < 0 && !p.petal) a *= 1 - t;
        let size = p.size;
        if (p.grow) size *= 1 + t * p.grow;
        if (p.shrink) size *= 1 - t * 0.7;
        let lr = 1, lg = 1, lb = 1;
        if (p.light) {
          const Lt = world.getLight(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
          const s = (Lt >> 4) / 15, bl = (Lt & 15) / 15;
          const U = this.r.U;
          const amb = U.uAmbient.value, lc = U.uLightCol.value, bc = U.uBlockCol.value;
          const sl = s * s;
          lr = amb.x * sl + lc.x * 0.55 * sl + bc.x * bl * bl + 0.02;
          lg = amb.y * sl + lc.y * 0.55 * sl + bc.y * bl * bl + 0.02;
          lb = amb.z * sl + lc.z * 0.55 * sl + bc.z * bl * bl + 0.02;
        }
        pos[i * 3] = p.x; pos[i * 3 + 1] = p.y; pos[i * 3 + 2] = p.z;
        col[i * 4] = p.color[0] * lr; col[i * 4 + 1] = p.color[1] * lg; col[i * 4 + 2] = p.color[2] * lb; col[i * 4 + 3] = a;
        tex[i * 4] = p.layer; tex[i * 4 + 1] = p.u || 0; tex[i * 4 + 2] = p.v || 0; tex[i * 4 + 3] = size;
        glow[i] = p.glow ? 1 : 0;
      }
      pool.g.instanceCount = n;
      pool.aPos.needsUpdate = pool.aCol.needsUpdate = pool.aTex.needsUpdate = pool.aGlow.needsUpdate = true;
      pool.aPos.addUpdateRange && pool.aPos.clearUpdateRanges && (pool.aPos.clearUpdateRanges(), pool.aPos.addUpdateRange(0, n * 3), pool.aCol.clearUpdateRanges(), pool.aCol.addUpdateRange(0, n * 4), pool.aTex.clearUpdateRanges(), pool.aTex.addUpdateRange(0, n * 4), pool.aGlow.clearUpdateRanges(), pool.aGlow.addUpdateRange(0, n));
    }
  }

  clear() { for (const pool of [this.norm, this.add]) { for (const p of pool.list) if (p.onDie) p.onDie(); pool.list.length = 0; pool.g.instanceCount = 0; } }
}
