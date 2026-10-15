// Block and item registry. Pure data: imported by the main thread and by the
// generation / meshing workers, so nothing here may touch the DOM.

export const SHAPE = { NONE: 0, CUBE: 1, CROSS: 2, CROP: 3, LIQUID: 4, BOXES: 5 };
export const BUCKET = { OPAQUE: 0, CUTOUT: 1, WATER: 2 };
export const TINT = { NONE: 0, GRASS: 1, FOLIAGE: 2, WATER: 3, BIRCH: 4, SPRUCE: 5 };
export const WAVE = { NONE: 0, LEAVES: 1, PLANT: 2, PLANT_ALL: 3 };
// Material flags read by the chunk shader.
export const MAT = { NONE: 0, GLOSSY: 1, EMISSIVE: 2, GLINT: 3, LAVA: 4 };

const MAX = 256;
export const BLOCKS = [];          // id -> def
export const B = {};               // name -> id
export const SHAPES = new Uint8Array(MAX);
export const OPAQUE = new Uint8Array(MAX);
export const BUCKETS = new Uint8Array(MAX);
export const TINTS = new Uint8Array(MAX);
export const WAVES = new Uint8Array(MAX);
export const EMIT = new Uint8Array(MAX);
export const LO = new Uint8Array(MAX);        // light opacity
export const SOLID = new Uint8Array(MAX);
export const LIQUID = new Uint8Array(MAX);    // 1 water, 2 lava
export const LEVEL = new Uint8Array(MAX);     // liquid level, 0 source, 8 falling
export const AOCC = new Uint8Array(MAX);      // casts ambient occlusion
export const CULLSELF = new Uint8Array(MAX);
export const MATF = new Uint8Array(MAX);
export const REPLACEABLE = new Uint8Array(MAX);
export const FACE_TEX = new Uint16Array(MAX * 6);
export const FACE_ROT = new Uint8Array(MAX * 6);
export const FACE_OVERLAY = new Uint8Array(MAX * 6); // grass side overlay flag

// Face order used everywhere: +X, -X, +Y, -Y, +Z, -Z
export const DIRS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];

// ---------------------------------------------------------------- textures
export const TEX_NAMES = [];
export const TEX = {};
export function texName(n) {
  if (TEX[n] === undefined) { TEX[n] = TEX_NAMES.length; TEX_NAMES.push(n); }
  return TEX[n];
}
// Shared non-block textures, registered first so their layers are stable.
for (let i = 0; i < 10; i++) texName('destroy_' + i);
texName('grass_side_overlay');
texName('grass_side_snow');
texName('water_still');
texName('lava_still');

let nextId = 0;
function reg(name, d = {}) {
  const id = nextId++;
  const def = {
    id, name,
    display: d.display || name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    shape: d.shape ?? SHAPE.CUBE,
    bucket: d.bucket ?? BUCKET.OPAQUE,
    hardness: d.hardness ?? 1,
    tool: d.tool || null,          // 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword'
    toolLevel: d.toolLevel ?? -1,  // required tier, -1 = hand ok
    sound: d.sound || 'stone',
    drops: d.drops,                // undefined = itself, null = nothing, fn(rng, tool)
    item: d.item,                  // item id this block is picked/dropped as (variants)
    boxes: d.boxes || null,
    collide: d.collide || null,    // collision boxes override
    noItem: d.noItem || false,     // hidden from creative inventory
    ...d,
  };
  def.id = id; def.name = name;
  BLOCKS[id] = def; B[name] = id;
  SHAPES[id] = def.shape;
  const opaque = d.opaque ?? (def.shape === SHAPE.CUBE && def.bucket === BUCKET.OPAQUE);
  OPAQUE[id] = opaque ? 1 : 0;
  BUCKETS[id] = def.bucket;
  TINTS[id] = d.tint ?? TINT.NONE;
  WAVES[id] = d.wave ?? WAVE.NONE;
  EMIT[id] = d.emit ?? 0;
  LO[id] = d.lo ?? (opaque ? 15 : 0);
  SOLID[id] = (d.solid ?? (def.shape === SHAPE.CUBE || def.shape === SHAPE.BOXES)) ? 1 : 0;
  LIQUID[id] = d.liquid ?? 0;
  LEVEL[id] = d.level ?? 0;
  AOCC[id] = d.aocc ?? (opaque ? 1 : 0);
  CULLSELF[id] = d.cullSelf ? 1 : 0;
  MATF[id] = d.mat ?? MAT.NONE;
  REPLACEABLE[id] = d.replaceable ? 1 : 0;
  // Resolve face textures.
  const t = d.tex === undefined ? name : d.tex;
  if (t !== null) {
    let faces;
    if (typeof t === 'string') faces = [t, t, t, t, t, t];
    else {
      const side = t.side || t.all;
      faces = [t.east || side, t.west || side, t.top || t.all || side, t.bottom || t.top || side,
        t.south || side, t.north || side];
      if (d.facing !== undefined && t.front) faces[d.facing] = t.front;
    }
    if (d.axis === 'x') {
      faces = [t.top, t.top, t.side, t.side, t.side, t.side];
      FACE_ROT[id * 6 + 2] = 1; FACE_ROT[id * 6 + 3] = 1; FACE_ROT[id * 6 + 4] = 1; FACE_ROT[id * 6 + 5] = 1;
    } else if (d.axis === 'z') {
      faces = [t.side, t.side, t.side, t.side, t.top, t.top];
      FACE_ROT[id * 6 + 0] = 1; FACE_ROT[id * 6 + 1] = 1;
    }
    for (let f = 0; f < 6; f++) FACE_TEX[id * 6 + f] = texName(faces[f]);
  }
  if (d.overlaySides) for (const f of [0, 1, 4, 5]) FACE_OVERLAY[id * 6 + f] = 1;
  return id;
}

// Helpers for common kinds.
const plant = (name, d = {}) => reg(name, {
  shape: SHAPE.CROSS, bucket: BUCKET.CUTOUT, hardness: 0, sound: 'grass', solid: false,
  wave: WAVE.PLANT, replaceable: false, ...d,
});
const stoneLike = (name, d = {}) => reg(name, { hardness: 1.5, tool: 'pickaxe', toolLevel: 0, sound: 'stone', ...d });

// ---------------------------------------------------------------- blocks
reg('air', { shape: SHAPE.NONE, tex: null, solid: false, opaque: false, lo: 0, hardness: 0, noItem: true });
stoneLike('stone', { drops: 'cobblestone' });
stoneLike('cobblestone', { hardness: 2 });
stoneLike('mossy_cobblestone', { hardness: 2 });
stoneLike('stone_bricks');
stoneLike('mossy_stone_bricks');
stoneLike('smooth_stone', { hardness: 2 });
stoneLike('granite');
stoneLike('diorite');
stoneLike('andesite');
stoneLike('slate', { hardness: 3, display: 'Deep Slate', drops: 'cobbled_slate' });
stoneLike('cobbled_slate', { hardness: 3.5 });
reg('bedrock', { hardness: -1, sound: 'stone' });
reg('dirt', { hardness: 0.5, tool: 'shovel', sound: 'gravel' });
reg('grass', {
  display: 'Grass Block', tex: { top: 'grass_top', bottom: 'dirt', side: 'grass_side' },
  tint: TINT.GRASS, overlaySides: true, hardness: 0.6, tool: 'shovel', sound: 'grass', drops: 'dirt',
});
reg('podzol', { tex: { top: 'podzol_top', bottom: 'dirt', side: 'podzol_side' }, hardness: 0.5, tool: 'shovel', sound: 'gravel', drops: 'dirt' });
reg('coarse_dirt', { hardness: 0.5, tool: 'shovel', sound: 'gravel' });
reg('moss_block', { hardness: 0.1, tool: 'hoe', sound: 'grass' });
reg('farmland', {
  tex: { top: 'farmland_dry', bottom: 'dirt', side: 'dirt' }, shape: SHAPE.BOXES, boxes: [[0, 0, 0, 16, 15, 16]],
  opaque: false, lo: 15, aocc: 1, hardness: 0.6, tool: 'shovel', sound: 'gravel', drops: 'dirt',
});
reg('farmland_wet', {
  tex: { top: 'farmland_wet', bottom: 'dirt', side: 'dirt' }, shape: SHAPE.BOXES, boxes: [[0, 0, 0, 16, 15, 16]],
  opaque: false, lo: 15, aocc: 1, hardness: 0.6, tool: 'shovel', sound: 'gravel', drops: 'dirt', noItem: true,
});
reg('sand', { hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true });
reg('sandstone', { tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone_side' }, hardness: 0.8, tool: 'pickaxe', toolLevel: 0 });
reg('gravel', { hardness: 0.6, tool: 'shovel', sound: 'gravel', gravity: true });
reg('clay', { hardness: 0.6, tool: 'shovel', sound: 'gravel' });
reg('snow', { display: 'Snow Block', hardness: 0.2, tool: 'shovel', sound: 'snow' });
reg('snow_layer', {
  display: 'Snow', tex: 'snow', shape: SHAPE.BOXES, boxes: [[0, 0, 0, 16, 2, 16]], collide: [[0, 0, 0, 16, 2, 16]],
  hardness: 0.1, tool: 'shovel', sound: 'snow', drops: null, replaceable: true, lo: 0,
});
reg('ice', { hardness: 0.5, tool: 'pickaxe', sound: 'glass', mat: MAT.GLOSSY, drops: null, lo: 2, opaque: true, slippery: true });
reg('packed_ice', { hardness: 0.5, tool: 'pickaxe', sound: 'glass', mat: MAT.GLOSSY, slippery: true });
reg('obsidian', { hardness: 50, tool: 'pickaxe', toolLevel: 3, mat: MAT.GLOSSY });

// Liquids: source, flowing levels, falling.
const liquidCommon = { shape: SHAPE.LIQUID, solid: false, hardness: -1, replaceable: true, noItem: true, drops: null, sound: 'none' };
reg('water', { ...liquidCommon, tex: 'water_still', bucket: BUCKET.WATER, liquid: 1, level: 0, lo: 1, tint: TINT.WATER });
for (let l = 1; l <= 7; l++) reg('water_' + l, { ...liquidCommon, tex: 'water_still', bucket: BUCKET.WATER, liquid: 1, level: l, lo: 1, tint: TINT.WATER });
reg('water_falling', { ...liquidCommon, tex: 'water_still', bucket: BUCKET.WATER, liquid: 1, level: 8, lo: 1, tint: TINT.WATER });
reg('lava', { ...liquidCommon, tex: 'lava_still', bucket: BUCKET.OPAQUE, liquid: 2, level: 0, lo: 15, emit: 15, mat: MAT.LAVA });
for (let l = 1; l <= 3; l++) reg('lava_' + l, { ...liquidCommon, tex: 'lava_still', bucket: BUCKET.OPAQUE, liquid: 2, level: l * 2, lo: 15, emit: 15, mat: MAT.LAVA });
reg('lava_falling', { ...liquidCommon, tex: 'lava_still', bucket: BUCKET.OPAQUE, liquid: 2, level: 8, lo: 15, emit: 15, mat: MAT.LAVA });

// Wood families.
export const WOODS = ['oak', 'birch', 'spruce', 'cherry', 'acacia'];
const leafTint = { oak: TINT.FOLIAGE, birch: TINT.BIRCH, spruce: TINT.SPRUCE, cherry: TINT.NONE, acacia: TINT.FOLIAGE };
for (const w of WOODS) {
  const tex = { top: w + '_log_top', side: w + '_log' };
  const log = reg(w + '_log', { tex, axis: 'y', hardness: 2, tool: 'axe', sound: 'wood', fuel: 300, tag: 'log' });
  reg(w + '_log_x', { tex, axis: 'x', hardness: 2, tool: 'axe', sound: 'wood', item: log, noItem: true, tag: 'log' });
  reg(w + '_log_z', { tex, axis: 'z', hardness: 2, tool: 'axe', sound: 'wood', item: log, noItem: true, tag: 'log' });
}
for (const w of WOODS) reg(w + '_planks', { hardness: 2, tool: 'axe', sound: 'wood', fuel: 300, tag: 'planks' });
for (const w of WOODS) {
  const leaf = reg(w + '_leaves', {
    bucket: BUCKET.CUTOUT, opaque: false, lo: 1, aocc: 1, tint: leafTint[w], wave: WAVE.LEAVES,
    hardness: 0.2, tool: 'hoe', sound: 'grass', leaves: true, wood: w,
  });
  reg(w + '_leaves_p', {
    tex: w + '_leaves', bucket: BUCKET.CUTOUT, opaque: false, lo: 1, aocc: 1, tint: leafTint[w], wave: WAVE.LEAVES,
    hardness: 0.2, tool: 'hoe', sound: 'grass', item: leaf, noItem: true, persistent: true, wood: w,
  });
}
for (const w of WOODS) plant(w + '_sapling', { wave: WAVE.PLANT, sapling: w, fuel: 100 });

reg('glass', { bucket: BUCKET.CUTOUT, opaque: false, cullSelf: true, hardness: 0.3, sound: 'glass', drops: null, lo: 0 });
// Ores
stoneLike('coal_ore', { hardness: 3, drops: 'coal' });
stoneLike('iron_ore', { hardness: 3, toolLevel: 1 });
stoneLike('copper_ore', { hardness: 3, toolLevel: 1 });
stoneLike('gold_ore', { hardness: 3, toolLevel: 2 });
stoneLike('diamond_ore', { hardness: 3, toolLevel: 2, drops: 'diamond', mat: MAT.GLINT });
stoneLike('emerald_ore', { hardness: 3, toolLevel: 2, drops: 'emerald', mat: MAT.GLINT });
stoneLike('crystal_ore', { hardness: 3, toolLevel: 2, drops: 'crystal_shard', dropCount: [2, 4], mat: MAT.GLINT, emit: 6 });
stoneLike('coal_block', { hardness: 5, fuel: 16000 });
stoneLike('iron_block', { hardness: 5, toolLevel: 1, sound: 'metal', mat: MAT.GLOSSY });
stoneLike('copper_block', { hardness: 5, toolLevel: 1, sound: 'metal', mat: MAT.GLOSSY });
stoneLike('gold_block', { hardness: 3, toolLevel: 2, sound: 'metal', mat: MAT.GLOSSY });
stoneLike('diamond_block', { hardness: 5, toolLevel: 2, sound: 'metal', mat: MAT.GLOSSY });
stoneLike('emerald_block', { hardness: 5, toolLevel: 2, sound: 'metal', mat: MAT.GLOSSY });
reg('crystal_block', { hardness: 1.5, tool: 'pickaxe', sound: 'glass', emit: 12, mat: MAT.EMISSIVE });
reg('glowstone', { hardness: 0.3, sound: 'glass', emit: 15, mat: MAT.EMISSIVE });
stoneLike('bricks', { hardness: 2 });
reg('bookshelf', { tex: { top: 'oak_planks', side: 'bookshelf' }, hardness: 1.5, tool: 'axe', sound: 'wood', fuel: 300 });
reg('crafting_table', { tex: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side', north: 'crafting_table_front', south: 'crafting_table_front' }, hardness: 2.5, tool: 'axe', sound: 'wood', fuel: 300, use: 'craft' });

// Facing variants: index into DIRS for the front face.
const FACINGS = [5, 4, 0, 1]; // north, south, east, west
export const FACING_NAMES = ['n', 's', 'e', 'w'];
function facingFamily(base, d) {
  const first = reg(base, { ...d, facing: FACINGS[0] });
  for (let i = 1; i < 4; i++) reg(base + '_' + FACING_NAMES[i], { ...d, facing: FACINGS[i], item: first, noItem: true });
  return first;
}
facingFamily('furnace', { tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front' }, hardness: 3.5, tool: 'pickaxe', toolLevel: 0, use: 'furnace', be: 'furnace', facingFamily: 'furnace' });
const lit = facingFamily('furnace_lit', { tex: { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front_lit' }, hardness: 3.5, tool: 'pickaxe', toolLevel: 0, use: 'furnace', be: 'furnace', emit: 13, noItem: true, facingFamily: 'furnace_lit' });
for (let i = 0; i < 4; i++) BLOCKS[lit + i].item = B.furnace;
facingFamily('chest', {
  tex: { top: 'chest_top', bottom: 'chest_top', side: 'chest_side', front: 'chest_front' },
  shape: SHAPE.BOXES, boxes: [[1, 0, 1, 15, 14, 15]], opaque: false, lo: 0, hardness: 2.5, tool: 'axe', sound: 'wood', use: 'chest', be: 'chest', facingFamily: 'chest', fuel: 300,
});
facingFamily('pumpkin', { tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'pumpkin_side' }, hardness: 1, tool: 'axe', sound: 'wood', facingFamily: 'pumpkin' });
facingFamily('jack_o_lantern', { tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'jack_o_lantern' }, hardness: 1, tool: 'axe', sound: 'wood', emit: 15, facingFamily: 'jack_o_lantern' });
reg('melon', { tex: { top: 'melon_top', side: 'melon_side' }, hardness: 1, tool: 'axe', sound: 'wood' });
reg('tnt', { tex: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' }, hardness: 0, sound: 'grass', use: 'tnt' });

// Light sources
const torch = reg('torch', {
  shape: SHAPE.BOXES, boxes: [[7, 0, 7, 9, 10, 9]], bucket: BUCKET.CUTOUT, solid: false, opaque: false,
  hardness: 0, emit: 14, sound: 'wood', torch: true, mat: MAT.EMISSIVE,
});
const wallBoxes = { n: [7, 3, 0, 9, 13, 2], s: [7, 3, 14, 9, 13, 16], e: [14, 3, 7, 16, 13, 9], w: [0, 3, 7, 2, 13, 9] };
// wall torch named by the side of the block it hangs on
for (const k of ['n', 's', 'e', 'w']) reg('wall_torch_' + k, {
  tex: 'torch', shape: SHAPE.BOXES, boxes: [wallBoxes[k]], bucket: BUCKET.CUTOUT, solid: false, opaque: false,
  hardness: 0, emit: 14, sound: 'wood', item: torch, noItem: true, torch: true, mat: MAT.EMISSIVE,
});
reg('lantern', {
  tex: { top: 'lantern_top', bottom: 'lantern_top', side: 'lantern' }, shape: SHAPE.BOXES,
  boxes: [[5, 0, 5, 11, 7, 11], [6, 7, 6, 10, 9, 10]], bucket: BUCKET.CUTOUT, opaque: false, hardness: 1,
  tool: 'pickaxe', emit: 15, sound: 'metal', mat: MAT.EMISSIVE,
});
plant('crystal_cluster', { emit: 10, mat: MAT.EMISSIVE, wave: WAVE.NONE, hardness: 0.5, sound: 'glass', drops: 'crystal_shard' });
plant('glow_mushroom', { emit: 9, mat: MAT.EMISSIVE, wave: WAVE.NONE });

// Plants
plant('short_grass', { tint: TINT.GRASS, replaceable: true, drops: 'seeds_chance', noItem: false });
plant('tall_fern', { display: 'Fern', tint: TINT.GRASS, replaceable: true, drops: 'seeds_chance' });
plant('dead_bush', { replaceable: true, drops: 'stick_chance', fuel: 100 });
plant('dandelion');
plant('poppy');
plant('cornflower');
plant('allium');
plant('orange_tulip');
plant('pink_tulip');
plant('oxeye_daisy');
plant('lily_of_the_valley');
plant('red_mushroom', { wave: WAVE.NONE });
plant('brown_mushroom', { wave: WAVE.NONE });
plant('sugar_cane', { tint: TINT.GRASS, wave: WAVE.PLANT_ALL, cane: true });
plant('sweet_berry_bush', { wave: WAVE.PLANT, drops: 'sweet_berries', berry: true });
reg('cactus', {
  tex: { top: 'cactus_top', bottom: 'cactus_bottom', side: 'cactus_side' }, shape: SHAPE.BOXES,
  boxes: [[1, 0, 1, 15, 16, 15]], bucket: BUCKET.CUTOUT, opaque: false, aocc: 0, hardness: 0.4, sound: 'cloth', cactus: true,
});
for (let s = 0; s < 8; s++) reg('wheat_' + s, {
  tex: 'wheat_stage' + s, shape: SHAPE.CROP, bucket: BUCKET.CUTOUT, solid: false, opaque: false,
  hardness: 0, sound: 'grass', wave: WAVE.PLANT, crop: s, noItem: true, drops: 'wheat_drop',
});

// Wool
export const COLORS = ['white', 'light_gray', 'gray', 'black', 'red', 'orange', 'yellow', 'lime', 'green', 'cyan', 'light_blue', 'blue', 'purple', 'magenta', 'pink', 'brown'];
for (const c of COLORS) reg(c + '_wool', { tex: 'wool_' + c, hardness: 0.8, sound: 'cloth', fuel: 100, wool: c });

// Slabs (bottom half)
const slab = (name, tex, d) => reg(name, { tex, shape: SHAPE.BOXES, boxes: [[0, 0, 0, 16, 8, 16]], opaque: false, lo: 15, aocc: 0, slab: true, ...d });
slab('stone_slab', { top: 'smooth_stone', side: 'smooth_stone_slab_side' }, { hardness: 2, tool: 'pickaxe', toolLevel: 0 });
slab('cobblestone_slab', 'cobblestone', { hardness: 2, tool: 'pickaxe', toolLevel: 0 });
slab('stone_brick_slab', 'stone_bricks', { hardness: 2, tool: 'pickaxe', toolLevel: 0 });
slab('oak_slab', 'oak_planks', { hardness: 2, tool: 'axe', sound: 'wood', fuel: 150 });
slab('cherry_slab', 'cherry_planks', { hardness: 2, tool: 'axe', sound: 'wood', fuel: 150 });

reg('bed', {
  tex: { top: 'bed_top', bottom: 'oak_planks', side: 'bed_side' }, shape: SHAPE.BOXES,
  boxes: [[0, 3, 0, 16, 9, 16], [0, 0, 0, 3, 3, 3], [13, 0, 0, 16, 3, 3], [0, 0, 13, 3, 3, 16], [13, 0, 13, 16, 3, 16]],
  collide: [[0, 0, 0, 16, 9, 16]], opaque: false, lo: 0, hardness: 0.2, sound: 'cloth', use: 'bed',
});
reg('cloud', { hardness: 0.3, sound: 'cloth', display: 'Cloud', bucket: BUCKET.OPAQUE });
reg('hay_block', { tex: { top: 'hay_top', side: 'hay_side' }, hardness: 0.5, sound: 'grass', tool: 'hoe' });

export const BLOCK_COUNT = nextId;
if (BLOCK_COUNT > 256) throw new Error('too many blocks');

// ---------------------------------------------------------------- items
// Items share the id space: blocks are 0..255, other items start at 256.
export const ITEMS = [];
export const I = {};
for (const b of BLOCKS) {
  ITEMS[b.id] = { id: b.id, name: b.name, display: b.display, block: b.id, stack: 64, fuel: b.fuel || 0, hidden: b.noItem };
  I[b.name] = b.id;
}
let nextItem = 256;
function item(name, d = {}) {
  const id = nextItem++;
  ITEMS[id] = {
    id, name, display: d.display || name.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    stack: d.stack ?? 64, icon: d.icon || name, fuel: d.fuel || 0, ...d,
  };
  ITEMS[id].id = id;
  I[name] = id;
  return id;
}
item('stick', { fuel: 100 });
item('coal', { fuel: 1600 });
item('charcoal', { fuel: 1600 });
item('iron_ingot');
item('gold_ingot');
item('copper_ingot');
item('diamond');
item('emerald');
item('crystal_shard');
item('flint');
item('string');
item('feather');
item('bone');
item('gunpowder');
item('wheat');
item('seeds', { display: 'Wheat Seeds', place: 'wheat_0', needs: ['farmland', 'farmland_wet'] });
item('bread', { food: [5, 6] });
item('apple', { food: [4, 2.4] });
item('golden_apple', { food: [4, 9.6], heal: 8, glint: true });
item('sweet_berries', { food: [2, 0.4], place: 'sweet_berry_bush', needs: ['grass', 'dirt', 'podzol'] });
item('melon_slice', { food: [2, 1.2] });
item('raw_porkchop', { food: [3, 1.8], cooks: 'cooked_porkchop' });
item('cooked_porkchop', { food: [8, 12.8] });
item('raw_beef', { food: [3, 1.8], cooks: 'steak' });
item('steak', { food: [8, 12.8] });
item('raw_mutton', { food: [2, 1.2], cooks: 'cooked_mutton' });
item('cooked_mutton', { food: [6, 9.6] });
item('raw_chicken', { food: [2, 1.2], cooks: 'cooked_chicken' });
item('cooked_chicken', { food: [6, 7.2] });
item('rotten_flesh', { food: [4, 0.8] });
item('bucket', { stack: 16 });
item('water_bucket', { stack: 1 });
item('lava_bucket', { stack: 1, fuel: 20000 });
item('flint_and_steel', { stack: 1, durability: 64 });
item('bow', { stack: 1, durability: 384 });
item('arrow');
item('shears', { stack: 1, durability: 238 });

// Tools: tier 0 wood, 1 stone, 2 iron, 3 diamond, 4 crystal, gold is fast but tier 0.
export const TIERS = {
  wooden: { level: 0, speed: 2, dur: 59, dmg: 0, mat: 'planks' },
  stone: { level: 1, speed: 4, dur: 131, dmg: 1, mat: 'cobblestone' },
  iron: { level: 2, speed: 6, dur: 250, dmg: 2, mat: 'iron_ingot' },
  golden: { level: 0, speed: 12, dur: 32, dmg: 0, mat: 'gold_ingot' },
  diamond: { level: 3, speed: 8, dur: 1561, dmg: 3, mat: 'diamond' },
  crystal: { level: 3, speed: 11, dur: 2400, dmg: 4, mat: 'crystal_shard' },
};
const TOOL_BASE = { pickaxe: 2, axe: 7, shovel: 2.5, sword: 4, hoe: 1 };
for (const [tier, t] of Object.entries(TIERS)) {
  for (const kind of ['pickaxe', 'axe', 'shovel', 'sword', 'hoe']) {
    const dmg = kind === 'sword' ? 4 + t.dmg : kind === 'axe' ? 5 + t.dmg : TOOL_BASE[kind] + t.dmg * 0.5;
    item(tier + '_' + kind, {
      stack: 1, tool: kind, level: t.level, speed: t.speed, durability: t.dur, damage: dmg,
      tier, fuel: tier === 'wooden' ? 200 : 0, glint: tier === 'crystal',
    });
  }
}
// Guns: left click fires, R reloads, right click aims. Magazine state lives in the stack's dmg field
// (rounds fired since the last reload).
item('pistol', { stack: 1, gun: { dmg: 5, cd: 0.26, mag: 12, spread: 0.014, auto: false, range: 70, recoil: 0.035, pellets: 1, reload: 1.2, snd: 'gun.pistol', reloadSnd: 'pistol', zoom: 0.85 } });
item('assault_rifle', { stack: 1, gun: { dmg: 4, cd: 0.095, mag: 30, spread: 0.022, auto: true, range: 90, recoil: 0.018, pellets: 1, reload: 1.8, snd: 'gun.rifle', reloadSnd: 'rifle', zoom: 0.75 } });
item('shotgun', { stack: 1, gun: { dmg: 3, cd: 0.8, mag: 6, spread: 0.075, auto: false, range: 32, recoil: 0.07, pellets: 8, reload: 2.2, snd: 'gun.shotgun', reloadSnd: 'pump', zoom: 0.85 } });
item('sniper_rifle', { stack: 1, gun: { dmg: 20, cd: 1.25, mag: 5, spread: 0.05, scopedSpread: 0.0008, auto: false, range: 160, recoil: 0.09, pellets: 1, reload: 2.0, snd: 'gun.sniper', reloadSnd: 'bolt', zoom: 0.28, scope: true } });
item('bullets', { display: 'Bullets' });
item('verity', { stack: 1, display: 'Verity', verity: true });
item('jenny', { stack: 1, display: 'Jenny', jenny: true });
export const ITEM_COUNT = nextItem;

export function itemDef(id) { return ITEMS[id]; }
export function isBlockItem(id) { return id < 256; }
export function blockItem(blockId) {
  const b = BLOCKS[blockId];
  return b.item !== undefined ? b.item : blockId;
}
export function maxStack(id) { return ITEMS[id] ? ITEMS[id].stack : 64; }

// Tags used by recipes and smelting.
export function hasTag(id, tag) {
  if (id >= 256) return false;
  return BLOCKS[id].tag === tag;
}

// Break time in seconds for a block with a tool item (or null).
export function breakTime(blockId, toolId, inWater = false, onGround = true) {
  const b = BLOCKS[blockId];
  if (b.hardness < 0) return Infinity;
  if (b.hardness === 0) return 0.05;
  const t = toolId != null ? ITEMS[toolId] : null;
  let speed = 1;
  const correct = t && t.tool && b.tool === t.tool;
  if (correct) speed = t.speed;
  if (t && t.tool === 'sword' && (b.leaves || b.name === 'cobweb')) speed = 1.5;
  if (t && t.tool === 'shears' && (b.leaves || b.wool)) speed = 5;
  const canHarvest = b.toolLevel < 0 || (correct && t.level >= b.toolLevel);
  let time = b.hardness * (canHarvest ? 1.5 : 5) / speed;
  if (inWater) time *= 5;
  if (!onGround) time *= 5;
  return time;
}
export function canHarvest(blockId, toolId) {
  const b = BLOCKS[blockId];
  if (b.toolLevel < 0) return true;
  const t = toolId != null ? ITEMS[toolId] : null;
  return !!(t && t.tool === b.tool && t.level >= b.toolLevel);
}

// Drops for a broken block: array of [itemId, count].
export function blockDrops(blockId, toolId, rnd = Math.random) {
  const b = BLOCKS[blockId];
  if (!canHarvest(blockId, toolId)) return [];
  const tool = toolId != null ? ITEMS[toolId] : null;
  if (b.leaves) {
    if (tool && tool.name === 'shears') return [[blockItem(blockId), 1]];
    const out = [];
    if (rnd() < 0.06) out.push([I[b.wood + '_sapling'], 1]);
    if ((b.wood === 'oak') && rnd() < 0.02) out.push([I.apple, 1]);
    if (rnd() < 0.03) out.push([I.stick, 1]);
    return out;
  }
  const d = b.drops;
  if (d === null) return [];
  if (d === undefined) return [[blockItem(blockId), 1]];
  if (d === 'seeds_chance') return rnd() < 0.125 ? [[I.seeds, 1]] : [];
  if (d === 'stick_chance') return [[I.stick, Math.floor(rnd() * 3)]].filter(x => x[1] > 0);
  if (d === 'wheat_drop') {
    if (b.crop === 7) return [[I.wheat, 1], [I.seeds, 1 + Math.floor(rnd() * 3)]];
    return [[I.seeds, 1]];
  }
  if (d === 'sweet_berries') return [[I.sweet_berries, 1 + Math.floor(rnd() * 2)]];
  if (b.name === 'gravel' && rnd() < 0.1) return [[I.flint, 1]];
  const count = b.dropCount ? b.dropCount[0] + Math.floor(rnd() * (b.dropCount[1] - b.dropCount[0] + 1)) : 1;
  return [[I[d], count]];
}

// Which wall torch to place when clicking a face with normal (nx,nz).
export function wallTorchFor(nx, nz) {
  if (nz === 1) return B.wall_torch_n;   // attached to block north of it
  if (nz === -1) return B.wall_torch_s;
  if (nx === 1) return B.wall_torch_w;
  if (nx === -1) return B.wall_torch_e;
  return B.torch;
}

// Pick a facing variant for a block family given the player's yaw (front faces the player).
export function facingVariant(baseId, yaw) {
  const b = BLOCKS[baseId];
  if (!b.facingFamily) return baseId;
  // yaw 0 = looking toward -Z (north). Player looks north -> block faces south.
  const a = ((yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const q = Math.round(a / (Math.PI / 2)) % 4; // 0 north, 1 west, 2 south, 3 east (yaw increases to the left)
  const faceIdx = [1, 2, 0, 3][q]; // index into [n, s, e, w] variants: facing toward player
  return baseId + faceIdx;
}

export function logVariant(baseId, axis) {
  if (BLOCKS[baseId].tag !== 'log' || BLOCKS[baseId].axis !== 'y') return baseId;
  if (axis === 'x') return baseId + 1;
  if (axis === 'z') return baseId + 2;
  return baseId;
}
