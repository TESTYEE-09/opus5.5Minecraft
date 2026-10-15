# Lumencraft

A voxel sandbox that runs in the browser. There is one persistent world and everyone who opens the page plays in it together.

**Play:** https://testyee-09.github.io/opus5.5Minecraft/

- Infinite procedural worlds: 14 biomes, rivers, caves, lush caves, ores, and **floating sky islands** with waterfalls and glowing crystal ore
- Shader-pack look out of the box: real-time sun and moon shadows, screen-space water reflections, bloom, god rays, smooth lighting, waving foliage, fog and an atmospheric sky with clouds, stars, shooting stars and auroras
- Survival: health, hunger, drowning, fall damage, mining tiers, crafting with a recipe book, furnaces, chests, farming, beds, TNT, bows
- Mobs: pigs, cows, sheep, chickens; zombies and skeletons that burn at dawn; spiders
- Flowing water and lava, falling sand, leaf decay, crop growth, weather with thunderstorms
- One shared world: no rooms or codes. A Cloudflare Durable Object (`server/`) stores every block edit, chest, furnace and player save, and relays messages; the longest-connected player's browser runs the simulation and hands it over when they leave
- If the server can't be reached you can play an offline copy of the world
- Character creator, generative piano soundtrack, recorded sound effects

Everything visual (textures, models, terrain) is generated in code. See `public/CREDITS.md` for audio credits.

```bash
npm install
npm run dev
```

World server: `cd server && npx wrangler@4.151.0 deploy` (wss://lumencraft-world.nomaeofficial.workers.dev/world).
