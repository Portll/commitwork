// A vendored input path, held to the usual rules: ENOENT is the only absence, a corrupt file stops
// the run, writes are atomic, same inputs ⇒ byte-identical.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadIndex, distil, merge, serialise, write, idsFromReports, indexPath } from '../advisory-index.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'cw-advidx-'));

// GitHub's real shape, trimmed to what distil() reads.
const advisory = (over = {}) => ({
  ghsa_id: 'GHSA-73rr-hh4g-fpgx', cve_id: 'CVE-2026-24001', severity: 'low',
  cvss: { vector_string: null, score: null },
  cvss_severities: {
    cvss_v3: { vector_string: null, score: 0 },
    cvss_v4: { vector_string: 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:N/VI:N/VA:L/SC:N/SI:N/SA:N/E:U', score: 2.7 },
  },
  ...over,
});

describe('distil', () => {
  test('keeps CWE ids, and the names dedupe into a separate map', () => {
    const d = distil(advisory({ cwes: [{ cwe_id: 'CWE-400', name: 'Uncontrolled Resource Consumption' }] }));
    assert.deepEqual(d.entry.cwe, ['CWE-400']);
    assert.deepEqual(d.names, { 'CWE-400': 'Uncontrolled Resource Consumption' });
  });

  test('no CWE means no cwe key — never an empty array posing as a classification', () => {
    assert.equal('cwe' in distil(advisory({ cwes: [] })).entry, false);
  });

  test('keeps the v4 SCORE — the one thing we cannot compute ourselves', () => {
    const d = distil(advisory());
    assert.equal(d.id, 'GHSA-73rr-hh4g-fpgx');
    assert.equal(d.entry.s4, 2.7);
    assert.equal(d.entry.label, 'low');
    assert.equal(d.entry.cve, 'CVE-2026-24001');
  });

  test('a null vector is omitted, never stored as a zero score', () => {
    // GitHub sends {vector_string: null, score: 0}; storing that 0 publishes a fabricated NONE
    const d = distil(advisory());
    assert.equal('v3' in d.entry, false);
    assert.equal('s3' in d.entry, false);
  });

  test('an advisory GitHub cannot score is still indexed — asked-and-got-nothing is not never-asked', () => {
    const d = distil(advisory({ ghsa_id: 'GHSA-h6ch-v84p-w6p9', cve_id: null, severity: 'high',
      cvss_severities: { cvss_v3: { vector_string: null, score: 0 }, cvss_v4: { vector_string: null, score: 0 } } }));
    assert.deepEqual(d.entry, { label: 'high' });
  });

  test('junk in yields null, not a half-built entry', () => {
    for (const x of [null, undefined, {}, { severity: 'high' }]) assert.equal(distil(x), null);
  });
});

describe('loadIndex — ENOENT is the only absence', () => {
  test('a missing index is empty, because it has legitimately not been built', () => {
    assert.deepEqual(loadIndex(join(dir(), 'nope.json')).advisories, {});
  });

  test('a CORRUPT index throws — a broken CVSS source must not read as "no CVSS exists"', () => {
    const d = dir();
    const p = join(d, 'bad.json');
    writeFileSync(p, '{ this is not json');
    assert.throws(() => loadIndex(p), 'a parse failure silently became an empty index');
  });

  test('a well-formed file with no advisories map is refused, not coerced', () => {
    const d = dir();
    const p = join(d, 'shape.json');
    writeFileSync(p, JSON.stringify({ source: 'x' }));
    assert.throws(() => loadIndex(p), /no advisories map/);
  });

  test('the path is env-overridable and read at CALL time', () => {
    const before = process.env.CW_ADVISORY_INDEX;
    process.env.CW_ADVISORY_INDEX = '/tmp/cw-set-after-import.json';
    assert.equal(indexPath(), '/tmp/cw-set-after-import.json');
    if (before === undefined) delete process.env.CW_ADVISORY_INDEX; else process.env.CW_ADVISORY_INDEX = before;
  });
});

describe('merge and write', () => {
  test('merge adds without dropping what was already known', () => {
    const existing = { advisories: { 'GHSA-a': { label: 'high' } } };
    const m = merge(existing, { 'GHSA-b': { label: 'low' } });
    assert.deepEqual(Object.keys(m.advisories).sort(), ['GHSA-a', 'GHSA-b']);
    assert.equal(m.count, 2);
  });

  test('a GitHub re-fetch must not drop the v2 that only NVD has', () => {
    // GitHub carries no v2 at all, so a whole-entry replace would silently undo --fill-nvd
    const existing = { advisories: { 'GHSA-a': { label: 'high', v2: 'AV:N/AC:M/Au:N/C:N/I:P/A:N', s2: 4.3 } } };
    const m = merge(existing, { 'GHSA-a': { label: 'high', cwe: ['CWE-400'] } });
    assert.equal(m.advisories['GHSA-a'].s2, 4.3, 'NVD-sourced v2 was lost on re-fetch');
    assert.deepEqual(m.advisories['GHSA-a'].cwe, ['CWE-400']);
  });

  test('a re-fetch overwrites its own id and only its own', () => {
    const m = merge({ advisories: { 'GHSA-a': { label: 'high' }, 'GHSA-b': { label: 'low' } } },
      { 'GHSA-a': { label: 'critical' } });
    assert.equal(m.advisories['GHSA-a'].label, 'critical');
    assert.equal(m.advisories['GHSA-b'].label, 'low');
  });

  test('same inputs ⇒ byte-identical output, whatever order they arrived in', () => {
    process.env.CW_NOW = '2026-08-23T00:00:00.000Z';
    const a = serialise(merge({ advisories: {} }, { 'GHSA-z': { label: 'low' }, 'GHSA-a': { label: 'high' } }));
    const b = serialise(merge({ advisories: {} }, { 'GHSA-a': { label: 'high' }, 'GHSA-z': { label: 'low' } }));
    assert.equal(a, b);
    assert.ok(a.indexOf('GHSA-a') < a.indexOf('GHSA-z'), 'ids must be sorted');
    delete process.env.CW_NOW;
  });

  test('the write is atomic — no .tmp is left behind', () => {
    const d = dir();
    const p = join(d, 'idx.json');
    write(merge({ advisories: {} }, { 'GHSA-a': { label: 'high' } }), p);
    assert.ok(existsSync(p));
    assert.deepEqual(readdirSync(d), ['idx.json'], 'a tmp file survived the write');
    assert.equal(loadIndex(p).advisories['GHSA-a'].label, 'high');
  });
});

describe('idsFromReports', () => {
  const seed = () => {
    const d = dir();
    mkdirSync(join(d, 'batch', 'repo'), { recursive: true });
    writeFileSync(join(d, 'batch', 'repo', 'vendor-scan.json'),
      JSON.stringify({ findings: [{ id: 'GHSA-b' }, { id: 'GHSA-a' }, { id: 'GHSA-a' }] }));
    return d;
  };

  test('ids are deduped and sorted — the seed must be deterministic', () => {
    assert.deepEqual(idsFromReports(seed()), ['GHSA-a', 'GHSA-b']);
  });

  test('an unreadable artifact does not zero the whole scan', () => {
    const d = seed();
    mkdirSync(join(d, 'batch', 'broken'), { recursive: true });
    writeFileSync(join(d, 'batch', 'broken', 'vendor-scan.json'), 'not json');
    assert.deepEqual(idsFromReports(d), ['GHSA-a', 'GHSA-b'], 'one bad artifact hid the good ones');
  });

  test('a missing reports dir is empty, not a throw', () => {
    assert.deepEqual(idsFromReports(join(dir(), 'absent')), []);
  });
});

test('the checked-in index, if present, is well formed and self-consistent', () => {
  const p = indexPath();
  if (!existsSync(p)) return;   // not yet built is a legitimate state
  const j = JSON.parse(readFileSync(p, 'utf8'));
  assert.equal(j.count, Object.keys(j.advisories).length, 'count drifted from the map it counts');
  for (const [id, e] of Object.entries(j.advisories)) {
    assert.match(id, /^GHSA-/, `${id} is not a GHSA id`);
    if (e.s4 !== undefined) assert.ok(e.v4, `${id} has a v4 score with no v4 vector`);
    if (e.s3 !== undefined) assert.ok(e.v3, `${id} has a v3 score with no v3 vector`);
    if (e.s2 !== undefined) assert.ok(e.v2, `${id} has a v2 score with no v2 vector`);
    for (const k of Object.keys(e)) {
      assert.ok(['label', 'cve', 'cwe', 'nvd', 'v2', 's2', 'v3', 's3', 'v4', 's4'].includes(k), `${id} carries undeclared field ${k}`);
    }
  }
});
