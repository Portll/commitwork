import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ADMIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const lf = (s) => s.split('\r\n').join('\n');
const dir = (d) => readdirSync(join(ADMIN, d)).filter((n) => n.endsWith('.mjs')).sort().map((n) => `${d}/${n}`);

// contract: serve.mjs first, then every module it hosts
export const SERVER_FILES = () => ['serve.mjs', 'auth.mjs', 'rp-origin.mjs', ...dir('lib'), ...dir('routes')];

export function serverSource() {
  return SERVER_FILES().map((f) => lf(readFileSync(join(ADMIN, f), 'utf8'))).join('\n');
}
