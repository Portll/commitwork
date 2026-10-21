// bin/yara-witness.mjs and bin/yara-rules.mjs, offline: a fake `yr` that answers from file content,
// a temp pin manifest and a file:// mirror for the rule store. The one test that drives the real
// yara-x runs only where it and the pinned packs are installed, and says so when it skips.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, chmodSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { scanTree, parseNdjson, sevFor, metaOf } from '../yara-witness.mjs';
import { install, verifyStore, loadPins } from '../yara-rules.mjs';

const roots = [];
after(() => { for (const r of roots) rmSync(r, { recursive: true, force: true }); });
const tmp = (p) => { const d = mkdtempSync(join(tmpdir(), p)); roots.push(d); return d; };
const sha = (s) => createHash('sha256').update(s).digest('hex');
const put = (root, rel, body) => { const a = join(root, rel); mkdirSync(dirname(a), { recursive: true }); writeFileSync(a, body); return a; };
const C1 = 'a'.repeat(40);
const C2 = 'b'.repeat(40);

const FAKE_YR = `#!/usr/bin/env node
const fs = require('fs');
const a = process.argv.slice(2);
if (a[0] === '--version') { console.log('yara-x-cli 9.9.9'); process.exit(0); }
const list = a[a.length - 1];
if (process.env.FAKE_YR_ECHO) fs.writeFileSync(process.env.FAKE_YR_ECHO, fs.readFileSync(list));
for (const p of fs.readFileSync(list, 'utf8').split('\\n').filter(Boolean)) {
  const t = fs.readFileSync(p, 'latin1');
  const rules = [];
  if (t.includes('FAKE-SIG')) rules.push({ identifier: 'Fake_Sig', namespace: 'sigpack', meta: [['author', 'Test Author'], ['score', 85]] });
  if (t.includes('FAKE-NOISE')) rules.push({ identifier: 'Noise', namespace: 'noisepack', meta: [] });
  if (rules.length) console.log(JSON.stringify({ path: p, rules }));
}
if (process.env.FAKE_YR_GARBAGE) console.log('not json');
`;

function fixtureStore() {
  const mirror = tmp('cw-yara-mirror-');
  const tools = tmp('cw-yara-tools-');
  const ruleA = 'rule Fake_Sig { condition: false }\n';
  const ruleB = 'rule Noise { condition: false }\n';
  put(mirror, `t/sig/${C1}/a.yar`, ruleA);
  put(mirror, `t/noise/${C2}/b.yar`, ruleB);
  const pins = put(tmp('cw-yara-pins-'), 'pins.json', JSON.stringify({ sets: {
    sigpack: { repo: 't/sig', commit: C1, url: 'https://example.invalid/sig', license: 'DRL-1.1', base: '', entry: null, files: { 'a.yar': sha(ruleA) } },
    noisepack: { repo: 't/noise', commit: C2, url: 'https://example.invalid/noise', license: 'LGPL-3.0-only', base: '', entry: null, defaultSev: '',
      undeterminedReason: 'measured to be noise in this test', files: { 'b.yar': sha(ruleB) } },
  } }));
  const fake = put(tmp('cw-yara-bin-'), 'yr', FAKE_YR);
  chmodSync(fake, 0o755);
  return { mirror, tools, pins, fake };
}
function withEnv(env, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v == null) delete process.env[k]; else process.env[k] = v; } }
}
async function withEnvAsync(env, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(env)) { saved[k] = process.env[k]; if (v == null) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v == null) delete process.env[k]; else process.env[k] = v; } }
}
async function installedEnv() {
  const s = fixtureStore();
  const env = { CW_YARA_RULE_PINS: s.pins, CW_TOOLS_ROOT: s.tools, CW_YARA_RULES_URL_BASE: pathToFileURL(s.mirror).href, CW_YR_BIN: s.fake };
  await withEnvAsync(env, () => install(loadPins()));
  return { ...s, env };
}

describe('yara-rules', () => {
  test('install fetches every pinned file and verifies it; a mismatched byte is refused and not written', async () => {
    const s = fixtureStore();
    await withEnvAsync({ CW_YARA_RULE_PINS: s.pins, CW_TOOLS_ROOT: s.tools, CW_YARA_RULES_URL_BASE: pathToFileURL(s.mirror).href }, async () => {
      assert.equal(verifyStore(loadPins()).ok, false, 'an empty store is not installed');
      assert.deepEqual((await install(loadPins())).sort(), ['noisepack/b.yar', 'sigpack/a.yar']);
      assert.equal(verifyStore(loadPins()).ok, true);
    });
    writeFileSync(join(s.mirror, `t/sig/${C1}/a.yar`), 'rule Tampered { condition: true }\n');
    const fresh = tmp('cw-yara-tools2-');
    await withEnvAsync({ CW_YARA_RULE_PINS: s.pins, CW_TOOLS_ROOT: fresh, CW_YARA_RULES_URL_BASE: pathToFileURL(s.mirror).href }, async () => {
      await assert.rejects(install(loadPins()), /does not match the pin/);
      assert.ok(!existsSync(join(fresh, 'yara-rules', 'sigpack', C1, 'a.yar')));
    });
  });

  test('pins with a traversal path or a short commit are refused', () => {
    const p = put(tmp('cw-yara-badpins-'), 'p.json', JSON.stringify({ sets: { x: { repo: 'r', commit: C1, files: { '../evil.yar': 'f'.repeat(64) } } } }));
    assert.throws(() => loadPins(p), /unsafe path/);
    const q = put(tmp('cw-yara-badpins-'), 'q.json', JSON.stringify({ sets: { x: { repo: 'r', commit: 'abc', files: {} } } }));
    assert.throws(() => loadPins(q), /40-hex commit/);
  });
});

describe('yara-witness', () => {
  test('helpers: score sets severity, an undetermined pack stays undetermined, meta pairs become an object', () => {
    assert.equal(sevFor({ defaultSev: 'med' }, { score: 85 }), 'high');
    assert.equal(sevFor({ defaultSev: 'med' }, { score: 65 }), 'med');
    assert.equal(sevFor({ defaultSev: 'med' }, { score: 40 }), 'low');
    assert.equal(sevFor({ defaultSev: '' }, {}), '');
    assert.deepEqual(metaOf([['author', 'A'], ['score', 1], 'junk']), { author: 'A', score: 1 });
    assert.deepEqual(parseNdjson('{"path":"a","rules":[]}\nnope\n\n'), { records: [{ path: 'a', rules: [] }], unparsed: 1 });
  });

  test('yara-x absent is a void that names the cause', () => {
    const r = withEnv({ CW_YR_BIN: join(tmpdir(), 'no-such-yr-binary') }, () => scanTree(tmp('cw-yara-t-')));
    assert.equal(r.summary.filesScanned, 0);
    assert.match(r.summary.voidReason, /yara-x is not installed/);
  });

  test('rules not installed is a void that names the fix', () => {
    const s = fixtureStore();
    const r = withEnv({ CW_YARA_RULE_PINS: s.pins, CW_TOOLS_ROOT: s.tools, CW_YR_BIN: s.fake }, () => scanTree(tmp('cw-yara-t-')));
    assert.match(r.summary.voidReason, /yara-rules\.mjs --install/);
  });

  test('matches become rows with attribution; a noise pack goes to undetermined; divergence is stated both ways', async () => {
    const { env } = await installedEnv();
    const root = tmp('cw-yara-tree-');
    put(root, 'a/shell.php', '<?php // FAKE-SIG\n');
    put(root, 'b/noise.php', '<?php // FAKE-NOISE\n');
    put(root, 'c/x.php.b64', Buffer.from('<?php eval($x); // a dropper the fake yr cannot see\n').toString('base64'));
    put(root, 'node_modules/p/skip.php', '<?php // FAKE-SIG\n');
    const echo = join(tmp('cw-yara-echo-'), 'list.txt');
    const r = withEnv({ ...env, FAKE_YR_ECHO: echo }, () => scanTree(root));
    assert.deepEqual(r.findings.map((f) => [f.rule, f.path, f.sev]), [['sigpack:Fake_Sig', 'a/shell.php', 'high']]);
    assert.match(r.findings[0].detail, /by Test Author — DRL-1\.1 https:\/\/example\.invalid\/sig/);
    assert.equal(r.summary.undetermined.count, 1);
    assert.deepEqual(r.summary.undetermined.reasons, ['measured to be noise in this test']);
    assert.deepEqual(r.summary.divergence.yaraOnly.sample, ['a/shell.php']);
    assert.deepEqual(r.summary.divergence.detectOnly.sample, ['c/x.php.b64']);
    assert.ok(!readFileSync(echo, 'utf8').includes('node_modules'), 'a skipped directory reached the scan list');
    assert.ok(r.summary.skippedPaths.includes('node_modules'));
  });

  test('unparsed output is a declared partial read; the report is deterministic', async () => {
    const { env } = await installedEnv();
    const root = tmp('cw-yara-tree-');
    put(root, 'a.php', '<?php // FAKE-SIG\n');
    const one = withEnv({ ...env, FAKE_YR_GARBAGE: '1' }, () => scanTree(root));
    assert.equal(one.summary.partial, true);
    assert.match(one.summary.partialReasons.join(' '), /not parsed/);
    const a = withEnv(env, () => JSON.stringify(scanTree(root)));
    const b = withEnv(env, () => JSON.stringify(scanTree(root)));
    assert.equal(a, b);
  });

  test('REAL yara-x with the pinned packs flags a shell built here', (t) => {
    const yr = spawnSync(process.env.CW_YR_BIN || 'yr', ['--version'], { encoding: 'utf8' });
    if (yr.error || yr.status !== 0) return t.skip('yara-x is not installed here — the real engine is NOT measured, which is not a pass');
    let ok = false;
    try { ok = verifyStore(loadPins()).ok; } catch { ok = false; }
    if (!ok) return t.skip('the pinned rule packs are not installed (node bin/yara-rules.mjs --install) — NOT measured');
    const root = tmp('cw-yara-real-');
    put(root, 's.php', `<?php @eval($_POST["${'cana'}ry"]); ?>\n`);
    put(root, 'ok.txt', 'hello\n');
    const r = scanTree(root);
    assert.ok(r.findings.some((f) => f.path === 's.php' && f.rule.startsWith('signature-base:')), JSON.stringify(r.summary.byRule));
    assert.ok(!r.findings.some((f) => f.path === 'ok.txt'));
  });
});
