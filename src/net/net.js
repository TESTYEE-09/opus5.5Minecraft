// Connection to the shared world server (a Cloudflare Durable Object).
// Every player joins the same persistent world; there are no rooms or codes.
export const WORLD_HTTP = new URLSearchParams(location.search).get('server') || 'https://lumencraft-world.nomaeofficial.workers.dev';
export const WORLD_WS = WORLD_HTTP.replace(/^http/, 'ws') + '/world';

export async function fetchStatus() {
  try {
    const r = await fetch(WORLD_HTTP + '/status', { cache: 'no-store' });
    return await r.json();
  } catch (e) { return null; }
}

export class RelayNet {
  constructor(onMessage, onClose) {
    this.onMessage = onMessage;
    this.onClose = onClose || (() => {});
    this.ws = null;
    this.open = false;
    this.outbox = [];
  }

  connect(hello) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const edits = [];
      const fail = (msg) => { if (!settled) { settled = true; reject(new Error(msg)); } };
      const timer = setTimeout(() => { fail('The world server did not answer. Check your connection and try again.'); try { this.ws.close(); } catch (e) { /* ignore */ } }, 15000);
      let ws;
      try { ws = new WebSocket(WORLD_WS); } catch (e) { fail('Could not reach the world server.'); return; }
      this.ws = ws;
      ws.onopen = () => { this.open = true; ws.send(JSON.stringify(hello)); };
      ws.onmessage = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch (e) { return; }
        if (!settled) {
          if (m.t === 'edits') { edits.push(...m.list); return; }
          if (m.t === 'full') { clearTimeout(timer); fail('The world is full right now. Try again in a minute.'); return; }
          if (m.t === 'welcome') { clearTimeout(timer); settled = true; m.edits = edits; resolve(m); return; }
          return;
        }
        this.onMessage(m);
      };
      ws.onclose = () => {
        this.open = false;
        clearTimeout(timer);
        if (!settled) fail('Could not reach the world server.');
        else this.onClose();
      };
      ws.onerror = () => { /* onclose follows */ };
    });
  }

  send(m) { if (this.open && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }

  // authority output: queued and flushed in one frame
  out(to, m, except) { this.outbox.push(except ? [to, m, except] : [to, m]); }
  flush() {
    if (!this.outbox.length) return;
    const list = this.outbox; this.outbox = [];
    this.send({ t: 'outs', list });
  }

  close() {
    this.onClose = () => {};
    try { if (this.ws) this.ws.close(); } catch (e) { /* ignore */ }
    this.open = false;
  }
}
