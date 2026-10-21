// bin/resolve-sha.mjs — the map that survives a history rewrite. An absent or unreadable map must
// never answer "no rewrites happened": a dead sha and an unmapped sha are different facts.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { commitMapPathFor } from '../../monitor/store-paths.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TOOL = join(CW, 'bin', 'resolve-sha.mjs');
const MAP = commitMapPathFor(CW);
// fact: the real map indexes private history, so it lives in the sidecar and a public checkout skips these
const needsMap = () => {
  try { statSync(MAP); return {}; } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    return { skip: `commit map absent at ${MAP} (ENOENT) — it is sidecar-resident, so a public checkout cannot run this` };
  }
};
const HEAD_SHA = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: CW, encoding: 'utf8' }).trim();

const run = (args, env = {}) => {
  try {
    return { code: 0, out: execFileSync('node', [TOOL, ...args], { cwd: CW, encoding: 'utf8', env: { ...process.env, ...env } }) };
  } catch (e) {
    return { code: e.status ?? 1, out: `${e.stdout || ''}${e.stderr || ''}` };
  }
};

describe('the private map resolves a rewritten sha', needsMap(), () => {
  test('the shipped map is well-formed — 40-hex pairs, no self-maps', () => {
    const lines = readFileSync(MAP, 'utf8').split('\n').filter((l) => l && !l.startsWith('#'));
    assert.ok(lines.length > 100, `expected a substantial map, got ${lines.length} entries`);
    for (const l of lines) {
      const [o, n] = l.trim().split(/\s+/);
      assert.match(o, /^[0-9a-f]{40}$/, `bad old sha: ${l}`);
      assert.match(n, /^[0-9a-f]{40}$/, `bad new sha: ${l}`);
      assert.notEqual(o, n, 'a self-map is noise — an unrewritten commit does not belong in the map');
    }
  });

  test('a rewritten sha resolves, by prefix — docs cite 7 chars, the map holds 40', () => {
    const first = readFileSync(MAP, 'utf8').split('\n').find((l) => l && !l.startsWith('#'));
    const [oldSha, newSha] = first.trim().split(/\s+/);
    const short = run([oldSha.slice(0, 7)]);
    assert.equal(short.code, 0);
    assert.match(short.out, new RegExp(newSha), 'a 7-char prefix must resolve to the full new sha');
  });

  test('every NEW sha in the map is actually reachable from HEAD', () => {
    // a mapping to something unreachable looks authoritative and still dead-ends
    const lines = readFileSync(MAP, 'utf8').split('\n').filter((l) => l && !l.startsWith('#')).slice(0, 40);
    assert.equal(lines.length, 40, `the map must hold at least the 40 this samples, got ${lines.length} — a short map makes the reachability check below vacuous`);
    for (const l of lines) {
      const n = l.trim().split(/\s+/)[1];
      const ok = (() => {
        try { execFileSync('git', ['merge-base', '--is-ancestor', n, 'HEAD'], { cwd: CW, stdio: 'ignore' }); return true; }
        catch { return false; }
      })();
      assert.ok(ok, `${n} is in the map but is not an ancestor of HEAD`);
    }
  });
});

describe('absence is stated, never answered as "nothing was rewritten"', () => {
  test('a MISSING map refuses with exit 2 rather than reporting no rewrites', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-sha-'));
    try {
      const r = run(['badc0de'], { CW_COMMIT_MAP: join(d, 'nope.txt') });
      assert.equal(r.code, 2, 'a missing map must refuse, not answer');
      assert.match(r.out, /no commit map/i);
      assert.match(r.out, /--rebuild/, 'and it must say how to recover while recovery is still possible');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('a sha that is neither mapped nor an object says UNKNOWN, not "fine"', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-sha-'));
    const p = join(d, 'map.txt');
    writeFileSync(p, '# header only\n');
    const r = run(['deadbeefdeadbeef'], { CW_COMMIT_MAP: p });
    rmSync(d, { recursive: true, force: true });
    assert.equal(r.code, 0);
    assert.match(r.out, /UNKNOWN/, 'an unmappable sha must not read as resolvable');
    assert.match(r.out, /gc/i, 'and it should name why it might be unrecoverable');
  });

  test('an EMPTY but present map still refuses to imply a sha is current', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-sha-'));
    const p = join(d, 'empty.txt');
    writeFileSync(p, '# header only\n');
    try {
      const r = run([HEAD_SHA().slice(0, 7)], { CW_COMMIT_MAP: p });
      assert.equal(r.code, 0);
      // HEAD is an object in every clone, so the honest answer is "resolves as-is", never a mapping.
      assert.ok(!/->/.test(r.out), 'an empty map must not invent a mapping');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe('--scan reports and does not rewrite', () => {
  test('a doc citing a dead sha is REPORTED, and the file is left byte-identical', () => {
    const d = mkdtempSync(join(tmpdir(), 'cw-sha-'));
    const f = join(d, 'doc.md');
    const map = join(d, 'map.txt');
    const oldSha = '1234567' + '0'.repeat(33);
    writeFileSync(map, `# synthetic\n${oldSha} ${HEAD_SHA()}\n`);
    const body = `see commit ${oldSha.slice(0, 7)} for the fix\n`;
    writeFileSync(f, body);
    try {
      const r = run(['--scan', f], { CW_COMMIT_MAP: map });
      assert.equal(r.code, 0);
      assert.match(r.out, /dead sha\(s\) resolved/);
      assert.equal(readFileSync(f, 'utf8'), body,
        'scan must never edit prose — a silently rewritten quotation stops matching what it quotes');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
