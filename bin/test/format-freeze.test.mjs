// manifests/formats.json held to the code: every frozen format's schema matches its pinned history,
// its writer stamps the declared version, and no versioned format id in the source is unlisted.
// Policy: docs/STABILITY.md, "Format versions".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { validateAgainstSchema } from '../../monitor/registry.mjs';
import { schemaShape, schemaFingerprint, fingerprint, historyViolations, schemaPinsVersion } from '../lib/format-freeze.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (rel) => JSON.parse(readFileSync(join(REPO, rel), 'utf8'));
const formats = () => readJson('manifests/formats.json').formats;

test('the formats manifest validates against its schema', () => {
  assert.deepEqual(validateAgainstSchema(readJson('manifests/formats.json'), { path: join(REPO, 'schema', 'formats.schema.json') }).errors, []);
  const ids = formats().map((f) => f.id);
  assert.equal(new Set(ids).size, ids.length, 'format ids are unique');
});

test('each status carries the fields it claims', () => {
  const bad = [];
  for (const f of formats()) {
    const has = (k) => f[k] !== null && f[k] !== undefined;
    if (f.status === 'frozen' && !(has('version') && has('versionField') && has('schema') && Array.isArray(f.history))) bad.push(`${f.id}: frozen needs version, versionField, schema and history`);
    if (f.status === 'unschematized' && !(has('version') && has('versionField') && !has('schema') && has('gap'))) bad.push(`${f.id}: unschematized needs a version, no schema, and a gap`);
    if (f.status === 'unversioned' && (has('version') || has('versionField') || !has('gap'))) bad.push(`${f.id}: unversioned has no version and states its gap`);
    if (f.status === 'external' && !(has('version') && has('versionField') && (has('schema') || has('upstream') || has('gap')))) bad.push(`${f.id}: external names its version, and an upstream schema or why there is none`);
    if (f.status !== 'frozen' && f.history) bad.push(`${f.id}: only a frozen format has a history`);
    if (f.status !== 'external' && f.upstream) bad.push(`${f.id}: only an external format names an upstream`);
    if (f.pin && f.id !== 'mcp-tools') bad.push(`${f.id}: no computation is defined for this pin, so it could never fail`);
  }
  assert.deepEqual(bad, []);
});

test('every named schema, writer module and document exists', () => {
  const missing = [];
  for (const f of formats()) {
    for (const rel of [f.schema, f.writer.module, f.writer.document, f.writer.source]) {
      if (rel && !existsSync(join(REPO, rel))) missing.push(`${f.id}: ${rel}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('a frozen schema pins the version, and its shape matches the last history line', () => {
  const bad = [];
  for (const f of formats().filter((x) => x.status === 'frozen')) {
    const schema = readJson(f.schema);
    const why = schemaPinsVersion(schema, f.versionField, f.version);
    if (why) bad.push(`${f.id}: ${why}`);
    bad.push(...historyViolations(f, schemaFingerprint(schema)));
  }
  assert.deepEqual(bad, []);
});

// The writer is asked, not described: an export is imported and compared (a function is called and
// its document read), a document is parsed, and only a writer with neither is matched as source.
async function stampedBy(f) {
  const w = f.writer;
  if (w.export) {
    const mod = await import(pathToFileURL(join(REPO, w.module)).href);
    if (!(w.export in mod)) return { error: `${w.module} does not export ${w.export}` };
    const v = w.call ? mod[w.export]()[f.versionField] : mod[w.export];
    return { value: v };
  }
  if (w.document) return { value: readJson(w.document)[f.versionField] };
  if (w.source) {
    const src = readFileSync(join(REPO, w.source), 'utf8');
    if (!w.match.includes(String(f.version))) return { error: `match ${JSON.stringify(w.match)} does not contain the version` };
    return src.includes(w.match) ? { value: f.version } : { error: `${w.source} no longer contains ${JSON.stringify(w.match)}` };
  }
  return { error: 'no export, document or source to read the version from' };
}

test('each versioned format\'s writer stamps the declared version', async () => {
  const bad = [];
  for (const f of formats().filter((x) => x.version !== null)) {
    const r = await stampedBy(f);
    if (r.error) bad.push(`${f.id}: ${r.error}`);
    else if (r.value !== f.version) bad.push(`${f.id}: writer stamps ${JSON.stringify(r.value)}, manifest declares ${JSON.stringify(f.version)}`);
  }
  assert.deepEqual(bad, []);
});

// A new versioned format cannot be absent from the manifest by omission.
test('every versioned format id in the source is listed', () => {
  const out = execFileSync('git', ['-C', REPO, 'grep', '-hoE', 'commitwork(\\.[a-z0-9-]+/[0-9]+|/[a-z0-9-]+\\.v[0-9]+)', '--',
    '*.mjs', ':!**/test/**', ':!**/fixtures/**'], { encoding: 'utf8' });
  const found = new Set(out.split('\n').filter(Boolean));
  const listed = new Set(formats().flatMap((f) => [f.version, f.label]).filter((x) => typeof x === 'string'));
  assert.ok(found.size > 0, 'the source search found nothing, so it cannot have checked anything');
  assert.deepEqual([...found].filter((id) => !listed.has(id)).sort(), [],
    'list each in manifests/formats.json, frozen or with its gap');
});

test('the MCP tool list matches its pin', async () => {
  const keys = ['CW_SETTINGS', 'CW_EXPERIMENTAL', ...Object.keys(process.env).filter((k) => k.startsWith('CW_FEATURE_'))];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const tmp = mkdtempSync(join(tmpdir(), 'cw-format-freeze-'));
  try {
    for (const k of keys) delete process.env[k];
    process.env.CW_SETTINGS = join(tmp, 'settings.json');
    process.env.CW_EXPERIMENTAL = 'on';
    const { handleRequest } = await import('../../mcp/server.mjs');
    const res = handleRequest({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, {});
    const tools = res.result.tools.map(({ name, inputSchema }) => ({ name, inputSchema: schemaShape(inputSchema) }))
      .sort((a, b) => (a.name < b.name ? -1 : 1));
    assert.ok(tools.length > 0, 'precondition: the server listed tools');
    const pin = formats().find((f) => f.id === 'mcp-tools').pin;
    assert.equal(fingerprint(tools), pin,
      'an MCP tool or input schema changed. Update the mcp-tools pin in manifests/formats.json, and follow docs/STABILITY.md if a tool or input was removed, renamed or made required');
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    rmSync(tmp, { recursive: true, force: true });
  }
});

// ── the guard's own witnesses: each rule is shown failing on a synthetic case ──────────────────

const BASE = { type: 'object', required: ['schema'], properties: { schema: { const: 'x/1', description: 'v' }, description: { type: 'string' } } };

test('annotations do not move the fingerprint; shape, and a property named description, do', () => {
  const fp = schemaFingerprint(BASE);
  assert.equal(schemaFingerprint({ ...BASE, description: 'reworded', $comment: 'c', title: 't' }), fp);
  assert.equal(schemaFingerprint({ ...BASE, properties: { ...BASE.properties, schema: { const: 'x/1', description: 'deprecated' } } }), fp);
  assert.notEqual(schemaFingerprint({ ...BASE, properties: { schema: BASE.properties.schema } }), fp, 'dropping the description PROPERTY is a shape change');
  assert.notEqual(schemaFingerprint({ ...BASE, required: ['schema', 'description'] }), fp);
  assert.equal(schemaFingerprint(Object.fromEntries(Object.entries(BASE).reverse())), fp, 'key order is not shape');
});

test('the history rules each refuse what they exist to refuse', () => {
  const fp0 = schemaFingerprint(BASE);
  const fp1 = schemaFingerprint({ ...BASE, required: [] });
  const line = (o) => ({ version: 'x/1', fingerprint: fp0, release: '0.9.0', change: 'initial', note: 'pinned for the test', ...o });
  const entry = (history, version = history[history.length - 1].version) => ({ id: 't', schema: 's', version, history });
  assert.deepEqual(historyViolations(entry([line()]), fp0), []);
  assert.match(historyViolations(entry([line()]), fp1).join(), /changed shape/);
  assert.deepEqual(historyViolations(entry([line(), line({ fingerprint: fp1, change: 'additive', release: '0.9.5' })]), fp1), []);
  assert.match(historyViolations(entry([line(), line({ fingerprint: fp1, change: 'breaking', release: '0.10.0' })]), fp1).join(), /keeps version/);
  assert.deepEqual(historyViolations(entry([line(), line({ version: 'x/2', fingerprint: fp1, change: 'breaking', release: '0.10.0' })]), fp1), [],
    'before 1.0 a breaking change ships in a minor release with its history line');
  assert.match(historyViolations(entry([line({ release: '1.0.0' }), line({ version: 'x/2', fingerprint: fp1, change: 'breaking', release: '1.4.0' })]), fp1).join(), /needs a major release/);
  assert.deepEqual(historyViolations(entry([line({ release: '1.0.0' }), line({ version: 'x/2', fingerprint: fp1, change: 'breaking', release: '2.0.0' })]), fp1), []);
  assert.match(historyViolations(entry([line(), line({ version: 'x/2', fingerprint: fp1, change: 'additive' })]), fp1).join(), /additive but moves/);
  assert.match(historyViolations(entry([line()], 'x/2'), fp0).join(), /not the last history version/);
  assert.match(historyViolations(entry([line({ change: 'breaking' })]), fp0).join(), /first history line/);
});

test('schemaPinsVersion refuses an unpinned, unrequired or mismatched version field', () => {
  assert.equal(schemaPinsVersion(BASE, 'schema', 'x/1'), null);
  assert.match(schemaPinsVersion(BASE, 'schema', 'x/2'), /pinned to "x\/1"/);
  assert.match(schemaPinsVersion({ ...BASE, required: [] }, 'schema', 'x/1'), /does not require/);
  assert.match(schemaPinsVersion({ ...BASE, properties: { schema: { type: 'string' } } }, 'schema', 'x/1'), /not pinned/);
  assert.match(schemaPinsVersion(BASE, 'version', 1), /declares no/);
});
