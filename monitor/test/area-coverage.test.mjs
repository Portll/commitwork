import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  readJsonState, reposOf, assess, scanSlices, newestPerRepo, declaredFor, coverageFor,
} from '../area-coverage.mjs';

const fixture = () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-area-cov-'));
  const dir = join(root, 'demo-area');
  mkdirSync(dir, { recursive: true });
  const slice = (id, generated, repos) => writeFileSync(
    join(dir, `rollup-sweep-${id}.json`),
    JSON.stringify({ sliceId: `sweep-${id}`, generated, repos: repos.map((name) => ({ name })) }),
  );
  return { root, dir, slice };
};

describe('readJsonState — absent, unreadable and unparseable are three different states', () => {
  test('ENOENT is absent, and ONLY ENOENT', () => {
    assert.deepEqual(readJsonState(join(tmpdir(), 'cw-nope-does-not-exist.json')), { ok: false, reason: 'absent' });
  });
  test('malformed JSON is unparseable, never an empty object', () => {
    const { dir } = fixture();
    const p = join(dir, 'bad.json');
    writeFileSync(p, '{not json');
    const st = readJsonState(p);
    assert.equal(st.ok, false);
    assert.equal(st.reason, 'unparseable');
  });
  test('a permission error is unreadable, not absent — a blind reader must not certify a clean area', () => {
    const { dir } = fixture();
    const p = join(dir, 'locked.json');
    writeFileSync(p, '{}');
    chmodSync(p, 0o000);
    const st = readJsonState(p);
    chmodSync(p, 0o600);
    if (process.getuid && process.getuid() === 0) return; // root reads anything; the assertion would be vacuous
    assert.equal(st.ok, false);
    assert.equal(st.reason, 'unreadable', 'reporting this as absent is how a check certifies what it never read');
  });
});

describe('reposOf — a rollup with no repos[] is UNKNOWN, never an empty area', () => {
  test('missing repos[] returns null so the caller cannot read it as zero', () => {
    assert.equal(reposOf({}), null);
    assert.equal(reposOf(null), null);
    assert.deepEqual(reposOf({ repos: [{ name: 'a' }, { name: 'b' }] }), ['a', 'b']);
  });
  test('nameless rows are dropped rather than becoming undefined entries', () => {
    assert.deepEqual(reposOf({ repos: [{ name: 'a' }, {}, { name: '' }] }), ['a']);
  });
});

describe('assess — the missing set is the finding', () => {
  test('THE MEASURED CASE: a one-repo slice of a six-repo area is partial', () => {
    const r = assess({
      observed: ['commitwork', 'commitwork-business', 'commitwork-remote', 'commitwork-research', 'commitwork-sidecar', 'commitwork-web'],
      covered: ['commitwork-remote'],
    });
    assert.equal(r.state, 'partial');
    assert.equal(r.missing.length, 5);
    assert.ok(r.missing.includes('commitwork'), 'the repo a reader would actually be asking about');
  });
  test('a slice holding every observed repo is complete', () => {
    assert.equal(assess({ observed: ['a', 'b'], covered: ['b', 'a'] }).state, 'complete');
  });
  test('a null covered set is undetermined, never complete', () => {
    assert.equal(assess({ observed: ['a'], covered: null }).state, 'undetermined');
  });
  test('an empty observed population is undetermined — zero over zero is not 100%', () => {
    const r = assess({ observed: [], covered: [] });
    assert.equal(r.state, 'undetermined');
    assert.match(r.reason, /nothing to be complete against/);
  });
  test('a repo in the rollup but outside the population is REPORTED, not absorbed', () => {
    const r = assess({ observed: ['a'], covered: ['a', 'stranger'] });
    assert.deepEqual(r.unexpected, ['stranger'],
      'widening the population to fit would destroy the only signal that it was computed wrong');
    assert.equal(r.state, 'complete');
  });
});

describe('newestPerRepo — where each repo was actually last seen', () => {
  test('the newer slice wins per repo, independently', () => {
    const n = newestPerRepo([
      { file: 'f1', sliceId: 's1', generated: '2026-09-01T00:00:00Z', repos: ['a', 'b'] },
      { file: 'f2', sliceId: 's2', generated: '2026-09-05T00:00:00Z', repos: ['b'] },
    ]);
    assert.equal(n.a.sliceId, 's1');
    assert.equal(n.b.sliceId, 's2', 'b was swept again; a was not');
  });
  test('a slice with no timestamp never displaces one that has a comparable timestamp', () => {
    const n = newestPerRepo([
      { file: 'f1', sliceId: 'dated', generated: '2026-09-05T00:00:00Z', repos: ['a'] },
      { file: 'f2', sliceId: 'undated', generated: null, repos: ['a'] },
    ]);
    assert.equal(n.a.sliceId, 'dated');
  });
});

describe('declaredFor — the registry names only part of an area', () => {
  test('reads the declared entries for one area', () => {
    const reg = { projects: [{ name: 'x', area: 'A' }, { name: 'y', area: 'B' }] };
    assert.deepEqual(declaredFor(reg, 'A'), ['x']);
  });
  test('a bare array registry is accepted too', () => {
    assert.deepEqual(declaredFor([{ name: 'x', area: 'A' }], 'A'), ['x']);
  });
});

describe('coverageFor — end to end over a real directory', () => {
  test('the partial case is detected and each absent repo carries where it was last seen', () => {
    const { root, dir, slice } = fixture();
    slice('20260101', '2026-01-01T00:00:00Z', ['alpha', 'beta', 'gamma']);
    slice('20260202', '2026-02-02T00:00:00Z', ['beta']);
    writeFileSync(join(dir, 'rollup.json'), JSON.stringify({ sliceId: 'sweep-20260202', repos: [{ name: 'beta' }] }));
    const r = coverageFor('demo-area', { root });
    assert.equal(r.state, 'partial');
    assert.deepEqual(r.missing, ['alpha', 'gamma']);
    assert.equal(r.perRepoNewest.alpha.sliceId, 'sweep-20260101');
    assert.equal(r.perRepoNewest.beta.sliceId, 'sweep-20260202');
    rmSync(root, { recursive: true, force: true });
  });

  test('a full sweep at the stable path reads complete', () => {
    const { root, dir, slice } = fixture();
    slice('20260101', '2026-01-01T00:00:00Z', ['alpha', 'beta']);
    writeFileSync(join(dir, 'rollup.json'), JSON.stringify({ sliceId: 'sweep-20260101', repos: [{ name: 'alpha' }, { name: 'beta' }] }));
    assert.equal(coverageFor('demo-area', { root }).state, 'complete');
    rmSync(root, { recursive: true, force: true });
  });

  test('a declared repo never yet swept still counts in the population', () => {
    const { root, dir, slice } = fixture();
    slice('20260101', '2026-01-01T00:00:00Z', ['alpha']);
    writeFileSync(join(dir, 'rollup.json'), JSON.stringify({ repos: [{ name: 'alpha' }] }));
    const reg = { projects: [{ name: 'never-swept', area: 'demo-area' }] };
    const r = coverageFor('demo-area', { root, registry: reg });
    assert.equal(r.state, 'partial');
    assert.deepEqual(r.missing, ['never-swept']);
    rmSync(root, { recursive: true, force: true });
  });

  test('an unparseable slice is excluded and NAMED, never counted as an empty sweep', () => {
    const { root, dir, slice } = fixture();
    slice('20260101', '2026-01-01T00:00:00Z', ['alpha']);
    writeFileSync(join(dir, 'rollup-sweep-20260202.json'), '{broken');
    writeFileSync(join(dir, 'rollup.json'), JSON.stringify({ repos: [{ name: 'alpha' }] }));
    const r = coverageFor('demo-area', { root });
    assert.equal(r.unreadableSlices.length, 1);
    assert.equal(r.unreadableSlices[0].reason, 'unparseable');
    assert.equal(r.state, 'complete', 'alpha is still covered; the broken slice is disclosed, not fatal');
    rmSync(root, { recursive: true, force: true });
  });

  test('an absent area directory is undetermined, not complete', () => {
    const { root } = fixture();
    assert.equal(coverageFor('no-such-area', { root }).state, 'undetermined');
    rmSync(root, { recursive: true, force: true });
  });
});
