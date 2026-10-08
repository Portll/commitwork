// The supported Node.js floor. package.json `engines.node` is the only declaration; the CLI's
// refusal, `doctor` and bin/test/node-floor.test.mjs all read it from there.
//
// The floor is a minor, not a bare major: monitor/archive-container.mjs imports zlib's zstd
// functions (22.15) and bin/taxonomy-db.mjs passes DatabaseSync a `timeout` (22.18), which an older
// 22.x ignores without saying so.

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_JSON = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');

function parseVersion(text) {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/.exec(String(text).trim());
  return m ? [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)] : null;
}

/** The declared floor as { range, version: [major, minor, patch], text }. Throws when it cannot be read. */
export function declaredFloor(pkgPath = PACKAGE_JSON) {
  let pkg;
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')); }
  catch (e) { throw new Error(`cannot read the Node.js floor from ${pkgPath}: ${e.code || e.message}`); }
  const range = pkg?.engines?.node;
  const m = typeof range === 'string' ? /^>=\s*(\S+)$/.exec(range.trim()) : null;
  const version = m && parseVersion(m[1]);
  if (!version) throw new Error(`${pkgPath} engines.node is ${JSON.stringify(range)}; only ">=X.Y.Z" is understood`);
  return { range: range.trim(), version, text: version.join('.') };
}

/** Whether `version` (default: this process) meets the declared floor. */
export function nodeFloorCheck(version = process.versions.node, pkgPath = PACKAGE_JSON) {
  const floor = declaredFloor(pkgPath);
  const have = parseVersion(version);
  if (!have) throw new Error(`cannot parse the running Node.js version ${JSON.stringify(version)}`);
  let cmp = 0;
  for (let i = 0; i < 3 && cmp === 0; i++) cmp = Math.sign(have[i] - floor.version[i]);
  const ok = cmp >= 0;
  return {
    ok, floor: floor.text, range: floor.range, version: have.join('.'),
    message: ok ? `Node.js ${have.join('.')} meets the declared floor (${floor.range})`
      : `Node.js ${have.join('.')} is below the supported floor ${floor.text} (package.json engines.node ${floor.range}). Install Node.js ${floor.text} or a later maintained release and re-run.`,
  };
}
