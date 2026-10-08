// taxonomy-web.test.mjs — the edition lineage has to account for exactly the classes the registry
// holds, and the page has to say so when it does not.
//
// The reconciliation tests run on FIXTURES so the real registry's state decides nothing, except in
// the three tests that name it: those assert the shipped lineage and the shipped page agree with
// the shipped registry, which is the pair that goes stale in practice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { reconcile } from '../taxonomy-web.mjs';
import { redactionMapPath } from '../../lib/publish-redactions.mjs';
import { privateRoot, docsiteRoot } from '../../lib/docsite-roots.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const CLI = resolve(REPO, 'bin', 'taxonomy-web.mjs');
const REGISTRY = resolve(REPO, 'monitor', 'failure-taxonomy.json');
const LINEAGE = resolve(REPO, 'monitor', 'taxonomy-editions.json');
// A draft document: the generator writes it into the private docsite root (lib/docsite-roots.mjs).
const OUT_PAGE = resolve(privateRoot() || docsiteRoot(), 'imported', 'taxonomy.html');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const cls = (id) => ({ id, name: id, machine: `f.${id}`, layer: 'IMPL', description: 'd', example: 'e', analogy: 'a', closure: 0, gain: 0 });
const regOf = (ids) => ({
  version: 1, families: [{ roman: 'I', key: 'f', prefix: ids[0][0], name: 'F', proposition: 'p' , test: 'A fixture membership test, long enough to satisfy the schema minimum length for a family test.'}],
  classes: ids.map(cls), scaleBounds: { closureMin: 0, closureMax: 4, gainMin: 0, gainMax: 4, fullyClosed: 4 },
});
const linOf = (editions) => ({ note: 'n', measurement: 'm', editions });

test('a lineage that accounts for every class reconciles with no errors', () => {
  const r = reconcile(regOf(['C1', 'C2', 'C3']), linOf([
    { version: 1, changes: [{ kind: 'classes', ids: ['C1', 'C2'] }], countAfter: 2 },
    { version: 2, changes: [{ kind: 'classes', ids: ['C3'] }], countAfter: 3 },
  ]));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.unattributed, []);
  assert.equal(r.byClass.get('C3'), 2);
  assert.equal(r.editions[1].computedAfter, 3);
});

test('a class no edition claims is UNATTRIBUTED, not absorbed into the newest edition', () => {
  const r = reconcile(regOf(['C1', 'C2']), linOf([
    { version: 1, changes: [{ kind: 'classes', ids: ['C1'] }], countAfter: 1 },
  ]));
  assert.deepEqual(r.errors, []);                 // incomplete is not malformed
  assert.deepEqual(r.unattributed, ['C2']);
  assert.equal(r.byClass.has('C2'), false);        // and it is not silently given to v1
});

test('an edition claiming a class the registry does not hold is an error', () => {
  const r = reconcile(regOf(['C1']), linOf([
    { version: 1, changes: [{ kind: 'classes', ids: ['C1', 'C9'] }], countAfter: 2 },
  ]));
  assert.equal(r.errors.some((e) => e.includes('C9')), true);
});

test('a class claimed by two editions is an error, and the first claim stands', () => {
  const r = reconcile(regOf(['C1']), linOf([
    { version: 1, changes: [{ kind: 'classes', ids: ['C1'] }], countAfter: 1 },
    { version: 2, changes: [{ kind: 'classes', ids: ['C1'] }], countAfter: 2 },
  ]));
  assert.equal(r.errors.some((e) => e.includes('more than one edition')), true);
  assert.equal(r.byClass.get('C1'), 1);
});

test('a declared countAfter that disagrees with the ids beneath it is an error', () => {
  const r = reconcile(regOf(['C1', 'C2']), linOf([
    { version: 1, changes: [{ kind: 'classes', ids: ['C1', 'C2'] }], countAfter: 63 },
  ]));
  assert.equal(r.errors.some((e) => e.includes('countAfter 63')), true);
});

test('editions are reconciled in version order however the file lists them', () => {
  const r = reconcile(regOf(['C1', 'C2']), linOf([
    { version: 2, changes: [{ kind: 'classes', ids: ['C2'] }], countAfter: 2 },
    { version: 1, changes: [{ kind: 'classes', ids: ['C1'] }], countAfter: 1 },
  ]));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.editions.map((e) => e.version), [1, 2]);
});

// ---- the CLI, on fixtures

const FIXTURE_MANIFEST = { docs: [{ slug: 'taxonomy', urlPath: 'taxonomy', title: 'The failure taxonomy', kind: 'imported', state: 'published' }] };

function sandbox() {
  return mkdtempSync(join(tmpdir(), 'cw-taxweb-'));
}
function run(dir, { registry, lineage, manifest = FIXTURE_MANIFEST, args = [] }) {
  writeFileSync(join(dir, 'reg.json'), JSON.stringify(registry));
  writeFileSync(join(dir, 'lin.json'), JSON.stringify(lineage));
  writeFileSync(join(dir, 'manifest.json'), JSON.stringify(manifest));
  // The real publish map is a private store; these runs test rendering, so a synthetic one stands in.
  writeFileSync(join(dir, 'publish-map.json'), JSON.stringify({ note: 'fixture', map: { 'fixture-client': 'client-z' } }));
  return spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    env: { ...process.env, CW_TAXONOMY_JSON: join(dir, 'reg.json'), CW_TAXONOMY_EDITIONS: join(dir, 'lin.json'), CW_DOCSITE_MANIFEST: join(dir, 'manifest.json'), CW_PUBLISH_REDACTIONS: join(dir, 'publish-map.json'), CW_NOW: '2026-01-01' },
  });
}

// THE LINEAGE HERE IS DELIBERATELY WELL-FORMED. It carries every key the edition schema requires
// and is rejected purely on what it CLAIMS — an edition attributing class C9 to a registry that
// holds only C1. The fixture used to omit label/date/form/artifact/headline/body, and passed for
// the wrong reason once bin/taxonomy-web.mjs began validating its inputs at load: the run still
// exited 2 and still wrote nothing, but on a SCHEMA error raised before reconciliation ever ran, so
// the assertion that the failure names C9 was the only thing that noticed the difference.
//
// Structural validity and semantic reconciliation are separate guards and each needs its own
// unambiguous case, or a regression in one hides behind the other's failure.
test('reconciliation errors write NOTHING and exit 2', () => {
  const dir = sandbox();
  const out = join(dir, 'out.html');
  const r = run(dir, {
    registry: regOf(['C1']),
    lineage: linOf([{
      version: 1, label: 'one', date: '2026-01-01', form: 'f', artifact: 'a', headline: 'h', body: 'b',
      changes: [{ kind: 'classes', ids: ['C1', 'C9'] }], countAfter: 2,
    }]),
    args: ['--out', out],
  });
  assert.equal(r.status, 2);
  assert.equal(existsSync(out), false, 'a page must not be written from a lineage that cannot be true');
  assert.match(r.stderr, /C9/, 'the failure must name the class that cannot be true, not merely fail');
  assert.doesNotMatch(r.stderr, /does not satisfy schema/,
    'this case must reach reconciliation — if it is rejected structurally it stops testing reconciliation at all');
});

test('a structurally invalid lineage is refused at load, before any reconciliation is attempted', () => {
  // The other half of the split above, and the case that had no test of its own: bin/taxonomy-web.mjs
  // validates its inputs against schema/taxonomy-editions.schema.json at load. Without this, the
  // only thing exercising that validation was the fixture above failing for the wrong reason.
  const dir = sandbox();
  const out = join(dir, 'out.html');
  const r = run(dir, {
    registry: regOf(['C1']),
    lineage: linOf([{ version: 1, changes: [{ kind: 'classes', ids: ['C1'] }], countAfter: 1 }]),
    args: ['--out', out],
  });
  assert.equal(r.status, 2);
  assert.equal(existsSync(out), false);
  assert.match(r.stderr, /does not satisfy schema/);
  assert.match(r.stderr, /required key/, 'the refusal must say WHICH key is missing, not merely that something is');
});

test('an unattributed class renders as its own state and fails --check without blocking the page', () => {
  const dir = sandbox();
  const out = join(dir, 'out.html');
  const fixture = {
    registry: regOf(['C1', 'C2']),
    lineage: linOf([{ version: 1, label: 'one', date: '2026-01-01', form: 'f', artifact: 'a', headline: 'h', body: 'b', changes: [{ kind: 'classes', ids: ['C1'] }], countAfter: 1 }]),
  };
  const checked = run(dir, { ...fixture, args: ['--check'] });
  assert.equal(checked.status, 1, '--check must not pass while the lineage is incomplete');

  const r = run(dir, { ...fixture, args: ['--out', out] });
  assert.equal(r.status, 0);
  const html = readFileSync(out, 'utf8');
  assert.match(html, /not attributed to any edition/);
  assert.match(html, /data-ed="none"/, 'the unattributed class carries its own filter value');
  assert.match(r.stderr, /attributed to no edition: C2/);
});

test('a manifest with no docs array fails closed rather than rendering navless', () => {
  const dir = sandbox();
  const r = run(dir, {
    registry: regOf(['C1']),
    lineage: linOf([{ version: 1, label: 'one', date: 'd', form: 'f', artifact: 'a', headline: 'h', body: 'b', changes: [{ kind: 'classes', ids: ['C1'] }], countAfter: 1 }]),
    manifest: { note: 'no docs key' },
    args: ['--out', join(dir, 'out.html')],
  });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /docs array/);
  assert.equal(existsSync(join(dir, 'out.html')), false);
});

test('the page is byte-identical across runs when CW_NOW is pinned', () => {
  const dir = sandbox();
  const fixture = {
    registry: regOf(['C1', 'C2']),
    lineage: linOf([{ version: 1, label: 'one', date: 'd', form: 'f', artifact: 'a', headline: 'h', body: 'b', changes: [{ kind: 'classes', ids: ['C1', 'C2'] }], countAfter: 2 }]),
  };
  const a = join(dir, 'a.html'), b = join(dir, 'b.html');
  run(dir, { ...fixture, args: ['--out', a] });
  run(dir, { ...fixture, args: ['--out', b] });
  assert.equal(readFileSync(a, 'utf8'), readFileSync(b, 'utf8'));
});

test('registry text is escaped, so a class name cannot inject markup', () => {
  const dir = sandbox();
  const registry = regOf(['C1']);
  registry.classes[0].name = '<script>alert(1)</script>';
  registry.classes[0].description = 'a "quoted" & <angled> description';
  const out = join(dir, 'out.html');
  run(dir, {
    registry,
    lineage: linOf([{ version: 1, label: 'one', date: 'd', form: 'f', artifact: 'a', headline: 'h', body: 'b', changes: [{ kind: 'classes', ids: ['C1'] }], countAfter: 1 }]),
    args: ['--out', out],
  });
  const html = readFileSync(out, 'utf8');
  // nosemgrep: javascript.lang.security.audit.unknown-value-with-script-tag.unknown-value-with-script-tag -- test string asserting or planting markup, never written to a served page
  assert.equal(html.includes('<script>alert(1)</script>'), false);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&amp;/);
});

// ---- the shipped registry, lineage and page

test('the shipped lineage accounts for exactly the shipped registry', () => {
  const r = reconcile(readJson(REGISTRY), readJson(LINEAGE));
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.unattributed, [], 'every class in the registry names the edition it arrived in');
});

test('the lineage id lists are the ones the tracked source documents define', () => {
  // The declared arrays are checked against the documents rather than trusted: v2 and v3 define
  // their new classes in tables, and those files are tracked, so the claim stays checkable after
  // the gitignored renders that witnessed v4-v6 are gone.
  const lineage = readJson(LINEAGE);
  const idsOf = (v) => lineage.editions.find((e) => e.version === v).changes.filter((c) => c.kind === 'classes').flatMap((c) => c.ids);
  const rows = (t) => [...t.matchAll(/^\|\s*`?([CARPMGDWKE]\d{1,2})`?\s*\|/gm)].map((m) => m[1]);
  const between = (t, a, b) => { const i = t.indexOf(a); const j = t.indexOf(b, i); return t.slice(i, j < 0 ? t.length : j); };
  const doc = (f) => readFileSync(resolve(REPO, 'monitor', f), 'utf8');

  const v2doc = doc('FAILURE-TAXONOMY-v2.md');
  const v2 = new Set(rows(between(v2doc, '## 4. ░ Shade 3', '## 7. Bucket index')));
  assert.deepEqual(new Set(idsOf(2)), v2, 'v2 must claim exactly the rows of its three shade tables');

  const v3doc = doc('FAILURE-TAXONOMY-v3.md');
  const v3 = new Set(rows(between(v3doc, '### 10.2 The classes', '### 10.3')));
  assert.deepEqual(new Set(idsOf(3)), v3, 'v3 must claim exactly the rows of its family VIII table');

  // v1's own file has since been amended: two classes a later pass introduced were back-added to
  // its family tables. The reconciliation is that the difference is claimed by SOME edition, never
  // that the file matches v1 as published.
  const v1rows = new Set(doc('FAILURE-TAXONOMY.md').split(/^## /m).filter((s) => /^Family/.test(s)).flatMap((s) => rows('\n' + s)));
  const v1 = new Set(idsOf(1));
  for (const id of v1) assert.equal(v1rows.has(id), true, `${id} is claimed for v1 and is not in v1's family tables`);
  // EMPTY backAdded IS THE PASS, and the loop below is deliberately unguarded because of it.
  // bin/pattern-scan.mjs's test-loop-unguarded detector reports this line as a loop over a derived
  // collection with no non-empty assertion, and it is right about the shape and wrong about the
  // remedy: an assertion that backAdded is non-empty would require v1's tables to contain ids v1
  // never claimed — the test would demand the defect it exists to catch. Triaged 2026-08-27; leave
  // it unguarded, and if you are here because the detector flagged it, that is why.
  const backAdded = [...v1rows].filter((id) => !v1.has(id));
  const claimedLater = new Set(lineage.editions.filter((e) => e.version > 1).flatMap((e) => e.changes.filter((c) => c.kind === 'classes').flatMap((c) => c.ids)));
  for (const id of backAdded) assert.equal(claimedLater.has(id), true, `${id} sits in v1's tables and no later edition claims it`);
});

const committedPageSkip = () => {
  if (!existsSync(OUT_PAGE)) return `${OUT_PAGE} not present (a private draft page; a public checkout has none)`;
  const map = redactionMapPath();
  return existsSync(map) ? false : `private publish map absent at ${map} — the committed page cannot be regenerated without it`;
};

test('the committed page is the one the current registry and lineage produce', { skip: committedPageSkip() }, () => {
  const shipped = readFileSync(OUT_PAGE, 'utf8');
  const stamp = shipped.match(/Generated (\d{4}-\d{2}-\d{2})/);
  assert.notEqual(stamp, null, 'the page must carry its generation stamp');
  const dir = mkdtempSync(join(tmpdir(), 'cw-taxweb-live-'));
  const out = join(dir, 'live.html');
  const r = spawnSync(process.execPath, [CLI, '--out', out, '--quiet'], { encoding: 'utf8', env: { ...process.env, CW_NOW: stamp[1] } });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readFileSync(out, 'utf8'), shipped,
    `${OUT_PAGE} is generated: regenerate it with \`node bin/taxonomy-web.mjs\` rather than editing it, and commit the result to the sidecar with the registry change that moved it`);
});
