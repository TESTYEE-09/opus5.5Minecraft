// Recorded CC0 sound effects, positional audio, ambience and a generative piano score.
const SFX = {
  'step.grass': ['footstep_grass_000', 'footstep_grass_001', 'footstep_grass_002', 'footstep_grass_003', 'footstep_grass_004'],
  'step.stone': ['footstep_concrete_000', 'footstep_concrete_001', 'footstep_concrete_002', 'footstep_concrete_003', 'footstep_concrete_004'],
  'step.wood': ['footstep_wood_000', 'footstep_wood_001', 'footstep_wood_002', 'footstep_wood_003', 'footstep_wood_004'],
  'step.snow': ['footstep_snow_000', 'footstep_snow_001', 'footstep_snow_002', 'footstep_snow_003', 'footstep_snow_004'],
  'step.cloth': ['footstep_carpet_000', 'footstep_carpet_001', 'footstep_carpet_002', 'footstep_carpet_003', 'footstep_carpet_004'],
  'step.gravel': ['footstep00', 'footstep02', 'footstep04', 'footstep06', 'footstep08'],
  'dig.stone': ['impactMining_000', 'impactMining_001', 'impactMining_002', 'impactMining_003', 'impactMining_004'],
  'dig.wood': ['impactPlank_medium_000', 'impactPlank_medium_001', 'impactPlank_medium_002', 'impactPlank_medium_003', 'impactPlank_medium_004'],
  'dig.glass': ['impactGlass_heavy_000', 'impactGlass_heavy_001'],
  'hit.glass': ['impactGlass_light_000', 'impactGlass_light_001', 'impactGlass_light_002'],
  'dig.metal': ['impactMetal_light_000', 'impactMetal_light_001', 'impactMetal_light_002'],
  'dig.soft': ['impactSoft_medium_000', 'impactSoft_medium_001', 'impactSoft_medium_002', 'impactSoft_medium_003', 'impactSoft_medium_004'],
  'place': ['impactGeneric_light_000', 'impactGeneric_light_001', 'impactGeneric_light_002', 'impactGeneric_light_003'],
  'punch': ['impactPunch_medium_000', 'impactPunch_medium_001', 'impactPunch_medium_002'],
  'hurt': ['impactPunch_heavy_000', 'impactPunch_heavy_001'],
  'wood.heavy': ['impactWood_heavy_000', 'impactWood_heavy_001', 'impactWood_heavy_002'],
  'chest.open': ['creak1', 'creak2'], 'chest.close': ['doorClose_1'], 'door': ['doorOpen_1'],
  'eat': ['cloth1', 'cloth2', 'cloth3', 'cloth4'], 'chop': ['chop'], 'book': ['bookFlip1'], 'latch': ['metalLatch'], 'leather': ['handleSmallLeather'],
  'click': ['click_001', 'click_002', 'click_003'], 'select': ['select_001', 'select_002'], 'open': ['open_001'], 'close': ['close_001'],
  'pop': ['pluck_001', 'pluck_002'], 'confirm': ['confirmation_001'], 'drop': ['drop_001'], 'toggle': ['toggle_001'],
  'explode': ['explosionCrunch_000', 'explosionCrunch_001', 'explosionCrunch_002'], 'boom': ['lowFrequency_explosion_000', 'lowFrequency_explosion_001'],
  'fizz': ['slime_000'], 'woosh': ['woosh1', 'woosh2', 'woosh3', 'woosh4'], 'splash': ['sinkWater1', 'sinkWater2', 'sinkWater3', 'sinkWater4'],
  'drip': ['drip1', 'drip2', 'drip3', 'drip4'], 'pickup': ['pickup1', 'pickup2'],
};
export const STEP = { grass: 'step.grass', stone: 'step.stone', wood: 'step.wood', snow: 'step.snow', cloth: 'step.cloth', gravel: 'step.gravel', sand: 'step.gravel', glass: 'step.stone', metal: 'step.stone' };
export const DIG = { grass: 'dig.soft', stone: 'dig.stone', wood: 'dig.wood', snow: 'step.snow', cloth: 'dig.soft', gravel: 'step.gravel', sand: 'step.gravel', glass: 'dig.glass', metal: 'dig.metal' };

const NOTES = ['C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7'];
const NOTE_MIDI = (n) => { const m = n.match(/([A-G])(s?)(\d)/); const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]] + (m[2] ? 1 : 0); return (Number(m[3]) + 1) * 12 + base; };

export class Audio {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.piano = [];
    this.vol = { master: 0.8, music: 0.55, sfx: 0.9, ambient: 0.7 };
    this.started = false;
    this.listener = { x: 0, y: 0, z: 0 };
    this.musicNext = 25;
    this.musicPlaying = false;
    this.amb = { wind: 0, rain: 0, under: 0, indoor: 0, cave: 0 };
    this.dripT = 4;
  }

  start() {
    if (this.started) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    this.started = true;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = this.vol.master;
    this.underFilter = c.createBiquadFilter(); this.underFilter.type = 'lowpass'; this.underFilter.frequency.value = 22000;
    this.underFilter.connect(this.master); this.master.connect(c.destination);
    this.sfxBus = c.createGain(); this.sfxBus.gain.value = this.vol.sfx; this.sfxBus.connect(this.underFilter);
    this.musicBus = c.createGain(); this.musicBus.gain.value = this.vol.music;
    this.ambBus = c.createGain(); this.ambBus.gain.value = this.vol.ambient; this.ambBus.connect(this.underFilter);
    // reverb for the piano and big sounds
    this.reverb = c.createConvolver();
    this.reverb.buffer = this.impulse(4.5, 2.6);
    const wet = c.createGain(); wet.gain.value = 0.55;
    this.musicBus.connect(this.master);
    this.musicBus.connect(this.reverb); this.reverb.connect(wet); wet.connect(this.master);
    this.sfxReverb = c.createGain(); this.sfxReverb.gain.value = 0.0; this.sfxReverb.connect(this.reverb);
    this.makeAmbience();
    this.loadAll();
  }

  impulse(sec, decay) {
    const c = this.ctx, len = Math.floor(c.sampleRate * sec);
    const b = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  async loadAll() {
    const base = import.meta.env.BASE_URL || './';
    const names = new Set(Object.values(SFX).flat());
    const load = async (url) => { const r = await fetch(url); const a = await r.arrayBuffer(); return await this.ctx.decodeAudioData(a); };
    await Promise.all([...names].map(async (n) => {
      try { this.buffers.set(n, await load(`${base}sfx/${n}.mp3`)); } catch (e) { /* missing sound is fine */ }
    }));
    for (const n of NOTES) {
      try { this.piano.push({ midi: NOTE_MIDI(n), buf: await load(`${base}music/${n}.mp3`) }); } catch (e) { /* ignore */ }
    }
  }

  setVolumes(v) {
    Object.assign(this.vol, v);
    if (!this.ctx) return;
    this.master.gain.value = this.vol.master;
    this.sfxBus.gain.value = this.vol.sfx;
    this.musicBus.gain.value = this.vol.music;
    this.ambBus.gain.value = this.vol.ambient;
  }

  setListener(x, y, z, fx, fy, fz) {
    this.listener.x = x; this.listener.y = y; this.listener.z = z;
    if (!this.ctx) return;
    const L = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (L.positionX) {
      L.positionX.setValueAtTime(x, t); L.positionY.setValueAtTime(y, t); L.positionZ.setValueAtTime(z, t);
      L.forwardX.setValueAtTime(fx, t); L.forwardY.setValueAtTime(fy, t); L.forwardZ.setValueAtTime(fz, t);
      L.upX.setValueAtTime(0, t); L.upY.setValueAtTime(1, t); L.upZ.setValueAtTime(0, t);
    } else { L.setPosition(x, y, z); L.setOrientation(fx, fy, fz, 0, 1, 0); }
  }

  // play a sound group; opts: {vol, rate, pos:[x,y,z], range}
  play(group, opts = {}) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const list = SFX[group] || [group];
    const name = list[Math.floor(Math.random() * list.length)];
    const buf = this.buffers.get(name);
    if (!buf) return;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = (opts.rate ?? 1) * (1 + (Math.random() - 0.5) * (opts.vary ?? 0.12));
    const g = c.createGain();
    g.gain.value = opts.vol ?? 1;
    src.connect(g);
    if (opts.pos) {
      const dx = opts.pos[0] - this.listener.x, dy = opts.pos[1] - this.listener.y, dz = opts.pos[2] - this.listener.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const range = opts.range || 24;
      if (d > range * 1.5) return;
      const p = c.createPanner();
      p.panningModel = 'equalpower'; p.distanceModel = 'linear'; p.refDistance = 1; p.maxDistance = range; p.rolloffFactor = 1;
      p.positionX ? (p.positionX.value = opts.pos[0], p.positionY.value = opts.pos[1], p.positionZ.value = opts.pos[2]) : p.setPosition(...opts.pos);
      g.connect(p); p.connect(this.sfxBus);
    } else g.connect(this.sfxBus);
    if (opts.reverb) { const r = c.createGain(); r.gain.value = opts.reverb; g.connect(r); r.connect(this.reverb); }
    src.start(c.currentTime + (opts.delay || 0));
  }

  // ---------------------------------------------------------------- ambience
  makeAmbience() {
    const c = this.ctx;
    const len = c.sampleRate * 4;
    const nb = c.createBuffer(1, len, c.sampleRate);
    const d = nb.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0526;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
    }
    const mk = (type, freq, q) => { const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; };
    // wind
    const ws = c.createBufferSource(); ws.buffer = nb; ws.loop = true;
    this.windF = mk('bandpass', 420, 0.7);
    this.windG = c.createGain(); this.windG.gain.value = 0;
    ws.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(this.ambBus); ws.start();
    // rain
    const rs = c.createBufferSource(); rs.buffer = nb; rs.loop = true; rs.playbackRate.value = 1.7;
    this.rainHP = mk('highpass', 700, 0.5); this.rainLP = mk('lowpass', 7000, 0.5);
    this.rainG = c.createGain(); this.rainG.gain.value = 0;
    rs.connect(this.rainHP); this.rainHP.connect(this.rainLP); this.rainLP.connect(this.rainG); this.rainG.connect(this.ambBus); rs.start();
  }

  updateAmbience(dt, s) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = 1 - Math.exp(-dt * 2);
    const a = this.amb;
    a.wind += ((s.wind || 0) - a.wind) * k;
    a.rain += ((s.rain || 0) - a.rain) * k;
    a.under += ((s.under ? 1 : 0) - a.under) * Math.min(1, dt * 8);
    a.indoor += ((s.indoor ? 1 : 0) - a.indoor) * k;
    const gust = 0.6 + 0.4 * Math.sin(t * 0.37) * Math.sin(t * 0.13 + 1);
    this.windG.gain.setTargetAtTime(a.wind * 0.22 * gust * (1 - a.indoor * 0.7), t, 0.3);
    this.windF.frequency.setTargetAtTime(300 + gust * 400, t, 0.5);
    this.rainG.gain.setTargetAtTime(a.rain * 0.3 * (1 - a.indoor * 0.5), t, 0.3);
    this.rainLP.frequency.setTargetAtTime(a.indoor > 0.5 ? 900 : 7000, t, 0.4);
    this.underFilter.frequency.setTargetAtTime(a.under > 0.5 ? 650 : 22000, t, 0.08);
    // cave drips
    if (s.cave) {
      this.dripT -= dt;
      if (this.dripT <= 0) {
        this.dripT = 2 + Math.random() * 7;
        const ang = Math.random() * Math.PI * 2;
        this.play('drip', { vol: 0.35, pos: [this.listener.x + Math.cos(ang) * 6, this.listener.y + 3, this.listener.z + Math.sin(ang) * 6], reverb: 0.6, range: 20 });
      }
    }
    // music scheduling
    if (this.vol.music > 0 && this.piano.length > 10) {
      this.musicNext -= dt;
      if (this.musicNext <= 0 && !this.musicPlaying) this.playPiece(s);
    }
  }

  thunder(dist) {
    const delay = Math.min(4, dist / 340);
    this.play('boom', { vol: Math.max(0.25, 1 - dist / 200), rate: 0.55, delay, reverb: 0.8, vary: 0.2 });
    this.play('explode', { vol: Math.max(0.15, 0.7 - dist / 200), rate: 0.4, delay: delay + 0.05, reverb: 0.8 });
  }

  // ---------------------------------------------------------------- generative piano
  note(midi, when, vel, dur = 4) {
    if (!this.piano.length) return;
    let best = this.piano[0];
    for (const p of this.piano) if (Math.abs(p.midi - midi) < Math.abs(best.midi - midi)) best = p;
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = best.buf;
    src.playbackRate.value = Math.pow(2, (midi - best.midi) / 12);
    const g = c.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(vel, when + 0.01);
    g.gain.setTargetAtTime(0, when + dur, 1.2);
    src.connect(g); g.connect(this.musicBus);
    src.start(when);
    src.stop(when + dur + 6);
  }

  playPiece(s = {}) {
    this.musicPlaying = true;
    const c = this.ctx;
    const r = Math.random;
    const night = s.night > 0.5;
    const roots = [48, 50, 53, 55, 57]; // C D F G A
    const root = roots[Math.floor(r() * roots.length)];
    const minor = night || r() < 0.4;
    const scale = minor ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    const progs = minor ? [[0, 5, 2, 6], [0, 3, 5, 4], [0, 6, 5, 6]] : [[0, 5, 3, 4], [0, 3, 0, 4], [0, 4, 5, 3], [3, 0, 4, 5]];
    const prog = progs[Math.floor(r() * progs.length)];
    const beat = 60 / (58 + r() * 14);
    const bars = 16 + Math.floor(r() * 8);
    let t = c.currentTime + 0.5;
    const deg = (d, oct = 0) => root + scale[((d % 7) + 7) % 7] + 12 * (Math.floor(d / 7) + oct);
    let mel = 7 + Math.floor(r() * 4);
    for (let bar = 0; bar < bars; bar++) {
      const ch = prog[Math.floor(bar / 2) % prog.length];
      const fade = bar < 2 ? 0.6 + bar * 0.2 : bar > bars - 3 ? 0.7 : 1;
      // left hand: root and fifth, rolled
      if (bar % 2 === 0) {
        this.note(deg(ch, -1), t, 0.20 * fade, beat * 7);
        this.note(deg(ch + 4, -1), t + 0.12, 0.13 * fade, beat * 7);
        if (r() < 0.6) this.note(deg(ch + 2), t + 0.26, 0.10 * fade, beat * 6);
      }
      // right hand: sparse melody walking near chord tones
      let bt = 0;
      while (bt < 4) {
        const len = [1, 1, 2, 2, 3, 4][Math.floor(r() * 6)];
        if (r() < 0.28) { bt += len; continue; }
        const step = [-2, -1, -1, 0, 1, 1, 2, 3][Math.floor(r() * 8)];
        mel = Math.max(ch + 5, Math.min(ch + 14, mel + step));
        if (r() < 0.35) mel = ch + 7 + [0, 2, 4][Math.floor(r() * 3)];
        this.note(deg(mel), t + bt * beat + (r() - 0.5) * 0.03, (0.13 + r() * 0.08) * fade, beat * len * 1.4);
        if (r() < 0.12) this.note(deg(mel + 2), t + bt * beat + 0.08, 0.06 * fade, beat * len);
        bt += len;
      }
      t += beat * 4;
    }
    const dur = t - c.currentTime + 6;
    setTimeout(() => { this.musicPlaying = false; this.musicNext = 120 + Math.random() * 180; }, dur * 1000);
  }
}
