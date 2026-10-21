// A stand-in cobolwork release for the pin tests: an npm-pack shaped tarball (package/...) built in
// process, and the pin that names it. The package's bin answers --version, capabilities --json and
// scan --out the way a packed cobolwork does, stating the commit its lib/revision.json carries.

import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';

export const COMMIT = 'c0b01'.padEnd(40, 'a');

function header(name, size, type, mode, link = '') {
  const h = Buffer.alloc(512);
  h.write(name, 0, 100, 'utf8');
  h.write(`${mode.toString(8).padStart(7, '0')}\0`, 100);
  h.write('0000000\0', 108);
  h.write('0000000\0', 116);
  h.write(`${size.toString(8).padStart(11, '0')}\0`, 124);
  h.write('00000000000\0', 136);
  h.fill(' ', 148, 156);
  h.write(type, 156);
  if (link) h.write(link, 157, 100, 'utf8');
  h.write('ustar\0', 257);
  h.write('00', 263);
  let sum = 0;
  for (const b of h) sum += b;
  h.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return h;
}

// entries: [{ path, data?, mode?, type?, link? }] -> gzip Buffer
export function tarball(entries) {
  const parts = [];
  for (const e of entries) {
    const type = e.type || '0';
    const data = Buffer.from(type === '0' ? (e.data ?? '') : '');
    parts.push(header(e.path, data.length, type, e.mode ?? 0o644, e.link));
    if (data.length) parts.push(data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  parts.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(parts));
}

export function capabilitiesFor({ version = '9.9.9', commit = COMMIT, tag = `v${version}` } = {}) {
  return {
    tool: 'cobolwork-capabilities', schemaVersion: 1, toolVersion: version,
    toolRevision: { commit, dirty: false, tag, from: 'release' },
    commands: {
      scan: { args: ['<path>'], options: ['--format', '--out'], documents: ['cobolwork'] },
      inventory: { args: ['<path>'], options: ['--out'], documents: ['cobolwork-inventory'] },
      explain: { args: ['<path>', '<fingerprint>'], options: [], documents: ['cobolwork-explain'] },
      gate: { args: ['<repo>'], options: ['--base', '--head', '--target', '--target-only'], documents: ['cobolwork-gate'] },
      capabilities: { args: [], options: ['--json'], documents: ['cobolwork-capabilities'] },
    },
    globalOptions: ['--help', '--version', '--rules-path'],
    identity: { version: 'cobolwork/v1' },
  };
}

// The package's bin: a script that states `caps` and writes a scan report naming its revision.
export function binScript(caps) {
  return [
    '#!/usr/bin/env node',
    "import { writeFileSync } from 'node:fs';",
    `const CAPS = ${JSON.stringify(caps)};`,
    'const a = process.argv.slice(2);',
    "if (a[0] === '--version') process.stdout.write(`${CAPS.toolVersion}\\n`);",
    "else if (a[0] === 'capabilities') process.stdout.write(JSON.stringify(CAPS));",
    "else if (a[0] === 'scan') writeFileSync(a[a.indexOf('--out') + 1], JSON.stringify({ tool: 'cobolwork', schemaVersion: 3,",
    "  summary: { toolVersion: CAPS.toolVersion, filesScanned: 1, nosrc: false, coverageIncomplete: false, toolRevision: CAPS.toolRevision }, findings: [] }));",
    "else { process.stderr.write(`cobolwork: unknown command ${a[0]}\\n`); process.exitCode = 2; }",
    '',
  ].join('\n');
}

// -> { tgz, sha256 } for a package at `version` whose revision.json says `stated` (default: commit).
export function packCobolwork({ version = '9.9.9', commit = COMMIT, stated = commit, caps = null, extra = [] } = {}) {
  const tag = `v${version}`;
  const entries = [
    { path: 'package/package.json', data: JSON.stringify({ name: 'cobolwork', version, type: 'module', bin: { cobolwork: 'bin/cobolwork.mjs' } }) },
    { path: 'package/lib/revision.json', data: `${JSON.stringify({ commit: stated, tag })}\n` },
    { path: 'package/bin/cobolwork.mjs', data: binScript(caps || capabilitiesFor({ version, commit, tag })), mode: 0o755 },
    ...extra,
  ];
  const tgz = tarball(entries);
  return { tgz, sha256: createHash('sha256').update(tgz).digest('hex') };
}

export function pinFor({ version = '9.9.9', commit = COMMIT, sha256 }) {
  const tag = `v${version}`, asset = `cobolwork-${version}.tgz`;
  return { repo: 'Portll/cobolwork', version, tag, asset, url: `https://github.com/Portll/cobolwork/releases/download/${tag}/${asset}`, sha256, commit };
}

// Writes a pin file into dir and returns its path.
export function writePins(dir, pin, name = 'tool-pins.json') {
  const p = join(dir, name);
  writeFileSync(p, `${JSON.stringify({ $schema: '../schema/tool-pins.schema.json', note: 'test pin', tools: { cobolwork: pin } }, null, 2)}\n`);
  return p;
}
