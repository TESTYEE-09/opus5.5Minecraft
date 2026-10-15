// Rain and snow streaks (GPU animated, occluded by terrain), splashes and lightning.
import * as THREE from 'three';
import { RAIN_VERT, RAIN_FRAG } from './shaders.js';
import { LAYER } from './renderer.js';
import { BIOMES } from '../world/worldgen.js';
import { LIQUID } from '../core/blocks.js';

const DROPS = 5000;

export class Weather {
  constructor(renderer) {
    this.r = renderer;
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    const seeds = new Float32Array(DROPS * 4);
    for (let i = 0; i < DROPS * 4; i++) seeds[i] = Math.random();
    g.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = DROPS;
    this.hdata = new Uint8Array(64 * 64);
    this.htex = new THREE.DataTexture(this.hdata, 64, 64, THREE.RedFormat, THREE.UnsignedByteType);
    this.htex.magFilter = this.htex.minFilter = THREE.NearestFilter;
    this.htex.needsUpdate = true;
    this.u = {
      uTime: renderer.U.uTime, uCam: { value: new THREE.Vector3() }, uSnow: { value: 0 }, uHeight: { value: this.htex },
      uHOrigin: { value: new THREE.Vector2() }, uAmount: { value: 0 }, uTintR: { value: new THREE.Vector3(0.6, 0.65, 0.75) },
    };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({ uniforms: this.u, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false }));
    this.mesh.frustumCulled = false;
    this.mesh.layers.set(LAYER.TRANSPARENT);
    this.mesh.renderOrder = 30;
    renderer.scene.add(this.mesh);
    this.rain = 0; this.thunder = 0;
    this.target = { rain: 0, thunder: 0 };
    this.hOrigin = [Infinity, Infinity];
    this.hT = 0;
    this.flash = 0;
    this.bolts = [];
    this.snow = false;
    this.local = 0;      // precipitation visible where the player stands (0 in deserts)
    this.splashT = 0;
  }

  set(rain, thunder) { this.target.rain = rain; this.target.thunder = thunder; }

  updateHeights(world, cx, cz) {
    const ox = Math.floor(cx) - 32, oz = Math.floor(cz) - 32;
    this.hOrigin = [ox, oz];
    for (let z = 0; z < 64; z++) for (let x = 0; x < 64; x++) {
      const h = world.isLoaded(ox + x, oz + z) ? world.heightAt(ox + x, oz + z) : 255;
      this.hdata[z * 64 + x] = Math.min(255, h);
    }
    this.htex.needsUpdate = true;
    this.u.uHOrigin.value.set(ox, oz);
  }

  bolt(x, y, z) {
    const pts = [];
    let px = x, pz = z;
    const top = y + 140;
    for (let yy = top; yy > y; yy -= 3 + Math.random() * 4) {
      pts.push(new THREE.Vector3(px, yy, pz));
      px += (Math.random() - 0.5) * 3.5; pz += (Math.random() - 0.5) * 3.5;
    }
    pts.push(new THREE.Vector3(x, y, z));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(14, 14, 18), transparent: true });
    const line = new THREE.Line(geo, mat);
    line.layers.set(LAYER.TRANSPARENT);
    line.frustumCulled = false;
    this.r.scene.add(line);
    // a couple of branches
    const extra = [];
    for (let b = 0; b < 3; b++) {
      const s = pts[Math.floor(Math.random() * (pts.length - 2))];
      const bp = [s.clone()];
      let q = s.clone();
      for (let k = 0; k < 5; k++) { q = q.clone().add(new THREE.Vector3((Math.random() - 0.5) * 4, -3 - Math.random() * 3, (Math.random() - 0.5) * 4)); bp.push(q); }
      const l2 = new THREE.Line(new THREE.BufferGeometry().setFromPoints(bp), mat);
      l2.layers.set(LAYER.TRANSPARENT); l2.frustumCulled = false;
      this.r.scene.add(l2); extra.push(l2);
    }
    this.bolts.push({ line, extra, t: 0.45 });
    this.flash = 1;
  }

  update(dt, game) {
    const k = 1 - Math.exp(-dt * 0.35);
    this.rain += (this.target.rain - this.rain) * k;
    this.thunder += (this.target.thunder - this.thunder) * k;
    const cam = this.r.camera.position;
    const world = game.world;
    const biome = BIOMES[world.biomeAt(Math.floor(cam.x), Math.floor(cam.z))] || {};
    const localT = biome.dry ? 0 : 1;
    this.local += (localT - this.local) * Math.min(1, dt * 0.5);
    this.snow = !!biome.snow || cam.y > 135;
    this.hT -= dt;
    if (this.hT <= 0 || Math.abs(cam.x - 32 - this.hOrigin[0]) > 6 || Math.abs(cam.z - 32 - this.hOrigin[1]) > 6) { this.hT = 0.5; this.updateHeights(world, cam.x, cam.z); }
    const amount = this.rain * this.local;
    this.u.uAmount.value = amount;
    this.u.uSnow.value = this.snow ? 1 : 0;
    this.u.uCam.value.copy(cam);
    const day = this.r.env.day ?? 1;
    this.u.uTintR.value.set(0.25 + day * 0.45, 0.28 + day * 0.47, 0.34 + day * 0.5);
    this.mesh.visible = amount > 0.01;
    // splashes on the ground near the camera
    if (amount > 0.2 && !this.snow) {
      this.splashT += dt * amount * 60;
      while (this.splashT > 1) {
        this.splashT--;
        const x = cam.x + (Math.random() - 0.5) * 20, z = cam.z + (Math.random() - 0.5) * 20;
        const h = world.heightAt(Math.floor(x), Math.floor(z));
        if (Math.abs(h - cam.y) > 20) continue;
        const top = world.getBlock(Math.floor(x), h, Math.floor(z));
        game.particles.spawn({ x, y: h + 1.02, z, vy: 1.2, vx: (Math.random() - 0.5) * 0.6, vz: (Math.random() - 0.5) * 0.6, life: 0.25, size: 0.06, color: LIQUID[top] ? [0.7, 0.8, 1] : [0.6, 0.65, 0.75], alpha: 0.6, gravity: 10, light: true });
      }
    }
    for (const b of this.bolts) {
      b.t -= dt;
      const vis = b.t > 0 && (Math.random() > 0.25);
      b.line.visible = vis; for (const e of b.extra) e.visible = vis;
    }
    this.bolts = this.bolts.filter(b => {
      if (b.t > 0) return true;
      this.r.scene.remove(b.line); b.line.geometry.dispose();
      for (const e of b.extra) { this.r.scene.remove(e); e.geometry.dispose(); }
      return false;
    });
    this.flash = Math.max(0, this.flash - dt * 3);
  }
}
