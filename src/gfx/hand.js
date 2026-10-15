// First-person arm and held item, rendered in its own pass on top of the world.
import * as THREE from 'three';
import { LAYER } from './renderer.js';
import { itemMesh, isBlockLike, paintPlayerSkin } from '../entities/models.js';
import { ITEMS } from '../core/blocks.js';

export class Hand {
  constructor(renderer) {
    this.r = renderer;
    this.root = new THREE.Group();
    renderer.handScene.add(this.root);
    this.heldId = -1;
    this.itemObj = null;
    this.arm = null;
    this.equip = 1;     // 0 = lowered, 1 = raised
    this.swing = 0;
    this.useAnim = 0;
    this.sway = new THREE.Vector2();
    this.lastYaw = 0; this.lastPitch = 0;
    this.blockMat = renderer.blockEntityMaterial({ noFog: true, noShadow: true });
  }

  setLook(look) {
    if (this.arm) { this.root.remove(this.arm); }
    const skin = paintPlayerSkin(look);
    const mat = this.r.entityMaterial(skin.texture(), { noFog: true, noShadow: true });
    const b = skin.boxes.rarm;
    const g = new THREE.BoxGeometry(4 / 16, 12 / 16, 4 / 16);
    const uv = g.attributes.uv;
    const faces = [b.left, b.right, b.top, b.bottom, b.front, b.back];
    faces.forEach(([u0, v0, w, h], f) => {
      const U0 = u0 / 64, U1 = (u0 + w) / 64, V0 = 1 - v0 / 64, V1 = 1 - (v0 + h) / 64;
      uv.setXY(f * 4, U0, V0); uv.setXY(f * 4 + 1, U1, V0); uv.setXY(f * 4 + 2, U0, V1); uv.setXY(f * 4 + 3, U1, V1);
    });
    this.arm = new THREE.Mesh(g, mat);
    this.arm.layers.set(LAYER.HAND);
    this.armMat = mat;
    this.root.add(this.arm);
  }

  setItem(id) {
    if (id === this.heldId) return;
    this.heldId = id;
    if (this.itemObj) { this.root.remove(this.itemObj); this.itemObj = null; }
    if (id == null || id < 0) return;
    const m = itemMesh(id, this.r, isBlockLike(id) ? { mat: this.blockMat } : { noFog: true, noShadow: true });
    m.layers.set(LAYER.HAND);
    this.itemObj = m;
    this.itemMat = m.userData.mat;
    this.root.add(m);
  }

  doSwing() { if (this.swing <= 0 || this.swing > 0.5) this.swing = 0.0001; }

  update(dt, player, light, visible) {
    this.root.visible = visible;
    if (!visible) return;
    const held = player.held;
    const id = held ? held.id : -1;
    if (id !== this.heldId) { this.equip = 0; this.setItem(id); }
    this.equip = Math.min(1, this.equip + dt * 5);
    if (this.swing > 0) { this.swing += dt * 3.6; if (this.swing >= 1) this.swing = 0; }
    // sway follows view rotation
    let dyaw = player.yaw - this.lastYaw, dp = player.pitch - this.lastPitch;
    if (dyaw > Math.PI) dyaw -= Math.PI * 2; if (dyaw < -Math.PI) dyaw += Math.PI * 2;
    this.lastYaw = player.yaw; this.lastPitch = player.pitch;
    this.sway.x += (THREE.MathUtils.clamp(dyaw * 3, -0.3, 0.3) - this.sway.x) * Math.min(1, dt * 10);
    this.sway.y += (THREE.MathUtils.clamp(dp * 3, -0.3, 0.3) - this.sway.y) * Math.min(1, dt * 10);
    const bob = player.bob, amt = player.bobAmt;
    const bx = Math.sin(bob) * 0.02 * amt, by = -Math.abs(Math.cos(bob)) * 0.025 * amt;
    const s = this.swing;
    const sw = Math.sin(s * Math.PI), sw2 = Math.sin(Math.sqrt(s) * Math.PI);
    const eat = this.useAnim;
    const eq = (1 - this.equip) * -0.5;
    const L = light;
    if (this.armMat) this.armMat.uniforms.uEnt.value.set(L[0], L[1], 0);
    if (this.itemMat) this.itemMat.uniforms.uEnt.value.set(L[0], L[1], 0);

    const hasItem = !!this.itemObj;
    // arm: lower right, pointing forward
    this.arm.visible = !hasItem || !isBlockLike(this.heldId) || true;
    const ax = 0.42 + bx - this.sway.x * 0.2 - sw2 * 0.12;
    const ay = -0.42 + by + eq + this.sway.y * 0.1 + sw * 0.08;
    const az = -0.55 - sw * 0.12;
    this.arm.position.set(ax, ay, az);
    this.arm.rotation.set(-1.25 - sw * 0.6 + eat * 0.4, 0.25 + sw2 * 0.3, 0.12 + sw * 0.4);
    if (hasItem) {
      const block = isBlockLike(this.heldId);
      const tool = ITEMS[this.heldId] && ITEMS[this.heldId].tool;
      const o = this.itemObj;
      if (block) {
        o.scale.setScalar(0.32);
        o.position.set(0.36 + bx - this.sway.x * 0.2 - sw2 * 0.18, -0.32 + by + eq + this.sway.y * 0.1 + sw * 0.1 + eat * 0.12, -0.62 - sw * 0.15 - eat * 0.1);
        o.rotation.set(0.1 - sw * 0.5, 0.75 + sw2 * 0.35, 0);
        this.arm.position.y -= 0.06;
      } else {
        o.scale.setScalar(tool ? 0.62 : 0.48);
        o.position.set(0.40 + bx - this.sway.x * 0.2 - sw2 * 0.2, -0.27 + by + eq + this.sway.y * 0.1 + sw * 0.08 + eat * 0.15, -0.66 - sw * 0.15);
        o.rotation.set(-0.2 - sw * 1.1 + eat * 0.6, -1.45 + sw2 * 0.4 + eat * 0.5, tool ? 0.2 + sw * 0.4 : 0.05);
      }
    }
  }
}
