// Peer-to-peer multiplayer over WebRTC (PeerJS). The host's browser runs the server;
// friends join with a 5-letter room code. No dedicated server needed (works on GitHub Pages).
import { Peer } from 'peerjs';
import { NET_PREFIX } from '../core/config.js';

const ICE = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
    { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
    { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
  ],
};
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const makeCode = () => Array.from({ length: 5 }, () => ALPHA[Math.floor(Math.random() * ALPHA.length)]).join('');

// Host side: accepts connections and relays messages to the Server.
export class HostNet {
  constructor(server, onStatus) {
    this.server = server;
    this.onStatus = onStatus || (() => {});
    this.code = null;
    this.peer = null;
    this.conns = new Map();   // playerId -> conn
    this.nextId = 2;
  }

  open(code = makeCode(), tries = 0) {
    return new Promise((resolve, reject) => {
      this.code = code;
      const peer = new Peer(NET_PREFIX + code, { config: ICE, debug: 0 });
      this.peer = peer;
      let done = false;
      peer.on('open', () => { done = true; this.onStatus('open', code); resolve(code); });
      peer.on('error', (err) => {
        if (!done && err.type === 'unavailable-id' && tries < 4) { peer.destroy(); this.open(makeCode(), tries + 1).then(resolve, reject); return; }
        this.onStatus('error', err.type || String(err));
        if (!done) reject(err);
      });
      peer.on('disconnected', () => { if (!peer.destroyed) setTimeout(() => { try { peer.reconnect(); } catch (e) { /* ignore */ } }, 1500); });
      peer.on('connection', (conn) => this.accept(conn));
    });
  }

  accept(conn) {
    let pid = null;
    conn.on('data', (m) => {
      if (!m || typeof m !== 'object') return;
      if (m.t === 'hello' && pid === null) {
        if (this.conns.size >= 15) { conn.send({ t: 'full' }); setTimeout(() => conn.close(), 200); return; }
        pid = this.nextId++;
        this.conns.set(pid, conn);
        const name = String(m.name || 'Player').replace(/[^\w \-.]/g, '').slice(0, 16) || 'Player';
        const p = { id: pid, name, look: m.look || {}, x: 0, y: 0, z: 0, yaw: 0, pitch: 0, flags: 0, held: 0, gamemode: 'survival', send: (msg) => { if (conn.open) conn.send(msg); } };
        p.send(this.server.welcome(p));
        this.server.addPlayer(p);
        this.onStatus('join', name);
        return;
      }
      if (pid !== null) this.server.receive(pid, m);
    });
    const drop = () => {
      if (pid === null) return;
      this.conns.delete(pid);
      this.server.removePlayer(pid);
      pid = null;
    };
    conn.on('close', drop);
    conn.on('error', drop);
  }

  close() {
    for (const c of this.conns.values()) { try { c.close(); } catch (e) { /* ignore */ } }
    this.conns.clear();
    if (this.peer) this.peer.destroy();
    this.peer = null;
  }
  get count() { return this.conns.size; }
}

// Client side: one connection to the host.
export class ClientNet {
  constructor(onMessage, onStatus) {
    this.onMessage = onMessage;
    this.onStatus = onStatus || (() => {});
    this.peer = null; this.conn = null;
    this.connected = false;
  }
  join(code, hello) {
    code = code.trim().toUpperCase();
    return new Promise((resolve, reject) => {
      const peer = new Peer(undefined, { config: ICE, debug: 0 });
      this.peer = peer;
      let settled = false;
      const fail = (e) => { if (!settled) { settled = true; reject(e); } };
      const timer = setTimeout(() => fail(new Error('Could not reach that world. Check the code, or the host may be behind a strict firewall.')), 20000);
      peer.on('error', (err) => {
        clearTimeout(timer);
        const msg = err.type === 'peer-unavailable' ? `No world is open with code ${code}.` : `Connection error (${err.type || err}).`;
        if (!settled) fail(new Error(msg)); else this.onStatus('error', msg);
      });
      peer.on('open', () => {
        const conn = peer.connect(NET_PREFIX + code, { reliable: true, serialization: 'json' });
        this.conn = conn;
        conn.on('open', () => { this.connected = true; conn.send(hello); });
        conn.on('data', (m) => {
          if (m && m.t === 'welcome' && !settled) { settled = true; clearTimeout(timer); resolve(m); }
          if (m && m.t === 'full' && !settled) { fail(new Error('That world is full.')); return; }
          this.onMessage(m);
        });
        conn.on('close', () => { this.connected = false; this.onStatus('closed'); });
        conn.on('error', () => { this.connected = false; this.onStatus('closed'); });
      });
    });
  }
  send(m) { if (this.conn && this.conn.open) this.conn.send(m); }
  close() { try { if (this.conn) this.conn.close(); } catch (e) { /* ignore */ } if (this.peer) this.peer.destroy(); this.peer = null; }
}
