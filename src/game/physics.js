// Swept AABB collision against the voxel world. Shared by players, mobs and items.
import { LIQUID, BLOCKS, B } from '../core/blocks.js';

const tmp = [];

// body: { x, y, z (feet centre), hw (half width), h (height), vx, vy, vz, onGround }
// Moves the body by (dx,dy,dz) with collision; returns {hitX, hitY, hitZ}.
export function moveBody(world, body, dx, dy, dz, stepHeight = 0) {
  const hw = body.hw, h = body.h;
  const res = { hitX: false, hitY: false, hitZ: false };
  const minX = body.x - hw, maxX = body.x + hw, minY = body.y, maxY = body.y + h, minZ = body.z - hw, maxZ = body.z + hw;
  const boxes = world.collide(
    Math.min(minX, minX + dx) - 0.01, Math.min(minY, minY + dy) - 0.01, Math.min(minZ, minZ + dz) - 0.01,
    Math.max(maxX, maxX + dx) + 0.01, Math.max(maxY, maxY + dy) + stepHeight + 0.01, Math.max(maxZ, maxZ + dz) + 0.01, tmp,
  );
  const ody = dy;
  dy = clipY(boxes, body, dy);
  body.y += dy;
  if (dy !== ody) res.hitY = true;
  const odx = dx, odz = dz;
  dx = clipX(boxes, body, dx); body.x += dx;
  dz = clipZ(boxes, body, dz); body.z += dz;
  if (dx !== odx) res.hitX = true;
  if (dz !== odz) res.hitZ = true;
  // step up onto slabs / single blocks when walking into them
  if (stepHeight > 0 && (res.hitX || res.hitZ) && (body.onGround || ody < 0 && res.hitY)) {
    const save = { x: body.x - dx, y: body.y, z: body.z - dz };
    const t = { x: save.x, y: save.y, z: save.z, hw, h };
    let up = clipY(boxes, t, stepHeight); t.y += up;
    let sx = clipX(boxes, t, odx); t.x += sx;
    let sz = clipZ(boxes, t, odz); t.z += sz;
    let down = clipY(boxes, t, -up); t.y += down;
    if (sx * sx + sz * sz > dx * dx + dz * dz + 1e-6) {
      body.x = t.x; body.y = t.y; body.z = t.z;
      res.hitX = Math.abs(sx - odx) > 1e-6; res.hitZ = Math.abs(sz - odz) > 1e-6;
      res.stepped = t.y - save.y;
    }
  }
  return res;
}

function clipY(boxes, b, dy) {
  const minX = b.x - b.hw, maxX = b.x + b.hw, minZ = b.z - b.hw, maxZ = b.z + b.hw, minY = b.y, maxY = b.y + b.h;
  for (const c of boxes) {
    if (c[3] <= minX + 1e-7 || c[0] >= maxX - 1e-7 || c[5] <= minZ + 1e-7 || c[2] >= maxZ - 1e-7) continue;
    if (dy > 0 && c[1] >= maxY - 1e-7) dy = Math.min(dy, c[1] - maxY);
    else if (dy < 0 && c[4] <= minY + 1e-7) dy = Math.max(dy, c[4] - minY);
  }
  return dy;
}
function clipX(boxes, b, dx) {
  const minY = b.y, maxY = b.y + b.h, minZ = b.z - b.hw, maxZ = b.z + b.hw, minX = b.x - b.hw, maxX = b.x + b.hw;
  for (const c of boxes) {
    if (c[4] <= minY + 1e-7 || c[1] >= maxY - 1e-7 || c[5] <= minZ + 1e-7 || c[2] >= maxZ - 1e-7) continue;
    if (dx > 0 && c[0] >= maxX - 1e-7) dx = Math.min(dx, c[0] - maxX);
    else if (dx < 0 && c[3] <= minX + 1e-7) dx = Math.max(dx, c[3] - minX);
  }
  return dx;
}
function clipZ(boxes, b, dz) {
  const minY = b.y, maxY = b.y + b.h, minX = b.x - b.hw, maxX = b.x + b.hw, minZ = b.z - b.hw, maxZ = b.z + b.hw;
  for (const c of boxes) {
    if (c[4] <= minY + 1e-7 || c[1] >= maxY - 1e-7 || c[3] <= minX + 1e-7 || c[0] >= maxX - 1e-7) continue;
    if (dz > 0 && c[2] >= maxZ - 1e-7) dz = Math.min(dz, c[2] - maxZ);
    else if (dz < 0 && c[5] <= minZ + 1e-7) dz = Math.max(dz, c[5] - minZ);
  }
  return dz;
}

export function overlapsSolid(world, x0, y0, z0, x1, y1, z1) {
  return world.collide(x0, y0, z0, x1, y1, z1, tmp).some(c => c[0] < x1 && c[3] > x0 && c[1] < y1 && c[4] > y0 && c[2] < z1 && c[5] > z0);
}

// Which liquid (0/1/2) is at a body's feet, waist, eyes
export function liquidAt(world, x, y, z) {
  const id = world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  const l = LIQUID[id];
  if (!l) return 0;
  // flowing liquid surface height
  const lv = BLOCKS[id].level;
  const top = (lv === 0 || lv === 8) ? 0.9 : (8 - lv) / 9;
  return (y - Math.floor(y)) <= top + 0.05 || LIQUID[world.getBlock(Math.floor(x), Math.floor(y) + 1, Math.floor(z))] ? l : 0;
}

// Generic physics step for mobs / items. opts: gravity, drag, step
export function stepBody(world, b, dt, opts = {}) {
  const g = opts.gravity ?? 30;
  const wl = liquidAt(world, b.x, b.y + 0.3, b.z);
  b.inLiquid = wl;
  if (wl) {
    b.vy -= g * 0.25 * dt;
    if (opts.floats) b.vy += 18 * dt;
    const d = Math.pow(wl === 2 ? 0.2 : 0.35, dt);
    b.vx *= d; b.vz *= d; b.vy *= Math.pow(0.4, dt);
  } else {
    b.vy -= g * dt;
    if (b.vy < -60) b.vy = -60;
  }
  const r = moveBody(world, b, b.vx * dt, b.vy * dt, b.vz * dt, opts.step || 0);
  const wasGround = b.onGround;
  b.onGround = r.hitY && b.vy < 0;
  if (r.hitY) b.vy = 0;
  if (r.hitX) b.vx = opts.bounce ? -b.vx * 0.3 : 0;
  if (r.hitZ) b.vz = opts.bounce ? -b.vz * 0.3 : 0;
  if (b.onGround) {
    const below = world.getBlock(Math.floor(b.x), Math.floor(b.y - 0.05), Math.floor(b.z));
    const slip = below === B.ice || below === B.packed_ice;
    const f = Math.pow(slip ? 0.6 : (opts.groundFriction ?? 0.002), dt);
    b.vx *= f; b.vz *= f;
  } else if (!wl) {
    const f = Math.pow(opts.airDrag ?? 0.6, dt);
    b.vx *= f; b.vz *= f;
  }
  b.landed = !wasGround && b.onGround;
  return r;
}
