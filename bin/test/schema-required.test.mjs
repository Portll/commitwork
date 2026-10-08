import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateAgainstSchema } from '../../monitor/registry.mjs';
import { main as bareCatchRatchet, EXIT } from '../bare-catch-ratchet.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INVENTORY = resolve(REPO, 'monitor', 'registry-inventory.json');
const inv = () => JSON.parse(readFileSync(INVENTORY, 'utf8'));
const CLOSED_SCHEMA_DEBT = [
  'bin/bare-catch-baseline.json',
  'bin/comment-baseline.json',
  'cra/controls.json',
  'lib/memory-layer-contract.json',
  'monitor/approach-taxonomy.json',
  'monitor/config-correctness-ledger.example.json',
  'monitor/detector-bindings.json',
  'monitor/disregarded-warnings.example.json',
  'monitor/gate-exemptions.example.json',
  'monitor/image-acceptance.example.json',
  'monitor/ingest-quarantine.json',
  'monitor/owner-map.example.json',
  'monitor/perf-profiles.json',
  'monitor/program-worklist.example.json',
  'monitor/ruleId-cwe.json',
  'monitor/schema/status-enum.json',
  'monitor/taxonomy-substrates.json',
];

// The same discovery the inventory was built from. Kept here so the two are compared, not shared:
// a helper both sides imported would agree with itself by construction.
const IN_SCOPE = /^(monitor|bin|cra|admin|lib|manifests)\//;
const OUT = /(test|fixture|node_modules)/;
function tracked() {
  return execFileSync('git', ['-C', REPO, 'ls-files', '*.json'], { encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\n').filter(Boolean)
    .filter((f) => IN_SCOPE.test(f) && !OUT.test(f) && !f.endsWith('.schema.json'));
}

test('the inventory covers every tracked JSON in scope — a new one fails until it is classified', () => {
  const listed = new Set(inv().entries.map((e) => e.path));
  const missing = tracked().filter((f) => !listed.has(f));
  assert.deepEqual(missing, [],
    'these are tracked and unclassified: add each to monitor/registry-inventory.json with a kind, '
    + 'and either a schema or a reason there is none. A registry nobody decided about is the '
    + 'default this gate exists to remove.');
});

// A row naming a path git ITSELF declares machine-local — a private store, a downloaded feed cache —
// cannot be judged from a checkout that does not have it. That row is UNDETERMINED: not stale, and
// not verified either. Measured 2026-09-04 on a fresh Windows checkout: monitor/private does not
// exist at all (it is a sidecar symlink target) and monitor/data/{kev,epss}.json are downloaded on
// demand, so four rows failed this gate while describing nothing wrong — an unknown published as a
// finding, which this repo treats as the more expensive direction of error.
//
// The test is `git check-ignore`, not "the file is missing, so let it go". The repo has DECLARED
// these paths machine-local; a path with no such declaration that is absent is still stale and still
// fails. Undetermined rows are named out loud and counted, never folded into the pass.
const ignoredByGit = (rel) => {
  try {
    execFileSync('git', ['-C', REPO, 'check-ignore', '-q', '--', rel], { stdio: 'ignore' });
    return true;
  } catch { return false; }
};

test('the inventory names no file that does not exist', (t) => {
  const entries = inv().entries;
  const absent = entries.filter((e) => !existsSync(resolve(REPO, e.path)));
  const stale = absent.filter((e) => !ignoredByGit(e.path)).map((e) => e.path);
  const undetermined = absent.filter((e) => ignoredByGit(e.path)).map((e) => e.path);

  if (undetermined.length) {
    t.diagnostic(`UNDETERMINED (${undetermined.length}/${entries.length}): gitignored machine-local `
      + 'paths absent from this checkout. This gate cannot tell a live row from a stale one for '
      + `these, and is NOT asserting they are fine: ${undetermined.join(', ')}`);
  }
  // Grey must not swallow the whole population: if nothing was actually verified, a green here
  // would mean "checked nothing" while reading as "all rows are live".
  assert.ok(entries.length - undetermined.length > 0,
    'every row is undetermined — this gate verified nothing and must not report clean');

  assert.deepEqual(stale, [], 'inventory rows for files that are gone — the row describes nothing');
});

test('the inventory names each path exactly once', () => {
  const seen = new Set();
  const duplicates = [];
  for (const entry of inv().entries) {
    if (seen.has(entry.path)) duplicates.push(entry.path);
    seen.add(entry.path);
  }
  assert.deepEqual(duplicates, [],
    'duplicate rows inflate schema counts and let two declarations disagree about one registry');
});

test('every entry declares a known kind', () => {
  const doc = inv();
  const kinds = new Set(Object.keys(doc.kinds));
  const bad = doc.entries.filter((e) => !kinds.has(e.kind)).map((e) => `${e.path}: ${e.kind}`);
  assert.deepEqual(bad, [], `kind must be one of ${[...kinds].join(', ')}`);
});

test('every named schema file exists', () => {
  const bad = inv().entries.filter((e) => e.schema && !existsSync(resolve(REPO, e.schema)))
    .map((e) => `${e.path} -> ${e.schema}`);
  assert.deepEqual(bad, []);
});

// Only runtime bindings must fit this validator's supported JSON Schema subset.
test('a schema the validator applies must be one the validator can evaluate', () => {
  const bad = [];
  for (const e of inv().entries) {
    if (e.binding !== 'validator') continue;
    const r = validateAgainstSchema({}, { path: resolve(REPO, e.schema) });
    const unsupported = r.errors.filter((m) => m.includes('is not implemented here'));
    if (unsupported.length) bad.push(`${e.schema}: ${unsupported[0]}`);
  }
  assert.deepEqual(bad, []);
});

test('every schema-backed entry says what applies it', () => {
  const doc = inv();
  const kinds = new Set(Object.keys(doc.bindings));
  const bad = doc.entries.filter((e) => e.schema && !kinds.has(e.binding)).map((e) => e.path);
  assert.deepEqual(bad, [],
    'a schema file is not a check. Declare binding: validator | mirrored | none — "it has a schema" '
    + 'and "its shape is enforced" are different claims and only one of them gates anything.');
});

test('an entry with no schema states a reason', () => {
  const bare = inv().entries
    .filter((e) => !e.schema && (typeof e.reason !== 'string' || e.reason.trim().length < 20))
    .map((e) => e.path);
  assert.deepEqual(bare, [],
    'no schema and no reason is an omission wearing the shape of a decision');
});

test('the schemas that closed the non-feed debt validate their documents and reject structural drift', () => {
  const byPath = new Map(inv().entries.map((e) => [e.path, e]));
  const failures = [];
  for (const path of CLOSED_SCHEMA_DEBT) {
    const entry = byPath.get(path);
    if (!entry?.schema) { failures.push(`${path}: inventory has no schema`); continue; }
    const data = JSON.parse(readFileSync(resolve(REPO, path), 'utf8'));
    const schemaPath = resolve(REPO, entry.schema);
    const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));

    const valid = validateAgainstSchema(data, { path: schemaPath });
    if (valid.errors.length) failures.push(`${path}: shipped document rejected: ${valid.errors[0]}`);

    const required = schema.required?.[0];
    if (!required) failures.push(`${entry.schema}: no required top-level property to enforce`);
    else {
      const missing = structuredClone(data);
      delete missing[required];
      if (validateAgainstSchema(missing, { path: schemaPath }).errors.length === 0) {
        failures.push(`${entry.schema}: accepted document missing required '${required}'`);
      }
    }

    const extra = structuredClone(data);
    extra.__schema_probe__ = true;
    if (validateAgainstSchema(extra, { path: schemaPath }).errors.length === 0) {
      failures.push(`${entry.schema}: accepted an unexpected top-level property`);
    }
  }
  assert.deepEqual(failures, [],
    'closing schema debt means an evaluable constraint, not merely a JSON file named schema');
});

// The bare-catch schema was drawn from the seed row alone, so the ratchet's first --rekey wrote a
// baseline its own schema rejects. The binding is `mirrored` — the writer never consults the schema —
// so the writer is driven through every journal action it has, and what it wrote is validated.
test('the bare-catch baseline schema admits every journal row its writer emits, and no other', () => {
  const root = mkdtempSync(join(tmpdir(), 'cw-bcr-schema-'));
  const baseline = join(root, 'baseline.json');
  const saved = { ...process.env };
  const sink = { write() {} };
  const run = (...args) => bareCatchRatchet(['node', 'bare-catch-ratchet.mjs', ...args], sink, sink);
  const catches = (...names) => names.map((n) => `function ${n}() { try { x(); } catch { } }\n`).join('');
  try {
    Object.assign(process.env, { CW_BARE_CATCH_ROOT: root, CW_BARE_CATCH_BASELINE: baseline, CW_NOW: '2026-09-26T00:00:00.000Z' });
    delete process.env.CW_BARE_CATCH_STRICT_CRITICAL;
    writeFileSync(join(root, 'a.mjs'), catches('f', 'g'));
    assert.equal(run('--seed'), EXIT.PASS);
    assert.equal(run('--seed', '--force'), EXIT.PASS);
    writeFileSync(join(root, 'a.mjs'), catches('g'));
    writeFileSync(join(root, 'b.mjs'), catches('f'));
    assert.equal(run('--rekey', 'a.mjs', 'b.mjs'), EXIT.PASS);
    writeFileSync(join(root, 'a.mjs'), catches('g', 'h'));
    assert.equal(run('--accept', '--reason', 'fixture: a deliberate best-effort catch'), EXIT.PASS);
    writeFileSync(join(root, 'a.mjs'), catches('g'));
    assert.equal(run('--tighten'), EXIT.PASS);

    const doc = JSON.parse(readFileSync(baseline, 'utf8'));
    assert.deepEqual(doc.journal.map((j) => j.action), ['seed', 'reseed', 'rekey', 'accept', 'tighten'],
      'precondition: every action the writer has was written');
    const schemaPath = resolve(REPO, inv().entries.find((e) => e.path === 'bin/bare-catch-baseline.json').schema);
    assert.deepEqual(validateAgainstSchema(doc, { path: schemaPath }).errors, []);
    doc.journal.push({ at: '2026-09-26T00:00:00.000Z', action: 'invented', total: 0, digest: '0' });
    assert.notEqual(validateAgainstSchema(doc, { path: schemaPath }).errors.length, 0,
      'a journal action no writer emits must still be refused');
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
    rmSync(root, { recursive: true, force: true });
  }
});

test('THE RATCHET: the count of schema-less non-feed entries may not rise', () => {
  // Keep this literal at zero; upstream feeds are the only schema-less class.
  const CEILING = 0;
  const doc = inv();
  const missing = doc.entries.filter((e) => !e.schema && e.kind !== 'feed');
  assert.ok(missing.length <= CEILING,
    `${missing.length} entries lack a schema, ceiling is ${CEILING}. Adding one is a decision to be `
    + `made, not a number to raise:\n  ${missing.map((e) => e.path).join('\n  ')}`);
  assert.equal(missing.length, CEILING,
    `${missing.length} lack a schema and the ceiling still says ${CEILING} — lower it to bank the `
    + 'improvement, or the next regression is invisible.');
});

test('feeds are the only kind allowed to go schema-less by class', () => {
  const doc = inv();
  const feedsWithout = doc.entries.filter((e) => e.kind === 'feed' && !e.schema).length;
  const feeds = doc.entries.filter((e) => e.kind === 'feed').length;
  assert.equal(feedsWithout, feeds, 'if a feed gains a schema, say so — the exemption is by class, and a class with an exception is not a class');
  assert.ok(feeds > 0, 'no feeds found — if the data/ lanes moved, drop this exemption rather than letting it pass vacuously');
});

test('the shipped registries actually validate against the schemas the inventory names', (t) => {
  // The end the inventory exists for: a named schema that the file fails is worse than none,
  // because the row says the shape is checked.
  const failures = [];
  const undetermined = [];
  let checked = 0;
  for (const e of inv().entries) {
    if (e.binding !== 'validator') continue;
    if (resolve(REPO, e.path).includes('issues.json')) continue;   // 6 MB store; covered by its own suite
    // Same distinction as the staleness gate above: a gitignored machine-local path that is not on
    // this box is unreadable, not invalid. An absent path with NO such declaration still falls
    // through to readFileSync and is reported as a failure, which is what it is.
    if (!existsSync(resolve(REPO, e.path)) && ignoredByGit(e.path)) { undetermined.push(e.path); continue; }
    let data;
    try { data = JSON.parse(readFileSync(resolve(REPO, e.path), 'utf8')); }
    catch (err) { failures.push(`${e.path}: unparseable (${err.message})`); continue; }
    const r = validateAgainstSchema(data, { path: resolve(REPO, e.schema) });
    checked += 1;
    if (r.errors.length) failures.push(`${e.path} vs ${e.schema}: ${r.errors[0]}`);
  }
  if (undetermined.length) {
    t.diagnostic(`UNDETERMINED (${undetermined.length}): gitignored and absent here, so their shape `
      + `was NOT checked by this run: ${undetermined.join(', ')}`);
  }
  assert.ok(checked > 0,
    'no registry was actually validated — a green here would mean the loop found nothing to check');
  assert.deepEqual(failures, [],
    'a row claiming a schema whose file does not satisfy it is worse than a row claiming none');
});

// A private record's row names monitor/private/<name>, which a public checkout does not have, so its
// shape is undetermined there. The shipped example beside it is what a public run can check: each
// one must satisfy the schema its row names, whenever the validator can evaluate that schema.
test('every shipped example of a private record validates against its schema', (t) => {
  const examples = inv().entries.filter((e) => /\.example\.json$|^manifests\/bola\/example\.json$/.test(e.path) && e.schema);
  const failures = [];
  const unevaluable = [];
  for (const e of examples) {
    const r = validateAgainstSchema(JSON.parse(readFileSync(resolve(REPO, e.path), 'utf8')), { path: resolve(REPO, e.schema) });
    if (r.errors.some((m) => m.includes('is not implemented here'))) { unevaluable.push(e.path); continue; }
    if (r.errors.length) failures.push(`${e.path} vs ${e.schema}: ${r.errors[0]}`);
  }
  if (unevaluable.length) t.diagnostic(`UNDETERMINED (${unevaluable.length}): schema uses keywords the validator does not implement: ${unevaluable.join(', ')}`);
  assert.ok(examples.length - unevaluable.length > 0, 'no example was validated');
  assert.deepEqual(failures, [], 'a shipped example that fails its own schema documents a shape no reader accepts');
});

test('the count of applied schemas may not fall', () => {
  // Raise only after a consumer is proven to reject an invalid document through the schema.
  const FLOOR = 27; // 2026-09-27: manifests/tool-pins.json, refused by lib/cobolwork-resolve.mjs readPin when invalid (lib/test/cobolwork-resolve.test.mjs)
  const applied = inv().entries.filter((e) => e.binding === 'validator').length;
  assert.ok(applied >= FLOOR, `${applied} schemas are applied at runtime, floor is ${FLOOR}`);
  assert.equal(applied, FLOOR,
    `${applied} are applied and the floor still says ${FLOOR} — raise it to bank the improvement.`);
});

test('the inventory lists itself', () => {
  const self = inv().entries.find((e) => e.path === 'monitor/registry-inventory.json');
  assert.ok(self, 'an inventory of registries that omits itself is exactly the blind spot it exists to remove');
  assert.equal(self.binding, 'validator', 'and it is checked, not merely listed');
});

test('the inventory schema rejects narrative-length operational prose', () => {
  const doc = inv();
  doc.note = 'x'.repeat(241);
  const result = validateAgainstSchema(doc, {
    path: resolve(REPO, 'schema', 'registry-inventory.schema.json'),
  });
  assert.ok(result.errors.some((error) => error.includes('maxLength')), result.errors.join('\n'));
});
