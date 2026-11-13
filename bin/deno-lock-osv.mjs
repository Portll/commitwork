#!/usr/bin/env node
// usage: node bin/deno-lock-osv.mjs <repoDir> <outDir>
// exit 0: no deno.lock, or the record was written with no error
// exit 1: the record carries an error and no osv-scanner input was written
// exit 2: usage, or the record failed validation and the osv-scanner input was removed

import { readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { nowISO } from '../lib/clock.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';

export const TOOL = 'deno-lock-osv';
export const OSV_INPUT = 'deno-osv-scanner.json';
export const RECORD = 'deno-lock-osv.json';
const SUPPORTED = new Set(['3', '4', '5']);

export function splitNpmKey(key) {
  const bare = String(key).split('_')[0];
  const at = bare.lastIndexOf('@');
  if (at <= 0) return null;
  const name = bare.slice(0, at), version = bare.slice(at + 1);
  if (!name || !version) return null;
  return { name, version };
}

export function convertDenoLock(text) {
  let doc;
  try { doc = JSON.parse(text); } catch (e) { throw new Error(`deno.lock is not JSON: ${e.message}`); }
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('deno.lock is not an object');
  const lockVersion = doc.version == null ? null : String(doc.version);
  if (!SUPPORTED.has(lockVersion)) {
    throw new Error(`deno.lock version ${JSON.stringify(doc.version)} is not supported (3, 4, 5 are); refusing to guess its layout`);
  }
  const maps = lockVersion === '3' ? (doc.packages || {}) : doc;
  if (typeof maps !== 'object' || maps === null) throw new Error('deno.lock v3 `packages` is not an object');
  const npmMap = maps.npm == null ? {} : maps.npm;
  const jsrMap = maps.jsr == null ? {} : maps.jsr;
  if (typeof npmMap !== 'object' || Array.isArray(npmMap)) throw new Error('deno.lock `npm` is not an object');
  if (typeof jsrMap !== 'object' || Array.isArray(jsrMap)) throw new Error('deno.lock `jsr` is not an object');
  const seen = new Map();
  for (const key of Object.keys(npmMap)) {
    const p = splitNpmKey(key);
    if (!p) throw new Error(`deno.lock npm key ${JSON.stringify(key)} has no name@version`);
    seen.set(`${p.name}@${p.version}`, p);
  }
  const npm = [...seen.keys()].sort().map((k) => seen.get(k));
  const jsr = Object.keys(jsrMap).sort();
  const remote = doc.remote && typeof doc.remote === 'object' ? Object.keys(doc.remote).length : 0;
  return { lockVersion, npm, jsr, remote };
}

export function osvInput(npm) {
  return {
    results: [{
      source: { path: 'deno.lock', type: 'lockfile' },
      packages: npm.map(({ name, version }) => ({ package: { name, version, ecosystem: 'npm' } })),
    }],
  };
}

function main(argv) {
  const [repoArg, outArg] = argv;
  if (!repoArg || !outArg) { console.error('usage: deno-lock-osv.mjs <repoDir> <outDir>'); return 2; }
  const lock = join(resolve(repoArg), 'deno.lock');
  const outDir = resolve(outArg);
  const inputPath = join(outDir, OSV_INPUT);
  const recordPath = join(outDir, RECORD);
  rmSync(inputPath, { force: true });
  if (!existsSync(lock)) return 0;

  const record = { tool: TOOL, generatedAt: nowISO(), lockVersion: null, npm: 0, jsr: [], jsrUnscanned: true, remote: 0, written: null, error: null };
  let text = null;
  try { text = readFileSync(lock, 'utf8'); } catch (e) { record.error = `deno.lock unreadable: ${e.message}`; }
  if (text !== null) {
    try {
      const c = convertDenoLock(text);
      record.lockVersion = c.lockVersion; record.npm = c.npm.length; record.jsr = c.jsr; record.remote = c.remote;
      if (c.npm.length) {
        mkdirSync(outDir, { recursive: true });
        writeAtomic(inputPath, JSON.stringify(osvInput(c.npm), null, 1) + '\n');
        record.written = OSV_INPUT;
      }
    } catch (e) { record.error = e.message; }
  }
  writeAtomic(recordPath, JSON.stringify(record, null, 1) + '\n', { mkdir: true });
  const here = dirname(fileURLToPath(import.meta.url));
  const v = spawnSync(process.execPath, [join(here, 'validate-artifact.mjs'), TOOL, recordPath], { encoding: 'utf8' });
  if (v.status !== 0) {
    process.stderr.write(v.stderr || '');
    console.error(`${TOOL}: refusing to publish a record that does not match its schema`);
    rmSync(inputPath, { force: true });
    return 2;
  }
  if (record.error) { console.error(`${TOOL}: ${record.error} — deno.lock npm packages NOT scanned`); return 1; }
  console.error(`${TOOL}: deno.lock v${record.lockVersion}: ${record.npm} npm package(s) handed to osv-scanner; ${record.jsr.length} jsr and ${record.remote} remote module(s) unscanned (no OSV ecosystem)`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
