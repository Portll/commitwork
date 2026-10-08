// node --test monitor/test/ — the --apply thirdParty refusal, asserted by EFFECT.
//
// This guard existed, was documented at length, and protected NOTHING for its whole life. Two
// independent defects, either sufficient alone, found 2026-08-24 by measuring rather than reading:
//
//   1. Nothing ever passed `thirdPartyAreas`. The only caller that can reach --apply is the CLI in
//      preflight-build.mjs itself, and it omitted the option, so the parameter sat at `null`.
//   2. The predicate read `repo.area`, which resolveRepos leaves UNSET for 100 of the 101 repos in
//      the third-party corpus — the area is derived from the NAME via areaSlugOf(). Fixing (1)
//      alone would have protected exactly one repo, and passed a test written against that one.
//
// FIXTURES ARE DELIBERATELY NON-BUILDABLE (rust: Cargo.toml has no build command in ECOSYSTEMS).
// The first draft of this file used a node fixture, which IS buildable — and because the synthetic
// repo name resolved to a null area, it missed the guard, fell through to the build branch, and ran
// npm install for real. A test for a code-execution guard must not be able to execute code. The
// non-buildable ecosystem makes that structural rather than a matter of getting the areas right.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { preflight, verdictFor } from '../preflight-build.mjs';
import { areaSlugOf, _setRegistry } from '../project-scope.mjs';
import { ownArea } from '../registry.mjs';

/** A repo that is BLIND (Cargo.toml declaring deps, no Cargo.lock) and NOT buildable. */
function blindRepo(name, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'pfguard-'));
  writeFileSync(join(dir, 'Cargo.toml'), '[package]\nname = "x"\n\n[dependencies]\nserde = "1"\n');
  return { repo: { name, path: dir, ...extra }, dir };
}
const cleanup = (d) => rmSync(d, { recursive: true, force: true });
const wrote = (dir) => readdirSync(dir).filter((f) => f !== 'Cargo.toml');

test('NOT VACUOUS: the fixture is blind and non-buildable', () => {
  // Without this every refusal below could pass by never entering the guard branch at all, and the
  // non-buildable property is what makes the whole file safe to run.
  const { repo, dir } = blindRepo('probe');
  try {
    const v = verdictFor(repo);
    assert.equal(v.state, 'blind', 'the suite is vacuous unless the fixture reaches the blind state');
    assert.equal(v.ecosystems.every((e) => !e.buildable), true,
      'a test for a code-execution guard must not be able to execute code');
  } finally { cleanup(dir); }
});

test('a declared thirdParty area is refused, and nothing is written', () => {
  const { repo, dir } = blindRepo('widget', { area: 'somecorp' });
  try {
    const out = preflight([repo], { apply: true, thirdPartyAreas: new Set(['somecorp']) });
    const r = out.repos[0];
    assert.ok(r.applyRefused, 'a repo in a declared thirdParty area must be REFUSED');
    assert.match(r.applyRefused.reason, /declared thirdParty/);
    assert.deepEqual(wrote(dir), [], 'refusal means no build ran');
    assert.ok(!r.built, 'a refused repo has no build ledger');
  } finally { cleanup(dir); }
});

test('THE 100-OF-101 CASE: .area unset, area derived from the NAME, still refused', () => {
  // The defect that would have survived a fix to the wiring alone. resolveRepos leaves .area unset
  // for the whole third-party corpus; the area comes from areaSlugOf(name).
  //
  // The corpus area is synthetic and injected, shaped like the real one: a thirdParty area listing an
  // owner_repo name in members[]. That name is not a valid slug, so only the declaration can resolve it.
  const NAME = 'Fixture-Org_fixture-repo';
  _setRegistry({ areas: [{ slug: 'fixture-corpus', thirdParty: true, members: [NAME] }], projects: [] });
  const { repo, dir } = blindRepo(NAME);              // NOTE: no `area` property at all
  try {
    assert.equal(ownArea(NAME), null, 'the name must not resolve on its own — the registry has to be what resolves it');
    const slug = areaSlugOf(NAME);
    assert.ok(slug, `areaSlugOf(${NAME}) must resolve, or this test proves nothing`);
    assert.equal(repo.area, undefined, 'the whole point: .area is unset');
    const out = preflight([repo], { apply: true, thirdPartyAreas: new Set([slug]) });
    const r = out.repos[0];
    assert.ok(r.applyRefused,
      'a repo whose area is derived from its name must be refused too — otherwise the guard covers '
      + '1 repo out of 101');
    assert.match(r.applyRefused.reason, new RegExp(slug));
    assert.deepEqual(wrote(dir), []);
  } finally { cleanup(dir); _setRegistry(undefined); }
});

test('FAIL CLOSED: --apply without a declared set refuses everything', () => {
  // The exact shape of the original defect: the option omitted. It used to mean "protect nothing".
  const { repo, dir } = blindRepo('anything');
  try {
    const out = preflight([repo], { apply: true });          // <- thirdPartyAreas omitted
    const r = out.repos[0];
    assert.ok(r.applyRefused, 'an undeclared --apply must refuse, not proceed');
    assert.match(r.applyRefused.reason, /without declaring which areas are thirdParty/);
    assert.deepEqual(wrote(dir), []);
  } finally { cleanup(dir); }
});

test('an EMPTY set is an explicit opt-out and is honoured', () => {
  // Guards the over-correction: fail-closed must not become a blanket refusal that makes --apply
  // useless while still passing every test above.
  const { repo, dir } = blindRepo('ourown', { area: 'ourown-area' });
  try {
    const out = preflight([repo], { apply: true, thirdPartyAreas: new Set() });
    assert.ok(!out.repos[0].applyRefused, 'an explicit empty set means "no third-party areas"');
  } finally { cleanup(dir); }
});

test('a repo OUTSIDE the declared areas is not refused — the guard discriminates', () => {
  const { repo, dir } = blindRepo('ourown', { area: 'ourown-area' });
  try {
    const out = preflight([repo], { apply: true, thirdPartyAreas: new Set(['someone-else']) });
    assert.ok(!out.repos[0].applyRefused);
  } finally { cleanup(dir); }
});

test('apply:false refuses nothing and writes nothing, declared or not', () => {
  const { repo, dir } = blindRepo('widget', { area: 'somecorp' });
  try {
    const out = preflight([repo], { apply: false });
    assert.ok(!out.repos[0].applyRefused, 'detect-only has nothing to refuse');
    assert.deepEqual(wrote(dir), []);
  } finally { cleanup(dir); }
});

test('THE WIRING: the CLI builds the set from the registry — the half that was missing', async () => {
  // Defect (1) was in the CALL SITE. A test that only exercised preflight() would pass against a
  // codebase where --apply protected nothing, because the function was always correct in isolation.
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const src = readFileSync(fileURLToPath(new URL('../preflight-build.mjs', import.meta.url)), 'utf8');
  const call = /preflight\(repos,\s*\{[^}]*\}\)/.exec(src);
  assert.ok(call, 'the CLI call site must be findable');
  assert.match(call[0], /thirdPartyAreas/,
    'the CLI must PASS thirdPartyAreas — without it the guard is inert however correct it looks');
  assert.match(src, /\.filter\(\(a\) => a\.thirdParty\)/,
    'and derive the set from the registry rather than hard-coding slugs');
});
