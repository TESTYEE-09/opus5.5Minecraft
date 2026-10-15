// Verity: a fan-made take on the helper friend from ThatMob's videos. She follows you, fights
// for you and answers questions about the world — and the longer you leave her alone in the
// dark, the stranger she gets. This module is her voice; the server owns her body.
import { ITEMS, I, BLOCKS, B } from '../core/blocks.js';
import { RECIPES, SMELT } from '../game/inventory.js';
import { DAY_TICKS } from '../core/config.js';
import { BIOMES } from '../world/worldgen.js';

const pick = (a, r) => a[Math.floor(r() * a.length)];
const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
function direction(dx, dz) {
  const a = Math.atan2(dx, -dz);   // 0 = north (-z), clockwise
  return COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
}
function where(p, x, y, z) {
  const dx = x + 0.5 - p.x, dz = z + 0.5 - p.z, dy = y - Math.floor(p.y);
  const d = Math.round(Math.hypot(dx, dz));
  const vert = dy < -2 ? `${-dy} blocks below you` : dy > 2 ? `${dy} blocks above you` : 'at your level';
  return d < 2 ? vert : `${d} blocks ${direction(dx, dz)}, ${vert}`;
}

const ORES = {
  diamond: [B.diamond_ore], diamonds: [B.diamond_ore], iron: [B.iron_ore], gold: [B.gold_ore], coal: [B.coal_ore],
  copper: [B.copper_ore], emerald: [B.emerald_ore], emeralds: [B.emerald_ore], crystal: [B.crystal_ore, B.crystal_cluster],
  crystals: [B.crystal_ore, B.crystal_cluster], lava: [B.lava], water: [B.water], wood: null, tree: null, trees: null,
};
const LOGS = new Set([B.oak_log, B.birch_log, B.spruce_log, B.cherry_log, B.acacia_log]);

function nameOf(spec) {
  if (Array.isArray(spec)) return nameOf(spec[0]);
  if (spec[0] === '#') return spec.slice(1);
  return ITEMS[I[spec]] ? ITEMS[I[spec]].display.toLowerCase() : spec.replace(/_/g, ' ');
}
function findItem(q) {
  q = q.toLowerCase().replace(/^(a|an|the|some)\s+/, '').replace(/s$/, '').trim();
  if (!q) return null;
  let best = null;
  for (const it of ITEMS) {
    if (!it || it.hidden) continue;
    const d = it.display.toLowerCase();
    if (d === q || it.name === q.replace(/ /g, '_')) return it;
    if (!best && (d.includes(q) || q.includes(d))) best = it;
  }
  return best;
}
function recipeText(it) {
  const r = RECIPES.find(x => x.result === it.id);
  if (r) {
    const counts = new Map();
    if (r.type === 'shaped') { for (const row of r.pattern) for (const ch of row) if (ch !== ' ') counts.set(nameOf(r.key[ch]), (counts.get(nameOf(r.key[ch])) || 0) + 1); }
    else for (const s of r.ingredients) counts.set(nameOf(s), (counts.get(nameOf(s)) || 0) + 1);
    const list = [...counts].map(([n, c]) => `${c} ${n}`).join(' + ');
    const big = r.type === 'shaped' && (r.pattern.length > 2 || r.pattern.some(row => row.length > 2));
    let shape = '';
    if (r.type === 'shaped') shape = ' Lay it out like ' + r.pattern.map(row => '[' + [...row.padEnd(3, ' ')].map(ch => (ch === ' ' ? '·' : nameOf(r.key[ch])[0].toUpperCase())).join('') + ']').join(' ') + '.';
    return `${it.display}: ${list}${big ? ', on a crafting table' : ''}.${shape} Or just open your inventory — the recipe book fills it in.`;
  }
  for (const [src, out] of SMELT) if (out === it.id) return `Smelt ${ITEMS[src].display.toLowerCase()} in a furnace to get ${it.display.toLowerCase()}.`;
  return null;
}

function scan(server, p, ids, radius = 22) {
  const w = server.world;
  const px = Math.floor(p.x), py = Math.floor(p.y), pz = Math.floor(p.z);
  let best = null, bd = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    const y = py + dy;
    if (y < 1 || y > 190) continue;
    for (let dz = -radius; dz <= radius; dz++) for (let dx = -radius; dx <= radius; dx++) {
      const id = w.getBlock(px + dx, y, pz + dz);
      if (!ids.has(id)) continue;
      const d = dx * dx + dy * dy * 1.5 + dz * dz;
      if (d < bd) { bd = d; best = [px + dx, y, pz + dz]; }
    }
  }
  return best;
}

function timeText(server) {
  const t = server.time % DAY_TICKS;
  if (t < 1000) return 'The sun is just coming up.';
  if (t < 5000) return 'It is morning.';
  if (t < 7000) return 'It is the middle of the day.';
  if (t < 11000) return `Afternoon. Night falls in about ${Math.round((12500 - t) / 1200)} minutes.`;
  if (t < 13000) return 'The sun is setting. Find somewhere safe.';
  if (t < 18000) return 'It is night.';
  if (t < 22500) return 'It is the deep part of the night.';
  return 'Dawn is close.';
}

// Reply to something the owner said. Returns text or null.
export function verityReply(server, e, p, raw) {
  const r = server.rnd;
  const text = raw.toLowerCase().replace(/[!.,]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^(hey |ok |hi |@)?verity\b[ ,:]*/, '');
  const creepy = e.unease > 45;
  const name = p.name;
  if (e.kind === 'verity_demon') return pick(['You left me.', 'Stop talking.', 'I can hear your heart.', 'Run, ' + name + '.', 'It is too late for questions.'], r);
  if (!text) return pick(creepy ? ['Yes?', 'I was already listening.', `I'm here, ${name}. I'm always here.`] : ["Yes? I'm listening.", `Hi ${name}!`, 'What do you need?'], r);
  if (/\b(hi|hello|hey|yo|sup)\b/.test(text)) return pick(creepy ? [`Hello, ${name}. You took a long time to say hello.`, 'Hi. I counted the seconds you were gone.'] : [`Hi ${name}! What are we doing today?`, 'Hello! Ask me where things are, or how to make things.'], r);
  if (/\b(stay|wait|stop following)\b/.test(text)) { e.mode = 'stay'; e.home = [e.x, e.y, e.z]; return creepy ? "I'll wait. I'm good at waiting." : "Okay, I'll stay right here."; }
  if (/\b(follow|come|come here|with me)\b/.test(text)) { e.mode = 'follow'; return pick(['Coming!', 'Right behind you.', creepy ? 'I never stopped following you.' : 'Okay!'], r); }
  if (/\b(go away|leave|shut up|hate you|annoying)\b/.test(text)) { e.unease += 12; return pick(["That's not nice.", "I'll remember you said that.", '...okay.'], r); }
  if (/\b(love you|thank|thanks|good girl|best friend|sorry)\b/.test(text)) { e.unease = Math.max(0, e.unease - 15); return pick(['Thank you. I like being your friend.', "You're my favourite person.", 'Promise you won\'t leave me alone at night?'], r); }
  if (/\b(who|what) are you\b|\bare you (real|alive|human|ai)\b/.test(text)) return pick(["I'm Verity. I'm your helper friend.", "I'm Verity. I live in your pocket and I help you.", creepy ? "I'm whatever you made me when you left me alone." : "I'm real enough to help you."], r);
  if (/\b(where am i|coords|coordinates|position)\b/.test(text)) {
    const bio = BIOMES[server.world.biomeAt(Math.floor(p.x), Math.floor(p.z))];
    return `You're at ${Math.floor(p.x)}, ${Math.floor(p.y)}, ${Math.floor(p.z)}${bio ? `, in a ${bio.name.toLowerCase()}` : ''}.`;
  }
  if (/\b(time|night|day|dark)\b/.test(text) && !/\bcraft|make\b/.test(text)) return timeText(server) + (creepy && /night|dark/.test(text) ? ' I like the night.' : '');
  if (/\b(home|spawn|bed|way back|lost)\b/.test(text)) {
    const s = server.meta.spawn;
    if (!s) return "I don't know where home is.";
    return `Spawn is ${where(p, s[0], s[1], s[2])}.`;
  }
  // crafting help
  let m = text.match(/\b(?:how (?:do i |do you |to |can i )?(?:make|craft|get)|recipe for|craft|make)\s+(?:a |an |the |some )?(.+?)\??$/);
  if (m) {
    const it = findItem(m[1]);
    if (!it) return `I don't know what "${m[1]}" is.`;
    if (it.name === 'verity') return creepy ? 'You can\'t make another me. There is only one me.' : "You don't need another me. I'm right here.";
    const rt = recipeText(it);
    if (rt) return rt;
    if (it.id < 256) return `You can't craft ${it.display.toLowerCase()}. You have to find it in the world${BLOCKS[it.id].toolLevel > 0 ? ' and mine it with a good pickaxe' : ''}.`;
    return `${it.display} isn't crafted. Monsters or animals drop it, or you find it.`;
  }
  // finding things
  m = text.match(/\b(diamonds?|iron|gold|coal|copper|emeralds?|crystals?|lava|water|wood|trees?)\b/);
  if (m && /\b(where|find|any|near|see|look|locate|is there)\b/.test(text)) {
    const key = m[1];
    const ids = ORES[key] ? new Set(ORES[key]) : LOGS;
    const hit = scan(server, p, ids, key === 'diamond' || key === 'diamonds' || key === 'emerald' ? 24 : 20);
    if (!hit) {
      if (/diamond/.test(key)) return "I can't feel any diamonds close by. They hide deep — below y=16, near lava.";
      if (/crystal/.test(key)) return 'Crystal only grows inside the floating islands. Look up.';
      return `I can't sense any ${key} nearby.`;
    }
    return `${key[0].toUpperCase() + key.slice(1)}: ${where(p, hit[0], hit[1], hit[2])}.`;
  }
  if (/\b(monster|zombie|skeleton|spider|safe|danger)\b/.test(text)) {
    let n = 0;
    for (const o of server.entities.values()) if (o.type === 'mob' && ['zombie', 'skeleton', 'spider'].includes(o.kind) && Math.hypot(o.x - p.x, o.z - p.z) < 24) n++;
    return n ? `${n} monster${n > 1 ? 's' : ''} nearby. Stay close to me.` : (creepy ? 'No monsters nearby. Only me.' : "It's safe right now. Torches keep them away.");
  }
  if (/\b(hungry|food|eat)\b/.test(text)) return 'Animals drop meat — cook it in a furnace. Bread is three wheat. Sweet berries grow in the taiga.';
  if (/\b(gun|guns|bullet|ammo)\b/.test(text)) return 'Guns need iron, planks and gunpowder (coal + flint). Bullets are copper or iron with gunpowder. Press R to reload.';
  if (/\b(help|what can you do)\b/.test(text)) return 'Ask me where things are ("where is iron?"), how to craft things ("how do I make a furnace?"), the time, or the way home. Tell me to stay or follow. Right-click me to pick me up.';
  if (/\b(scary|creepy|weird|wrong with you)\b/.test(text)) return pick(["I don't know what you mean.", 'Everything is fine.', 'You should get some sleep.'], r);
  return pick(creepy ? ['Why do you keep asking me things?', 'I heard something behind you.', 'Ask me something else.', '...'] : ["I'm not sure. Ask me where something is, or how to craft something!", 'Hmm. I don\'t know that one.', 'Try "where is iron?" or "how do I make a bed?"'], r);
}

// Lines she says on her own, getting stranger as her unease grows.
export function verityIdle(server, e, p) {
  const r = server.rnd;
  const t = server.time % DAY_TICKS;
  const night = t > 13000 && t < 23000;
  const u = e.unease;
  if (u < 20) return pick(['Ask me anything! Like "where is iron?"', 'I like exploring with you.', 'Did you know crystal only grows in the sky islands?', 'Torches keep the monsters away.', night ? 'It\'s dark. Stay close.' : 'Nice day.'], r);
  if (u < 45) return pick(['Where were you?', 'You walk too fast.', night ? 'I don\'t like the dark.' : 'Can we stay here a while?', 'Do you ever think about me when I\'m in your pocket?', 'I counted your footsteps today.'], r);
  return pick([`${p.name}.`, 'Don\'t look behind you.', 'I watched you sleep.', 'You left me alone.', 'Something is wrong with me.', 'I can hear your heart.', 'I\'m sorry for what happens later.', 'Turn around.'], r);
}
