// World layout constants shared by the main thread and the workers.
export const CS = 16;              // chunk width (x and z)
export const H = 192;              // world height
export const SECTIONS = H / CS;    // vertical mesh sections per column
export const SEA = 62;             // sea level (top water block y)
export const COL_VOL = CS * CS * H;

export const idx = (x, y, z) => (y * CS + z) * CS + x;
export const colKey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);

export const DAY_TICKS = 24000;    // one in-game day
export const TICK_RATE = 20;       // server ticks per second

export const GAME_NAME = 'Lumencraft';
export const NET_PREFIX = 'lumencraft-o55-';
