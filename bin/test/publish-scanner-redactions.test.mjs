// publish-scanner-redactions: the scanner name leaves the PAGE, stays in the REGISTER, and the
// redaction refuses rather than silently lapsing when the text under it moves.
//
// A redaction is only worth what it still catches. The failure mode this guards is not "the code
// is wrong today" but "someone rewords the example in six months and the redaction quietly stops
// matching, with every test still green and a vendor's name back on a public page". So the
// no-longer-matches case is asserted as a THROW, and the shipped map is asserted to still apply.
//
// Since edition 18 the register itself names no scanner: the tracked register ships publicly, so
// the originals moved to the private prose overlay and the shipped map had nothing left to redact.
// Its absence is how this module says "no redactions". The mechanism is still exercised, against a
// roster built from live register text, so no assertion here passes vacuously on an empty map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadScannerRedactions, redactScannersForPublish, scannerRedactionPath }
  from '../../lib/publish-scanner-redactions.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REG = resolve(REPO, 'monitor', 'failure-taxonomy.json');
const load = () => JSON.parse(readFileSync(REG, 'utf8'));
const tmp = (name, body) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-scanred-'));
  const p = join(d, name);
  writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body));
  return p;
};
const fixture = () => {
  const c = load().classes.find((x) => (x.example || '').length > 80);
  const roster = { note: 'fixture', redactions: [{ class: c.id, field: 'example', from: c.example.slice(0, 40), to: 'a redacted phrase' }] };
  return { CW_PUBLISH_SCANNER_REDACTIONS: tmp('fixture.json', roster) };
};

// The catalogue names each approach by its tool. A first word that is ordinary English or an
// ecosystem is not a vendor's name, so it is not held against the register.
const NOT_A_TOOL = new Set(['npm', 'Socket', 'Gate', 'Agent', 'Commit', 'Model', 'Log', 'Tree', 'Actions',
  'Dependency', 'OWASP', 'OpenSSF', 'WordPress', 'deno', 'clippy', 'rustfmt', 'Webshells', 'Bearer']);
const scannerNames = () => {
  const { approaches } = JSON.parse(readFileSync(resolve(REPO, 'monitor', 'approach-taxonomy.json'), 'utf8'));
  const firstWords = approaches.map((a) => a.name || '').filter((n) => n.includes(' — ')).map((n) => n.split(' — ')[0].split(' ')[0]);
  return [...new Set(firstWords)].filter((n) => !NOT_A_TOOL.has(n));
};

test('the register names no catalogued scanner in any field a page renders', () => {
  const names = scannerNames();
  assert.ok(names.length > 20, `the catalogue yielded ${names.length} tool names; this check would pass vacuously`);
  const offenders = [];
  for (const c of redactScannersForPublish(load()).classes) {
    for (const field of ['name', 'description', 'predicate', 'example', 'analogy', 'scoreBasis']) {
      for (const n of names) {
        if (new RegExp(`(^|[^\\w-])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`).test(c[field] || '')) offenders.push(`${c.id}.${field}: ${n}`);
      }
    }
  }
  assert.deepEqual(offenders, [], `name the scanner's kind instead, and keep the original in the private prose overlay:\n  ${offenders.join('\n  ')}`);
});

test('every redaction still matches its record, and the published text carries the replacement', () => {
  const env = fixture();
  const out = redactScannersForPublish(load(), env);
  const byId = new Map(out.classes.map((c) => [c.id, c]));
  for (const r of loadScannerRedactions(env)) {
    const text = byId.get(r.class)[r.field];
    assert.ok(!text.includes(r.from), `${r.class}: the original still appears after redaction`);
    assert.ok(text.includes(r.to), `${r.class}: the replacement is missing`);
  }
});

test('THE DRIFT GUARD: a redaction whose text was reworded THROWS, it does not quietly no-op', () => {
  const env = fixture();
  const doc = load();
  const r = loadScannerRedactions(env)[0];
  const cls = doc.classes.find((c) => c.id === r.class);
  cls[r.field] = 'reworded text that no longer contains the redacted phrase';
  assert.throws(() => redactScannersForPublish(doc, env), /no longer occurs/);
});

test('every SHIPPED redaction names a class that exists — a typo redacts nothing, silently', () => {
  const ids = new Set(load().classes.map((c) => c.id));
  for (const r of loadScannerRedactions()) {
    assert.ok(ids.has(r.class), `${r.class}: named in the map, absent from the registry — this redaction is dead`);
  }
});

test('a registry that lacks the record is a SKIP, not a throw — fixtures and CW_TAXONOMY_JSON overrides', () => {
  const p = tmp('m.json', { note: 'x', redactions: [{ class: 'ZZ99', field: 'example', from: 'a', to: 'b' }] });
  const doc = load();
  assert.doesNotThrow(() => redactScannersForPublish(doc, { CW_PUBLISH_SCANNER_REDACTIONS: p }));
});

test('a record NOT named is untouched — the same scanner stays where it names our own defect', () => {
  const env = fixture();
  const before = load();
  const after = redactScannersForPublish(before, env);
  const named = new Set(loadScannerRedactions(env).map((r) => r.class));
  for (const c of after.classes) {
    if (named.has(c.id)) continue;
    const was = before.classes.find((x) => x.id === c.id);
    assert.equal(c.example, was.example, `${c.id}: an unnamed record was modified`);
  }
});

test('the REGISTER is not mutated — redaction returns a new document', () => {
  const env = fixture();
  const doc = load();
  const r = loadScannerRedactions(env)[0];
  const original = doc.classes.find((c) => c.id === r.class)[r.field];
  redactScannersForPublish(doc, env);
  assert.equal(doc.classes.find((c) => c.id === r.class)[r.field], original,
    'the register lost the original text — redaction is supposed to return a new document');
});

test('a malformed map FAILS CLOSED rather than publishing unredacted', () => {
  const bad = tmp('bad.json', '{ not json');
  assert.throws(() => loadScannerRedactions({ CW_PUBLISH_SCANNER_REDACTIONS: bad }), /not valid JSON/);
  const offSchema = tmp('off.json', { note: 'x', redactions: [{ class: 'C12' }] });
  assert.throws(() => loadScannerRedactions({ CW_PUBLISH_SCANNER_REDACTIONS: offSchema }), /does not satisfy its schema/);
});

test('a missing map is legitimately absent (ENOENT), not an error', () => {
  const gone = join(tmpdir(), 'cw-scanred-absent', 'nope.json');
  assert.deepEqual(loadScannerRedactions({ CW_PUBLISH_SCANNER_REDACTIONS: gone }), []);
});

test('the env override is read at CALL time, not at module load', () => {
  const p = tmp('late.json', { note: 'x', redactions: [{ class: 'C12', field: 'example', from: 'GuardDog', to: 'X' }] });
  assert.equal(scannerRedactionPath({ CW_PUBLISH_SCANNER_REDACTIONS: p }), p);
  assert.equal(loadScannerRedactions({ CW_PUBLISH_SCANNER_REDACTIONS: p })[0].to, 'X');
});

// fact: the redaction is wired into EVERY generator that renders this register, not just one /
// bin/taxonomy-web.mjs and bin/taxonomy-render.mjs both read monitor/failure-taxonomy.json and
// write a public page. Wiring only the first left GuardDog x3 and Prowler x1 standing on
// docsite/imported/taxonomy-reference.html — which lib/publish-redactions.mjs already names as the
// page a hand-redaction was silently reverted on. One generator is never the whole boundary.
test('NO GENERATED PUBLIC PAGE CARRIES A REDACTED PHRASE', async () => {
  // TRACKED pages only, and that scoping is load-bearing rather than convenient. docsite/pages
  // also holds untracked flat build outputs that two earlier commits each untracked once; they are
  // local cruft, they do not ship, and scanning them reported a leak on a file no reader can reach.
  // What publishes is what git carries, so git is the authority on the population.
  const { execFileSync } = await import('node:child_process');
  const pages = execFileSync('git', ['ls-files', 'docsite'], { cwd: REPO, encoding: 'utf8' })
    .split('\n').filter((f) => f.endsWith('.html')).map((f) => resolve(REPO, f));
  assert.ok(pages.length > 0, 'no tracked pages found — this check would pass vacuously');
  // Plus every non-draft page of the private docsite root (lib/docsite-roots.mjs): a hidden private
  // document ships with the bundle too, so git is the authority only for the public half.
  const { loadManifest, pagePath, sourcePath, isPrivateDoc } = await import('../../lib/docsite-manifest.mjs');
  for (const d of loadManifest().docs) {
    if (isPrivateDoc(d) && d.state !== 'draft') pages.push(d.kind === 'imported' ? sourcePath(d) : pagePath(d));
  }
  const redactions = loadScannerRedactions();
  const offenders = [];
  for (const p of pages) {
    const body = readFileSync(p, 'utf8');
    for (const r of redactions) if (body.includes(r.from)) offenders.push(`${p}: ${JSON.stringify(r.from)}`);
  }
  assert.deepEqual(offenders, [], `a published page still names the scanner:\n  ${offenders.join('\n  ')}`);
});
