import { meshSection } from './mesher.js';

self.onmessage = (e) => {
  const m = e.data;
  const out = meshSection(m.blocks, m.light, m.tints, m.yBase, m.cx, m.cz);
  const transfer = [];
  for (const o of out) transfer.push(o.pos.buffer, o.a.buffer, o.b.buffer, o.t.buffer);
  self.postMessage({ id: m.id, cx: m.cx, cz: m.cz, sy: m.sy, ver: m.ver, out }, transfer);
};
