// Lumencraft shared world: one Durable Object holds the persistent world (block edits,
// containers, time, weather, player saves) and relays messages between browsers.
// The longest-connected player's browser runs the simulation ("authority"); if it
// leaves, the next player takes over.
import { DurableObject } from 'cloudflare:workers';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' };
const MAX_PLAYERS = 40;
const MAX_MSG = 256 * 1024;
const MIN_CLIENT = 2;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
    // 'world2' replaced 'main' after the first water code flooded it; it imports main's edits once.
    const stub = env.WORLD.get(env.WORLD.idFromName('world2'));
    if (url.pathname === '/world') {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426, headers: CORS });
      return stub.fetch(req);
    }
    if (url.pathname === '/status') return stub.fetch(req);
    return new Response('Lumencraft world server', { headers: CORS });
  },
};

export class WorldDO extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sessions = new Map();   // id -> { ws, name, look, token, joined }
    this.nextId = 1;
    this.authority = 0;
    this.edits = new Map();      // col -> Map(idx -> id)
    this.dirty = new Set();
    this.meta = { time: 1000, weather: null, be: [] };
    ctx.blockConcurrencyWhile(async () => this.load());
  }

  load() {
    this.sql.exec('CREATE TABLE IF NOT EXISTS chunks (col INTEGER PRIMARY KEY, data BLOB)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS players (token TEXT PRIMARY KEY, data TEXT)');
    for (const row of this.sql.exec('SELECT col, data FROM chunks').toArray()) {
      const a = new Int32Array(row.data);
      const m = new Map();
      for (let i = 0; i < a.length; i += 2) m.set(a[i], a[i + 1]);
      this.edits.set(row.col, m);
    }
    for (const row of this.sql.exec('SELECT k, v FROM kv').toArray()) {
      try { this.meta[row.k] = JSON.parse(row.v); } catch (e) { /* ignore */ }
    }
    // migration 1: the first water-flow algorithm flooded hillsides. Drop every liquid edit
    // (block ids 29-42 are water, flowing water, lava and flowing lava) so the terrain underneath returns.
    if ((this.meta.mig || 0) < 2) {
      let removed = 0;
      for (const [col, m] of this.edits) {
        for (const [i, id] of m) if (id >= 29 && id <= 42) { m.delete(i); removed++; this.dirty.add(col); }
      }
      for (const col of this.dirty) {
        const m = this.edits.get(col);
        if (!m.size) { this.edits.delete(col); this.sql.exec('DELETE FROM chunks WHERE col = ?', col); }
      }
      this.flush();
      this.meta.mig = 2;
      this.sql.exec('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', 'mig', '2');
      this.meta.cleaned = removed;
    }
  }

  // One-time import of block edits from the original instance, dropping the flood water.
  async importOld() {
    if (this.meta.imported) return;
    let got = 0, kept = 0;
    try {
      const old = this.env.WORLD.get(this.env.WORLD.idFromName('main'));
      const resp = await old.fetch('https://internal/world', { headers: { Upgrade: 'websocket' } });
      const ws = resp.webSocket;
      if (ws) {
        ws.accept();
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 25000);
          ws.addEventListener('message', (ev) => {
            let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
            if (m.t === 'edits') {
              for (const [col, arr] of m.list) {
                let mp = this.edits.get(col);
                for (let i = 0; i < arr.length; i += 2) {
                  got++;
                  if (arr[i + 1] >= 29 && arr[i + 1] <= 42) continue;
                  if (!mp) { mp = new Map(); this.edits.set(col, mp); }
                  mp.set(arr[i], arr[i + 1]); kept++;
                  this.dirty.add(col);
                }
              }
            } else if (m.t === 'welcome') {
              if (m.time !== undefined) this.meta.time = m.time;
              clearTimeout(timer); resolve();
            }
          });
          ws.send(JSON.stringify({ t: 'hello', name: 'Archivist', token: '' }));
        });
        try { ws.close(); } catch (e) { /* ignore */ }
      }
    } catch (e) { /* no old world: start fresh */ }
    this.flush();
    this.meta.imported = { got, kept };
    this.meta.cleaned = got - kept;
    this.sql.exec('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', 'imported', JSON.stringify(this.meta.imported));
  }

  async fetch(req) {
    const url = new URL(req.url);
    if (!this.meta.imported && url.hostname !== 'internal') await this.ctx.blockConcurrencyWhile(() => this.importOld());
    if (url.pathname === '/status') {
      return new Response(JSON.stringify({ online: this.sessions.size, names: [...this.sessions.values()].map(s => s.name), cleaned: this.meta.cleaned }), { headers: { ...CORS, 'content-type': 'application/json' } });
    }
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    let id = 0;
    server.addEventListener('message', (ev) => {
      if (typeof ev.data !== 'string' || ev.data.length > MAX_MSG) return;
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (!id) { if (m.t === 'hello') id = this.hello(server, m); return; }
      this.onMessage(id, m);
    });
    const close = () => { if (id) { const i = id; id = 0; this.leave(i); } };
    server.addEventListener('close', close);
    server.addEventListener('error', close);
    return new Response(null, { status: 101, webSocket: client });
  }

  send(ws, m) { try { ws.send(typeof m === 'string' ? m : JSON.stringify(m)); } catch (e) { /* closed */ } }
  sendTo(id, m) { const s = this.sessions.get(id); if (s) this.send(s.ws, m); }

  hello(ws, m) {
    // outdated tabs run old simulation code (the first one flooded the world): make them refresh
    if ((m.v || 0) < MIN_CLIENT) { this.send(ws, { t: 'outdated' }); ws.close(4000, 'outdated'); return 0; }
    if (this.sessions.size >= MAX_PLAYERS) { this.send(ws, { t: 'full' }); ws.close(1013, 'full'); return 0; }
    const id = this.nextId++;
    let name = String(m.name || 'Player').replace(/[^\w \-.]/g, '').trim().slice(0, 16) || 'Player';
    const taken = new Set([...this.sessions.values()].map(s => s.name.toLowerCase()));
    if (taken.has(name.toLowerCase())) { let k = 2; while (taken.has((name + k).toLowerCase())) k++; name = name + k; }
    const token = String(m.token || '').slice(0, 64);
    const s = { ws, name, look: m.look || {}, token, joined: Date.now() };
    this.sessions.set(id, s);
    // world edits go first, in batches small enough for one websocket frame
    let batch = [], size = 0;
    for (const [col, map] of this.edits) {
      const arr = [];
      for (const [i, v] of map) arr.push(i, v);
      batch.push([col, arr]); size += arr.length * 7;
      if (size > 400000) { this.send(ws, { t: 'edits', list: batch }); batch = []; size = 0; }
    }
    if (batch.length) this.send(ws, { t: 'edits', list: batch });
    let player = null;
    if (token) { const r = this.sql.exec('SELECT data FROM players WHERE token = ?', token).toArray(); if (r.length) { try { player = JSON.parse(r[0].data); } catch (e) { /* ignore */ } } }
    const becomes = !this.authority || !this.sessions.has(this.authority);
    if (becomes) this.authority = id;
    const others = [...this.sessions.entries()].filter(([k]) => k !== id).map(([k, v]) => ({ id: k, name: v.name, look: v.look }));
    this.send(ws, {
      t: 'welcome', id, name, authority: this.authority, players: others, player,
      time: this.meta.time, weather: this.meta.weather, be: becomes ? this.meta.be : undefined,
    });
    if (!becomes) this.sendTo(this.authority, { t: 'join', id, name, look: s.look });
    return id;
  }

  onMessage(id, m) {
    const s = this.sessions.get(id);
    if (!s) return;
    if (m.t === 'save') {
      if (s.token && m.data) this.sql.exec('INSERT INTO players (token, data) VALUES (?, ?) ON CONFLICT(token) DO UPDATE SET data = excluded.data', s.token, JSON.stringify(m.data).slice(0, 60000));
      return;
    }
    if (m.t === 'ping') { this.send(s.ws, { t: 'pong', s: m.s }); return; }
    if (id === this.authority) {
      if (m.t === 'outs') {
        for (const [to, msg, except] of m.list || []) {
          if (!msg) continue;
          this.snoop(msg);
          const str = JSON.stringify(msg);
          if (to === 0) { for (const [k, o] of this.sessions) if (k !== id && k !== except) this.send(o.ws, str); }
          else if (to !== id) this.sendTo(to, str);
        }
      } else if (m.t === 'persist') {
        if (m.be) this.meta.be = m.be;
        if (m.time !== undefined) this.meta.time = m.time;
        if (m.weather) this.meta.weather = m.weather;
        this.saveMeta();
      }
      return;
    }
    // everyone else's intents go to the authority
    this.sendTo(this.authority, { t: 'in', from: id, m });
  }

  snoop(msg) {
    if (msg.t === 'bs' && Array.isArray(msg.a)) {
      const a = msg.a;
      for (let i = 0; i + 3 < a.length; i += 4) {
        const x = a[i] | 0, y = a[i + 1] | 0, z = a[i + 2] | 0, id = a[i + 3] | 0;
        if (y < 0 || y >= 192) continue;
        const col = ((x >> 4) + 32768) * 65536 + ((z >> 4) + 32768);
        const idx = (y * 16 + (z & 15)) * 16 + (x & 15);
        let mp = this.edits.get(col);
        if (!mp) { mp = new Map(); this.edits.set(col, mp); }
        mp.set(idx, id);
        this.dirty.add(col);
      }
      this.scheduleFlush();
    } else if (msg.t === 'time') { this.meta.time = msg.v; }
    else if (msg.t === 'weather') { this.meta.weather = { rain: msg.rain, thunder: msg.thunder, timer: 6000 }; }
  }

  scheduleFlush() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => { this.flushTimer = null; this.flush(); }, 4000);
  }
  flush() {
    for (const col of this.dirty) {
      const m = this.edits.get(col);
      if (!m || !m.size) continue;
      const a = new Int32Array(m.size * 2);
      let i = 0;
      for (const [k, v] of m) { a[i++] = k; a[i++] = v; }
      this.sql.exec('INSERT INTO chunks (col, data) VALUES (?, ?) ON CONFLICT(col) DO UPDATE SET data = excluded.data', col, a.buffer);
    }
    this.dirty.clear();
    this.saveMeta();
  }
  saveMeta() {
    for (const k of ['time', 'weather', 'be']) this.sql.exec('INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v', k, JSON.stringify(this.meta[k]));
  }

  leave(id) {
    const s = this.sessions.get(id);
    if (!s) return;
    this.sessions.delete(id);
    if (id === this.authority) {
      this.authority = 0;
      // hand the simulation to whoever has been here longest
      let best = null;
      for (const [k, v] of this.sessions) if (!best || v.joined < best[1].joined) best = [k, v];
      if (best) {
        this.authority = best[0];
        const players = [...this.sessions.entries()].filter(([k]) => k !== best[0]).map(([k, v]) => ({ id: k, name: v.name, look: v.look }));
        this.sendTo(best[0], { t: 'becomeAuthority', time: this.meta.time, weather: this.meta.weather, be: this.meta.be, players });
        for (const [k] of this.sessions) if (k !== best[0]) this.sendTo(k, { t: 'pq', id });
        for (const [k] of this.sessions) this.sendTo(k, { t: 'chat', text: `§e${s.name} left the game` });
      }
    } else if (this.authority) this.sendTo(this.authority, { t: 'leave', id });
    if (!this.sessions.size) this.flush();
  }
}
