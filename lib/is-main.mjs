// lib/is-main.mjs — was this module run directly, or imported?

import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// fix: realpath BOTH sides. import.meta.url is symlink-resolved, argv[1] is the path as typed, so
// comparing them is false through any link and the CLI block silently never runs — exit 0, no output.
const real = (p) => { try { return realpathSync(p); } catch { return p; } };

export const isMainModule = (metaUrl) =>
  !!process.argv[1] && real(process.argv[1]) === real(fileURLToPath(metaUrl));
