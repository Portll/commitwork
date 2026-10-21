#!/usr/bin/env node
// commitwork monitor — refresh the admin panel's Modernization tab (#modmap): re-copy the live
// map snapshot (map/data/<area slug>/index.html) into reports/<area out>/modernization.html,
// which otherwise silently rots after each map pipeline run.
//   node monitor/refresh-modmap.mjs        (MAP_DIR overrides the map location)
import { copyFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { registry, outDirFor, ambientArea } from './area.mjs';
const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');
const REG = registry();
const OUT = outDirFor(null, REG);
const MAP = process.env.MAP_DIR ? resolve(process.env.MAP_DIR) : join(CW, 'map', 'data', ambientArea(REG, OUT).slug);
const src = join(MAP, 'index.html');
const dst = join(OUT, 'modernization.html');
copyFileSync(src, dst);
console.log(`refresh-modmap: ${src} (${statSync(src).size}B) -> ${dst}`);
