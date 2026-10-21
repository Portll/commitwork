// The bridge's advise: the document from a cobolwork whose capabilities list it, and unavailable, with
// the reason, from one without advise or writing a schemaVersion the bridge does not read. The stored
// document is `cobolwork advise` over cobolwork's bench/cases/001-argv-reaches-os-command, its
// catalogue trimmed to the entries the items cite.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ADVICE_SCHEMA, adviceProblem, advise } from '../cobolwork-bridge.mjs';

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const STUB = join(FIXTURES, 'cobolwork-advice-stub.mjs');
const STORED = join(FIXTURES, 'cobolwork-advice-001.json');
const TMP = mkdtempSync(join(tmpdir(), 'cw-advice-bridge-'));
after(() => rmSync(TMP, { recursive: true, force: true }));

const envFor = (extra = {}) => ({ ...process.env, CW_COBOLWORK_BIN: STUB, CW_TEST_ADVICE_CAPS: 'advise', CW_TEST_ADVICE_DOC: '', CW_TEST_ADVICE_ARGV: '', ...extra });
const stored = () => JSON.parse(readFileSync(STORED, 'utf8'));

test('a cobolwork whose capabilities list cobolwork-advice 1 gives the document, run with --format json and the ironwork named', async () => {
  const argv = join(TMP, 'argv.jsonl');
  const r = await advise(join(TMP, 'tree'), { ironwork: '/opt/ironwork/bin/ironwork', env: envFor({ CW_TEST_ADVICE_ARGV: argv }) });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.doc.tool, 'cobolwork-advice');
  assert.equal(r.doc.schemaVersion, ADVICE_SCHEMA);
  assert.deepEqual(r.doc.summary.ordered, stored().summary.ordered);
  assert.deepEqual(JSON.parse(readFileSync(argv, 'utf8')), ['advise', join(TMP, 'tree'), '--format', 'json', '--ironwork', '/opt/ironwork/bin/ironwork']);
});

test('the cobolwork option runs that cobolwork in place of the resolved one', async () => {
  const r = await advise(TMP, { cobolwork: STUB, env: { ...envFor(), CW_COBOLWORK_BIN: join(TMP, 'no-such-cobolwork') } });
  assert.equal(r.ok, true, r.reason);
});

test('a cobolwork without advise, as the pinned 0.9.0 is, is unavailable and says so', async () => {
  const r = await advise(TMP, { env: envFor({ CW_TEST_ADVICE_CAPS: 'none' }) });
  assert.equal(r.ok, false);
  assert.equal(r.unavailable, 'cobolwork 0.9.0 has no advise command: its capabilities list no cobolwork-advice document');
  assert.equal(r.reason, r.unavailable);
});

test('an advice schemaVersion the bridge does not read is unavailable, whether the capabilities or the document states it', async () => {
  const caps = await advise(TMP, { env: envFor({ CW_TEST_ADVICE_CAPS: 'v2' }) });
  assert.equal(caps.ok, false);
  assert.match(caps.unavailable, /writes cobolwork-advice schemaVersion 2, and commitwork reads only 1/);
  const v2 = join(TMP, 'advice-v2.json');
  writeFileSync(v2, JSON.stringify({ ...stored(), schemaVersion: 2 }));
  const doc = await advise(TMP, { env: envFor({ CW_TEST_ADVICE_DOC: v2 }) });
  assert.equal(doc.ok, false);
  assert.match(doc.unavailable, /the advice document's schemaVersion is 2, and commitwork reads only 1/);
});

test('an advise that cannot take the ironwork asked for, or no cobolwork at all, is unavailable too', async () => {
  const noIronwork = await advise(TMP, { ironwork: '/opt/ironwork', env: envFor({ CW_TEST_ADVICE_CAPS: 'no-ironwork' }) });
  assert.match(noIronwork.unavailable, /is not used for advice: its advise takes no --ironwork/);
  const none = await advise(TMP, { env: envFor({ CW_COBOLWORK_BIN: join(TMP, 'no-such-cobolwork') }) });
  assert.equal(none.ok, false);
  assert.equal(typeof none.unavailable, 'string');
});

test('a document whose order does not name its items is not read', () => {
  const d = stored();
  assert.equal(adviceProblem(d), null);
  assert.match(adviceProblem({ ...d, tool: 'cobolwork' }), /expected a cobolwork-advice document/);
  assert.match(adviceProblem({ ...d, summary: { ...d.summary, ordered: [...d.summary.ordered, 'finding:x:y'] } }), /names "finding:x:y", which is not an item/);
  assert.match(adviceProblem({ ...d, summary: { ...d.summary, ordered: d.summary.ordered.slice(1) } }), /lists 6 ids for 7 items/);
  assert.match(adviceProblem({ ...d, unmeasured: undefined }), /no items, summary.ordered or unmeasured/);
  assert.match(adviceProblem({ ...d, items: [{ ...d.items[0], kind: 'hint' }, ...d.items.slice(1)] }), /item "finding:argv-or-env-to-os-command:[0-9a-f]{32}" is not a version 1 advice item/);
  assert.match(adviceProblem({ ...d, items: [{ ...d.items[0], sev: 'severe' }, ...d.items.slice(1)] }), /its kind, sev or fingerprint is not one version 1 writes/);
});
