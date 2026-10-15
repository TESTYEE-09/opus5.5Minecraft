// Inventory model, crafting recipes and smelting.
import { I, ITEMS, BLOCKS, WOODS, COLORS, maxStack, hasTag } from '../core/blocks.js';

export const stack = (id, count = 1, dmg = 0) => ({ id, count, dmg });
export const cloneStack = (s) => (s ? { id: s.id, count: s.count, dmg: s.dmg || 0 } : null);

export class Inventory {
  constructor(size = 36) { this.slots = new Array(size).fill(null); this.onChange = null; }
  changed() { if (this.onChange) this.onChange(); }
  // Add items, hotbar first. Returns leftover count.
  add(id, count = 1, dmg = 0) {
    const max = maxStack(id);
    const order = [...Array(this.slots.length).keys()];
    if (max > 1) for (const i of order) {
      const s = this.slots[i];
      if (s && s.id === id && s.count < max && !s.dmg) {
        const n = Math.min(count, max - s.count); s.count += n; count -= n;
        if (!count) break;
      }
    }
    for (const i of order) {
      if (!count) break;
      if (!this.slots[i]) { const n = Math.min(count, max); this.slots[i] = stack(id, n, dmg); count -= n; }
    }
    this.changed();
    return count;
  }
  canFit(id, count = 1) {
    const max = maxStack(id);
    for (const s of this.slots) {
      if (!s) count -= max; else if (s.id === id && max > 1) count -= max - s.count;
      if (count <= 0) return true;
    }
    return count <= 0;
  }
  count(id) { let n = 0; for (const s of this.slots) if (s && s.id === id) n += s.count; return n; }
  take(id, n) {
    for (let i = this.slots.length - 1; i >= 0 && n > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id) { const k = Math.min(n, s.count); s.count -= k; n -= k; if (!s.count) this.slots[i] = null; }
    }
    this.changed();
    return n === 0;
  }
  decSlot(i, n = 1) { const s = this.slots[i]; if (!s) return; s.count -= n; if (s.count <= 0) this.slots[i] = null; this.changed(); }
  serialize() { return this.slots.map(s => (s ? [s.id, s.count, s.dmg || 0] : 0)); }
  load(arr) {
    if (!arr) return;
    for (let i = 0; i < this.slots.length; i++) {
      const a = arr[i];
      this.slots[i] = a && ITEMS[a[0]] ? stack(a[0], a[1], a[2] || 0) : null;
    }
    this.changed();
  }
  clear() { this.slots.fill(null); this.changed(); }
}

// ------------------------------------------------------------------ recipes
// key values: item name, '#planks', '#log', '#wool', or array of names.
export const RECIPES = [];
function shaped(result, count, pattern, key) { RECIPES.push({ type: 'shaped', result: I[result], count, pattern, key }); }
function shapeless(result, count, ingredients) { RECIPES.push({ type: 'shapeless', result: I[result], count, ingredients }); }

for (const w of WOODS) {
  shapeless(w + '_planks', 4, [w + '_log']);
}
shaped('stick', 4, ['P', 'P'], { P: '#planks' });
shaped('crafting_table', 1, ['PP', 'PP'], { P: '#planks' });
shaped('torch', 4, ['C', 'S'], { C: ['coal', 'charcoal'], S: 'stick' });
shaped('furnace', 1, ['CCC', 'C C', 'CCC'], { C: ['cobblestone', 'cobbled_slate'] });
shaped('chest', 1, ['PPP', 'P P', 'PPP'], { P: '#planks' });
const TOOLMAT = { wooden: '#planks', stone: ['cobblestone', 'cobbled_slate'], iron: 'iron_ingot', golden: 'gold_ingot', diamond: 'diamond', crystal: 'crystal_shard' };
for (const [tier, m] of Object.entries(TOOLMAT)) {
  shaped(tier + '_pickaxe', 1, ['MMM', ' S ', ' S '], { M: m, S: 'stick' });
  shaped(tier + '_axe', 1, ['MM', 'MS', ' S'], { M: m, S: 'stick' });
  shaped(tier + '_shovel', 1, ['M', 'S', 'S'], { M: m, S: 'stick' });
  shaped(tier + '_sword', 1, ['M', 'M', 'S'], { M: m, S: 'stick' });
  shaped(tier + '_hoe', 1, ['MM', ' S', ' S'], { M: m, S: 'stick' });
}
shaped('bow', 1, [' SX', 'S X', ' SX'], { S: 'stick', X: 'string' });
shaped('arrow', 4, ['F', 'S', 'E'], { F: 'flint', S: 'stick', E: 'feather' });
shaped('bread', 1, ['WWW'], { W: 'wheat' });
shaped('bucket', 1, ['I I', ' I '], { I: 'iron_ingot' });
shapeless('flint_and_steel', 1, ['iron_ingot', 'flint']);
shaped('shears', 1, [' I', 'I '], { I: 'iron_ingot' });
shaped('stone_bricks', 4, ['SS', 'SS'], { S: 'stone' });
shaped('sandstone', 1, ['SS', 'SS'], { S: 'sand' });
shaped('bookshelf', 1, ['PPP', 'CCC', 'PPP'], { P: '#planks', C: 'sugar_cane' });
shaped('tnt', 1, ['SCS', 'CSC', 'SCS'], { S: 'sand', C: ['gunpowder', 'coal'] });
shaped('white_wool', 1, ['SS', 'SS'], { S: 'string' });
shaped('bed', 1, ['WWW', 'PPP'], { W: '#wool', P: '#planks' });
shaped('lantern', 1, ['I', 'T', 'I'], { I: 'iron_ingot', T: 'torch' });
shaped('crystal_block', 1, ['CC', 'CC'], { C: 'crystal_shard' });
shaped('glowstone', 1, ['CT', 'TC'], { C: 'crystal_shard', T: 'torch' });
shaped('golden_apple', 1, ['GGG', 'GAG', 'GGG'], { G: 'gold_ingot', A: 'apple' });
shaped('jack_o_lantern', 1, ['P', 'T'], { P: 'pumpkin', T: 'torch' });
shaped('hay_block', 1, ['WWW', 'WWW', 'WWW'], { W: 'wheat' });
shapeless('wheat', 9, ['hay_block']);
shaped('mossy_cobblestone', 1, ['CM'], { C: 'cobblestone', M: 'moss_block' });
shaped('mossy_stone_bricks', 1, ['CM'], { C: 'stone_bricks', M: 'moss_block' });
shaped('stone_slab', 6, ['SSS'], { S: 'smooth_stone' });
shaped('cobblestone_slab', 6, ['SSS'], { S: 'cobblestone' });
shaped('stone_brick_slab', 6, ['SSS'], { S: 'stone_bricks' });
shaped('oak_slab', 6, ['SSS'], { S: 'oak_planks' });
shaped('cherry_slab', 6, ['SSS'], { S: 'cherry_planks' });
shaped('melon', 1, ['MMM', 'MMM', 'MMM'], { M: 'melon_slice' });
shapeless('melon_slice', 9, ['melon']);
for (const [b, it] of [['iron_block', 'iron_ingot'], ['gold_block', 'gold_ingot'], ['copper_block', 'copper_ingot'], ['diamond_block', 'diamond'], ['emerald_block', 'emerald'], ['coal_block', 'coal']]) {
  shaped(b, 1, ['XXX', 'XXX', 'XXX'], { X: it });
  shapeless(it, 9, [b]);
}
shaped('snow', 1, ['SS', 'SS'], { S: 'snow_layer' });
const DYES = {
  dandelion: 'yellow', poppy: 'red', cornflower: 'blue', allium: 'magenta', orange_tulip: 'orange', pink_tulip: 'pink',
  oxeye_daisy: 'light_gray', lily_of_the_valley: 'white', coal: 'black', cactus: 'green', sweet_berries: 'red',
  red_mushroom: 'red', brown_mushroom: 'brown', crystal_shard: 'purple', emerald: 'lime', diamond: 'light_blue', copper_ingot: 'cyan',
};
for (const [src, color] of Object.entries(DYES)) if (color !== 'white') shapeless(color + '_wool', 1, ['white_wool', src]);
shapeless('gray_wool', 2, ['white_wool', 'black_wool']);
// guns
shapeless('gunpowder', 2, ['coal', 'flint']);
shapeless('bullets', 12, ['copper_ingot', 'gunpowder']);
shapeless('bullets', 8, ['iron_ingot', 'gunpowder']);
shaped('pistol', 1, ['III', '  W'], { I: 'iron_ingot', W: '#planks' });
shaped('assault_rifle', 1, ['III', 'GIW', '  W'], { I: 'iron_ingot', G: 'gunpowder', W: '#planks' });
shaped('shotgun', 1, ['II ', 'IGW'], { I: 'iron_ingot', G: 'gunpowder', W: '#planks' });
shaped('sniper_rifle', 1, ['DII', 'IGW', '  W'], { D: 'diamond', I: 'iron_ingot', G: 'gunpowder', W: '#planks' });
// Verity can be remade if lost
shapeless('jenny', 1, ['gold_ingot', 'pink_tulip', 'white_wool']);
shapeless('jenny', 1, ['gold_ingot', 'poppy', 'white_wool']);
shapeless('verity', 1, ['white_wool', 'black_wool', 'string', 'string']);

function matches(spec, id) {
  if (id == null) return false;
  if (Array.isArray(spec)) return spec.some(s => matches(s, id));
  if (spec[0] === '#') {
    const tag = spec.slice(1);
    if (tag === 'wool') return id < 256 && !!BLOCKS[id].wool;
    return hasTag(id, tag);
  }
  return I[spec] === id;
}

// grid: array of item ids (or null), w x h (2x2 or 3x3)
export function craft(grid, w) {
  const h = grid.length / w;
  let minX = w, minY = h, maxX = -1, maxY = -1;
  const items = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const id = grid[y * w + x];
    if (id != null) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); items.push(id); }
  }
  if (!items.length) return null;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  const at = (x, y) => grid[(y + minY) * w + (x + minX)];
  for (const r of RECIPES) {
    if (r.type === 'shapeless') {
      if (r.ingredients.length !== items.length) continue;
      const left = [...items];
      let ok = true;
      for (const ing of r.ingredients) {
        const k = left.findIndex(id => matches(ing, id));
        if (k < 0) { ok = false; break; }
        left.splice(k, 1);
      }
      if (ok) return { id: r.result, count: r.count };
      continue;
    }
    const ph = r.pattern.length, pw = Math.max(...r.pattern.map(s => s.length));
    if (pw !== bw || ph !== bh) continue;
    for (const mirror of [false, true]) {
      let ok = true;
      for (let y = 0; y < ph && ok; y++) for (let x = 0; x < pw && ok; x++) {
        const px = mirror ? pw - 1 - x : x;
        const ch = r.pattern[y][px] || ' ';
        const id = at(x, y);
        if (ch === ' ') { if (id != null) ok = false; }
        else if (!matches(r.key[ch], id)) ok = false;
      }
      if (ok) return { id: r.result, count: r.count };
    }
  }
  return null;
}

// Recipe book: recipes whose result the player can currently craft (for the crafting helper)
export function craftableWith(inv, gridSize) {
  const out = [];
  const have = new Map();
  for (const s of inv.slots) if (s) have.set(s.id, (have.get(s.id) || 0) + s.count);
  for (const r of RECIPES) {
    if (r.type === 'shaped') {
      const ph = r.pattern.length, pw = Math.max(...r.pattern.map(s => s.length));
      if (ph > gridSize || pw > gridSize) continue;
    } else if (r.ingredients.length > gridSize * gridSize) continue;
    const need = [];
    if (r.type === 'shaped') { for (const row of r.pattern) for (const ch of row) if (ch !== ' ') need.push(r.key[ch]); }
    else need.push(...r.ingredients);
    const pool = new Map(have);
    let ok = true;
    for (const spec of need) {
      let found = false;
      for (const [id, n] of pool) if (n > 0 && matches(spec, id)) { pool.set(id, n - 1); found = true; break; }
      if (!found) { ok = false; break; }
    }
    if (ok && !out.some(o => o.result === r.result)) out.push(r);
  }
  return out;
}

// Fill a crafting grid from the inventory for a recipe (returns grid ids or null).
export function layoutRecipe(r, inv, gridSize) {
  const grid = new Array(gridSize * gridSize).fill(null);
  const pool = new Map();
  for (const s of inv.slots) if (s) pool.set(s.id, (pool.get(s.id) || 0) + s.count);
  const pick = (spec) => { for (const [id, n] of pool) if (n > 0 && matches(spec, id)) { pool.set(id, n - 1); return id; } return null; };
  if (r.type === 'shaped') {
    for (let y = 0; y < r.pattern.length; y++) for (let x = 0; x < r.pattern[y].length; x++) {
      const ch = r.pattern[y][x];
      if (ch === ' ') continue;
      const id = pick(r.key[ch]);
      if (id == null) return null;
      grid[y * gridSize + x] = id;
    }
  } else {
    r.ingredients.forEach((ing, i) => { grid[i] = pick(ing); });
    if (grid.some((g, i) => i < r.ingredients.length && g == null)) return null;
  }
  return grid;
}

// ------------------------------------------------------------------ smelting
export const SMELT = new Map();
const sm = (a, b) => SMELT.set(I[a], I[b]);
sm('cobblestone', 'stone'); sm('stone', 'smooth_stone'); sm('sand', 'glass'); sm('iron_ore', 'iron_ingot');
sm('gold_ore', 'gold_ingot'); sm('copper_ore', 'copper_ingot'); sm('clay', 'bricks'); sm('cobbled_slate', 'slate');
sm('raw_porkchop', 'cooked_porkchop'); sm('raw_beef', 'steak'); sm('raw_mutton', 'cooked_mutton'); sm('raw_chicken', 'cooked_chicken');
sm('cactus', 'green_wool'); sm('wet_sponge', 'stone');
for (const w of WOODS) sm(w + '_log', 'charcoal');
sm('crystal_ore', 'crystal_shard'); sm('diamond_ore', 'diamond'); sm('emerald_ore', 'emerald'); sm('coal_ore', 'coal');
SMELT.delete(undefined);

export function fuelTicks(id) {
  const it = ITEMS[id];
  return it ? it.fuel || 0 : 0;
}
