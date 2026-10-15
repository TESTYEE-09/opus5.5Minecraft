// All DOM UI: menus, HUD, chat, inventories, tooltips and name tags.
import * as THREE from 'three';
import { ITEMS, I, BLOCKS, maxStack, SHAPES, SHAPE, ITEM_COUNT } from '../core/blocks.js';
import { craft, craftableWith, layoutRecipe, SMELT, fuelTicks, Inventory } from '../game/inventory.js';
import { SKIN_TONES, HAIR_COLORS, SHIRT_COLORS, PANTS_COLORS, paintPlayerSkin, buildHumanoid, defaultLook } from '../entities/models.js';
import { GAME_NAME } from '../core/config.js';

const h = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
};
const SPLASHES = ['Now with sky islands!', 'Made of light!', 'Bring a friend!', 'Cherry blossoms!', 'Fireflies at night!', 'Look up after dark!', 'Generative piano!', '100% procedural!', 'Waterfalls from the sky!', 'Crystal tools!', 'Also try fishing! (not yet)', 'Shaders included!', 'Runs in a browser!', 'Mind the creepers… wait'];
const TIPS = ['Crystal ore only grows inside the floating islands. Crystal tools are the fastest in the world.', 'Hold wheat to lead cows and sheep. Chickens prefer seeds.', 'Everyone plays in the same world — say hi with T.', 'Sleep in a bed to skip the night — and set your respawn point.', 'Torches keep monsters from spawning. Glowstone lights up deep caves.', 'The recipe book in your inventory fills the crafting grid for you.', 'Snowy biomes have auroras on clear nights.', 'Press F2 for a screenshot and F1 to hide the HUD.', 'Water and lava make obsidian. Only diamond or crystal can mine it.', 'Shift-click moves stacks between your inventory and containers.'];

function statIcons() {
  const mk = (rows, pal) => {
    const c = document.createElement('canvas'); c.width = 9; c.height = 9;
    const x = c.getContext('2d');
    rows.forEach((r, y) => [...r].forEach((ch, xx) => { if (pal[ch]) { x.fillStyle = pal[ch]; x.fillRect(xx, y, 1, 1); } }));
    return c.toDataURL();
  };
  const heart = ['.KK...KK.', 'KRRK.KRRK', 'KRWRKRRRK', 'KRRRRRRRK', 'KRRRRRRDK', '.KRRRRDK.', '..KRRDK..', '...KDK...', '....K....'];
  const half = heart.map(r => r.slice(0, 5).replace(/[RWD]/g, (c) => c) + r.slice(5).replace(/[RWD]/g, 'E'));
  const empty = heart.map(r => r.replace(/[RWD]/g, 'E'));
  const P = { K: '#1a0507', R: '#e8303c', W: '#ffd0d4', D: '#a01822', E: '#3a2a2e' };
  const food = ['.....KK..', '....KBBK.', '...KBBBK.', '..KMMBBK.', '.KMMMMK..', 'KMMWMK...', 'KMMMMK...', '.KKKK....', '.........'];
  const FP = { K: '#2a1606', B: '#f0ecdc', M: '#c8702a', W: '#f0a050', E: '#3a2a20' };
  const fhalf = food.map(r => r.slice(0, 4).replace(/[MW]/g, 'E').replace(/B/g, 'E') + r.slice(4));
  const fempty = food.map(r => r.replace(/[MWB]/g, 'E'));
  const bub = ['..KKKK...', '.KBBBBK..', 'KBWBBBBK.', 'KBWBBBBK.', 'KBBBBBBK.', 'KBBBBBBK.', '.KBBBBK..', '..KKKK...', '.........'];
  return {
    heart: mk(heart, P), half: mk(half, P), empty: mk(empty, P),
    food: mk(food, FP), fhalf: mk(fhalf, FP), fempty: mk(fempty, FP),
    bubble: mk(bub, { K: '#0a2a5a', B: '#4aa0ff', W: '#e0f4ff' }),
  };
}

export class UI {
  constructor(game) {
    this.game = game;
    this.root = document.getElementById('ui');
    this.screens = {};
    this.current = null;
    this.icons = statIcons();
    this.cursor = null;
    this.hover = null;
    this.chatLines = [];
    this.toastsEl = null;
    this.dirty = true;
    this.heldNameT = 0;
    this.lastSel = -1;
    this.nametags = new Map();
    this.inv = null;
    this.buildHud();
    window.__ui = this;
    document.addEventListener('mousemove', (e) => { this.mx = e.clientX; this.my = e.clientY; this.moveCursor(); });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  setIcons(sheet) {
    this.sheet = sheet;
    document.documentElement.style.setProperty('--icons', `url(${sheet.url})`);
  }
  icon(id, size = 34) {
    const el = h('div', { class: 'ic' });
    if (id == null) return el;
    const col = id % this.sheet.cols, row = Math.floor(id / this.sheet.cols);
    el.style.width = size + 'px'; el.style.height = size + 'px';
    el.style.backgroundSize = `${this.sheet.cols * size}px auto`;
    el.style.backgroundPosition = `-${col * size}px -${row * size}px`;
    return el;
  }
  click() { this.game.audio.play('click', { vol: 0.5 }); }

  // ================================================================ screens
  show(name, opts) {
    for (const el of Object.values(this.screens)) el.remove();
    if (name !== 'inventory') this.closeInventoryDom();
    this.screens = {};
    this.current = name;
    if (!name) { this.hud.classList.toggle('hidden', !this.game.inWorld()); return; }
    const el = this['screen_' + name](opts || {});
    el.id = name;
    this.screens[name] = el;
    this.root.append(el);
    this.hud.classList.toggle('hidden', !this.game.inWorld() || name === 'loading' || name === 'title');
  }
  isOpen() { return !!this.current; }

  screen_title() {
    const splash = SPLASHES[Math.floor(Math.random() * SPLASHES.length)];
    const p = this.game.profile;
    this.onlineEl = h('div', { class: 'online' });
    this.updateOnline(this.game.online);
    return h('div', { class: 'screen' },
      h('div', { id: 'title', class: 'screen' },
        h('div', { class: 'logo' }, GAME_NAME.toUpperCase(), h('span', { class: 'splash' }, splash)),
        h('div', { class: 'logo-sub' }, 'ONE WORLD · EVERYONE'),
        h('div', { class: 'menu' },
          h('button', { class: 'btn primary play', onclick: () => { this.click(); this.game.playShared(); } }, 'Play'),
          this.onlineEl,
          h('div', { class: 'row' },
            h('button', { class: 'btn', onclick: () => { this.click(); this.show('character', { back: 'title' }); } }, 'Character'),
            h('button', { class: 'btn', onclick: () => { this.click(); this.show('settings', { back: 'title' }); } }, 'Settings'),
          ),
        ),
        h('div', { class: 'foot' },
          h('span', {}, `${GAME_NAME} 1.1 · playing as ${p.name}`),
          h('span', {}, 'Textures, terrain & music generated in code · ', h('a', { href: './CREDITS.md', target: '_blank' }, 'credits')),
        ),
      ),
    );
  }
  updateOnline(n) {
    if (!this.onlineEl) return;
    this.onlineEl.innerHTML = '';
    if (n === null || n === undefined) this.onlineEl.append(h('span', { class: 'dot off' }), 'Checking the world…');
    else this.onlineEl.append(h('span', { class: 'dot' }), n === 0 ? 'Nobody online — the world is waiting for you' : `${n} player${n === 1 ? '' : 's'} online now`);
  }

  screen_offline(opts) {
    return h('div', { class: 'screen dim' }, h('div', { class: 'panel', style: { width: 'min(460px, calc(100vw - 32px))', textAlign: 'center' } },
      h('h2', {}, opts.title || "Can't reach the world"),
      h('div', { class: 'muted', style: { marginBottom: '18px', lineHeight: 1.5 } }, opts.text || ''),
      h('div', { class: 'col' },
        h('button', { class: 'btn primary', onclick: () => { this.click(); this.game.playShared(); } }, 'Try again'),
        h('button', { class: 'btn', onclick: () => { this.click(); this.game.playOffline(); } }, 'Play offline instead'),
        h('button', { class: 'btn', onclick: () => { this.click(); this.show('title'); } }, 'Back'),
      ),
    ));
  }

  screen_character(opts) {
    const look = { ...this.game.profile.look };
    const name = h('input', { class: 'input', value: this.game.profile.name, maxlength: 16 });
    const cv = h('canvas', { width: 520, height: 680 });
    const preview = new Preview(cv);
    const refresh = () => preview.setLook(look);
    const swatches = (key, list) => h('div', { class: 'swatches' }, ...list.map(c => {
      const s = h('div', { class: 'sw' + (look[key] === c ? ' on' : ''), style: { background: c }, onclick: () => { look[key] = c; s.parentNode.querySelectorAll('.sw').forEach(x => x.classList.remove('on')); s.classList.add('on'); refresh(); this.click(); } });
      return s;
    }));
    const style = h('div', { class: 'seg' }, ...['Short', 'Long', 'Buzz'].map((n, i) => h('button', { class: look.hairStyle === i ? 'on' : '', onclick: (e) => { look.hairStyle = i; style.querySelectorAll('button').forEach(b => b.classList.remove('on')); e.target.classList.add('on'); refresh(); this.click(); } }, n)));
    refresh();
    const close = () => { preview.dispose(); };
    return h('div', { class: 'screen dim' }, h('div', { class: 'panel' },
      h('h2', {}, 'Your character'),
      h('div', { class: 'char' }, cv, h('div', {},
        h('div', { class: 'field' }, h('label', {}, 'NAME'), name),
        h('h3', {}, 'Skin'), swatches('skin', SKIN_TONES),
        h('h3', {}, 'Hair'), swatches('hair', HAIR_COLORS), h('div', { style: { marginTop: '8px' } }, style),
        h('h3', {}, 'Shirt'), swatches('shirt', SHIRT_COLORS),
        h('h3', {}, 'Trousers'), swatches('pants', PANTS_COLORS),
        h('h3', {}, 'Eyes'), swatches('eyes', ['#3a6ad5', '#3a8a4a', '#5a3a1e', '#2a2a2a', '#8a4ad5']),
      )),
      h('div', { class: 'row', style: { marginTop: '16px' } },
        h('button', { class: 'btn', onclick: () => { Object.assign(look, defaultLook()); this.click(); close(); this.game.setProfile({ look }); this.show('character', opts); } }, 'Randomise'),
        h('div', { class: 'grow' }),
        h('button', { class: 'btn primary', onclick: () => { this.click(); close(); this.game.setProfile({ name: name.value.trim() || 'Player', look }); this.show(opts.back || 'title'); } }, 'Done'),
      ),
    ));
  }

  screen_settings(opts) {
    const s = this.game.settings;
    const apply = () => { this.game.applySettings(); };
    const slider = (label, key, min, max, step, fmt = (v) => v) => {
      const val = h('span', { class: 'val' }, fmt(s[key]));
      const r = h('input', { type: 'range', min, max, step, value: s[key], oninput: (e) => { s[key] = Number(e.target.value); val.textContent = fmt(s[key]); apply(); } });
      return h('div', { class: 'set' }, h('label', {}, label), h('div', { class: 'row' }, r, val));
    };
    const toggle = (label, key) => {
      const t = h('div', { class: 'toggle' + (s[key] ? ' on' : ''), onclick: () => { s[key] = !s[key]; t.classList.toggle('on', s[key]); apply(); this.click(); } });
      return h('div', { class: 'set' }, h('label', {}, label), t);
    };
    const preset = h('div', { class: 'seg' }, ...['Fast', 'Fancy', 'Fabulous'].map(n => h('button', { class: s.preset === n ? 'on' : '', onclick: (e) => {
      s.preset = n;
      Object.assign(s, n === 'Fast' ? { shadows: false, ssr: false, bloom: false, rays: false, renderScale: 0.75 } : n === 'Fancy' ? { shadows: true, shadowRes: 2048, ssr: true, bloom: true, rays: false, renderScale: 0.85 } : { shadows: true, shadowRes: 4096, ssr: true, bloom: true, rays: true, renderScale: 1 });
      apply(); this.click(); this.show('settings', opts);
    } }, n)));
    const pct = (v) => Math.round(v * 100) + '%';
    return h('div', { class: 'screen dim' }, h('div', { class: 'panel' },
      h('h2', {}, 'Settings'),
      h('div', { class: 'row', style: { marginBottom: '10px' } }, h('span', { class: 'muted' }, 'Graphics preset'), preset),
      h('div', { class: 'settings' },
        slider('Render distance', 'renderDist', 4, 16, 1, (v) => v + ' chunks'),
        slider('Field of view', 'fov', 55, 110, 1),
        slider('Render scale', 'renderScale', 0.5, 1, 0.05, pct),
        slider('Mouse sensitivity', 'sensitivity', 0.2, 2.5, 0.05, (v) => v.toFixed(2)),
        toggle('Sun shadows', 'shadows'),
        toggle('Water reflections', 'ssr'),
        toggle('Bloom', 'bloom'),
        toggle('God rays', 'rays'),
        toggle('View bobbing', 'bob'),
        toggle('Invert mouse Y', 'invertY'),
        toggle('Show FPS', 'showFps'),
        toggle('Clouds', 'clouds'),
        slider('Master volume', 'volMaster', 0, 1, 0.05, pct),
        slider('Music', 'volMusic', 0, 1, 0.05, pct),
        slider('Sounds', 'volSfx', 0, 1, 0.05, pct),
        slider('Ambience', 'volAmbient', 0, 1, 0.05, pct),
      ),
      h('div', { class: 'row', style: { marginTop: '16px', justifyContent: 'space-between' } },
        h('span', { class: 'muted', style: { fontSize: '13px' } }, 'WASD move · Space jump · Shift sneak · Ctrl sprint · E inventory · Q drop · T chat · F1 HUD · F2 screenshot · F3 debug · F5 camera'),
        h('button', { class: 'btn primary', onclick: () => { this.click(); this.game.saveSettings(); this.show(opts.back || 'title'); } }, 'Done'),
      ),
    ));
  }

  screen_loading(opts) {
    this.loadBar = h('div');
    this.loadText = h('div', { style: { fontSize: '22px', letterSpacing: '2px' } }, opts.text || 'Generating world…');
    const tip = h('div', { class: 'tip' }, TIPS[Math.floor(Math.random() * TIPS.length)]);
    return h('div', { class: 'screen' }, h('div', { id: 'loading', class: 'screen' },
      h('div', { class: 'logo', style: { fontSize: '54px' } }, GAME_NAME.toUpperCase()),
      this.loadText, h('div', { class: 'bar' }, this.loadBar), tip,
    ));
  }
  loading(p, text) {
    if (this.loadBar) this.loadBar.style.width = Math.round(p * 100) + '%';
    if (text && this.loadText) this.loadText.textContent = text;
  }

  screen_pause() {
    const g = this.game;
    const names = g.playerNames();
    return h('div', { class: 'screen dim' }, h('div', { class: 'panel', style: { width: 'min(400px, calc(100vw - 32px))' } },
      h('h2', { style: { textAlign: 'center' } }, 'Game paused'),
      h('div', { class: 'col' },
        h('button', { class: 'btn primary', onclick: () => { this.click(); g.resume(); } }, 'Back to Game'),
        g.shared ? h('div', { class: 'players' },
          h('div', { class: 'muted', style: { fontSize: '14px', marginBottom: '6px' } }, `${names.length} online`),
          ...names.map(n => h('div', { class: 'pl' }, h('span', { class: 'dot' }), n))) : h('div', { class: 'muted', style: { textAlign: 'center' } }, 'Offline world'),
        h('button', { class: 'btn', onclick: () => { this.click(); this.show('settings', { back: 'pause' }); } }, 'Settings'),
        h('button', { class: 'btn danger', onclick: () => { this.click(); g.quitToTitle(); } }, g.shared ? 'Leave World' : 'Save & Quit'),
      ),
    ));
  }

  screen_death(opts) {
    return h('div', { class: 'screen' }, h('div', { id: 'death', class: 'screen' },
      h('h1', {}, 'You died!'),
      h('div', { style: { fontSize: '20px', marginBottom: '20px' } }, opts.msg || ''),
      h('button', { class: 'btn primary', style: { width: '280px' }, onclick: () => { this.click(); this.game.respawn(); } }, 'Respawn'),
      h('button', { class: 'btn', style: { width: '280px' }, onclick: () => { this.click(); this.game.quitToTitle(); } }, 'Title Screen'),
    ));
  }

  screen_message(opts) {
    return h('div', { class: 'screen dim' }, h('div', { class: 'panel', style: { width: 'min(440px, calc(100vw - 32px))', textAlign: 'center' } },
      h('h2', {}, opts.title || ''), h('div', { class: 'muted', style: { marginBottom: '16px', lineHeight: 1.5 } }, opts.text || ''),
      h('button', { class: 'btn primary', onclick: () => { this.click(); this.show(opts.back || 'title'); } }, 'OK'),
    ));
  }

  // ================================================================ HUD
  buildHud() {
    this.hud = h('div', { id: 'hud', class: 'passive hidden' });
    this.cross = h('div', { class: 'crosshair' });
    this.hearts = h('div', { class: 'stat-row' });
    this.food = h('div', { class: 'stat-row right' });
    this.air = h('div', { class: 'stat-row right', style: { position: 'absolute', right: '7px', bottom: '78px' } });
    this.hotbar = h('div', { class: 'hotbar' });
    this.statsEl = h('div', { class: 'stats' }, this.hearts, this.food);
    this.heldName = h('div', { class: 'held-name', style: { opacity: 0 } });
    this.hotbarWrap = h('div', { class: 'hotbar-wrap' }, this.air, this.statsEl, this.hotbar);
    this.toastsEl = h('div', { class: 'toasts' });
    this.chatEl = h('div', { class: 'chat' });
    this.debugEl = h('div', { class: 'debug hidden' });
    this.fpsEl = h('div', { class: 'fps hidden' });
    this.badge = h('div', { class: 'room-badge hidden' });
    this.tags = h('div', {});
    this.hintEl = h('div', { class: 'hint', style: { opacity: 0 } });
    this.ammoEl = h('div', { class: 'ammo hidden' });
    this.scopeEl = h('div', { class: 'scope hidden' });
    this.hud.append(this.scopeEl, this.ammoEl, this.cross, this.hotbarWrap, this.heldName, this.toastsEl, this.chatEl, this.debugEl, this.fpsEl, this.badge, this.tags, this.hintEl);
    this.root.append(this.hud);
    this.slotEls = [];
    for (let i = 0; i < 9; i++) { const s = h('div', { class: 'slot' }); this.hotbar.append(s); this.slotEls.push(s); }
  }
  hudDirty() { this.dirty = true; }
  setHudVisible(v) { this.hud.style.visibility = v ? 'visible' : 'hidden'; }

  fillSlot(el, st) {
    el.innerHTML = '';
    if (!st) return;
    el.append(this.icon(st.id, el.classList.contains('big') ? 42 : 34));
    if (st.count > 1) el.append(h('div', { class: 'cnt' }, st.count));
    const it = ITEMS[st.id];
    if (it && it.durability && st.dmg > 0) {
      const f = 1 - st.dmg / it.durability;
      el.append(h('div', { class: 'dur' }, h('div', { style: { width: (f * 100) + '%', background: `hsl(${f * 120}, 90%, 50%)` } })));
    }
  }

  updateHud(dt) {
    const g = this.game, p = g.player;
    if (!p) return;
    if (this.dirty) {
      this.dirty = false;
      for (let i = 0; i < 9; i++) {
        this.fillSlot(this.slotEls[i], p.inventory.slots[i]);
        this.slotEls[i].classList.toggle('sel', i === p.selected);
      }
      const survival = !p.creative;
      this.statsEl.style.visibility = survival ? 'visible' : 'hidden';
      this.hearts.innerHTML = ''; this.food.innerHTML = '';
      for (let i = 0; i < 10; i++) {
        const hp = p.health - i * 2;
        this.hearts.append(h('i', { style: { backgroundImage: `url(${hp >= 2 ? this.icons.heart : hp >= 1 ? this.icons.half : this.icons.empty})` } }));
        const f = p.hunger - i * 2;
        this.food.append(h('i', { style: { backgroundImage: `url(${f >= 2 ? this.icons.food : f >= 1 ? this.icons.fhalf : this.icons.fempty})` } }));
      }
      this.hearts.classList.toggle('shake', p.health <= 4);
    }
    // air bubbles
    const bubbles = p.eyeInWater === 1 && !p.creative ? Math.ceil(p.air / 1.5) : 0;
    if (bubbles !== this.lastBubbles) {
      this.lastBubbles = bubbles;
      this.air.innerHTML = '';
      for (let i = 0; i < bubbles; i++) this.air.append(h('i', { style: { backgroundImage: `url(${this.icons.bubble})` } }));
    }
    if (p.selected !== this.lastSel || (p.held && p.held.id) !== this.lastHeldId) {
      this.lastSel = p.selected; this.lastHeldId = p.held && p.held.id;
      this.heldName.textContent = p.held ? ITEMS[p.held.id].display : '';
      this.heldNameT = 2.2;
    }
    this.heldNameT -= dt;
    this.heldName.style.opacity = Math.max(0, Math.min(1, this.heldNameT));
    // chat fade
    const now = performance.now();
    for (const l of this.chatLines) l.el.classList.toggle('old', now - l.t > 9000);
    // fps / debug
    this.fpsEl.classList.toggle('hidden', !g.settings.showFps);
    if (g.settings.showFps) this.fpsEl.textContent = Math.round(g.fps) + ' fps';
    this.debugEl.classList.toggle('hidden', !g.debug);
    if (g.debug) this.debugEl.textContent = g.debugInfo();
    // room badge
    // gun ammo + scope
    const gun = p.held && ITEMS[p.held.id].gun;
    this.ammoEl.classList.toggle('hidden', !gun);
    if (gun) {
      const gs = g.gunState;
      const inMag = gun.mag - (p.held.dmg || 0);
      const reserve = p.creative ? '∞' : p.inventory.count(I.bullets);
      const txt = gs && gs.reload > 0 ? 'RELOADING' : `${inMag} / ${reserve}`;
      if (this.ammoEl.textContent !== txt) this.ammoEl.textContent = txt;
      this.ammoEl.classList.toggle('low', inMag <= Math.ceil(gun.mag / 4));
    }
    this.scopeEl.classList.toggle('hidden', !g.scoped);
    this.cross.style.opacity = g.scoped ? 0 : 1;
    this.updateNametags();
  }

  updateNametags() {
    const g = this.game;
    const cam = g.renderer.camera;
    const seen = new Set();
    const w = window.innerWidth, hh = window.innerHeight;
    for (const v of g.entities.players.values()) {
      if (!v.screen || v.alive === 0) continue;
      seen.add(v.id);
      let el = this.nametags.get(v.id);
      if (!el) { el = h('div', { class: 'nametag' }, v.name); this.tags.append(el); this.nametags.set(v.id, el); }
      const p = new THREE.Vector3(v.screen.x, v.screen.y, v.screen.z).project(cam);
      const dist = cam.position.distanceTo(new THREE.Vector3(v.screen.x, v.screen.y, v.screen.z));
      const vis = p.z < 1 && Math.abs(p.x) < 1.1 && Math.abs(p.y) < 1.1 && dist < 80;
      el.style.display = vis ? 'block' : 'none';
      if (vis) { el.style.left = ((p.x + 1) / 2 * w) + 'px'; el.style.top = ((1 - p.y) / 2 * hh) + 'px'; el.style.opacity = (v.flags & 1) ? 0.4 : 1; }
    }
    for (const [id, el] of this.nametags) if (!seen.has(id)) { el.remove(); this.nametags.delete(id); }
  }

  toast(html, ms = 3500) {
    const t = h('div', { class: 'toast', html });
    this.toastsEl.append(t);
    setTimeout(() => { t.style.transition = 'opacity 0.4s'; t.style.opacity = 0; setTimeout(() => t.remove(), 450); }, ms);
  }

  hint(html, ms = 7000) {
    this.hintEl.innerHTML = html;
    this.hintEl.style.opacity = 1;
    clearTimeout(this.hintTimer);
    this.hintTimer = setTimeout(() => { this.hintEl.style.opacity = 0; }, ms);
  }

  chat(text, from) {
    const el = h('div', { class: 'line' });
    if (from) el.append(h('span', { style: { color: '#ffcf6b' } }, `<${from}> `));
    const COLORS = { e: '#ffe94a', a: '#7dff8a', c: '#ff6b7a', b: '#6ff7e8', d: '#ff8af0', 7: '#bbbbbb', 6: '#ffaa00', f: '#ffffff' };
    const parts = String(text).split('§');
    el.append(parts[0]);
    for (let i = 1; i < parts.length; i++) { const c = COLORS[parts[i][0]] || '#fff'; el.append(h('span', { style: { color: c } }, parts[i].slice(1))); }
    this.chatEl.append(el);
    this.chatLines.push({ el, t: performance.now() });
    while (this.chatLines.length > 60) this.chatLines.shift().el.remove();
  }

  openChat(prefix = '') {
    if (this.chatInput) return;
    this.chatEl.classList.add('open');
    const inp = h('input', { class: 'input chat-input', maxlength: 200, value: prefix });
    this.chatInput = inp;
    this.root.append(inp);
    this.current = 'chat';
    this.game.input.unlock();
    setTimeout(() => { inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length); }, 0);
    let hist = this.histIdx = this.game.chatHistory.length;
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') { const v = inp.value.trim(); this.closeChat(); if (v) this.game.sendChat(v); }
      else if (e.key === 'Escape') { this.closeChat(); }
      else if (e.key === 'ArrowUp') { hist = Math.max(0, hist - 1); inp.value = this.game.chatHistory[hist] || ''; e.preventDefault(); }
      else if (e.key === 'ArrowDown') { hist = Math.min(this.game.chatHistory.length, hist + 1); inp.value = this.game.chatHistory[hist] || ''; e.preventDefault(); }
    });
  }
  closeChat() {
    if (!this.chatInput) return;
    this.chatInput.remove(); this.chatInput = null;
    this.chatEl.classList.remove('open');
    this.current = null;
    this.game.resume();
  }

  // ================================================================ inventories
  openInventory(mode, data = {}) {
    this.closeInventoryDom();
    const g = this.game;
    const n = mode === 'craft' ? 3 : 2;
    this.inv = { mode, key: data.key, be: data.be, craft: new Array(n * n).fill(null), n, tab: 'all', search: '', scroll: 0 };
    this.current = 'inventory';
    g.input.unlock();
    this.renderInventory();
    g.audio.play(mode === 'chest' ? 'chest.open' : 'open', { vol: 0.45 });
  }
  updateBE(key, data) {
    if (!this.inv || this.inv.key !== key) return;
    this.inv.be = data;
    this.renderInventory();
  }
  closeInventory() {
    if (!this.inv) return;
    const g = this.game;
    const inv = g.player.inventory;
    for (let i = 0; i < this.inv.craft.length; i++) {
      const s = this.inv.craft[i];
      if (s) { const left = inv.add(s.id, s.count, s.dmg); if (left) g.dropStack({ id: s.id, count: left, dmg: s.dmg }); }
    }
    if (this.cursor) { const left = inv.add(this.cursor.id, this.cursor.count, this.cursor.dmg); if (left) g.dropStack({ ...this.cursor, count: left }); this.cursor = null; }
    if (this.inv.key) g.closeBE(this.inv.key);
    g.audio.play(this.inv.mode === 'chest' ? 'chest.close' : 'close', { vol: 0.4 });
    this.closeInventoryDom();
    this.inv = null;
    this.current = null;
    this.hudDirty();
    g.resume();
  }
  closeInventoryDom() {
    if (this.invEl) { this.invEl.remove(); this.invEl = null; }
    if (this.cursorEl) { this.cursorEl.remove(); this.cursorEl = null; }
    if (this.tipEl) { this.tipEl.remove(); this.tipEl = null; }
  }

  // slot accessors
  get(ref) {
    const g = this.game, iv = this.inv;
    switch (ref.c) {
      case 'inv': return g.player.inventory.slots[ref.i];
      case 'craft': return iv.craft[ref.i];
      case 'result': { const r = craft(iv.craft.map(s => (s ? s.id : null)), iv.n); return r ? { id: r.id, count: r.count, dmg: 0 } : null; }
      case 'chest': { const a = iv.be && iv.be.items[ref.i]; return a ? { id: a[0], count: a[1], dmg: a[2] || 0 } : null; }
      case 'fin': case 'ffuel': case 'fout': { const k = { fin: 'in', ffuel: 'fuel', fout: 'out' }[ref.c]; const a = iv.be && iv.be[k]; return a ? { id: a[0], count: a[1], dmg: a[2] || 0 } : null; }
      case 'cre': return { id: ref.id, count: maxStack(ref.id), dmg: 0 };
      default: return null;
    }
  }
  set(ref, st) {
    const g = this.game, iv = this.inv;
    if (st && st.count <= 0) st = null;
    switch (ref.c) {
      case 'inv': g.player.inventory.slots[ref.i] = st; g.player.inventory.changed(); this.hudDirty(); break;
      case 'craft': iv.craft[ref.i] = st; break;
      case 'chest': iv.be.items[ref.i] = st ? [st.id, st.count, st.dmg || 0] : 0; g.sendBE(iv.key, { items: iv.be.items }); break;
      case 'fin': case 'ffuel': case 'fout': { const k = { fin: 'in', ffuel: 'fuel', fout: 'out' }[ref.c]; iv.be[k] = st ? [st.id, st.count, st.dmg || 0] : 0; g.sendBE(iv.key, { in: iv.be.in, fuel: iv.be.fuel, out: iv.be.out }); break; }
      default: break;
    }
  }
  accepts(ref, st) {
    if (!st) return true;
    if (ref.c === 'result' || ref.c === 'fout' || ref.c === 'cre') return false;
    if (ref.c === 'ffuel') return fuelTicks(st.id) > 0;
    if (ref.c === 'fin') return SMELT.has(st.id);
    return true;
  }

  clickSlot(ref, button, shift) {
    const g = this.game;
    const creative = g.player.creative;
    if (ref.c === 'trash') { this.cursor = null; this.renderInventory(); return; }
    if (ref.c === 'cre') {
      if (shift) { g.player.inventory.add(ref.id, maxStack(ref.id)); this.hudDirty(); }
      else if (this.cursor && this.cursor.id === ref.id && this.cursor.count < maxStack(ref.id)) this.cursor.count = button === 2 ? this.cursor.count + 1 : maxStack(ref.id);
      else if (this.cursor) this.cursor = null;
      else this.cursor = { id: ref.id, count: button === 2 ? 1 : maxStack(ref.id), dmg: 0 };
      g.audio.play('pop', { vol: 0.3, rate: 1.4 });
      this.renderInventory();
      return;
    }
    if (ref.c === 'result') { this.takeResult(shift); return; }
    const cur = this.get(ref);
    if (shift && cur) { this.quickMove(ref, cur); this.renderInventory(); return; }
    if (ref.c === 'fout') {
      if (!cur) return;
      if (!this.cursor) { this.cursor = cur; this.set(ref, null); }
      else if (this.cursor.id === cur.id && this.cursor.count + cur.count <= maxStack(cur.id)) { this.cursor.count += cur.count; this.set(ref, null); }
      this.renderInventory();
      return;
    }
    const c = this.cursor;
    if (button === 0) {
      if (!c && cur) { this.cursor = cur; this.set(ref, null); }
      else if (c && !cur) { if (!this.accepts(ref, c)) return; this.set(ref, c); this.cursor = null; }
      else if (c && cur) {
        if (c.id === cur.id && !c.dmg && !cur.dmg) {
          const max = maxStack(c.id); const n = Math.min(c.count, max - cur.count);
          cur.count += n; c.count -= n; this.set(ref, cur); if (c.count <= 0) this.cursor = null;
        } else if (this.accepts(ref, c)) { this.set(ref, c); this.cursor = cur; }
      }
    } else if (button === 2) {
      if (!c && cur) { const half = Math.ceil(cur.count / 2); this.cursor = { ...cur, count: half }; cur.count -= half; this.set(ref, cur.count ? cur : null); }
      else if (c && (!cur || (cur.id === c.id && cur.count < maxStack(c.id)))) {
        if (!this.accepts(ref, c)) return;
        if (cur) { cur.count++; this.set(ref, cur); } else this.set(ref, { ...c, count: 1 });
        c.count--; if (c.count <= 0) this.cursor = null;
      }
    }
    void creative;
    this.renderInventory();
  }

  takeResult(shift) {
    const iv = this.inv;
    const g = this.game;
    let crafted = 0;
    for (let k = 0; k < (shift ? 64 : 1); k++) {
      const res = this.get({ c: 'result' });
      if (!res) break;
      if (shift) {
        if (!g.player.inventory.canFit(res.id, res.count)) break;
        g.player.inventory.add(res.id, res.count);
      } else {
        if (this.cursor && (this.cursor.id !== res.id || this.cursor.count + res.count > maxStack(res.id))) break;
        if (this.cursor) this.cursor.count += res.count; else this.cursor = res;
      }
      for (let i = 0; i < iv.craft.length; i++) {
        const s = iv.craft[i];
        if (!s) continue;
        // buckets come back empty
        if (s.id === I.water_bucket || s.id === I.lava_bucket) { iv.craft[i] = { id: I.bucket, count: 1, dmg: 0 }; continue; }
        s.count--; if (s.count <= 0) iv.craft[i] = null;
      }
      crafted++;
    }
    if (crafted) { g.audio.play('pop', { vol: 0.35 }); g.onCrafted && g.onCrafted(); }
    this.hudDirty();
    this.renderInventory();
  }

  quickMove(ref, st) {
    const g = this.game, inv = g.player.inventory, iv = this.inv;
    if (ref.c === 'inv') {
      if (iv.mode === 'chest') {
        let left = st.count;
        const items = iv.be.items;
        for (let i = 0; i < items.length && left; i++) if (items[i] && items[i][0] === st.id && !st.dmg) { const n = Math.min(left, maxStack(st.id) - items[i][1]); items[i][1] += n; left -= n; }
        for (let i = 0; i < items.length && left; i++) if (!items[i]) { const n = Math.min(left, maxStack(st.id)); items[i] = [st.id, n, st.dmg || 0]; left -= n; }
        g.sendBE(iv.key, { items });
        this.set(ref, left ? { ...st, count: left } : null);
        return;
      }
      if (iv.mode === 'furnace') {
        const key = SMELT.has(st.id) ? 'fin' : fuelTicks(st.id) > 0 ? 'ffuel' : null;
        if (key) {
          const cur = this.get({ c: key });
          if (!cur) { this.set({ c: key }, st); this.set(ref, null); return; }
          if (cur.id === st.id) { const n = Math.min(st.count, maxStack(st.id) - cur.count); cur.count += n; this.set({ c: key }, cur); this.set(ref, st.count - n ? { ...st, count: st.count - n } : null); return; }
        }
      }
      // hotbar <-> main inventory
      const from = ref.i, toRange = from < 9 ? [9, 36] : [0, 9];
      let left = st.count;
      for (let i = toRange[0]; i < toRange[1] && left; i++) { const s = inv.slots[i]; if (s && s.id === st.id && !s.dmg && !st.dmg) { const n = Math.min(left, maxStack(st.id) - s.count); s.count += n; left -= n; } }
      for (let i = toRange[0]; i < toRange[1] && left; i++) if (!inv.slots[i]) { inv.slots[i] = { ...st, count: left }; left = 0; }
      inv.slots[from] = left ? { ...st, count: left } : null;
      inv.changed(); this.hudDirty();
      return;
    }
    // container -> inventory
    const left = inv.add(st.id, st.count, st.dmg);
    this.set(ref, left ? { ...st, count: left } : null);
    this.hudDirty();
  }

  fillRecipe(r) {
    const iv = this.inv, g = this.game, inv = g.player.inventory;
    for (let i = 0; i < iv.craft.length; i++) { const s = iv.craft[i]; if (s) { inv.add(s.id, s.count, s.dmg); iv.craft[i] = null; } }
    const grid = layoutRecipe(r, inv, iv.n);
    if (!grid) return;
    for (let i = 0; i < grid.length; i++) if (grid[i] != null) { inv.take(grid[i], 1); iv.craft[i] = { id: grid[i], count: 1, dmg: 0 }; }
    g.audio.play('select', { vol: 0.35 });
    this.hudDirty();
    this.renderInventory();
  }

  slotEl(ref, cls = '') {
    const st = this.get(ref);
    const el = h('div', { class: 'slot ' + cls });
    this.fillSlot(el, st);
    el.addEventListener('mousedown', (e) => { e.preventDefault(); this.dragging = { button: e.button, done: new Set([el]) }; this.clickSlot(ref, e.button, e.shiftKey); });
    el.addEventListener('mouseenter', () => {
      this.hover = ref;
      this.showTip(this.get(ref));
      // right-drag places one item per slot
      if (this.dragging && this.dragging.button === 2 && this.cursor && !this.dragging.done.has(el) && ref.c !== 'result' && ref.c !== 'cre') { this.dragging.done.add(el); this.clickSlot(ref, 2, false); }
    });
    el.addEventListener('mouseleave', () => { if (this.hover === ref) { this.hover = null; this.showTip(null); } });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    return el;
  }

  showTip(st) {
    if (this.tipEl) { this.tipEl.remove(); this.tipEl = null; }
    if (!st || this.cursor) return;
    const it = ITEMS[st.id];
    const kids = [h('div', {}, it.display)];
    if (it.durability) kids.push(h('div', { class: 'sub' }, `Durability ${it.durability - (st.dmg || 0)} / ${it.durability}`));
    if (it.food) kids.push(h('div', { class: 'sub' }, `Restores ${it.food[0] / 2} hunger`));
    if (it.damage) kids.push(h('div', { class: 'sub' }, `${it.damage} attack damage`));
    this.tipEl = h('div', { class: 'tooltip' }, ...kids);
    this.root.append(this.tipEl);
    this.moveCursor();
  }

  moveCursor() {
    if (this.cursorEl) { this.cursorEl.style.left = (this.mx - 22) + 'px'; this.cursorEl.style.top = (this.my - 22) + 'px'; }
    if (this.tipEl) { this.tipEl.style.left = (this.mx + 16) + 'px'; this.tipEl.style.top = (this.my - 34) + 'px'; }
  }

  creativeItems() {
    const iv = this.inv;
    const q = iv.search.toLowerCase();
    const out = [];
    for (let id = 1; id < ITEM_COUNT; id++) {
      const it = ITEMS[id];
      if (!it || it.hidden) continue;
      if (id < 256 && (SHAPES[id] === SHAPE.LIQUID || SHAPES[id] === SHAPE.NONE)) continue;
      if (q && !it.display.toLowerCase().includes(q)) continue;
      const cat = this.category(id);
      if (iv.tab !== 'all' && cat !== iv.tab) continue;
      out.push(id);
    }
    return out;
  }
  category(id) {
    const it = ITEMS[id];
    if (id >= 256) { if (it.tool || it.gun || it.name === 'bullets' || ['bow', 'arrow', 'shears', 'flint_and_steel', 'bucket', 'water_bucket', 'lava_bucket'].includes(it.name)) return 'tools'; if (it.food) return 'food'; return 'misc'; }
    const b = BLOCKS[id];
    if (b.use || b.torch || b.be || ['lantern', 'glowstone', 'tnt', 'bed', 'crystal_block', 'jack_o_lantern'].includes(b.name)) return 'misc';
    if (SHAPES[id] === SHAPE.CROSS || b.leaves || b.sapling || b.tag === 'log' || ['grass', 'dirt', 'sand', 'gravel', 'clay', 'snow', 'ice', 'packed_ice', 'podzol', 'coarse_dirt', 'moss_block', 'cactus', 'pumpkin', 'melon', 'stone', 'cloud', 'farmland'].includes(b.name) || b.name.endsWith('_ore')) return 'nature';
    return 'building';
  }

  renderInventory() {
    const iv = this.inv;
    if (!iv) return;
    const g = this.game;
    const scroll = this.invEl && this.invEl.querySelector('.creative-grid') ? this.invEl.querySelector('.creative-grid').scrollTop : 0;
    const bookScroll = this.invEl && this.invEl.querySelector('.book') ? this.invEl.querySelector('.book').scrollTop : 0;
    if (this.invEl) this.invEl.remove();
    const panels = [];
    const creative = g.player.creative && iv.mode === 'player';
    const invGrid = () => h('div', {},
      h('div', { class: 'grid g9' }, ...Array.from({ length: 27 }, (_, k) => this.slotEl({ c: 'inv', i: 9 + k }))),
      h('div', { class: 'grid g9', style: { marginTop: '8px' } }, ...Array.from({ length: 9 }, (_, k) => this.slotEl({ c: 'inv', i: k }))),
    );
    // recipe book
    if (!creative && (iv.mode === 'player' || iv.mode === 'craft')) {
      const recipes = craftableWith(g.player.inventory, iv.n);
      const seen = new Set();
      const items = recipes.filter(r => { if (seen.has(r.result)) return false; seen.add(r.result); return true; });
      panels.push(h('div', { class: 'panel book' },
        h('div', { class: 'inv-title' }, 'Recipe book'),
        items.length ? h('div', { class: 'grid' }, ...items.map(r => {
          const el = h('div', { class: 'slot can', title: ITEMS[r.result].display, onmousedown: (e) => { e.preventDefault(); this.fillRecipe(r); } });
          this.fillSlot(el, { id: r.result, count: r.count });
          el.addEventListener('mouseenter', () => this.showTip({ id: r.result, count: r.count }));
          el.addEventListener('mouseleave', () => this.showTip(null));
          return el;
        })) : h('div', { class: 'muted', style: { fontSize: '14px', lineHeight: 1.4 } }, iv.n === 2 ? 'Gather wood to unlock recipes. Bigger recipes need a crafting table.' : 'Nothing craftable yet — gather more materials.'),
      ));
    }
    let top;
    if (creative) {
      const tabs = [['all', 'All'], ['building', 'Building'], ['nature', 'Nature'], ['tools', 'Tools & Combat'], ['food', 'Food'], ['misc', 'Utility']];
      const search = h('input', { class: 'input', placeholder: 'Search items…', value: iv.search, style: { padding: '6px 10px', fontSize: '15px', width: '100%', marginBottom: '8px' } });
      search.addEventListener('input', () => { iv.search = search.value; this.renderInventory(); const s = this.invEl.querySelector('input'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); });
      search.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Escape') this.closeInventory(); });
      top = h('div', {},
        h('div', { class: 'tabs' }, ...tabs.map(([k, n]) => h('button', { class: iv.tab === k ? 'on' : '', onclick: () => { iv.tab = k; this.renderInventory(); } }, n))),
        search,
        h('div', { class: 'creative-grid' }, h('div', { class: 'grid g9' }, ...this.creativeItems().map(id => this.slotEl({ c: 'cre', id })))),
        h('div', { class: 'row', style: { margin: '8px 0', justifyContent: 'space-between' } }, h('div', { class: 'inv-title' }, 'Inventory'), this.slotEl({ c: 'trash' }, 'trash')),
      );
    } else if (iv.mode === 'chest') {
      top = h('div', {}, h('div', { class: 'inv-title' }, 'Chest'), h('div', { class: 'grid g9', style: { marginBottom: '12px' } }, ...Array.from({ length: 27 }, (_, k) => this.slotEl({ c: 'chest', i: k }))), h('div', { class: 'inv-title' }, 'Inventory'));
    } else if (iv.mode === 'furnace') {
      const be = iv.be || {};
      const cook = (be.cook || 0) / 200, burn = be.burnMax ? (be.burn || 0) / be.burnMax : 0;
      top = h('div', {}, h('div', { class: 'inv-title' }, 'Furnace'),
        h('div', { class: 'craft-row', style: { justifyContent: 'center', gap: '24px' } },
          h('div', { class: 'col', style: { alignItems: 'center', gap: '4px' } }, this.slotEl({ c: 'fin' }), h('div', { class: 'flame' }, h('div', { class: 'lit', style: { height: (burn * 100) + '%', top: 'auto', bottom: 0 } })), this.slotEl({ c: 'ffuel' })),
          h('div', { class: 'arrow' }, h('div', { class: 'fill', style: { width: (cook * 26) + 'px' } })),
          this.slotEl({ c: 'fout' }, 'big'),
        ),
        h('div', { class: 'inv-title' }, 'Inventory'));
    } else {
      const n = iv.n;
      top = h('div', {}, h('div', { class: 'inv-title' }, n === 3 ? 'Crafting table' : 'Crafting'),
        h('div', { class: 'craft-row', style: { justifyContent: n === 3 ? 'center' : 'flex-end' } },
          h('div', { class: 'grid g' + n }, ...Array.from({ length: n * n }, (_, k) => this.slotEl({ c: 'craft', i: k }))),
          h('div', { class: 'arrow' }),
          this.slotEl({ c: 'result' }, 'big'),
        ),
        h('div', { class: 'inv-title' }, 'Inventory'));
    }
    panels.push(h('div', { class: 'panel' }, top, invGrid()));
    this.invEl = h('div', { class: 'screen dim inv-screen', onmousedown: (e) => {
      if (e.target === this.invEl || e.target.classList.contains('inv')) {
        if (this.cursor) { const st = e.button === 2 ? { ...this.cursor, count: 1 } : this.cursor; g.dropStack(st); if (e.button === 2) { this.cursor.count--; if (!this.cursor.count) this.cursor = null; } else this.cursor = null; this.renderInventory(); }
      }
    }, oncontextmenu: (e) => e.preventDefault() }, h('div', { class: 'inv' }, ...panels));
    this.root.append(this.invEl);
    const cg = this.invEl.querySelector('.creative-grid'); if (cg) cg.scrollTop = scroll;
    const bk = this.invEl.querySelector('.book'); if (bk) bk.scrollTop = bookScroll;
    if (this.cursorEl) this.cursorEl.remove();
    this.cursorEl = null;
    if (this.cursor) {
      this.cursorEl = h('div', { class: 'slot cursor-stack', style: { background: 'transparent', border: 0 } });
      this.fillSlot(this.cursorEl, this.cursor);
      this.root.append(this.cursorEl);
      this.moveCursor();
      if (this.tipEl) { this.tipEl.remove(); this.tipEl = null; }
    }
  }

  onKey(e) {
    if (e.target && e.target.tagName === 'INPUT') return;
    if (this.inv) {
      if (e.code === 'Escape' || e.code === this.game.input.binds.inventory) { e.preventDefault(); this.closeInventory(); return; }
      if (this.hover && /^Digit[1-9]$/.test(e.code)) {
        const k = Number(e.code.slice(5)) - 1;
        const ref = this.hover;
        if (ref.c === 'cre') { this.game.player.inventory.slots[k] = this.get(ref); this.game.player.inventory.changed(); }
        else if (ref.c !== 'result' && ref.c !== 'trash') {
          const a = this.get(ref), b = this.game.player.inventory.slots[k];
          if (this.accepts(ref, b)) { this.set(ref, b); this.game.player.inventory.slots[k] = a; this.game.player.inventory.changed(); }
        }
        this.hudDirty(); this.renderInventory();
      }
      if (this.hover && e.code === this.game.input.binds.drop) {
        const st = this.get(this.hover);
        if (st && this.hover.c !== 'cre' && this.hover.c !== 'result') {
          const n = e.ctrlKey ? st.count : 1;
          this.game.dropStack({ ...st, count: n });
          st.count -= n; this.set(this.hover, st.count ? st : null); this.renderInventory();
        }
      }
      return;
    }
    if (e.code === 'Escape' && this.current && !['title', 'loading', 'death'].includes(this.current) && this.current !== 'chat') {
      e.preventDefault();
      if (this.current === 'pause') this.game.resume();
      else if (this.current === 'settings' || this.current === 'character') this.show(this.game.inWorld() ? 'pause' : 'title');
      else if (['offline', 'message'].includes(this.current)) this.show('title');
    }
  }
}
window.addEventListener('mouseup', () => { if (window.__ui) window.__ui.dragging = null; });

// ------------------------------------------------------------------ 3D character preview
class Preview {
  constructor(canvas) {
    this.canvas = canvas;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.r.setPixelRatio(1);
    this.r.setSize(canvas.width, canvas.height, false);
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.cam = new THREE.PerspectiveCamera(30, canvas.width / canvas.height, 0.1, 50);
    this.cam.position.set(0, 1.15, 4.6);
    this.cam.lookAt(0, 0.95, 0);
    this.scene.add(new THREE.HemisphereLight(0xdde6ff, 0x403040, 1.6));
    const d = new THREE.DirectionalLight(0xfff2dd, 2.2); d.position.set(2, 3, 4); this.scene.add(d);
    this.t = 0;
    this.alive = true;
    const loop = () => {
      if (!this.alive) return;
      this.t += 0.016;
      if (this.model) {
        this.model.rotation.y = Math.sin(this.t * 0.6) * 0.7;
        const P = this.model.userData.parts;
        P.larm.rotation.x = Math.sin(this.t * 1.5) * 0.15; P.rarm.rotation.x = -Math.sin(this.t * 1.5) * 0.15;
        P.head.rotation.y = Math.sin(this.t * 0.9) * 0.3;
      }
      this.r.render(this.scene, this.cam);
      requestAnimationFrame(loop);
    };
    loop();
  }
  setLook(look) {
    if (this.model) this.scene.remove(this.model);
    const skin = paintPlayerSkin(look);
    const tex = skin.texture(); tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 });
    this.model = buildHumanoid(skin, mat);
    this.scene.add(this.model);
  }
  dispose() { this.alive = false; this.r.dispose(); }
}
export { h };
