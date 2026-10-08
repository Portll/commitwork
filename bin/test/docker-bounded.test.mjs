// A wedged Docker daemon BLOCKS `docker info` and `docker image inspect` rather than failing them.
// Measured 2026-09-15: four unbounded calls (cra, sandbox-effects, lockfile-synth, preflight-build)
// held the suite past the gate's 1800s timeout on every full run for two days, so no run printed a
// tally. Every synchronous docker call in tracked source carries a bound.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const tracked = (glob) => execFileSync('git', ['ls-files', glob], { cwd: REPO, encoding: 'utf8' }).split('\n').filter(Boolean);

export function unboundedJs(src) {
  const out = [];
  for (const m of src.matchAll(/\b(spawnSync|execFileSync|execSync)\(\s*(['"`])docker\2/g)) {
    let depth = 0, end = m.index + m[1].length;
    for (; end < src.length; end++) {
      if (src[end] === '(') depth++;
      else if (src[end] === ')' && --depth === 0) break;
    }
    if (!/\btimeout\b/.test(src.slice(m.index, end))) out.push(src.slice(0, m.index).split('\n').length);
  }
  return out;
}

export function unboundedSh(src) {
  const out = [];
  src.split('\n').forEach((line, i) => {
    const code = line.replace(/(^|\s)#.*$/, '');
    for (const m of code.matchAll(/(^|[;&|({]\s*|\bthen\s+|\bdo\s+)docker\s/g)) {
      if (!/\btimeout\s+\S+\s+$/.test(code.slice(0, m.index + m[1].length))) { out.push(i + 1); break; }
    }
  });
  return out;
}

test('POSITIVE CONTROL: both scanners flag an unbounded call and pass a bounded one', () => {
  assert.deepEqual(unboundedJs("x\nconst r = spawnSync('docker', ['info'], { stdio: 'ignore' });"), [2]);
  assert.deepEqual(unboundedJs("spawnSync('docker', ['info'], { stdio: 'ignore', timeout: 10_000 });"), []);
  assert.deepEqual(unboundedJs("execFileSync('docker', ['run', ...args, f(x)],\n  { encoding: 'utf8', timeout: 60_000 });"), [], 'a nested call inside the arguments does not end the scan early');
  assert.deepEqual(unboundedSh('docker info >/dev/null 2>&1 || skip "x"'), [1]);
  assert.deepEqual(unboundedSh('true || docker volume create v'), [1]);
  assert.deepEqual(unboundedSh('probe(){ docker run --rm img true; }'), [1]);
  assert.deepEqual(unboundedSh('timeout 10 docker info >/dev/null 2>&1 || skip "x"'), []);
  assert.deepEqual(unboundedSh('# docker info is described here'), []);
});

test('every synchronous docker call in tracked JavaScript carries a timeout', () => {
  const offenders = [];
  for (const f of tracked('*.mjs')) {
    let src;
    try { src = readFileSync(join(REPO, f), 'utf8'); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    if (f === 'bin/test/docker-bounded.test.mjs') continue;
    for (const line of unboundedJs(src)) offenders.push(`${f}:${line}`);
  }
  assert.deepEqual(offenders, []);
});

test('every docker command in tracked shell runs under timeout', () => {
  const offenders = [];
  for (const f of tracked('*.sh')) {
    let src;
    try { src = readFileSync(join(REPO, f), 'utf8'); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    for (const line of unboundedSh(src)) offenders.push(`${f}:${line}`);
  }
  assert.deepEqual(offenders, []);
});
