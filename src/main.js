import './style.css';
import * as THREE from 'three';
import { buildTextureArray, buildIconSheet } from './gfx/textures.js';
import { Renderer, LAYER } from './gfx/renderer.js';
import { Particles } from './gfx/particles.js';
import { Weather } from './gfx/weather.js';
import { Hand } from './gfx/hand.js';
import { World } from './world/world.js';
import { WorldGen, BIOMES, BI } from './world/worldgen.js';
import { Server } from './server/server.js';
import { RelayNet, fetchStatus } from './net/net.js';
import { Player } from './game/player.js';
import { Input } from './game/input.js';
import { EntityViews } from './entities/entities.js';
import { buildHumanoid, paintPlayerSkin, defaultLook, animateModel, setModelLight } from './entities/models.js';
import { Audio, STEP, DIG } from './audio/audio.js';
import { UI } from './ui/ui.js';
import * as Save from './save.js';
import { hashString } from './core/noise.js';
import { SEA, DAY_TICKS, H, GAME_NAME } from './core/config.js';
import {
  B, I, BLOCKS, ITEMS, SOLID, LIQUID, REPLACEABLE, SHAPES, SHAPE, breakTime, canHarvest, blockItem,
  wallTorchFor, facingVariant, logVariant, maxStack, TEX,
} from './core/blocks.js';
import { overlapsSolid } from './game/physics.js';

const DEFAULT_SETTINGS = {
  renderDist: 10, fov: 72, renderScale: 1, sensitivity: 1, shadows: true, shadowRes: 4096, ssr: true, bloom: true, rays: true,
  bob: true, invertY: false, showFps: false, clouds: true, preset: 'Fabulous',
  volMaster: 0.8, volMusic: 0.5, volSfx: 0.9, volAmbient: 0.7,
};
const DEATH = {
  fall: 'fell from a high place', drown: 'drowned', lava: 'tried to swim in lava', fire: 'burned to death', cactus: 'was pricked to death',
  starve: 'starved to death', void: 'fell out of the world', zombie: 'was slain by a Zombie', skeleton: 'was shot by a Skeleton',
  spider: 'was slain by a Spider', explosion: 'blew up', arrow: 'was shot', lightning: 'was struck by lightning', player: 'was slain', kill: 'died',
};
const ARMS = { pickaxe: 1, axe: 1, shovel: 1, hoe: 1 };
const SHARED_SEED_TEXT = 'Lumencraft';

class Game {
  constructor() {
    this.canvas = document.getElementById('game');
    this.settings = Save.loadSettings(DEFAULT_SETTINGS);
    this.profile = Save.loadLocal('profile', null) || { name: 'Player' + Math.floor(Math.random() * 900 + 100), look: defaultLook() };
    this.atlas = buildTextureArray();
    this.renderer = new Renderer(this.canvas, this.atlas);
    this.audio = new Audio();
    this.input = new Input(this.canvas);
    this.ui = new UI(this);
    this.ui.setIcons(buildIconSheet());
    this.particles = new Particles(this.renderer);
    this.weather = new Weather(this.renderer);
    this.hand = new Hand(this.renderer);
    this.hand.setLook(this.profile.look);
    this.entities = new EntityViews(this);
    this.state = 'title';
    this.world = null; this.server = null; this.net = null; this.player = null;
    this.playerInfos = new Map();
    this.chatHistory = [];
    this.time = 6000; this.dayCycle = true;
    this.fps = 60; this.frames = 0; this.fpsT = 0;
    this.debug = false; this.hudVisible = true; this.thirdPerson = 0;
    this.mine = null; this.useCd = 0; this.attackCd = 0; this.swingFlag = 0; this.hurtFlag = 0;
    this.eat = null; this.bow = null;
    this.shake = 0; this.damageFlash = 0;
    this.aurora = 0;
    this.shoot = { t: 0, next: 30 };
    this.serverAcc = 0; this.netAcc = 0; this.saveAcc = 0;
    this.lastT = performance.now();
    this.renderer.setEnvironment({ t: 0.3, time: 0 });
    this.makeOverlays();
    this.applySettings();
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing' && !this.ui.isOpen()) this.pause();
    };
    this.canvas.addEventListener('mousedown', () => {
      this.audio.start();
      if (this.state === 'playing' && !this.ui.isOpen() && !this.input.locked) this.input.lock();
    });
    window.addEventListener('pointerdown', () => this.audio.start(), { once: true });
    window.addEventListener('keydown', () => this.audio.start(), { once: true });
    window.addEventListener('resize', () => this.renderer.resize());
    window.addEventListener('beforeunload', () => { this.saveNow(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.saveNow(); });
    this.token = Save.loadLocal('token', null) || (crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now());
    Save.saveLocal('token', this.token);
    this.online = null;
    this.refreshStatus();
    this.startTitle();
    this.ui.show('title');
    requestAnimationFrame((t) => this.loop(t));
  }

  // ================================================================ settings / profile
  applySettings() {
    const s = this.settings;
    this.renderer.applySettings({ shadows: s.shadows, shadowRes: s.shadowRes, ssr: s.ssr, bloom: s.bloom, rays: s.rays, renderScale: s.renderScale, fov: s.fov });
    if (this.world && this.state !== 'title') this.world.setRenderDistance(s.renderDist);
    this.input.sensitivity = s.sensitivity; this.input.invertY = s.invertY;
    this.audio.setVolumes({ master: s.volMaster, music: s.volMusic, sfx: s.volSfx, ambient: s.volAmbient });
  }
  saveSettings() { Save.saveSettings(this.settings); }
  setProfile(p) {
    Object.assign(this.profile, p);
    Save.saveLocal('profile', this.profile);
    this.hand.setLook(this.profile.look);
    this.selfModel = null;
  }

  makeOverlays() {
    // block selection outline + crack overlay
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));
    this.selection = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }));
    this.selection.layers.set(LAYER.OVERLAY);
    this.selection.visible = false;
    this.renderer.scene.add(this.selection);
    const crackMat = new THREE.ShaderMaterial({
      uniforms: { uAtlas: { value: this.atlas }, uLayer: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'precision highp sampler2DArray; uniform sampler2DArray uAtlas; uniform float uLayer; varying vec2 vUv; void main(){ vec4 t = texture(uAtlas, vec3(vUv, uLayer)); if (t.a < 0.1) discard; gl_FragColor = vec4(0.0, 0.0, 0.0, t.a * 0.75); }',
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -4,
    });
    this.crack = new THREE.Mesh(new THREE.BoxGeometry(1.002, 1.002, 1.002), crackMat);
    this.crack.layers.set(LAYER.OVERLAY);
    this.crack.visible = false;
    this.renderer.scene.add(this.crack);
  }

  // ================================================================ title scene
  startTitle() {
    this.disposeWorld();
    this.state = 'title';
    const seedText = 'Lumencraft';
    const seed = hashString(seedText);
    const gen = new WorldGen(seed);
    const spot = this.findScenic(gen);
    this.titleSpot = spot;
    this.world = new World(seed, { renderDist: 7, materials: this.renderer.chunkMats });
    this.renderer.scene.add(this.world.group);
    this.renderer.casterRoots = [this.world.group, this.entities.root];
    this.titleT = Math.random() * 100;
    this.hand.root.visible = false;
  }

  findScenic(gen) {
    const c = {}, isl = {};
    for (let r = 0; r < 3000; r += 24) {
      for (let a = 0; a < Math.PI * 2; a += Math.max(0.05, 24 / Math.max(r, 24))) {
        const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
        if (!gen.islandAt(x, z, isl)) continue;
        if (isl.top - isl.bot < 10) continue;
        gen.climate(x + 40, z, c);
        if (c.h < SEA + 2 || c.h > 100) continue;
        return { x, z, y: isl.top };
      }
    }
    return { x: 0, z: 0, y: 110 };
  }

  // ================================================================ sessions
  inWorld() { return this.state === 'playing' || this.state === 'paused' || this.state === 'dead'; }
  get isHost() { return !!this.server; }
  get isClient() { return !!this.net && !this.server; }
  get shared() { return !!this.net; }
  playerCount() { return this.server ? this.server.players.size : this.playerInfos.size + 1; }
  playerNames() {
    if (this.server) return [...this.server.players.values()].map(p => p.name);
    return [this.profile.name, ...[...this.playerInfos.values()].map(p => p.name)];
  }
  async refreshStatus() {
    const st = await fetchStatus();
    this.online = st ? st.online : null;
    if (this.ui.current === 'title') this.ui.updateOnline && this.ui.updateOnline(this.online);
  }

  listWorlds() { return Save.listWorlds(); }
  deleteWorld(id) { return Save.deleteWorld(id); }

  async createWorld(opts, flags = {}) {
    const seedText = opts.seed || String(Math.floor(Math.random() * 2 ** 31));
    const seed = /^-?\d+$/.test(seedText) ? (Number(seedText) >>> 0) : hashString(seedText);
    const id = 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    const meta = { id, name: opts.name, seed, seedText, gamemode: opts.gamemode, cheats: !!opts.cheats, created: Date.now(), played: Date.now(), time: 1000 };
    const rec = { id, meta, edits: [], server: null, player: null };
    await Save.saveWorld(rec);
    return this.enterWorld(rec, flags);
  }
  async playWorld(id, flags = {}) {
    const rec = await Save.loadWorld(id);
    if (!rec) { this.ui.show('message', { title: 'World not found', text: 'That save could not be loaded.' }); return; }
    return this.enterWorld(rec, flags);
  }

  disposeWorld() {
    if (this.net) { this.net.close(); this.net = null; }
    if (this.world) { this.renderer.scene.remove(this.world.group); this.world.destroy(); this.world = null; }
    this.server = null;
    this.entities.clear();
    this.particles.clear();
    this.playerInfos.clear();
    this.player = null;
    this.selection.visible = false; this.crack.visible = false;
    if (this.selfModel) { this.renderer.scene.remove(this.selfModel); this.selfModel = null; }
  }

  async enterWorld(rec, flags = {}) {
    this.audio.start();
    this.state = 'loading';
    this.ui.show('loading', { text: 'Generating world…' });
    this.disposeWorld();
    this.rec = rec;
    const meta = rec.meta;
    this.world = new World(meta.seed, { renderDist: this.settings.renderDist, materials: this.renderer.chunkMats });
    Save.unpackEdits(rec.edits, this.world.edits);
    this.renderer.scene.add(this.world.group);
    this.renderer.casterRoots = [this.world.group, this.entities.root];
    if (!meta.spawn) meta.spawn = this.findSpawn(meta.seed);
    const sv = rec.server || {};
    this.server = new Server(this.world, { ...meta, time: sv.time ?? meta.time, dayCycle: sv.dayCycle, weather: sv.weather, blockEntities: sv.blockEntities, pvp: !!meta.pvp });
    this.server.hostId = 1;
    this.player = new Player(this);
    this.player.gamemode = meta.gamemode;
    if (rec.player) this.player.load(rec.player);
    else { this.player.x = meta.spawn[0] + 0.5; this.player.y = meta.spawn[1]; this.player.z = meta.spawn[2] + 0.5; this.needsGround = true; this.giveStarter(); }
    const me = { id: 1, local: true, name: this.profile.name, look: this.profile.look, x: this.player.x, y: this.player.y, z: this.player.z, yaw: 0, pitch: 0, flags: 0, held: 0, gamemode: this.player.gamemode, send: (m) => this.onServer(m) };
    this.server.players.set(1, me); me.alive = true;
    this.myId = 1;
    this.time = this.server.time;
    this.weather.set(this.server.weather.rain, this.server.weather.thunder);
    this.weather.rain = this.server.weather.rain; this.weather.thunder = this.server.weather.thunder;
    await this.waitForSpawn();
    this.state = 'playing';
    this.ui.show(null);
    this.ui.hudDirty();
    this.input.lock();
    this.ui.chat(`§7Welcome to §e${meta.name}§7. Press §fT§7 to chat, §fEsc§7 for the menu.`);
    if (!rec.player) this.ui.hint('<kbd>WASD</kbd> move · <kbd>Space</kbd> jump · <kbd>E</kbd> inventory · <kbd>Esc</kbd> menu', 9000);
    this.saveNow();
    void flags;
  }

  giveStarter() {
    if (this.player.creative) return;
  }

  findSpawn(seed) {
    const gen = new WorldGen(seed);
    const c = {};
    const good = [BI.PLAINS, BI.FOREST, BI.CHERRY_GROVE, BI.BIRCH_FOREST, BI.SAVANNA, BI.TAIGA];
    for (let r = 0; r < 4000; r += 16) {
      const steps = Math.max(1, Math.floor((Math.PI * 2 * r) / 32));
      for (let k = 0; k < steps; k++) {
        const a = (k / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
        gen.climate(x, z, c);
        if (c.h > SEA + 1.5 && c.mount < 0.3 && good.includes(c.biome) && c.river < 0.2) return [x, Math.ceil(c.h) + 3, z];
      }
    }
    return [0, 100, 0];
  }

  async waitForSpawn() {
    const t0 = performance.now();
    const p = this.player;
    return new Promise((resolve) => {
      const tick = () => {
        if (!this.world) return resolve();
        this.world.update(p.x, p.z);
        const r = this.world.readiness(p.x, p.z, 2);
        const r2 = this.world.readiness(p.x, p.z, Math.min(5, this.settings.renderDist));
        this.ui.loading(r * 0.5 + r2 * 0.5, r < 1 ? 'Generating terrain…' : 'Lighting the world…');
        const elapsed = performance.now() - t0;
        if ((r >= 1 && r2 > 0.85) || elapsed > 25000) {
          if (this.needsGround) {
            const gx = Math.floor(p.x), gz = Math.floor(p.z);
            let gy = this.world.groundAt(gx, gz);
            if (gy < 0) gy = this.world.heightAt(gx, gz);
            p.y = gy + 1.01;
            this.rec.meta.spawn = [gx, gy + 1, gz];
            this.needsGround = false;
          }
          resolve();
          return;
        }
        // render the world while it loads so the screen isn't static behind the bar
        setTimeout(tick, 30);
      };
      tick();
    });
  }

  // ---------------------------------------------------------------- the shared world
  async playShared() {
    this.audio.start();
    this.state = 'loading';
    this.ui.show('loading', { text: 'Connecting to the world…' });
    this.disposeWorld();
    const net = new RelayNet((m) => this.onRelay(m), () => this.onDisconnect());
    let welcome;
    try {
      welcome = await net.connect({ t: 'hello', name: this.profile.name, look: this.profile.look, token: this.token });
    } catch (e) {
      this.state = 'title';
      this.ui.show('offline', { text: e.message });
      return;
    }
    this.net = net;
    this.myId = welcome.id;
    if (welcome.name !== this.profile.name) this.ui.toast(`Someone called ${this.profile.name} is online — you're <b>${welcome.name}</b>`);
    this.myName = welcome.name;
    const seed = hashString(SHARED_SEED_TEXT);
    this.ui.loading(0.02, 'Generating terrain…');
    this.world = new World(seed, { renderDist: this.settings.renderDist, materials: this.renderer.chunkMats });
    for (const [k, arr] of welcome.edits) {
      const m = new Map();
      for (let i = 0; i < arr.length; i += 2) m.set(arr[i], arr[i + 1]);
      this.world.edits.set(k, m);
    }
    this.renderer.scene.add(this.world.group);
    this.renderer.casterRoots = [this.world.group, this.entities.root];
    for (const p of welcome.players) this.playerInfos.set(p.id, { name: p.name, look: p.look });
    const spawn = this.findSpawn(seed);
    this.rec = { meta: { id: 'shared', name: GAME_NAME, seed, seedText: SHARED_SEED_TEXT, spawn, gamemode: 'survival', cheats: false, protect: 10 } };
    this.time = welcome.time ?? 1000;
    const wt = welcome.weather || { rain: 0, thunder: 0 };
    this.weather.set(wt.rain, wt.thunder); this.weather.rain = wt.rain;
    this.player = new Player(this);
    this.player.gamemode = 'survival';
    if (welcome.player) { this.player.load(welcome.player); this.player.gamemode = 'survival'; }
    else { this.player.x = spawn[0] + 0.5; this.player.y = spawn[1]; this.player.z = spawn[2] + 0.5; this.needsGround = true; }
    if (welcome.authority === welcome.id) this.becomeAuthority({ time: welcome.time, weather: welcome.weather, be: welcome.be, players: welcome.players, quiet: true });
    await this.waitForSpawn();
    if (this.server) this.server.meta.spawn = this.rec.meta.spawn;
    if (!this.world) return;
    this.state = 'playing';
    this.ui.show(null);
    this.ui.hudDirty();
    this.input.lock();
    const n = this.playerCount();
    this.ui.chat(`§7Welcome to §e${GAME_NAME}§7 — one world, shared by everyone. ${n > 1 ? `§a${n - 1} other player${n > 2 ? 's' : ''} online.` : 'You are the only one here right now.'}`);
    if (!welcome.player) this.ui.hint('<kbd>WASD</kbd> move · <kbd>Space</kbd> jump · <kbd>E</kbd> inventory · <kbd>T</kbd> chat · <kbd>Esc</kbd> menu', 9000);
  }

  // This browser runs the simulation for everyone (mobs, water, furnaces, time).
  becomeAuthority(d) {
    const meta = { ...this.rec.meta, time: d.time ?? this.time, weather: d.weather ? { rain: d.weather.rain || 0, thunder: d.weather.thunder || 0, timer: d.weather.timer || 6000 } : null, blockEntities: d.be || [] };
    const server = new Server(this.world, meta);
    server.hostId = -1;
    server.relay = { out: (to, m, except) => this.net && this.net.out(to, m, except), persist: (data) => this.net && this.net.send(data) };
    const me = { id: this.myId, local: true, name: this.myName || this.profile.name, look: this.profile.look, x: this.player.x, y: this.player.y, z: this.player.z, yaw: 0, pitch: 0, flags: 0, held: 0, gamemode: this.player.gamemode, send: (m) => this.onServer(m) };
    me.alive = true;
    server.players.set(me.id, me);
    for (const p of d.players || []) { const r = this.remotePlayer(p); r.alive = true; server.players.set(p.id, r); }
    this.server = server;
    this.time = server.time;
    if (!d.quiet) this.ui.toast('You are now keeping the world running');
  }
  remotePlayer(m) {
    return { id: m.id, name: m.name, look: m.look || {}, x: 0, y: -200, z: 0, yaw: 0, pitch: 0, flags: 0, held: 0, gamemode: 'survival', send: (msg) => this.net && this.net.out(m.id, msg) };
  }
  onRelay(m) {
    if (this.server) {
      if (m.t === 'in') { this.server.receive(m.from, m.m); return; }
      if (m.t === 'join') { this.server.addPlayer(this.remotePlayer(m)); this.ui.toast(`<b>${m.name}</b> joined`); return; }
      if (m.t === 'leave') { this.server.removePlayer(m.id); return; }
    }
    if (m.t === 'becomeAuthority') { if (this.world && this.player) this.becomeAuthority(m); return; }
    if (m.t === 'pj' && !this.server) this.ui.toast(`<b>${m.name}</b> joined`);
    if (!this.world) return;
    this.onServer(m);
  }
  onDisconnect() {
    if (!this.inWorld() && this.state !== 'loading') return;
    this.net = null;
    this.quitToTitle(true);
    this.ui.show('offline', { title: 'Connection lost', text: 'The connection to the world dropped. Your progress up to a few seconds ago is saved.' });
  }

  async playOffline() {
    let rec = await Save.loadWorld('offline');
    if (!rec) {
      const seed = hashString(SHARED_SEED_TEXT);
      rec = { id: 'offline', meta: { id: 'offline', name: 'Offline world', seed, seedText: SHARED_SEED_TEXT, gamemode: 'survival', cheats: true, created: Date.now(), played: Date.now(), time: 1000 }, edits: [], server: null, player: null };
      await Save.saveWorld(rec);
    }
    return this.enterWorld(rec);
  }

  saveNow() {
    if (this.state === 'title' || !this.player) return;
    if (this.net) {
      const data = this.player.serialize();
      data.gamemode = 'survival';
      this.net.send({ t: 'save', data });
      if (this.server) this.net.send(this.server.persistData());
      return;
    }
    if (!this.server || !this.rec || !this.rec.id) return;
    const rec = this.rec;
    rec.meta.played = Date.now();
    rec.meta.time = this.server.time;
    rec.edits = Save.packEdits(this.world.edits);
    rec.server = this.server.serialize();
    rec.player = this.player.serialize();
    if (this.thumb) rec.thumb = this.thumb;
    Save.saveWorld(rec);
  }

  quitToTitle(silent) {
    this.saveNow();
    this.input.unlock();
    this.disposeWorld();
    this.startTitle();
    this.refreshStatus();
    if (!silent) this.ui.show('title');
  }

  pause() {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.mine = null;
    this.ui.show('pause');
  }
  resume() {
    if (this.state === 'dead') return;
    if (this.state === 'paused' || this.state === 'playing') {
      this.state = 'playing';
      if (this.ui.current !== 'inventory' && this.ui.current !== 'chat') this.ui.show(null);
      this.input.lock();
    }
  }

  // ================================================================ server messages (both host-local and remote)
  onServer(m) {
    switch (m.t) {
      case 'bs': {
        const a = m.a;
        for (let i = 0; i < a.length; i += 4) this.world.setBlock(a[i], a[i + 1], a[i + 2], a[i + 3], { immediate: Math.abs(a[i] - this.player.x) < 12 && Math.abs(a[i + 2] - this.player.z) < 12 });
        break;
      }
      case 'ents': this.entities.applySnapshot(m.s, !this.isClient); break;
      case 'pl': this.entities.applyPlayers(m.s, this.server ? this.serverInfos() : this.playerInfos); break;
      case 'pj': this.playerInfos.set(m.id, { name: m.name, look: m.look }); break;
      case 'pq': this.playerInfos.delete(m.id); this.entities.removePlayer(m.id); break;
      case 'give': {
        const left = this.player.inventory.add(m.item.id, m.item.count, m.item.dmg);
        if (left) this.dropStack({ id: m.item.id, count: left, dmg: m.item.dmg }, true);
        this.audio.play('pop', { vol: 0.35, rate: 1.3 });
        this.ui.hudDirty();
        this.entities.removeView(m.from);
        break;
      }
      case 'hurt': {
        const p = this.player;
        if (p.damage(m.amt, m.cause, false, m.kb)) { if (m.fire) p.fire = 5; this.lastAttacker = m.by; }
        break;
      }
      case 'time': this.time = m.v; if (m.slept) { this.player.sleeping = false; this.ui.toast('Good morning ☀'); } break;
      case 'weather': this.weather.set(m.rain, m.thunder); break;
      case 'fx': this.onFx(m); break;
      case 'chat': this.ui.chat(m.text, m.from); if (m.from) this.audio.play('click', { vol: 0.2, rate: 1.6 }); break;
      case 'be':
        if (this.pendingBE === m.key) { this.pendingBE = null; this.ui.openInventory(BLOCKS[this.world.getBlock(...m.key.split(',').map(Number))].be || 'chest', { key: m.key, be: structuredClone(m.data) }); }
        else this.ui.updateBE(m.key, structuredClone(m.data));
        break;
      case 'beGone': if (this.ui.inv && this.ui.inv.key === m.key) this.ui.closeInventory(); break;
      default: break;
    }
  }
  serverInfos() {
    const map = new Map();
    for (const p of this.server.players.values()) map.set(p.id, { name: p.name, look: p.look });
    return map;
  }

  onFx(m) {
    const P = this.particles, A = this.audio;
    const pos = (x, y, z) => [x, y, z];
    switch (m.k) {
      case 'break': {
        P.blockBreak(m.x, m.y, m.z, m.id);
        A.play(DIG[BLOCKS[m.id].sound] || 'dig.stone', { vol: 0.6, pos: pos(m.x + 0.5, m.y + 0.5, m.z + 0.5) });
        break;
      }
      case 'explode': {
        P.explosion(m.x, m.y, m.z, m.r);
        A.play('explode', { vol: 1, pos: pos(m.x, m.y, m.z), range: 80, reverb: 0.5 });
        A.play('boom', { vol: 0.9, pos: pos(m.x, m.y, m.z), range: 90, rate: 0.8 });
        const d = this.renderer.camera.position.distanceTo(new THREE.Vector3(m.x, m.y, m.z));
        this.shake = Math.max(this.shake, Math.max(0, 1 - d / 40));
        break;
      }
      case 'bolt': {
        this.weather.bolt(m.x, m.y, m.z);
        const d = this.renderer.camera.position.distanceTo(new THREE.Vector3(m.x, m.y, m.z));
        A.thunder(d);
        break;
      }
      case 'mobhurt': {
        const v = this.entities.ents.get(m.e);
        if (v && v.buf.length) { const s = v.buf[v.buf.length - 1]; A.play('punch', { vol: 0.6, pos: pos(s.x, s.y + 1, s.z) }); }
        break;
      }
      case 'mobdie': P.poof(m.x, m.y, m.z); A.play('pop', { vol: 0.4, pos: pos(m.x, m.y, m.z), rate: 0.7 }); break;
      case 'pickup': if (m.to !== this.myId) this.entities.removeView(m.e); break;
      case 'fuse': A.play('fizz', { vol: 0.7, pos: pos(m.x + 0.5, m.y, m.z + 0.5) }); break;
      case 'fizz': A.play('fizz', { vol: 0.6, pos: pos(m.x + 0.5, m.y + 0.5, m.z + 0.5) }); P.poof(m.x + 0.5, m.y + 0.5, m.z + 0.5); break;
      case 'arrowhit': A.play('dig.wood', { vol: 0.35, pos: pos(m.x, m.y, m.z), rate: 1.5 }); break;
      case 'bow': A.play('woosh', { vol: 0.5, pos: pos(m.x, m.y, m.z), rate: 1.3 }); break;
      case 'shear': A.play('chop', { vol: 0.6 }); break;
      default: break;
    }
  }

  // send an intent to the server (local call when hosting)
  send(m) {
    if (this.server) this.server.receive(this.myId, m);
    else if (this.net) this.net.send(m);
  }
  sendBE(key, data) { this.send({ t: 'beSet', key, data }); }
  closeBE(key) { this.send({ t: 'closeBE', key }); }

  dropStack(st, noDelay) {
    const p = this.player;
    const cy = Math.cos(p.yaw), sy = Math.sin(p.yaw), cp = Math.cos(p.pitch);
    const v = [-sy * cp * 5, Math.sin(p.pitch) * 5 + 2, -cy * cp * 5];
    this.send({ t: 'drop', item: { id: st.id, count: st.count, dmg: st.dmg || 0 }, p: [p.x, p.y + p.eyeH - 0.3, p.z], v });
    void noDelay;
  }

  sendChat(text) {
    this.chatHistory.push(text);
    if (text.startsWith('/')) { this.runCommand(text.slice(1)); return; }
    this.send({ t: 'chat', text });
  }

  canCheat() { return !this.net; }

  runCommand(cmd) {
    const [name, ...args] = cmd.trim().split(/\s+/);
    const p = this.player;
    const say = (t) => this.ui.chat('§7' + t);
    if (!this.canCheat() && !['help', 'seed', 'spawn', 'kill', 'list'].includes(name)) { say('That command is off in the shared world. Try /help.'); return; }
    switch (name) {
      case 'list': say('Online: ' + this.playerNames().join(', ')); break;
      case 'help': if (this.net) { say('/list · /spawn · /seed · /kill'); break; } say('/time set day|night|noon|midnight|<ticks> · /weather clear|rain|thunder · /gamemode survival|creative · /give <item> [n] · /tp x y z · /summon <mob> · /seed · /spawn · /kill'); break;
      case 'time': {
        const v = args[1] || args[0];
        const map = { day: 1000, noon: 6000, sunset: 11800, night: 13000, midnight: 18000, sunrise: 23200 };
        const t = map[v] !== undefined ? map[v] : Number(v);
        if (isNaN(t)) { say('Usage: /time set day'); break; }
        const day = Math.floor(this.time / DAY_TICKS) * DAY_TICKS;
        this.send({ t: 'setTime', v: day + t + (t < this.time % DAY_TICKS ? DAY_TICKS : 0) });
        say('Time set to ' + v);
        break;
      }
      case 'weather': this.send({ t: 'setWeather', rain: args[0] !== 'clear', thunder: args[0] === 'thunder', dur: 12000 }); say('Weather set to ' + args[0]); break;
      case 'gamemode': case 'gm': {
        const m = { 0: 'survival', 1: 'creative', s: 'survival', c: 'creative', survival: 'survival', creative: 'creative' }[args[0]];
        if (!m) { say('Usage: /gamemode creative'); break; }
        p.gamemode = m; if (m === 'survival') p.flying = false;
        this.ui.hudDirty(); say('Game mode set to ' + m);
        break;
      }
      case 'give': {
        const nm = (args[0] || '').toLowerCase();
        const id = I[nm];
        if (id === undefined) { say('Unknown item ' + nm); break; }
        const n = Math.min(64 * 36, Number(args[1]) || 1);
        p.inventory.add(id, n);
        this.ui.hudDirty(); say(`Gave ${n} ${ITEMS[id].display}`);
        break;
      }
      case 'tp': {
        const [x, y, z] = args.map(Number);
        if ([x, y, z].some(isNaN)) { say('Usage: /tp x y z'); break; }
        p.x = x; p.y = y; p.z = z; p.vx = p.vy = p.vz = 0; break;
      }
      case 'summon': this.send({ t: 'summon', kind: args[0], x: p.x - Math.sin(p.yaw) * 3, y: p.y + 0.5, z: p.z - Math.cos(p.yaw) * 3 }); break;
      case 'seed': say('Seed: ' + this.world.seed); break;
      case 'spawn': { const s = p.spawn || this.rec.meta.spawn; p.x = s[0] + 0.5; p.y = s[1] + 0.5; p.z = s[2] + 0.5; p.vx = p.vy = p.vz = 0; break; }
      case 'kill': p.damage(999, 'kill', true); break;
      case 'fly': if (p.creative) p.flying = !p.flying; break;
      default: say('Unknown command. Try /help');
    }
  }

  // ================================================================ player events
  onFootstep(p) {
    const id = this.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
    const above = this.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
    const b = BLOCKS[above === B.snow_layer ? above : id];
    if (!b || !b.sound || b.sound === 'none') return;
    this.audio.play(STEP[b.sound] || 'step.stone', { vol: p.sneaking ? 0.12 : 0.28 });
  }
  onLand(p, dist) {
    const id = this.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.2), Math.floor(p.z));
    const b = BLOCKS[id];
    if (b && b.sound) this.audio.play(STEP[b.sound] || 'step.stone', { vol: Math.min(0.8, 0.25 + dist * 0.06), rate: 0.85 });
    if (LIQUID[this.world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))] === 1 && dist > 2) { this.particles.splash(p.x, p.y + 0.5, p.z); this.audio.play('splash', { vol: 0.5 }); }
  }
  onPlayerHurt(p, amount, cause) {
    this.audio.play('hurt', { vol: 0.8 });
    this.damageFlash = 1;
    this.shake = Math.max(this.shake, 0.35);
    this.hurtFlag = 0.3;
    this.ui.hudDirty();
    void amount; void cause;
  }
  onPlayerDeath(p, cause) {
    const msg = DEATH[cause] || 'died';
    this.send({ t: 'died', msg });
    if (!p.creative) {
      for (let i = 0; i < p.inventory.slots.length; i++) {
        const s = p.inventory.slots[i];
        if (s) this.send({ t: 'drop', item: s, p: [p.x, p.y + 1, p.z], v: [(Math.random() - 0.5) * 4, 3, (Math.random() - 0.5) * 4] });
      }
      p.inventory.clear();
    }
    this.state = 'dead';
    this.mine = null;
    this.input.unlock();
    this.ui.show('death', { msg: `${this.profile.name} ${msg}` });
  }
  respawn() {
    const p = this.player;
    let s = p.spawn;
    if (s && this.world.getBlock(s[0], s[1], s[2]) !== B.bed) { s = null; p.spawn = null; this.ui.toast('Your bed was missing'); }
    const sp = s ? [s[0] + 0.5, s[1] + 0.6, s[2] + 0.5] : [this.rec.meta.spawn[0] + 0.5, this.rec.meta.spawn[1] + 0.2, this.rec.meta.spawn[2] + 0.5];
    p.respawn(sp);
    this.state = 'playing';
    this.ui.show(null);
    this.ui.hudDirty();
    this.input.lock();
  }

  // ================================================================ interaction
  eyePos() { const p = this.player; return new THREE.Vector3(p.x, p.y + p.eyeH, p.z); }
  lookDir() {
    const p = this.player;
    const cp = Math.cos(p.pitch);
    return new THREE.Vector3(-Math.sin(p.yaw) * cp, Math.sin(p.pitch), -Math.cos(p.yaw) * cp);
  }

  interact(dt) {
    const p = this.player, inp = this.input, w = this.world;
    const eye = this.eyePos(), dir = this.lookDir();
    const reach = p.creative ? 5.5 : 4.6;
    const hit = w.raycast(eye, dir, reach);
    const ehit = this.entities.raycast(eye, dir, p.creative ? 5 : 3.6, !!(this.rec && this.rec.meta.pvp));
    const target = ehit && (!hit || ehit.dist < hit.dist) ? ehit : null;
    this.target = hit;
    // selection outline
    if (hit && !target) {
      const box = World.selBox(hit.id) || [0, 0, 0, 16, 16, 16];
      this.selection.visible = true;
      this.selection.scale.set((box[3] - box[0]) / 16 + 0.004, (box[4] - box[1]) / 16 + 0.004, (box[5] - box[2]) / 16 + 0.004);
      this.selection.position.set(hit.x + (box[0] + box[3]) / 32, hit.y + (box[1] + box[4]) / 32, hit.z + (box[2] + box[5]) / 32);
    } else this.selection.visible = false;

    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.useCd > 0) this.useCd -= dt;
    const held = p.held;
    const it = held ? ITEMS[held.id] : null;

    // ---- left: attack / mine
    if (inp.mouse.left && !this.eat && !this.bow) {
      if (target && inp.mouse.leftDown) this.attack(target);
      else if (hit && !target) {
        if (p.creative) {
          if (inp.mouse.leftDown || this.attackCd <= 0) {
            if (!(it && it.tool === 'sword')) this.breakBlock(hit);
            this.attackCd = 0.22;
            this.swing();
          }
        } else {
          if (!this.mine || this.mine.x !== hit.x || this.mine.y !== hit.y || this.mine.z !== hit.z) this.mine = { x: hit.x, y: hit.y, z: hit.z, id: hit.id, p: 0, snd: 0 };
          const bt = breakTime(hit.id, held ? held.id : null, p.eyeInWater === 1, p.onGround || p.inWater);
          this.mine.p += dt / bt;
          this.mine.snd -= dt;
          if (this.mine.snd <= 0) {
            this.mine.snd = 0.25;
            const snd = BLOCKS[hit.id].sound;
            this.audio.play(DIG[snd] || 'dig.stone', { vol: 0.22, rate: 1.1 });
            this.particles.blockHit(hit.x, hit.y, hit.z, hit.id, hit.nx, hit.ny, hit.nz);
            this.swing();
          }
          if (this.mine.p >= 1) { this.breakBlock(hit); this.mine = null; }
        }
      }
    } else this.mine = null;
    if (inp.mouse.leftDown && !hit && !target) this.swing();
    // crack overlay
    if (this.mine && this.mine.p > 0) {
      this.crack.visible = true;
      this.crack.position.set(this.mine.x + 0.5, this.mine.y + 0.5, this.mine.z + 0.5);
      this.crack.material.uniforms.uLayer.value = TEX['destroy_' + Math.min(9, Math.floor(this.mine.p * 10))];
    } else this.crack.visible = false;

    // ---- right: use
    const rightPress = inp.mouse.rightDown;
    if (this.eat) {
      if (!inp.mouse.right || !held || held.id !== this.eat.id) { this.eat = null; this.hand.useAnim = 0; }
      else {
        this.eat.t += dt;
        this.hand.useAnim = Math.abs(Math.sin(this.eat.t * 12)) * 0.5;
        if (Math.floor(this.eat.t * 5) !== Math.floor((this.eat.t - dt) * 5)) this.audio.play('eat', { vol: 0.35, rate: 1.3 });
        if (this.eat.t >= 1.5) {
          if (p.eat(held.id)) { if (!p.creative) p.inventory.decSlot(p.selected); this.audio.play('pop', { vol: 0.4, rate: 0.8 }); }
          this.eat = null; this.hand.useAnim = 0; this.ui.hudDirty();
        }
      }
    }
    if (this.bow) {
      this.bow.t += dt;
      if (!inp.mouse.right) {
        const power = Math.min(1, this.bow.t / 0.9);
        if (power > 0.15) this.shootArrow(power);
        this.bow = null;
      }
    }
    if ((rightPress || (inp.mouse.right && this.useCd <= 0)) && !this.eat && !this.bow) {
      this.useCd = 0.22;
      this.use(hit, target, rightPress);
    }
    // middle click: pick block
    if (inp.mouse.middleDown && hit) {
      const id = blockItem(hit.id);
      const inv = p.inventory;
      const idx = inv.slots.findIndex(s => s && s.id === id);
      if (idx >= 0 && idx < 9) p.selected = idx;
      else if (p.creative) inv.slots[p.selected] = { id, count: maxStack(id), dmg: 0 };
      else if (idx >= 9) { const t = inv.slots[p.selected]; inv.slots[p.selected] = inv.slots[idx]; inv.slots[idx] = t; }
      inv.changed(); this.ui.hudDirty();
    }
  }

  swing() { this.hand.doSwing(); this.swingFlag = 0.15; }

  attack(target) {
    const p = this.player;
    if (this.attackCd > 0) return;
    this.attackCd = 0.3;
    this.swing();
    const held = p.held;
    const it = held ? ITEMS[held.id] : null;
    let dmg = it && it.damage ? it.damage : 1;
    const crit = p.vy < -0.5 && !p.onGround;
    if (crit) dmg *= 1.5;
    const dir = this.lookDir();
    const v = target.v;
    if (v.type === 'player') this.send({ t: 'hitp', e: v.id, d: Math.round(dmg), kx: dir.x, kz: dir.z });
    else if (v.type === 'tnt') return;
    else this.send({ t: 'hit', e: v.id, d: Math.round(dmg), kx: dir.x, kz: dir.z });
    const s = v.buf[v.buf.length - 1];
    if (s && crit) this.particles.crit(s.x, s.y + (v.h || 1) * 0.7, s.z);
    this.audio.play('punch', { vol: 0.55 });
    p.addExhaustion(0.1);
    if (it && it.durability && !p.creative) this.wearTool(it.tool === 'sword' ? 1 : 2);
  }

  wearTool(n) {
    const p = this.player, s = p.held;
    if (!s) return;
    const it = ITEMS[s.id];
    if (!it.durability) return;
    s.dmg = (s.dmg || 0) + n;
    if (s.dmg >= it.durability) {
      p.inventory.slots[p.selected] = null;
      this.audio.play('dig.metal', { vol: 0.8, rate: 0.7 });
      this.ui.toast(`Your ${it.display} broke!`);
    }
    p.inventory.changed();
    this.ui.hudDirty();
  }

  breakBlock(hit) {
    const p = this.player;
    const id = hit.id;
    const def = BLOCKS[id];
    if (def.hardness < 0 && !p.creative) return;
    const held = p.held;
    this.particles.blockBreak(hit.x, hit.y, hit.z, id);
    this.audio.play(DIG[def.sound] || 'dig.stone', { vol: 0.65 });
    if (!this.server) this.world.setBlock(hit.x, hit.y, hit.z, 0, { immediate: true });
    this.send({ t: 'set', x: hit.x, y: hit.y, z: hit.z, id: 0, drop: !p.creative, tool: held ? held.id : null });
    if (!p.creative && held && ITEMS[held.id].durability && def.hardness > 0) this.wearTool(ITEMS[held.id].tool === 'sword' ? 2 : ARMS[ITEMS[held.id].tool] ? 1 : 0);
    p.addExhaustion(0.005);
    if (!canHarvest(id, held ? held.id : null) && !p.creative && def.toolLevel >= 0) this.ui.hint('That block needs a better tool', 2500);
  }

  // place position for a hit
  placeAt(hit) {
    const w = this.world;
    if (REPLACEABLE[hit.id] && !LIQUID[hit.id]) return [hit.x, hit.y, hit.z];
    return [hit.x + hit.nx, hit.y + hit.ny, hit.z + hit.nz];
  }

  use(hit, target, press) {
    const p = this.player, w = this.world;
    const held = p.held;
    const it = held ? ITEMS[held.id] : null;
    // entities
    if (target && press) {
      const v = target.v;
      if (v.type === 'mob') { this.send({ t: 'use', e: v.id, item: held ? held.id : null }); this.swing(); }
      return;
    }
    // block actions (unless sneaking with an item)
    if (hit && press && !(p.sneaking && held)) {
      const def = BLOCKS[hit.id];
      if (def.use === 'craft') { this.ui.openInventory('craft'); return; }
      if (def.use === 'chest' || def.use === 'furnace') { const key = `${hit.x},${hit.y},${hit.z}`; this.pendingBE = key; this.send({ t: 'openBE', x: hit.x, y: hit.y, z: hit.z }); return; }
      if (def.use === 'bed') { this.sleep(hit); return; }
      if (def.use === 'tnt' && it && (it.name === 'flint_and_steel' || held.id === B.torch)) { this.send({ t: 'ignite', x: hit.x, y: hit.y, z: hit.z }); this.swing(); if (it.durability) this.wearTool(1); return; }
    }
    if (!held) return;
    // food
    if (it.food && (p.hunger < 20 || it.heal || p.creative) && press) { this.eat = { id: held.id, t: 0 }; return; }
    // bow
    if (it.name === 'bow' && press) {
      if (p.creative || p.inventory.count(I.arrow) > 0) this.bow = { t: 0 };
      return;
    }
    // buckets
    if (it.name === 'bucket' && press) {
      const fh = w.raycast(this.eyePos(), this.lookDir(), 5, true);
      if (fh && LIQUID[fh.id] && BLOCKS[fh.id].level === 0) {
        this.setBlockLocal(fh.x, fh.y, fh.z, 0, fh.id);
        const full = LIQUID[fh.id] === 1 ? I.water_bucket : I.lava_bucket;
        if (!p.creative) { p.inventory.decSlot(p.selected); const left = p.inventory.add(full, 1); if (left) this.dropStack({ id: full, count: 1 }); }
        this.audio.play('splash', { vol: 0.5 });
        this.ui.hudDirty();
      }
      return;
    }
    if (!hit) return;
    if ((it.name === 'water_bucket' || it.name === 'lava_bucket') && press) {
      const [x, y, z] = this.placeAt(hit);
      const cur = w.getBlock(x, y, z);
      if (cur && !REPLACEABLE[cur]) return;
      this.setBlockLocal(x, y, z, it.name === 'water_bucket' ? B.water : B.lava, cur);
      if (!p.creative) { p.inventory.slots[p.selected] = { id: I.bucket, count: 1, dmg: 0 }; p.inventory.changed(); }
      this.audio.play('splash', { vol: 0.5 }); this.swing(); this.ui.hudDirty();
      return;
    }
    if (it.tool === 'hoe' && press && (hit.id === B.grass || hit.id === B.dirt) && w.getBlock(hit.x, hit.y + 1, hit.z) === 0) {
      this.setBlockLocal(hit.x, hit.y, hit.z, B.farmland, hit.id);
      this.audio.play('step.gravel', { vol: 0.5 }); this.swing(); if (!p.creative) this.wearTool(1);
      return;
    }
    if (it.name === 'flint_and_steel' && press) {
      const [x, y, z] = this.placeAt(hit);
      if (w.getBlock(x, y, z) === 0 && w.getBlock(hit.x, hit.y, hit.z) === B.obsidian) this.ui.hint('Portals are coming in a future update ✨', 2500);
      return;
    }
    // placement
    let place = it.block !== undefined ? it.block : it.place ? B[it.place] : undefined;
    if (place === undefined) return;
    const [x, y, z] = this.placeAt(hit);
    if (y < 0 || y >= H) return;
    const cur = w.getBlock(x, y, z);
    if (cur && !REPLACEABLE[cur]) return;
    if (it.needs) { const below = w.getBlock(x, y - 1, z); if (!it.needs.map(n => B[n]).includes(below)) return; }
    const def = BLOCKS[place];
    // orientation variants
    if (def.torch) { if (hit.ny === 1 || hit.ny === -1) { if (hit.ny === -1) return; place = B.torch; } else place = wallTorchFor(hit.nx, hit.nz); if (place !== B.torch && !SOLID[w.getBlock(x - hit.nx, y, z - hit.nz)]) return; if (place === B.torch && !SOLID[w.getBlock(x, y - 1, z)]) return; }
    else if (def.tag === 'log') place = logVariant(place, hit.nx ? 'x' : hit.nz ? 'z' : 'y');
    else if (def.facingFamily) place = facingVariant(place, p.yaw);
    else if (def.leaves) place = B[def.wood + '_leaves_p'];
    if (SHAPES[place] === SHAPE.CROSS || BLOCKS[place].crop !== undefined) {
      const below = w.getBlock(x, y - 1, z);
      if (!SOLID[below] && !BLOCKS[place].crystal) return;
    }
    // don't place inside players / mobs
    if (SOLID[place]) {
      const boxes = BLOCKS[place].collide || (SHAPES[place] === SHAPE.BOXES ? BLOCKS[place].boxes : [[0, 0, 0, 16, 16, 16]]);
      for (const b of boxes) {
        const x0 = x + b[0] / 16, y0 = y + b[1] / 16, z0 = z + b[2] / 16, x1 = x + b[3] / 16, y1 = y + b[4] / 16, z1 = z + b[5] / 16;
        if (p.x + p.hw > x0 && p.x - p.hw < x1 && p.y + p.h > y0 && p.y < y1 && p.z + p.hw > z0 && p.z - p.hw < z1) return;
        for (const v of this.entities.ents.values()) {
          if (v.type !== 'mob') continue;
          const s = v.buf[v.buf.length - 1];
          if (s && s.x + v.hw > x0 && s.x - v.hw < x1 && s.y + v.h > y0 && s.y < y1 && s.z + v.hw > z0 && s.z - v.hw < z1) return;
        }
      }
    }
    if (cur === B.water && (def.torch || SHAPES[place] === SHAPE.CROSS)) return;
    this.setBlockLocal(x, y, z, place, cur);
    this.audio.play(DIG[def.sound] || 'place', { vol: 0.5, rate: 1.15 });
    this.swing();
    if (!p.creative) { p.inventory.decSlot(p.selected); this.ui.hudDirty(); }
  }

  // The host's server applies edits to the shared world itself; clients predict locally.
  setBlockLocal(x, y, z, id, expect) {
    if (!this.server) this.world.setBlock(x, y, z, id, { immediate: true });
    this.send({ t: 'set', x, y, z, id, expect });
  }

  shootArrow(power) {
    const p = this.player;
    if (!p.creative) { if (!p.inventory.take(I.arrow, 1)) return; this.wearTool(1); }
    const d = this.lookDir();
    const e = this.eyePos();
    const sp = 12 + power * 30;
    this.send({ t: 'shoot', p: [e.x + d.x * 0.5, e.y - 0.1 + d.y * 0.5, e.z + d.z * 0.5], v: [d.x * sp, d.y * sp, d.z * sp], d: Math.round(2 + power * 7) });
    this.audio.play('woosh', { vol: 0.6, rate: 1.2 });
    this.ui.hudDirty();
  }

  sleep(hit) {
    const t = this.time % DAY_TICKS;
    const p = this.player;
    p.spawn = [hit.x, hit.y, hit.z];
    if (t < 12500 && this.weather.thunder < 0.5) { this.ui.toast('Respawn point set. You can only sleep at night.'); return; }
    p.sleeping = true;
    p.x = hit.x + 0.5; p.z = hit.z + 0.5; p.y = hit.y + 0.6;
    this.send({ t: 'sleep', on: true });
    this.ui.toast('Sleeping… (everyone online needs to sleep)');
  }

  // ================================================================ frame loop
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    let dt = (now - this.lastT) / 1000;
    this.lastT = now;
    if (!(dt > 0)) dt = 1 / 60;
    dt = Math.min(dt, 0.1);
    this.frames++; this.fpsT += dt;
    if (this.fpsT >= 0.5) { this.fps = this.frames / this.fpsT; this.frames = 0; this.fpsT = 0; }
    this.renderer.U.uTime.value += dt;
    try {
      if (this.state === 'title') this.titleFrame(dt);
      else if (this.state !== 'loading' && this.world) this.gameFrame(dt);
    } catch (e) { console.error(e); }
    this.input.endFrame();
  }

  titleFrame(dt) {
    if (!this.world) return;
    this.titleT += dt;
    const s = this.titleSpot;
    const cam = this.renderer.camera;
    const a = this.titleT * 0.03;
    const R = 64;
    cam.position.set(s.x + Math.cos(a) * R, s.y + 26 + Math.sin(this.titleT * 0.1) * 2, s.z + Math.sin(a) * R);
    cam.lookAt(s.x, s.y - 6, s.z);
    this.world.update(cam.position.x, cam.position.z);
    this.renderer.setEnvironment({ t: 0.43, time: this.titleT, renderDist: 7, cloudCover: 0.42 });
    this.renderer.camera.fov = 70; this.renderer.camera.updateProjectionMatrix();
    this.renderer.render(dt, { hand: false });
  }

  gameFrame(dt) {
    const p = this.player, inp = this.input;
    const playing = this.state === 'playing' && !this.ui.isOpen();
    inp.enabled = playing && inp.locked;
    // ---- look
    if (inp.enabled) {
      const k = 0.0022 * this.settings.sensitivity * (this.bow ? 0.6 : 1);
      p.yaw -= inp.mouse.dx * k;
      p.pitch -= inp.mouse.dy * k * (this.settings.invertY ? -1 : 1);
      p.pitch = Math.max(-1.55, Math.min(1.55, p.pitch));
      // hotbar
      if (inp.mouse.wheel) { p.selected = (p.selected + inp.mouse.wheel + 9) % 9; this.ui.hudDirty(); }
      for (let i = 1; i <= 9; i++) if (inp.hitCode('Digit' + i)) { p.selected = i - 1; this.ui.hudDirty(); }
      if (inp.hit('inventory')) this.ui.openInventory('player');
      if (inp.hit('chat')) this.ui.openChat();
      if (inp.hit('command')) this.ui.openChat('/');
      if (inp.hit('drop') && p.held) {
        const n = inp.down('sprint') ? p.held.count : 1;
        this.dropStack({ ...p.held, count: n });
        p.inventory.decSlot(p.selected, n); this.ui.hudDirty();
      }
      if (inp.hit('perspective')) this.thirdPerson = (this.thirdPerson + 1) % 3;
      if (inp.hit('debug')) this.debug = !this.debug;
      if (inp.hit('hud')) { this.hudVisible = !this.hudVisible; this.ui.setHudVisible(this.hudVisible); }
      if (inp.hit('screenshot')) this.wantShot = true;
    }
    // ---- simulate local player once its column is ready
    const ready = this.world.isMeshed(Math.floor(p.x), Math.floor(p.z));
    if (ready && this.state !== 'dead') p.update(dt, inp.enabled ? inp : null);
    if (playing && inp.enabled && this.state === 'playing') this.interact(dt);
    else { this.mine = null; this.crack.visible = false; }
    if (p.sleeping && (p.vx * p.vx + p.vz * p.vz > 0.5 || inp.hit('sneak'))) { p.sleeping = false; this.send({ t: 'sleep', on: false }); }

    // ---- server / network
    if (this.server) {
      this.serverAcc += dt;
      let n = 0;
      while (this.serverAcc >= 0.05 && n < 4) { this.serverAcc -= 0.05; this.server.update(0.05); n++; }
      if (n === 4) this.serverAcc = 0;
      this.time = this.server.time;
    } else if (this.dayCycle) this.time += dt * 20;
    if (this.server && this.net) this.net.flush();
    this.netAcc += dt;
    if (this.netAcc >= (this.server ? 0.05 : 0.1)) {
      this.netAcc = 0;
      const flags = (p.sneaking ? 1 : 0) | (p.sprinting ? 2 : 0) | (this.swingFlag > 0 ? 4 : 0) | (this.hurtFlag > 0 ? 8 : 0) | (this.bow ? 16 : 0);
      this.send({ t: 'state', p: [+p.x.toFixed(3), +p.y.toFixed(3), +p.z.toFixed(3)], r: [+p.yaw.toFixed(3), +p.pitch.toFixed(3)], f: flags, h: p.held ? p.held.id : 0, g: p.gamemode, dead: p.dead, hp: p.health });
    }
    this.swingFlag -= dt; this.hurtFlag -= dt;
    // item pickup requests
    this.pickupT = (this.pickupT || 0) - dt;
    if (this.pickupT <= 0 && !p.dead) {
      this.pickupT = 0.1;
      for (const v of this.entities.ents.values()) {
        if (v.type !== 'item' || v.requested) continue;
        const s = v.buf[v.buf.length - 1];
        if (!s || v.age < 0.5) continue;
        const dx = s.x - p.x, dy = s.y - (p.y + 0.6), dz = s.z - p.z;
        if (dx * dx + dy * dy + dz * dz < 2.2 && p.inventory.canFit(v.kind, s.extra || 1)) { v.requested = true; this.send({ t: 'pickup', e: v.id }); setTimeout(() => { v.requested = false; }, 1000); }
      }
    }
    this.saveAcc += dt;
    if (this.saveAcc > (this.net ? 15 : 30)) { this.saveAcc = 0; this.saveNow(); }

    // ---- world + visuals
    this.world.update(p.x, p.z);
    this.entities.update(dt);
    this.weather.update(dt, this);
    this.particles.update(dt, this);
    this.updateCamera(dt);
    const L = this.world.getLight(Math.floor(p.x), Math.floor(p.y + p.eyeH), Math.floor(p.z));
    const sky = (L >> 4) / 15, blk = (L & 15) / 15;
    this.hand.update(dt, p, [sky, blk], this.thirdPerson === 0 && this.hudVisible && !p.dead);
    if (this.hand.swing === 0.0001) { /* swing started */ }
    // environment
    const t = (this.time % DAY_TICKS) / DAY_TICKS;
    const bio = BIOMES[this.world.biomeAt(Math.floor(p.x), Math.floor(p.z))] || {};
    const auroraT = (bio.aurora || p.y > 130) ? 1 : 0;
    this.aurora += (auroraT - this.aurora) * Math.min(1, dt * 0.3);
    this.damageFlash = Math.max(0, this.damageFlash - dt * 2.5);
    this.renderer.compPass.m.uniforms.uDamage.value = this.damageFlash * 0.8 + (p.health <= 4 && !p.creative ? 0.25 + 0.15 * Math.sin(this.renderer.U.uTime.value * 4) : 0);
    this.renderer.compPass.m.uniforms.uFade.value = p.sleeping ? Math.max(0.15, (this.renderer.compPass.m.uniforms.uFade.value - dt * 0.5)) : Math.min(1, this.renderer.compPass.m.uniforms.uFade.value + dt * 2);
    const eyeLight = Math.max(sky, blk);
    this.renderer.setEnvironment({
      t, time: this.renderer.U.uTime.value, rain: this.weather.rain * this.weather.local, thunder: this.weather.thunder,
      flash: this.weather.flash * 0.6, aurora: this.aurora, renderDist: this.world.renderDist, cloudCover: this.settings.clouds ? 0.42 : 0,
      underwater: p.eyeInWater === 1, eyeLight: 1 - eyeLight * 0.6,
    });
    this.shootingStars(dt);
    // audio
    const cam = this.renderer.camera;
    const fwd = this.lookDir();
    this.audio.setListener(cam.position.x, cam.position.y, cam.position.z, fwd.x, fwd.y, fwd.z);
    this.audio.updateAmbience(dt, {
      wind: Math.min(1, Math.max(0.15, (p.y - 70) / 60)) * (sky > 0.5 ? 1 : 0.1) + this.weather.thunder * 0.5,
      rain: this.weather.rain * this.weather.local * (this.weather.snow ? 0.2 : 1), under: p.eyeInWater === 1, indoor: sky < 0.6,
      cave: sky < 0.15 && p.y < 60, night: this.renderer.env.night,
    });
    // render
    this.renderer.render(dt, { hand: this.thirdPerson === 0 && this.hudVisible && !p.dead });
    if (this.wantShot) { this.wantShot = false; this.screenshot(); }
    this.thumbT = (this.thumbT || 0) - dt;
    if (this.thumbT <= 0 && this.state === 'playing') { this.thumbT = 20; this.captureThumb(); }
    this.ui.updateHud(dt);
  }

  updateCamera(dt) {
    const p = this.player, cam = this.renderer.camera;
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const fov = this.settings.fov + p.fovKick * 8 - (this.bow ? Math.min(1, this.bow.t / 0.9) * 10 : 0);
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov += (fov - cam.fov) * Math.min(1, dt * 12); cam.updateProjectionMatrix(); }
    const eye = new THREE.Vector3(p.x, p.y + p.eyeH, p.z);
    let bobX = 0, bobY = 0, roll = 0;
    if (this.settings.bob && this.thirdPerson === 0) {
      bobX = Math.sin(p.bob) * 0.045 * p.bobAmt; bobY = Math.abs(Math.cos(p.bob)) * 0.06 * p.bobAmt;
      roll = Math.sin(p.bob) * 0.006 * p.bobAmt;
    }
    if (p.hurtTime > 0) roll += Math.sin(p.hurtTime * 12) * 0.04 * p.hurtTime * 2;
    const sh = this.shake * this.shake;
    cam.rotation.order = 'YXZ';
    cam.rotation.set(p.pitch + (Math.random() - 0.5) * sh * 0.05, p.yaw + (Math.random() - 0.5) * sh * 0.05, roll);
    if (p.dead) cam.rotation.z = 0.5;
    const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    eye.addScaledVector(right, bobX); eye.y += bobY - 0.03 * p.bobAmt;
    // third person
    if (this.thirdPerson) {
      const back = this.lookDir().multiplyScalar(this.thirdPerson === 1 ? -1 : 1);
      const hit = this.world.raycast(eye, back, 4.5);
      const d = hit ? Math.max(0.3, hit.dist - 0.3) : 4.2;
      cam.position.copy(eye).addScaledVector(back, d);
      if (this.thirdPerson === 2) cam.rotation.set(-p.pitch, p.yaw + Math.PI, 0);
      this.updateSelfModel(dt, true);
    } else {
      cam.position.copy(eye);
      this.updateSelfModel(dt, false);
    }
  }

  updateSelfModel(dt, visible) {
    if (!this.selfModel) {
      const skin = paintPlayerSkin(this.profile.look);
      const mat = this.renderer.entityMaterial(skin.texture());
      this.selfModel = buildHumanoid(skin, mat);
      this.selfModel.userData.mat = mat;
      this.selfModel.traverse(o => o.layers.set(LAYER.WORLD));
      this.entities.root.add(this.selfModel);
      this.selfPhase = 0;
    }
    const m = this.selfModel, p = this.player;
    m.visible = visible;
    m.position.set(p.x, p.y, p.z);
    m.rotation.y = p.yaw + Math.PI;
    this.selfPhase += p.bobAmt * dt * 9;
    animateModel(m, { walk: p.bobAmt, phase: this.selfPhase, headYaw: 0, headPitch: -p.pitch, swing: this.hand.swing, sneak: p.sneaking, t: this.renderer.U.uTime.value, holding: !!p.held }, dt);
    const L = this.world.getLight(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z));
    setModelLight(m, (L >> 4) / 15, (L & 15) / 15, p.hurtTime > 0 ? 0.6 : 0);
  }

  shootingStars(dt) {
    const s = this.shoot;
    if (this.renderer.env.night > 0.8) {
      s.next -= dt;
      if (s.next <= 0 && s.t <= 0) {
        s.next = 15 + Math.random() * 40; s.t = 0.0001;
        const a = Math.random() * Math.PI * 2;
        s.start = new THREE.Vector3(Math.cos(a), 0.45 + Math.random() * 0.4, Math.sin(a)).normalize();
        s.dir = new THREE.Vector3(Math.cos(a + 1.8), -0.4, Math.sin(a + 1.8)).normalize();
      }
    }
    if (s.t > 0) {
      s.t += dt * 1.4;
      if (s.t >= 1) s.t = 0;
      this.renderer.setShootingStar(new THREE.Vector4(s.start.x, s.start.y, s.start.z, s.t), s.dir);
    } else this.renderer.setShootingStar(new THREE.Vector4(0, 0, 0, 0));
  }

  screenshot() {
    this.canvas.toBlob((b) => {
      if (!b) return;
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b);
      a.download = `lumencraft-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      this.ui.toast('Screenshot saved');
    }, 'image/png');
  }

  captureThumb() {
    try {
      const c = document.createElement('canvas'); c.width = 192; c.height = 108;
      c.getContext('2d').drawImage(this.canvas, 0, 0, 192, 108);
      this.thumb = c.toDataURL('image/jpeg', 0.7);
    } catch (e) { /* ignore */ }
  }

  debugInfo() {
    const p = this.player, w = this.world;
    const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
    const L = w.getLight(bx, by, bz);
    const t = this.target;
    const r = this.renderer.gl.info.render;
    const facing = ['north', 'west', 'south', 'east'][Math.round((((p.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 2)) % 4];
    return [
      `${GAME_NAME} 1.0  ${Math.round(this.fps)} fps`,
      `XYZ ${p.x.toFixed(2)} / ${p.y.toFixed(2)} / ${p.z.toFixed(2)}`,
      `Chunk ${bx >> 4} ${bz >> 4}   facing ${facing}`,
      `Biome ${(BIOMES[w.biomeAt(bx, bz)] || {}).name}`,
      `Light sky ${L >> 4} block ${L & 15}`,
      `Time ${Math.floor(this.time % DAY_TICKS)}   day ${Math.floor(this.time / DAY_TICKS)}`,
      `Chunks ${w.columns.size}   entities ${this.entities.ents.size}   particles ${this.particles.norm.list.length + this.particles.add.list.length}`,
      `Draws ${r.calls}   tris ${(r.triangles / 1000).toFixed(0)}k`,
      t ? `Looking at ${BLOCKS[t.id].name} ${t.x} ${t.y} ${t.z}` : '',
      this.server ? `Hosting · ${this.server.players.size} player(s)` : this.net ? 'Connected as client' : '',
    ].join('\n');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  try { window.__game = new Game(); }
  catch (e) {
    console.error(e);
    document.getElementById('ui').innerHTML = `<div class="screen"><div class="panel" style="max-width:520px"><h2>Could not start</h2><p class="muted">${String(e.message || e)}</p><p class="muted">Lumencraft needs a browser with WebGL 2 (Chrome, Edge, Firefox or Safari 15+).</p></div></div>`;
  }
});
export { overlapsSolid };
