// Box-model entities (players and mobs) with procedurally painted skins,
// plus 3D item meshes (mini blocks and extruded sprites).
import * as THREE from 'three';
import { BLOCKS, SHAPES, SHAPE, FACE_TEX, FACE_ROT, FACE_OVERLAY, TINTS, TINT, MATF, ITEMS, WAVES } from '../core/blocks.js';
import { itemPixels } from '../gfx/textures.js';
import { mulberry32, hashString } from '../core/noise.js';

const PX = 1 / 16;

// ------------------------------------------------------------------ skin painting
class Skin {
  constructor(w, h) {
    this.w = w; this.h = h;
    this.c = document.createElement('canvas'); this.c.width = w; this.c.height = h;
    this.x = this.c.getContext('2d');
    this.boxes = {};
  }
  // MC-style unwrap rectangles for a box of size (w,h,d) at (u,v)
  layout(name, u, v, w, h, d) {
    this.boxes[name] = {
      u, v, w, h, d,
      top: [u + d, v, w, d], bottom: [u + d + w, v, w, d],
      right: [u, v + d, d, h], front: [u + d, v + d, w, h], left: [u + d + w, v + d, d, h], back: [u + d + w + d, v + d, w, h],
    };
    return this.boxes[name];
  }
  fill(rect, color, noise = 0.06, seed = 1) {
    const [x0, y0, w, h] = rect;
    const r = mulberry32(seed + x0 * 31 + y0 * 17);
    const c = new THREE.Color(color);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const f = 1 + (r() - 0.5) * 2 * noise;
      this.x.fillStyle = `rgb(${Math.min(255, c.r * 255 * f)},${Math.min(255, c.g * 255 * f)},${Math.min(255, c.b * 255 * f)})`;
      this.x.fillRect(x0 + x, y0 + y, 1, 1);
    }
  }
  boxFill(name, color, noise, seed) { const b = this.boxes[name]; for (const f of ['top', 'bottom', 'right', 'front', 'left', 'back']) this.fill(b[f], color, noise, seed); }
  px(rect, x, y, color, w = 1, h = 1) { this.x.fillStyle = color; this.x.fillRect(rect[0] + x, rect[1] + y, w, h); }
  // paint a horizontal band (y from top of box) across the 4 side faces
  band(name, y0, y1, color, noise = 0.05, seed = 3) {
    const b = this.boxes[name];
    for (const f of ['right', 'front', 'left', 'back']) {
      const r = b[f];
      this.fill([r[0], r[1] + y0, r[2], Math.min(r[3], y1) - y0], color, noise, seed);
    }
  }
  texture() {
    const t = new THREE.CanvasTexture(this.c);
    t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false;
    t.colorSpace = THREE.NoColorSpace;
    return t;
  }
}

function boxGeo(skin, name, w, h, d, inflate = 0) {
  const b = skin.boxes[name];
  const g = new THREE.BoxGeometry((w + inflate * 2) * PX, (h + inflate * 2) * PX, (d + inflate * 2) * PX);
  const uv = g.attributes.uv;
  const faces = [b.left, b.right, b.top, b.bottom, b.front, b.back]; // +X, -X, +Y, -Y, +Z, -Z
  const W = skin.w, Hh = skin.h;
  for (let f = 0; f < 6; f++) {
    const [u0, v0, rw, rh] = faces[f];
    let U0 = u0 / W, U1 = (u0 + rw) / W, V0 = 1 - v0 / Hh, V1 = 1 - (v0 + rh) / Hh;
    if (f === 3) { const t = V0; V0 = V1; V1 = t; } // bottom faces are flipped in MC skins
    uv.setXY(f * 4 + 0, U0, V0); uv.setXY(f * 4 + 1, U1, V0); uv.setXY(f * 4 + 2, U0, V1); uv.setXY(f * 4 + 3, U1, V1);
  }
  return g;
}

// A part: pivot group + mesh offset so it rotates around the pivot.
function part(parent, skin, mat, name, size, pivot, offset, inflate = 0) {
  const grp = new THREE.Group();
  grp.position.set(pivot[0] * PX, pivot[1] * PX, pivot[2] * PX);
  const m = new THREE.Mesh(boxGeo(skin, name, size[0], size[1], size[2], inflate), mat);
  m.position.set(offset[0] * PX, offset[1] * PX, offset[2] * PX);
  grp.add(m);
  parent.add(grp);
  return grp;
}

// ------------------------------------------------------------------ player
export const SKIN_TONES = ['#f2d0b4', '#e8b896', '#d29a72', '#b07a52', '#8a5a3a', '#5e3c26'];
export const HAIR_COLORS = ['#2a1c12', '#5a3a1e', '#8a5a2e', '#d8b060', '#e8e0c8', '#a82a1a', '#3a3a3a', '#6a3aa8'];
export const SHIRT_COLORS = ['#3a7bd5', '#d5523a', '#3aa86a', '#e0b030', '#8a4ad5', '#2a2a32', '#e8e8e8', '#e07ab0', '#1fa3a8'];
export const PANTS_COLORS = ['#2a3a6a', '#3a3a3a', '#5a4a3a', '#2a5a3a', '#6a2a2a', '#d8d0c0'];
export function defaultLook(seed = Math.random() * 1e9) {
  const r = mulberry32(seed >>> 0);
  const pick = (a) => a[Math.floor(r() * a.length)];
  return { skin: pick(SKIN_TONES), hair: pick(HAIR_COLORS), hairStyle: Math.floor(r() * 3), shirt: pick(SHIRT_COLORS), pants: pick(PANTS_COLORS), eyes: pick(['#3a6ad5', '#3a8a4a', '#5a3a1e', '#2a2a2a']) };
}

export function paintPlayerSkin(look, kind = 'player') {
  look = look || {};
  const s = new Skin(64, 64);
  s.layout('head', 0, 0, 8, 8, 8);
  s.layout('hat', 32, 0, 8, 8, 8);
  s.layout('body', 16, 16, 8, 12, 4);
  s.layout('rarm', 40, 16, 4, 12, 4);
  s.layout('larm', 32, 48, 4, 12, 4);
  s.layout('rleg', 0, 16, 4, 12, 4);
  s.layout('lleg', 16, 48, 4, 12, 4);
  const seed = hashString(JSON.stringify(look));
  let skin = look.skin, shirt = look.shirt, pants = look.pants, hair = look.hair;
  if (kind === 'zombie') { skin = '#5a9a52'; shirt = '#2f8a9a'; pants = '#3a3a8a'; hair = '#2f5a2a'; }
  if (kind === 'skeleton') { skin = '#c8c8c0'; shirt = '#b8b8b0'; pants = '#a8a8a0'; hair = '#c8c8c0'; }
  if (kind === 'verity') { skin = '#f3e9e6'; shirt = '#f6f6f8'; pants = '#f6f6f8'; hair = '#121016'; look = { ...look, hairStyle: 1 }; }
  if (kind === 'verity_demon') { skin = '#2e2a2e'; shirt = '#141016'; pants = '#141016'; hair = '#060508'; look = { ...look, hairStyle: 1 }; }
  // head
  s.boxFill('head', skin, 0.05, seed);
  const hd = s.boxes.head;
  if (kind !== 'skeleton') {
    // hair on top, back and sides
    s.fill(hd.top, hair, 0.12, seed + 1);
    s.fill(hd.back, hair, 0.12, seed + 2);
    const hairLen = look.hairStyle === 1 ? 7 : look.hairStyle === 2 ? 1 : 3;
    for (const f of ['right', 'left']) s.fill([hd[f][0], hd[f][1], 8, hairLen], hair, 0.12, seed + 3);
    s.fill([hd.front[0], hd.front[1], 8, look.hairStyle === 2 ? 1 : 2], hair, 0.12, seed + 4);
    if (look.hairStyle === 1) { s.fill([hd.front[0], hd.front[1] + 2, 1, 5], hair, 0.1, seed); s.fill([hd.front[0] + 7, hd.front[1] + 2, 1, 5], hair, 0.1, seed); }
  }
  const F = hd.front;
  // eyes
  if (kind === 'skeleton') {
    s.px(F, 1, 3, '#1a1a1a', 2, 2); s.px(F, 5, 3, '#1a1a1a', 2, 2); s.px(F, 3, 5, '#2a2a2a', 2, 1); s.px(F, 2, 6, '#3a3a3a', 4, 1);
  } else if (kind === 'verity') {
    s.px(F, 2, 4, '#050407', 1, 2); s.px(F, 5, 4, '#050407', 1, 2);
    s.px(F, 3, 6, '#d8b8b4', 2, 1);
    s.px(F, 1, 6, '#f0c8c8'); s.px(F, 6, 6, '#f0c8c8');
  } else if (kind === 'verity_demon') {
    s.px(F, 1, 3, '#ff1a1a', 2, 2); s.px(F, 5, 3, '#ff1a1a', 2, 2); s.px(F, 2, 3, '#ffd0d0'); s.px(F, 5, 3, '#ffd0d0');
    s.px(F, 1, 6, '#000000', 6, 1); s.px(F, 2, 7, '#000000'); s.px(F, 5, 7, '#000000'); s.px(F, 3, 6, '#ff3a3a', 2, 1);
  } else {
    s.px(F, 1, 4, '#ffffff', 2, 1); s.px(F, 5, 4, '#ffffff', 2, 1);
    s.px(F, kind === 'zombie' ? 1 : 2, 4, kind === 'zombie' ? '#1a1a1a' : look.eyes); s.px(F, kind === 'zombie' ? 6 : 5, 4, kind === 'zombie' ? '#1a1a1a' : look.eyes);
    s.px(F, 3, 6, kind === 'zombie' ? '#3a6a32' : shade(skin, 0.8), 2, 1);
    s.px(F, 3, 5, shade(skin, 0.92), 2, 1);
  }
  // body shirt + belt
  s.boxFill('body', shirt, 0.07, seed + 5);
  s.band('body', 10, 12, pants, 0.05);
  if (kind === 'player') s.px(s.boxes.body.front, 3, 0, shade(shirt, 0.75), 2, 2);
  if (kind === 'verity' || kind === 'verity_demon') {
    // long hair falls over the back of the dress
    s.fill([s.boxes.body.back[0], s.boxes.body.back[1], 8, 7], hair, 0.1, seed + 9);
    if (kind === 'verity_demon') for (let k = 0; k < 6; k++) s.px(s.boxes.body.front, k, 10 + (k % 2), '#000000');
  }
  if (kind === 'skeleton') {
    s.boxFill('body', '#2a2a2a', 0, seed);
    for (let y = 1; y < 10; y += 2) s.px(s.boxes.body.front, 1, y, '#c8c8c0', 6, 1);
    s.px(s.boxes.body.front, 3, 0, '#c8c8c0', 2, 12);
  }
  // arms: sleeves + skin
  for (const a of ['rarm', 'larm']) {
    s.boxFill(a, skin, 0.05, seed + 6);
    if (kind !== 'skeleton') s.band(a, 0, kind === 'zombie' ? 6 : 4, shirt, 0.07);
    s.fill(s.boxes[a].top, kind === 'skeleton' ? skin : shirt, 0.05);
  }
  // legs
  for (const l of ['rleg', 'lleg']) {
    s.boxFill(l, pants, 0.06, seed + 7);
    if (kind === 'player') s.band(l, 10, 12, '#3a2a1e', 0.08);
    if (kind === 'skeleton') s.boxFill(l, skin, 0.05, seed);
  }
  // transparent hat layer
  s.x.clearRect(32, 0, 32, 16);
  return s;
}
function shade(hex, f) {
  const c = new THREE.Color(hex); c.multiplyScalar(f);
  return '#' + c.getHexString();
}

export function buildHumanoid(skin, mat, opts = {}) {
  const root = new THREE.Group();
  const scale = opts.scale ?? 0.9375;
  const body = new THREE.Group();
  body.scale.setScalar(scale);
  root.add(body);
  const thin = opts.thin ? 2 : 4;
  const parts = {};
  parts.lleg = part(body, skin, mat, 'lleg', [thin, 12, thin], [2, 12, 0], [0, -6, 0]);
  parts.rleg = part(body, skin, mat, 'rleg', [thin, 12, thin], [-2, 12, 0], [0, -6, 0]);
  parts.body = part(body, skin, mat, 'body', [8, 12, 4], [0, 24, 0], [0, -6, 0]);
  parts.larm = part(body, skin, mat, 'larm', [thin, 12, thin], [5 + (opts.thin ? -1 : 0), 22, 0], [1, -4, 0]);
  parts.rarm = part(body, skin, mat, 'rarm', [thin, 12, thin], [-5 - (opts.thin ? -1 : 0), 22, 0], [-1, -4, 0]);
  parts.head = part(body, skin, mat, 'head', [8, 8, 8], [0, 24, 0], [0, 4, 0]);
  root.userData.parts = parts;
  root.userData.kind = 'humanoid';
  root.userData.height = 1.8;
  return root;
}

// ------------------------------------------------------------------ animals
function paintQuadruped(kind) {
  const s = new Skin(64, 64);
  const seed = hashString(kind);
  if (kind === 'pig') {
    s.layout('head', 0, 0, 8, 8, 8); s.layout('snout', 32, 0, 4, 3, 1); s.layout('body', 0, 16, 10, 8, 16); s.layout('leg', 0, 44, 4, 6, 4);
    s.boxFill('head', '#f0a0a0', 0.06, seed); s.boxFill('body', '#f0a0a0', 0.07, seed + 1); s.boxFill('leg', '#e89090', 0.06, seed + 2);
    s.boxFill('snout', '#e88080', 0.05, seed); s.px(s.boxes.snout.front, 0, 1, '#9a4a4a'); s.px(s.boxes.snout.front, 3, 1, '#9a4a4a');
    const F = s.boxes.head.front; s.px(F, 0, 3, '#ffffff', 2, 1); s.px(F, 6, 3, '#ffffff', 2, 1); s.px(F, 1, 3, '#1a1a1a'); s.px(F, 6, 3, '#1a1a1a');
    s.fill([s.boxes.leg.bottom[0], s.boxes.leg.bottom[1], 4, 4], '#6a4a3a');
    s.band('leg', 5, 6, '#7a5a4a');
  } else if (kind === 'cow') {
    s.layout('head', 0, 0, 8, 8, 6); s.layout('horn', 24, 0, 1, 3, 1); s.layout('body', 0, 16, 12, 10, 18); s.layout('leg', 0, 48, 4, 12, 4); s.layout('udder', 52, 0, 4, 1, 6);
    s.boxFill('head', '#3a2a22', 0.08, seed); s.boxFill('body', '#3a2a22', 0.08, seed + 1); s.boxFill('leg', '#3a2a22', 0.08, seed + 2);
    const r = mulberry32(seed);
    for (const f of ['top', 'right', 'left', 'back', 'front']) { const rc = s.boxes.body[f]; for (let k = 0; k < 4; k++) { const w = 3 + Math.floor(r() * 5), h = 2 + Math.floor(r() * 4); s.fill([rc[0] + Math.floor(r() * Math.max(1, rc[2] - w)), rc[1] + Math.floor(r() * Math.max(1, rc[3] - h)), w, h], '#e8e4dc', 0.05); } }
    s.band('leg', 8, 12, '#e8e4dc', 0.05); s.band('leg', 11, 12, '#2a2a2a', 0.05);
    s.boxFill('horn', '#d8d0b8', 0.05); s.boxFill('udder', '#f0a0a0', 0.05);
    const F = s.boxes.head.front; s.fill([F[0] + 2, F[1] + 5, 4, 3], '#b89a8a', 0.05); s.px(F, 2, 6, '#3a2a2a'); s.px(F, 5, 6, '#3a2a2a');
    s.px(F, 0, 2, '#ffffff', 2, 1); s.px(F, 6, 2, '#ffffff', 2, 1); s.px(F, 0, 2, '#1a1a1a'); s.px(F, 7, 2, '#1a1a1a');
    s.fill([F[0] + 2, F[1], 4, 2], '#e8e4dc');
  } else if (kind === 'sheep') {
    s.layout('head', 0, 0, 6, 6, 8); s.layout('wool_head', 32, 0, 6, 6, 6); s.layout('body', 0, 16, 10, 10, 16); s.layout('leg', 0, 48, 4, 12, 4);
    s.boxFill('head', '#c8bcae', 0.05, seed); s.boxFill('body', '#ecebe6', 0.09, seed + 1); s.boxFill('leg', '#ecebe6', 0.08, seed + 2);
    s.band('leg', 6, 12, '#c8bcae', 0.05);
    s.boxFill('wool_head', '#ecebe6', 0.09);
    const F = s.boxes.head.front; s.px(F, 0, 2, '#ffffff', 2, 1); s.px(F, 4, 2, '#ffffff', 2, 1); s.px(F, 0, 2, '#1a1a1a'); s.px(F, 5, 2, '#1a1a1a'); s.px(F, 2, 4, '#e8a0a0', 2, 1);
  } else if (kind === 'chicken') {
    s.layout('head', 0, 0, 4, 6, 3); s.layout('beak', 14, 0, 4, 2, 2); s.layout('wattle', 14, 4, 2, 2, 2); s.layout('body', 0, 9, 6, 8, 6); s.layout('leg', 26, 0, 3, 5, 3); s.layout('wing', 24, 13, 1, 4, 6);
    s.boxFill('head', '#f4f4f0', 0.04, seed); s.boxFill('body', '#f4f4f0', 0.06, seed + 1); s.boxFill('wing', '#e8e8e2', 0.05);
    s.boxFill('beak', '#f0b030', 0.05); s.boxFill('wattle', '#d82a2a', 0.05); s.boxFill('leg', '#e8a020', 0.05);
    const F = s.boxes.head.front; s.px(F, 0, 1, '#1a1a1a'); s.px(F, 3, 1, '#1a1a1a');
  } else if (kind === 'spider') {
    s.layout('head', 32, 4, 8, 8, 8); s.layout('neck', 0, 0, 6, 6, 6); s.layout('body', 0, 12, 10, 8, 12); s.layout('leg', 18, 0, 16, 2, 2);
    s.boxFill('head', '#2a2422', 0.1, seed); s.boxFill('neck', '#2a2422', 0.1); s.boxFill('body', '#2e2622', 0.12, seed + 1); s.boxFill('leg', '#2a2422', 0.1);
    const r = mulberry32(seed + 5);
    for (const f of ['top', 'back']) { const rc = s.boxes.body[f]; for (let k = 0; k < 8; k++) s.px(rc, Math.floor(r() * rc[2]), Math.floor(r() * rc[3]), '#4a3a32'); }
    const F = s.boxes.head.front;
    s.px(F, 1, 3, '#ff2a2a', 2, 1); s.px(F, 5, 3, '#ff2a2a', 2, 1); s.px(F, 2, 2, '#ff4a2a'); s.px(F, 5, 2, '#ff4a2a'); s.px(F, 0, 5, '#cc1a1a'); s.px(F, 7, 5, '#cc1a1a');
  }
  return s;
}

export function buildMob(kind, renderer) {
  if (kind === 'verity' || kind === 'verity_demon') {
    const skin = paintPlayerSkin(defaultLook(7), kind);
    const mat = renderer.entityMaterial(skin.texture(), { emissive: kind === 'verity_demon' ? 0.12 : 0 });
    const m = buildHumanoid(skin, mat, { scale: kind === 'verity' ? 0.55 : 1.2 });
    m.userData.mat = mat;
    m.userData.height = kind === 'verity' ? 1.05 : 2.3;
    return m;
  }
  if (kind === 'zombie' || kind === 'skeleton') {
    const skin = paintPlayerSkin(defaultLook(1), kind);
    const mat = renderer.entityMaterial(skin.texture());
    const m = buildHumanoid(skin, mat, { thin: kind === 'skeleton' });
    m.userData.mat = mat;
    m.userData.height = kind === 'skeleton' ? 1.95 : 1.9;
    return m;
  }
  const skin = paintQuadruped(kind);
  const tex = skin.texture();
  const mat = renderer.entityMaterial(tex);
  const root = new THREE.Group();
  const P = {};
  root.userData.mat = mat;
  root.userData.parts = P;
  if (kind === 'pig') {
    P.body = part(root, skin, mat, 'body', [10, 8, 16], [0, 10, 0], [0, 0, 0]);
    P.head = part(root, skin, mat, 'head', [8, 8, 8], [0, 12, 8], [0, 0, 3]);
    part(P.head, skin, mat, 'snout', [4, 3, 1], [0, -1.5, 7.5], [0, 0, 0]);
    P.legs = [[-3, 6, 5], [3, 6, 5], [-3, 6, -5], [3, 6, -5]].map(p => part(root, skin, mat, 'leg', [4, 6, 4], p, [0, -3, 0]));
    root.userData.height = 0.9;
  } else if (kind === 'cow') {
    P.body = part(root, skin, mat, 'body', [12, 10, 18], [0, 17, 0], [0, 0, 0]);
    P.head = part(root, skin, mat, 'head', [8, 8, 6], [0, 20, 9], [0, 0, 3]);
    part(P.head, skin, mat, 'horn', [1, 3, 1], [-4.5, 4, 3], [0, 0, 0]);
    part(P.head, skin, mat, 'horn', [1, 3, 1], [4.5, 4, 3], [0, 0, 0]);
    part(root, skin, mat, 'udder', [4, 1, 6], [0, 11.5, -2], [0, 0, 0]);
    P.legs = [[-4, 12, 6], [4, 12, 6], [-4, 12, -7], [4, 12, -7]].map(p => part(root, skin, mat, 'leg', [4, 12, 4], p, [0, -6, 0]));
    root.userData.height = 1.4;
  } else if (kind === 'sheep') {
    P.body = part(root, skin, mat, 'body', [10, 10, 16], [0, 17, 0], [0, 0, 0]);
    P.head = part(root, skin, mat, 'head', [6, 6, 8], [0, 18, 7], [0, 1, 3]);
    part(P.head, skin, mat, 'wool_head', [6, 6, 6], [0, 1.6, 2.2], [0, 0, 0], 0.6);
    P.legs = [[-3, 12, 5], [3, 12, 5], [-3, 12, -5], [3, 12, -5]].map(p => part(root, skin, mat, 'leg', [4, 12, 4], p, [0, -6, 0]));
    root.userData.height = 1.3;
  } else if (kind === 'chicken') {
    P.body = part(root, skin, mat, 'body', [6, 8, 6], [0, 8, 0], [0, 0, 0]);
    P.body.rotation.x = Math.PI / 2;
    P.head = part(root, skin, mat, 'head', [4, 6, 3], [0, 10, 4], [0, 1, 0]);
    part(P.head, skin, mat, 'beak', [4, 2, 2], [0, 2, 2.5], [0, 0, 0]);
    part(P.head, skin, mat, 'wattle', [2, 2, 2], [0, 0, 2], [0, 0, 0]);
    P.wings = [part(root, skin, mat, 'wing', [1, 4, 6], [-3.5, 11, 0], [0, -2, 0]), part(root, skin, mat, 'wing', [1, 4, 6], [3.5, 11, 0], [0, -2, 0])];
    P.legs = [part(root, skin, mat, 'leg', [3, 5, 3], [-1.5, 5, 0.5], [0, -2.5, 0]), part(root, skin, mat, 'leg', [3, 5, 3], [1.5, 5, 0.5], [0, -2.5, 0])];
    root.userData.height = 0.7;
  } else if (kind === 'spider') {
    P.body = part(root, skin, mat, 'body', [10, 8, 12], [0, 9, -9], [0, 0, 0]);
    part(root, skin, mat, 'neck', [6, 6, 6], [0, 9, 0], [0, 0, 0]);
    P.head = part(root, skin, mat, 'head', [8, 8, 8], [0, 9, 3], [0, 0, 4]);
    P.legs = [];
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1;
      const k = i % 4;
      const g = part(root, skin, mat, 'leg', [16, 2, 2], [side * 4, 9, 2 - k * 2], [side * 8, 0, 0]);
      g.rotation.z = side * 0.6;
      g.rotation.y = (k - 1.5) * 0.35 * side;
      g.userData.base = { z: g.rotation.z, y: g.rotation.y, side, k };
      P.legs.push(g);
    }
    root.userData.height = 0.9;
  }
  root.userData.kind = kind;
  return root;
}

// ------------------------------------------------------------------ animation
export function animateModel(model, s, dt) {
  // s: { walk (0..1 speed), phase, headYaw, headPitch, swing (0..1), sneak, hurt, holding, aim }
  const P = model.userData.parts;
  if (!P) return;
  const sw = Math.sin(s.phase) * 0.9 * s.walk;
  if (model.userData.kind === 'humanoid') {
    P.lleg.rotation.x = sw; P.rleg.rotation.x = -sw;
    P.larm.rotation.x = -sw * 0.8; P.rarm.rotation.x = sw * 0.8;
    P.larm.rotation.z = 0.06 + Math.sin(s.t * 1.3) * 0.03; P.rarm.rotation.z = -0.06 - Math.sin(s.t * 1.3) * 0.03;
    if (s.zombie) { P.larm.rotation.x = -1.45 + sw * 0.15; P.rarm.rotation.x = -1.45 - sw * 0.15; }
    if (s.aim) { P.rarm.rotation.x = -1.5 + s.headPitch; P.larm.rotation.x = -1.4 + s.headPitch; P.larm.rotation.y = 0.5; }
    if (s.holding && !s.zombie && !s.aim) P.rarm.rotation.x = sw * 0.5 - 0.3;
    if (s.swing > 0) {
      const a = Math.sin(s.swing * Math.PI);
      P.rarm.rotation.x = -1.2 * a - 0.4 * Math.sin(s.swing * Math.PI * 2);
      P.rarm.rotation.y = -0.4 * a;
    } else P.rarm.rotation.y = 0;
    P.head.rotation.y = s.headYaw; P.head.rotation.x = s.headPitch;
    const sneak = s.sneak ? 1 : 0;
    P.body.rotation.x = sneak * 0.45;
    P.head.position.z = sneak * 0.12; P.larm.position.z = P.rarm.position.z = sneak * 0.1;
    P.head.position.y = (24 - sneak * 1.5) / 16; P.body.position.y = (24 - sneak * 1.5) / 16;
    P.larm.position.y = P.rarm.position.y = (22 - sneak * 1.5) / 16;
  } else {
    if (P.legs) {
      if (model.userData.kind === 'spider') {
        P.legs.forEach((g, i) => {
          const b = g.userData.base; const ph = s.phase * 1.5 + (i % 2) * Math.PI + b.k;
          g.rotation.y = b.y + Math.sin(ph) * 0.35 * s.walk;
          g.rotation.z = b.z + Math.abs(Math.cos(ph)) * 0.25 * s.walk * b.side;
        });
      } else P.legs.forEach((g, i) => { g.rotation.x = (i === 0 || i === 3 ? sw : -sw); });
    }
    if (P.wings) { const f = s.flap || 0; P.wings[0].rotation.z = f; P.wings[1].rotation.z = -f; }
    if (P.head) { P.head.rotation.y = s.headYaw; P.head.rotation.x = s.headPitch + (s.graze || 0); }
  }
}

export function setModelLight(model, sky, block, hurt) {
  const m = model.userData.mat;
  if (m) m.uniforms.uEnt.value.set(sky, block, hurt);
}

// ------------------------------------------------------------------ item meshes
const itemGeoCache = new Map();
const itemTexCache = new Map();

// Mini block geometry with chunk-style attributes (rendered with blockEntityMaterial).
export function blockGeometry(id) {
  if (itemGeoCache.has('b' + id)) return itemGeoCache.get('b' + id);
  const def = BLOCKS[id];
  const boxes = SHAPES[id] === SHAPE.BOXES ? def.boxes : [[0, 0, 0, 16, 16, 16]];
  const pos = [], A = [], Bb = [], T = [];
  const N = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const U = [[0, 0, -1], [0, 0, 1], [1, 0, 0], [1, 0, 0], [1, 0, 0], [-1, 0, 0]];
  const V = [[0, 1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [0, 1, 0], [0, 1, 0]];
  const tints = { [TINT.GRASS]: [125, 191, 77], [TINT.FOLIAGE]: [107, 173, 61], [TINT.BIRCH]: [128, 167, 85], [TINT.SPRUCE]: [97, 135, 98] };
  for (const bx of boxes) {
    const mn = [bx[0] / 16, bx[1] / 16, bx[2] / 16], mx = [bx[3] / 16, bx[4] / 16, bx[5] / 16];
    for (let d = 0; d < 6; d++) {
      const corners = [];
      for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) {
        const pc = [0, 0, 0];
        for (let k = 0; k < 3; k++) {
          const half = (mx[k] - mn[k]) / 2, ctr = (mx[k] + mn[k]) / 2;
          pc[k] = ctr + N[d][k] * half + U[d][k] * (u - 0.5) * 2 * half + V[d][k] * (v - 0.5) * 2 * half;
        }
        const tu = (pc[0] - 0.5) * U[d][0] + (pc[1] - 0.5) * U[d][1] + (pc[2] - 0.5) * U[d][2] + 0.5;
        const tv = (pc[0] - 0.5) * V[d][0] + (pc[1] - 0.5) * V[d][1] + (pc[2] - 0.5) * V[d][2] + 0.5;
        const rot = FACE_ROT[id * 6 + d];
        corners.push([pc[0] - 0.5, pc[1] - 0.5, pc[2] - 0.5, Math.round((rot ? tv : tu) * 16), Math.round((rot ? 1 - tu : tv) * 16)]);
      }
      let tint = tints[TINTS[id]] || [255, 255, 255];
      if (def.name === 'grass' && d === 3) tint = [255, 255, 255];
      const flags = (FACE_OVERLAY[id * 6 + d] << 2) | (MATF[id] << 4);
      for (const c of [0, 1, 2, 0, 2, 3]) {
        const q = corners[c];
        pos.push(q[0], q[1], q[2]);
        A.push(d, 3, 255, 0);
        Bb.push(FACE_TEX[id * 6 + d], q[3], q[4], flags);
        T.push(tint[0], tint[1], tint[2], 255);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aA', new THREE.BufferAttribute(new Uint8Array(A), 4));
  g.setAttribute('aB', new THREE.BufferAttribute(new Uint8Array(Bb), 4));
  g.setAttribute('aT', new THREE.BufferAttribute(new Uint8Array(T), 4, true));
  itemGeoCache.set('b' + id, g);
  return g;
}

// Extruded 16x16 sprite like held items in MC.
export function spriteGeometry(id) {
  if (itemGeoCache.has('s' + id)) return itemGeoCache.get('s' + id);
  const d = itemPixels(id);
  const pos = [], nrm = [], uv = [];
  const th = 1 / 16;
  const a = (x, y) => (x < 0 || y < 0 || x > 15 || y > 15) ? 0 : d[(y * 16 + x) * 4 + 3];
  const quad = (p0, p1, p2, p3, n, u0, v0, u1, v1) => {
    for (const [p, uu, vv] of [[p0, u0, v0], [p1, u1, v0], [p2, u1, v1], [p0, u0, v0], [p2, u1, v1], [p3, u0, v1]]) { pos.push(...p); nrm.push(...n); uv.push(uu, vv); }
  };
  // front / back (x right, y up, sprite centred)
  const s = 1;
  quad([-0.5, -0.5, th / 2], [0.5, -0.5, th / 2], [0.5, 0.5, th / 2], [-0.5, 0.5, th / 2], [0, 0, 1], 0, 0, 1, 1);
  quad([0.5, -0.5, -th / 2], [-0.5, -0.5, -th / 2], [-0.5, 0.5, -th / 2], [0.5, 0.5, -th / 2], [0, 0, -1], 1, 0, 0, 1);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    if (!a(x, y)) continue;
    const x0 = x / 16 - 0.5, x1 = (x + 1) / 16 - 0.5, y0 = 0.5 - (y + 1) / 16, y1 = 0.5 - y / 16;
    const u0 = (x + 0.25) / 16, u1 = (x + 0.75) / 16, v0 = 1 - (y + 0.75) / 16, v1 = 1 - (y + 0.25) / 16;
    if (!a(x - 1, y)) quad([x0, y0, -th / 2], [x0, y0, th / 2], [x0, y1, th / 2], [x0, y1, -th / 2], [-1, 0, 0], u0, v0, u1, v1);
    if (!a(x + 1, y)) quad([x1, y0, th / 2], [x1, y0, -th / 2], [x1, y1, -th / 2], [x1, y1, th / 2], [1, 0, 0], u0, v0, u1, v1);
    if (!a(x, y - 1)) quad([x0, y1, th / 2], [x1, y1, th / 2], [x1, y1, -th / 2], [x0, y1, -th / 2], [0, 1, 0], u0, v0, u1, v1);
    if (!a(x, y + 1)) quad([x0, y0, -th / 2], [x1, y0, -th / 2], [x1, y0, th / 2], [x0, y0, th / 2], [0, -1, 0], u0, v0, u1, v1);
  }
  void s;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  itemGeoCache.set('s' + id, g);
  return g;
}

export function spriteTexture(id) {
  if (itemTexCache.has(id)) return itemTexCache.get(id);
  const d = itemPixels(id);
  // rows flipped so texture v=1 is the top pixel row
  const f = new Uint8Array(d.length);
  for (let y = 0; y < 16; y++) f.set(d.subarray((15 - y) * 64, (16 - y) * 64), y * 64);
  const t = new THREE.DataTexture(f, 16, 16, THREE.RGBAFormat);
  t.flipY = false;
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter;
  t.needsUpdate = true;
  itemTexCache.set(id, t);
  return t;
}

export function isBlockLike(id) {
  if (id >= 256) return false;
  const s = SHAPES[id];
  if (s === SHAPE.CUBE) return true;
  if (s === SHAPE.BOXES) return !BLOCKS[id].torch && BLOCKS[id].name !== 'lantern';
  return false;
}

// Build a mesh for an item stack (dropped item / held item).
const spriteMats = new Map();
export function itemMesh(id, renderer, opts = {}) {
  if (isBlockLike(id)) {
    const mat = opts.mat || renderer.blockEntityMaterial(opts);
    const m = new THREE.Mesh(blockGeometry(id), mat);
    m.userData.mat = mat; m.userData.block = true;
    return m;
  }
  const key = id + (opts.noFog ? 'n' : '') + (opts.noShadow ? 's' : '');
  let mat = opts.mat;
  if (!mat) {
    mat = renderer.entityMaterial(spriteTexture(id), { side: THREE.DoubleSide, glint: !!(ITEMS[id] && ITEMS[id].glint), ...opts });
    if (id < 256 && (MATF[id] === 2)) mat.uniforms.uEmissive.value = 1.2;
  }
  void spriteMats; void key; void WAVES;
  const m = new THREE.Mesh(spriteGeometry(id), mat);
  m.userData.mat = mat;
  return m;
}
