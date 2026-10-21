// publish-scanner-redactions: the scanner name leaves the PAGE, stays in the REGISTER, and the
// redaction refuses rather than silently lapsing when the text under it moves.
//
// A redaction is only worth what it still catches. The failure mode this guards is not "the code
// is wrong today" but "someone rewords the example in six months and the redaction quietly stops
// matching, with every test still green and a vendor's name back on a public page". So the
// no-longer-matches case is asserted as a THROW, and the shipped map is asserted to still apply.
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

test('the roster is non-empty — an empty map would make every assertion below vacuous', () => {
  assert.ok(loadScannerRedactions().length > 0, 'no redactions configured; nothing here proves anything');
});

test('every shipped redaction still matches its record, and the published text carries the replacement', () => {
  const out = redactScannersForPublish(load());
  const byId = new Map(out.classes.map((c) => [c.id, c]));
  for (const r of loadScannerRedactions()) {
    const text = byId.get(r.class)[r.field];
    assert.ok(!text.includes(r.from), `${r.class}: the original still appears after redaction`);
    assert.ok(text.includes(r.to), `${r.class}: the replacement is missing`);
  }
});

test('THE DRIFT GUARD: a redaction whose text was reworded THROWS, it does not quietly no-op', () => {
  const doc = load();
  const r = loadScannerRedactions()[0];
  const cls = doc.classes.find((c) => c.id === r.class);
  cls[r.field] = 'reworded text that no longer contains the redacted phrase';
  assert.throws(() => redactScannersForPublish(doc), /no longer occurs/);
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
  const before = load();
  const after = redactScannersForPublish(before);
  const named = new Set(loadScannerRedactions().map((r) => r.class));
  for (const c of after.classes) {
    if (named.has(c.id)) continue;
    const was = before.classes.find((x) => x.id === c.id);
    assert.equal(c.example, was.example, `${c.id}: an unnamed record was modified`);
  }
});

test('the REGISTER is not mutated — redaction returns a new document', () => {
  const doc = load();
  const r = loadScannerRedactions()[0];
  const original = doc.classes.find((c) => c.id === r.class)[r.field];
  redactScannersForPublish(doc);
  assert.equal(doc.classes.find((c) => c.id === r.class)[r.field], original,
    'the private register lost the real name — it is supposed to keep it');
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
