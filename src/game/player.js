// The local player: movement, survival stats and camera.
import { moveBody, overlapsSolid, liquidAt } from './physics.js';
import { Inventory } from './inventory.js';
import { B, BLOCKS, LIQUID, ITEMS } from '../core/blocks.js';

export class Player {
  constructor(game) {
    this.game = game;
    this.x = 0; this.y = 100; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0;
    this.hw = 0.3; this.h = 1.8;
    this.onGround = false;
    this.gamemode = 'survival';
    this.flying = false;
    this.health = 20; this.hunger = 20; this.saturation = 5; this.exhaustion = 0;
    this.air = 15; this.fire = 0;
    this.hurtTime = 0; this.invuln = 0; this.dead = false;
    this.sprinting = false; this.sneaking = false;
    this.inWater = 0; this.eyeInWater = 0;
    this.fallStart = null;
    this.selected = 0;
    this.inventory = new Inventory(36);
    this.spawn = null;
    this.bob = 0; this.bobAmt = 0;
    this.lastJump = 0; this.lastForward = 0;
    this.regenT = 0; this.starveT = 0; this.drownT = 0; this.lavaT = 0; this.fireT = 0; this.cactusT = 0;
    this.walkDist = 0;
    this.stepDist = 0;
    this.eyeH = 1.62;
    this.swing = 0;
    this.fovKick = 0;
    this.sleeping = false;
  }

  get creative() { return this.gamemode === 'creative'; }
  get eyeHeight() { return this.eyeH; }
  get held() { return this.inventory.slots[this.selected]; }

  addExhaustion(v) { if (!this.creative) this.exhaustion += v; }

  hasGroundAt(x, z) {
    return overlapsSolid(this.game.world, x - this.hw + 0.02, this.y - 0.62, z - this.hw + 0.02, x + this.hw - 0.02, this.y - 0.01, z + this.hw - 0.02);
  }

  update(dt, inp) {
    const world = this.game.world;
    if (this.dead) return;
    const now = performance.now();
    const active = inp && inp.enabled;
    const k = (a) => active && inp.down(a);
    // double-tap space toggles flight in creative
    if (active && inp.hit('jump')) {
      if (this.creative && now - this.lastJump < 300) { this.flying = !this.flying; this.vy = 0; }
      this.lastJump = now;
    }
    if (active && inp.hit('forward')) {
      if (now - this.lastForward < 280) this.sprinting = true;
      this.lastForward = now;
    }
    if (!this.creative) this.flying = false;

    const fwd = (k('forward') ? 1 : 0) - (k('back') ? 1 : 0);
    const str = (k('right') ? 1 : 0) - (k('left') ? 1 : 0);
    this.sneaking = k('sneak') && !this.flying;
    if (k('sprint') && fwd > 0) this.sprinting = true;
    if (fwd <= 0 || this.sneaking || (this.hunger <= 6 && !this.creative)) this.sprinting = false;

    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);
    let wx = -sy * fwd + cy * str, wz = -cy * fwd - sy * str;
    const wl = Math.hypot(wx, wz);
    if (wl > 0) { wx /= wl; wz /= wl; }

    this.inWater = liquidAt(world, this.x, this.y + 0.4, this.z);
    const eye = this.y + this.eyeH;
    this.eyeInWater = liquidAt(world, this.x, eye - 0.08, this.z);

    let speed = this.flying ? (this.sprinting ? 21.6 : 10.9) : this.sneaking ? 1.3 : this.sprinting ? 5.61 : 4.317;
    if (this.inWater && !this.flying) speed *= this.inWater === 2 ? 0.35 : 0.52;
    const below = world.getBlock(Math.floor(this.x), Math.floor(this.y - 0.1), Math.floor(this.z));
    const slippery = below === B.ice || below === B.packed_ice;
    let accel = this.flying ? 8 : this.onGround ? (slippery ? 3 : 18) : this.inWater ? 6 : 4.5;
    if (this.sleeping) speed = 0;
    const tx = wx * speed, tz = wz * speed;
    const a = 1 - Math.exp(-accel * dt);
    this.vx += (tx - this.vx) * a;
    this.vz += (tz - this.vz) * a;

    if (this.flying) {
      const up = (k('jump') ? 1 : 0) - (k('sneak') || this.keysSneakFly(inp) ? 1 : 0);
      this.vy += (up * 8 - this.vy) * (1 - Math.exp(-10 * dt));
    } else if (this.inWater) {
      this.vy -= 9 * dt;
      if (k('jump')) this.vy = Math.min(this.vy + 28 * dt, this.inWater === 2 ? 2.2 : 3.6);
      this.vy *= Math.pow(0.25, dt);
      // hop out of water onto a ledge
      if (k('jump') && this.horizontalBlocked) this.vy = Math.max(this.vy, 5.5);
    } else {
      this.vy -= 32 * dt;
      if (this.vy < -78) this.vy = -78;
      if (k('jump') && this.onGround && !this.sleeping) {
        this.vy = 9.0;
        if (this.sprinting) { this.vx += -sy * 2.2; this.vz += -cy * 2.2; this.addExhaustion(0.2); } else this.addExhaustion(0.05);
      }
    }

    let dx = this.vx * dt, dy = this.vy * dt, dz = this.vz * dt;
    // sneaking keeps you on edges
    if (this.sneaking && this.onGround) {
      if (!this.hasGroundAt(this.x + dx, this.z)) { dx = 0; this.vx = 0; }
      if (!this.hasGroundAt(this.x, this.z + dz)) { dz = 0; this.vz = 0; }
      if (!this.hasGroundAt(this.x + dx, this.z + dz)) { dx = 0; dz = 0; }
    }
    const ox = this.x, oz = this.z;
    const r = moveBody(world, this, dx, dy, dz, this.onGround && !this.flying ? 0.6 : 0);
    this.horizontalBlocked = r.hitX || r.hitZ;
    if (r.hitX) this.vx = 0;
    if (r.hitZ) this.vz = 0;
    const wasGround = this.onGround;
    this.onGround = r.hitY && dy < 0;
    if (r.hitY) { if (this.vy > 0) this.vy = 0; else if (this.vy < 0) this.vy = 0; }
    if (this.horizontalBlocked && this.sprinting && !this.inWater) this.sprinting = false;
    if (this.onGround && this.flying) this.flying = false;

    // fall damage
    if (!this.onGround && !this.flying && !this.inWater) {
      if (this.fallStart === null || this.y > this.fallStart) this.fallStart = this.y;
    }
    if (this.inWater || this.flying) this.fallStart = null;
    if (this.onGround && !wasGround) {
      if (this.fallStart !== null) {
        const dist = this.fallStart - this.y;
        if (dist > 3.4 && !this.creative) {
          const landed = world.getBlock(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z));
          const soft = landed === B.hay_block || landed === B.bed ? 0.2 : 1;
          const dmg = Math.floor((dist - 3) * soft);
          if (dmg > 0) this.damage(dmg, 'fall');
        }
        if (dist > 1.5) this.game.onLand(this, dist);
      }
      this.fallStart = null;
    }

    // walking: bob, footsteps, exhaustion
    const moved = Math.hypot(this.x - ox, this.z - oz);
    if (this.onGround) {
      this.walkDist += moved;
      this.stepDist += moved;
      this.addExhaustion(moved * (this.sprinting ? 0.1 : 0.01));
      if (this.stepDist > (this.sprinting ? 2.2 : 1.9)) { this.stepDist = 0; this.game.onFootstep(this); }
    } else if (this.inWater && moved > 0) this.addExhaustion(moved * 0.01);
    const bobTarget = this.onGround && !this.flying ? Math.min(1, moved / dt / 4.3) : 0;
    this.bobAmt += (bobTarget - this.bobAmt) * Math.min(1, dt * 10);
    this.bob += moved * 2.1;

    // eye height (sneaking)
    const targetEye = this.sneaking ? 1.27 : 1.62;
    this.eyeH += (targetEye - this.eyeH) * Math.min(1, dt * 14);
    this.h = this.sneaking ? 1.5 : 1.8;
    if (!this.sneaking && overlapsSolid(world, this.x - this.hw, this.y + 0.1, this.z - this.hw, this.x + this.hw, this.y + 1.8, this.z + this.hw)) this.h = 1.5;
    const fovT = this.sprinting ? 1 : 0;
    this.fovKick += (fovT - this.fovKick) * Math.min(1, dt * 8);

    this.survival(dt);
    if (this.swing > 0) { this.swing += dt * 3.6; if (this.swing >= 1) this.swing = 0; }
    if (this.hurtTime > 0) this.hurtTime -= dt;
    if (this.invuln > 0) this.invuln -= dt;
  }

  keysSneakFly(inp) { return inp && inp.down('sneak'); }

  survival(dt) {
    const world = this.game.world;
    if (this.y < -24) { this.damage(4 * dt * 5, 'void', true); }
    if (this.creative) { this.air = 15; this.fire = 0; return; }
    // drowning
    if (this.eyeInWater === 1) {
      this.air -= dt;
      if (this.air <= 0) { this.drownT += dt; if (this.drownT >= 1) { this.drownT = 0; this.damage(2, 'drown'); } }
    } else { this.air = Math.min(15, this.air + dt * 6); this.drownT = 0; }
    // lava & fire
    if (this.inWater === 2) { this.fire = 8; this.lavaT += dt; if (this.lavaT > 0.5) { this.lavaT = 0; this.damage(4, 'lava'); } }
    if (this.inWater === 1) this.fire = 0;
    if (this.fire > 0) {
      this.fire -= dt; this.fireT += dt;
      if (this.fireT > 1) { this.fireT = 0; this.damage(1, 'fire'); }
      if (this.game.weather && this.game.weather.rain > 0.5 && world.heightAt(Math.floor(this.x), Math.floor(this.z)) <= this.y) this.fire = Math.min(this.fire, 0.5);
    }
    // cactus
    this.cactusT += dt;
    if (this.cactusT > 0.5) {
      this.cactusT = 0;
      const x0 = Math.floor(this.x - this.hw - 0.05), x1 = Math.floor(this.x + this.hw + 0.05);
      const z0 = Math.floor(this.z - this.hw - 0.05), z1 = Math.floor(this.z + this.hw + 0.05);
      const y0 = Math.floor(this.y), y1 = Math.floor(this.y + this.h);
      let hit = false;
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (world.getBlock(x, y, z) === B.cactus) hit = true;
      if (hit) this.damage(1, 'cactus');
    }
    // hunger
    while (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else this.hunger = Math.max(0, this.hunger - 1);
      this.game.ui && this.game.ui.hudDirty();
    }
    if (this.hunger >= 18 && this.health < 20) {
      this.regenT += dt * (this.saturation > 0 && this.hunger >= 20 ? 4 : 1);
      if (this.regenT >= 4) { this.regenT = 0; this.health = Math.min(20, this.health + 1); this.addExhaustion(6); this.game.ui && this.game.ui.hudDirty(); }
    } else if (this.hunger <= 0) {
      this.starveT += dt;
      if (this.starveT > 4) { this.starveT = 0; if (this.health > 1) this.damage(1, 'starve'); }
    }
  }

  damage(amount, cause, bypass = false, kb = null) {
    if (this.dead) return false;
    if (this.creative && !bypass) return false;
    if (this.invuln > 0 && !bypass) return false;
    this.health = Math.max(0, this.health - amount);
    this.hurtTime = 0.5; this.invuln = bypass ? 0 : 0.5;
    this.addExhaustion(0.1);
    if (kb) { this.vx += kb[0]; this.vy = Math.max(this.vy, kb[1]); this.vz += kb[2]; }
    this.game.onPlayerHurt(this, amount, cause);
    if (this.health <= 0) { this.dead = true; this.game.onPlayerDeath(this, cause); }
    return true;
  }

  eat(id) {
    const it = ITEMS[id];
    if (!it || !it.food) return false;
    if (this.hunger >= 20 && !it.heal && !this.creative) return false;
    this.hunger = Math.min(20, this.hunger + it.food[0]);
    this.saturation = Math.min(this.hunger, this.saturation + it.food[1]);
    if (it.heal) this.health = Math.min(20, this.health + it.heal);
    return true;
  }

  respawn(pos) {
    this.dead = false; this.health = 20; this.hunger = 20; this.saturation = 5; this.air = 15; this.fire = 0;
    this.x = pos[0]; this.y = pos[1]; this.z = pos[2]; this.vx = this.vy = this.vz = 0; this.fallStart = null;
  }

  serialize() {
    return {
      pos: [this.x, this.y, this.z], yaw: this.yaw, pitch: this.pitch, health: this.health, hunger: this.hunger,
      saturation: this.saturation, inv: this.inventory.serialize(), selected: this.selected, gamemode: this.gamemode,
      spawn: this.spawn, flying: this.flying,
    };
  }
  load(d) {
    if (!d) return;
    [this.x, this.y, this.z] = d.pos;
    this.yaw = d.yaw || 0; this.pitch = d.pitch || 0;
    this.health = d.health ?? 20; this.hunger = d.hunger ?? 20; this.saturation = d.saturation ?? 5;
    this.inventory.load(d.inv); this.selected = d.selected || 0;
    if (d.gamemode) this.gamemode = d.gamemode;
    this.spawn = d.spawn || null; this.flying = !!d.flying && this.gamemode === 'creative';
  }
}
export { BLOCKS, LIQUID };
