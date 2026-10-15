import { WorldGen } from './worldgen.js';

let gen = null;
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'seed') { gen = new WorldGen(m.seed); return; }
  if (m.type === 'gen') {
    const r = gen.generate(m.cx, m.cz, m.edits);
    self.postMessage({ type: 'gen', cx: m.cx, cz: m.cz, ...r },
      [r.blocks.buffer, r.light.buffer, r.tints.buffer, r.biomes.buffer, r.heights.buffer, r.counts.buffer]);
  }
};
