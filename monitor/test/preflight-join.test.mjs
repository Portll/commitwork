// osv-scanner exits 128 "no package sources found" for two states that are not the same thing:
// brave-browser declares no dependencies at all, RxJava declares them in build.gradle and has no
// lockfile. The lane cannot tell them apart, so its reason is "artifact present but empty" — true,
// and useless to a reader deciding whether anything is wrong. preflight knows which; this joins them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readPreflight, preflightClause } from '../preflight-join.mjs';

const pf = (repos, generated = '2026-08-23T12:00:00Z') => ({ generated, ecosystemsVersion: 2, repos });
const BATCH = '2026-08-23T10:00:00Z'; // the batch started BEFORE that preflight — the normal case

test('a blind repo gets preflight\'s own wording, verbatim — one phrasing per fact', () => {
  const c = preflightClause(pf([{ name: 'rx', state: 'blind', ecosystems: [{ eco: 'jvm-gradle', state: 'blind', why: 'Gradle resolves dynamically; with no lockfile the dependency set is invisible' }] }]), 'rx', BATCH);
  assert.match(c, /preflight: blind — jvm-gradle: Gradle resolves dynamically/);
  assert.ok(!c.includes('from an earlier run'));
});

test('no-surface and blind are distinguishable in the reason — the whole point of the join', () => {
  const p = pf([
    { name: 'brave', state: 'no-surface', note: 'package.json declares no dependencies of any kind' },
    { name: 'rx', state: 'blind', ecosystems: [{ eco: 'jvm-gradle', state: 'blind', why: 'no lockfile' }] },
  ]);
  const a = preflightClause(p, 'brave', BATCH), b = preflightClause(p, 'rx', BATCH);
  assert.match(a, /no-surface/); assert.match(b, /blind/);
  assert.notEqual(a, b, 'two repos whose lane said the identical thing must now read differently');
});

test('subtree-only is carried through — a repo scanned only below its root', () => {
  const c = preflightClause(pf([{ name: 'x', state: 'subtree-only', note: 'no dependency manifest at the root, but 3 subtree(s) below it declare one' }]), 'x', BATCH);
  assert.match(c, /subtree-only — no dependency manifest at the root/);
});

test('an OK repo that scanned nothing is flagged as worth investigating, not explained away', () => {
  const c = preflightClause(pf([{ name: 'x', state: 'ok', ecosystems: [{ eco: 'node', state: 'ok' }] }]), 'x', BATCH);
  assert.match(c, /NOT explained by the tree's shape/,
    'preflight says the tree IS resolved and the lane still indexed nothing — the join must not paper over that');
});

test('a preflight generated BEFORE the batch says so — a CLI scan between sweeps reads a stale verdict', () => {
  const stale = pf([{ name: 'x', state: 'blind', ecosystems: [{ eco: 'node', state: 'blind', why: 'no lockfile' }] }], '2026-08-20T00:00:00Z');
  const c = preflightClause(stale, 'x', BATCH);
  assert.match(c, /from an earlier run, 2026-08-20T00:00:00Z/,
    'a repo that gained a lockfile since would otherwise still read blind, with nothing to say the verdict was old');
});

test('absent, unreadable, and not-listed are three distinct unknowns — never silence, never a state', () => {
  assert.match(preflightClause(null, 'x', BATCH), /unknown \(no preflight\.json/);
  assert.match(preflightClause({ unreadable: 'preflight.json unreadable (EACCES)', repos: [] }, 'x', BATCH), /unknown \(preflight\.json unreadable \(EACCES\)\)/);
  assert.match(preflightClause(pf([{ name: 'other', state: 'ok' }]), 'x', BATCH), /unknown \(this repo carries no preflight verdict\)/);
  for (const c of [preflightClause(null, 'x'), preflightClause(pf([]), 'x')]) {
    assert.ok(c.length > 10 && /unknown/.test(c), 'every branch returns a clause; none returns an empty string that would vanish into the reason');
  }
});

test('readPreflight: ENOENT is null, a corrupt file is an unreadable prober — fail closed', () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-pfj-'));
  assert.equal(readPreflight(d), null);
  writeFileSync(join(d, 'preflight.json'), '{ truncated');
  const r = readPreflight(d);
  assert.match(r.unreadable, /unreadable/);
  assert.match(preflightClause(r, 'x', BATCH), /unknown/,
    'an unreadable prober must not silently become "no verdict for this repo", which reads like a scoping fact');
});
