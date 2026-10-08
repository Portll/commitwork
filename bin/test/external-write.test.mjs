import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadExternalMap, redactExternal, residualTokens, writeExternal } from '../../lib/external-write.mjs';
import { externalMapPathFor } from '../../monitor/store-paths.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const sandbox = (map = { acme: 'clientZ', 'acme-labs': 'clientZ-labs', widgetco: 'internalZ' }) => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-external-'));
  const mapFile = join(dir, 'external-redactions.json');
  writeFileSync(mapFile, JSON.stringify({ note: 'fixture', map }));
  return { dir, env: { ...process.env, CW_EXTERNAL_REDACTIONS: mapFile, CW_EXTERNAL_ROOT: join(dir, 'external') } };
};

test('writes the redacted text under external/, longest name first', () => {
  const { dir, env } = sandbox();
  writeExternal('reports/run.md', 'acme-labs and ACME and WidgetCo', env);
  assert.equal(readFileSync(join(dir, 'external', 'reports', 'run.md'), 'utf8'), 'clientZ-labs and clientZ and internalZ');
});

test('an unlisted compound is replaced whole, never left as a fragment beside the token', () => {
  const entries = [['acme', 'clientZ']];
  assert.equal(redactExternal('XACME ACMEX acme_labs', entries), 'clientZ clientZ clientZ_labs');
});

test('a separator inside a name matches any separator or none', () => {
  const entries = [['acme-labs', 'clientZ-labs'], ['acme', 'clientZ']];
  assert.equal(redactExternal('acme_labs acme.labs acmelabs ACME-LABS', entries), 'clientZ-labs clientZ-labs clientZ-labs clientZ-labs');
});

test('POSITIVE CONTROL: the output witness fires on a separator variant the substitution cannot see', () => {
  const entries = [['acme', 'clientZ']];
  assert.deepEqual(residualTokens('see a-c-m-e today', entries), ['clientZ']);
  assert.deepEqual(residualTokens('see clientZ today', entries), []);
});

test('a separator-variant survivor refuses the write and names the token, not the name', () => {
  const { dir, env } = sandbox({ acme: 'clientZ' });
  assert.throws(() => writeExternal('x.md', 'a-c-m-e', env), (e) => /survived redaction \(residual forms of clientZ\)/.test(e.message) && !/acme/i.test(e.message));
  assert.equal(existsSync(join(dir, 'external', 'x.md')), false);
});

test('an ABSENT map refuses — absence is not "nothing to redact"', () => {
  const { dir, env } = sandbox();
  env.CW_EXTERNAL_REDACTIONS = join(dir, 'missing.json');
  assert.throws(() => writeExternal('x.md', 'hello', env), /is ABSENT at .* refusing to write/);
  assert.equal(existsSync(join(dir, 'external', 'x.md')), false);
});

test('malformed and empty maps refuse', () => {
  const { dir, env } = sandbox();
  writeFileSync(env.CW_EXTERNAL_REDACTIONS, '{ nope');
  assert.throws(() => loadExternalMap(env), /not valid JSON/);
  writeFileSync(env.CW_EXTERNAL_REDACTIONS, JSON.stringify({ note: 'x', map: {} }));
  assert.throws(() => loadExternalMap(env), /maps nothing/);
  writeFileSync(env.CW_EXTERNAL_REDACTIONS, JSON.stringify({ note: 'x', map: { 'two words': 'y' } }));
  assert.throws(() => loadExternalMap(env), /malformed entry/);
  assert.equal(existsSync(join(dir, 'external')), false);
});

test('a path escaping external/ refuses', () => {
  const { env } = sandbox();
  assert.throws(() => writeExternal('../outside.md', 'x', env), /resolves outside/);
  assert.throws(() => writeExternal('/etc/passwd', 'x', env), /relative to the external\/ folder/);
});

test('the env override is read at CALL time', () => {
  const a = sandbox({ acme: 'clientA1' }), b = sandbox({ acme: 'clientB1' });
  writeExternal('t.md', 'acme', a.env);
  writeExternal('t.md', 'acme', b.env);
  assert.equal(readFileSync(join(a.dir, 'external', 't.md'), 'utf8'), 'clientA1');
  assert.equal(readFileSync(join(b.dir, 'external', 't.md'), 'utf8'), 'clientB1');
});

// Guard on the guard, against the REAL private map: every declared name, in its listed form, an
// uppercase form, an underscore form and glued inside a longer word, must leave no residue. Skips
// with the path named on a checkout without private stores.
const realMap = externalMapPathFor(REPO, { ambient: false });
test('every declared external name is removed in every form', existsSync(realMap) ? {} : { skip: `private external map absent at ${realMap}` }, () => {
  const env = { ...process.env, CW_EXTERNAL_REDACTIONS: realMap };
  const entries = loadExternalMap(env);
  const forms = entries.flatMap(([n]) => [n, n.toUpperCase(), n.replace(/-/g, '_'), `pre${n}post`]);
  const out = redactExternal(forms.join(' '), entries);
  assert.deepEqual(residualTokens(out, entries), [], 'residual token(s) listed; names withheld because this output can reach a log');
});

// Material committed under external/ is held to the same witness even when a producer bypassed
// writeExternal.
test('nothing under external/ carries a declared name', existsSync(realMap) ? {} : { skip: `private external map absent at ${realMap}` }, () => {
  const root = resolve(REPO, 'external');
  if (!existsSync(root)) return;
  const entries = loadExternalMap({ ...process.env, CW_EXTERNAL_REDACTIONS: realMap });
  const offenders = [];
  const walk = (d) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (residualTokens(readFileSync(p, 'utf8'), entries).length) offenders.push(p.slice(REPO.length + 1));
    }
  };
  walk(root);
  assert.deepEqual(offenders, []);
});
