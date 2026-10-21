// fact: every assertion plants a violation and expects the gate to catch it / a gate tested only on clean input passes when it stops looking (expiry: never, prev: unknown)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FACT_RE, PREV_STATES, MAX_RUN, scanFile, runs, commentLines, classify, BASIS } from '../comment-schema.mjs';

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'comment-schema.mjs');

const sandbox = (files) => {
  const d = mkdtempSync(join(tmpdir(), 'cw-cmt-'));
  for (const [name, body] of Object.entries(files)) {
    const p = join(d, name);
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, body);
  }
  return d;
};
const run = (dir, baseline, args = []) => spawnSync(process.execPath, [CLI, ...args], {
  encoding: 'utf8',
  env: { ...process.env, CW_COMMENT_ROOT: dir, CW_COMMENT_BASELINE: baseline, CW_NOW: '2026-01-01' },
});

const GOOD = '// fact: claim here / consequence (expiry: never, prev: broken)';

test('the schema accepts the canonical form, including parens in the claim', () => {
  const m = FACT_RE.exec('fact: copy breaks links (silent 404) (expiry: if it moves, prev: broken)');
  assert.notEqual(m, null);
  assert.equal(m.groups.claim, 'copy breaks links (silent 404)');
  assert.equal(m.groups.expiry, 'if it moves');
  assert.equal(m.groups.prev, 'broken');
});

test('a fact with no trailer is accepted — a comment needs no expiry', () => {
  const r = scanFile('a.mjs', '// fact: something true (silent 404)\nconst x = 1;\n');
  assert.deepEqual(r.violations, []);
  const m = FACT_RE.exec('fact: something true (silent 404)');
  assert.equal(m.groups.claim, 'something true (silent 404)');
  assert.equal(m.groups.expiry, undefined);
});

test('a half-written trailer is a violation, never absorbed into the claim', () => {
  for (const t of ['(expiry: never prev: broken)', '(expiry: never)', '(prev: broken)']) {
    const r = scanFile('a.mjs', `// fact: x ${t}\nconst x = 1;\n`);
    assert.equal(r.violations.length, 1, t);
    assert.match(r.violations[0].why, /malformed trailer/);
  }
});

test('a fact with no claim is a violation', () => {
  for (const c of ['// fact:', '// fact: ', '// fact: (expiry: never, prev: broken)']) {
    assert.equal(scanFile('a.mjs', `${c}\nconst x = 1;\n`).violations.length, 1, JSON.stringify(c));
  }
});

test('a prev outside the closed set is a violation', () => {
  const r = scanFile('a.mjs', '// fact: x / y (expiry: never, prev: bananas)\nconst x = 1;\n');
  assert.equal(r.violations.length, 1);
  assert.match(r.violations[0].why, /not in the closed set/);
  assert.equal(PREV_STATES.has('bananas'), false);
});

test('expiry TODO/FIXME is a violation — the suggester placeholder is not a condition', () => {
  const r = scanFile('a.mjs', '// fact: x / y (expiry: TODO, prev: unknown)\nconst x = 1;\n');
  assert.equal(r.violations.length, 1);
  assert.match(r.violations[0].why, /unresolved expiry/);
});

test('a real expiry condition is accepted', () => {
  const r = scanFile('a.mjs', '// fact: x / y (expiry: when the lane is removed, prev: unknown)\nconst x = 1;\n');
  assert.deepEqual(r.violations, []);
});

test('an ordinary comment is not held to the schema', () => {
  const r = scanFile('a.mjs', '// just a note\nconst x = 1;\n');
  assert.deepEqual(r.violations, []);
});

test('runs are counted, and a blank line ends one', () => {
  const src = ['// a', '// b', '', '// c', 'const x = 1;'].join('\n');
  assert.deepEqual(runs(commentLines(src)).map((r) => r.len), [2, 1]);
});

test(`a block longer than ${MAX_RUN} counts as long; one at the limit does not`, () => {
  const atLimit = Array.from({ length: MAX_RUN }, (_, i) => `// line ${i}`).join('\n');
  const over = Array.from({ length: MAX_RUN + 1 }, (_, i) => `// line ${i}`).join('\n');
  assert.equal(scanFile('a.mjs', `${atLimit}\nconst x = 1;\n`).long, 0);
  assert.equal(scanFile('a.mjs', `${over}\nconst x = 1;\n`).long, 1);
});

test('block comments count toward a run, not just line comments', () => {
  const src = `/*\n${Array.from({ length: MAX_RUN + 1 }, (_, i) => ` * line ${i}`).join('\n')}\n */\nconst x = 1;\n`;
  assert.equal(scanFile('a.mjs', src).long, 1);
});

// ---- the ratchet, end to end

test('an unseeded baseline is exit 3, never a silent pass', () => {
  const d = sandbox({ 'a.mjs': `${GOOD}\nconst x = 1;\n` });
  const r = run(d, join(d, 'missing.json'));
  assert.equal(r.status, 3);
  assert.match(r.stderr, /not seeded/);
});

test('an unreadable baseline fails closed rather than grandfathering nothing', () => {
  const d = sandbox({ 'a.mjs': `${GOOD}\nconst x = 1;\n`, 'bad.json': '{ not json' });
  const r = run(d, join(d, 'bad.json'));
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unreadable/);
});

test('THE RATCHET BITES: a new long block in a seeded tree fails', () => {
  const d = sandbox({ 'a.mjs': `${GOOD}\nconst x = 1;\n` });
  const b = join(d, 'base.json');
  assert.equal(run(d, b, ['--seed']).status, 0);
  assert.equal(run(d, b).status, 0, 'clean tree passes after seeding');

  const long = Array.from({ length: MAX_RUN + 3 }, (_, i) => `// narrative line ${i}`).join('\n');
  writeFileSync(join(d, 'a.mjs'), `${long}\nconst x = 1;\n`);
  const r = run(d, b);
  assert.equal(r.status, 1, 'a block over the limit must fail the ratchet');
  assert.match(r.stdout, /RATCHET/);
});

test('legacy long blocks are grandfathered — the same file passes at its seeded count', () => {
  const long = Array.from({ length: MAX_RUN + 3 }, (_, i) => `// legacy line ${i}`).join('\n');
  const d = sandbox({ 'a.mjs': `${long}\nconst x = 1;\n` });
  const b = join(d, 'base.json');
  run(d, b, ['--seed']);
  assert.equal(run(d, b).status, 0, 'the grandfathered population must not fail');
});

test('--tighten banks a removal and then refuses to give it back', () => {
  const long = Array.from({ length: MAX_RUN + 3 }, (_, i) => `// legacy line ${i}`).join('\n');
  const d = sandbox({ 'a.mjs': `${long}\nconst x = 1;\n` });
  const b = join(d, 'base.json');
  run(d, b, ['--seed']);

  writeFileSync(join(d, 'a.mjs'), `${GOOD}\nconst x = 1;\n`);
  assert.equal(run(d, b, ['--tighten']).status, 0);

  writeFileSync(join(d, 'a.mjs'), `${long}\nconst x = 1;\n`);
  assert.equal(run(d, b).status, 1, 'a banked improvement must not be surrenderable');
});

// ---- reference blocks: counted, reported, never gated

const USAGE = [
  '// usage: tool.mjs [--json] [--seed] [--tighten]',
  '// --json     machine output',
  '// --seed     write the baseline',
  '// --force    overwrite an existing one',
  '// --tighten  bank removals',
  '// --status   print the population',
  '// exit: 0 pass · 1 findings · 2 failure',
].join('\n');

test('THE GAP: a usage: block over the limit is reference, and reference is not gated', () => {
  const r = scanFile('a.mjs', `${USAGE}\nconst x = 1;\n`);
  assert.equal(r.long, 0,
    'gating this made the only legal way to clear it a deletion of reference material that is not verbose');
  assert.equal(r.reference, 1, 'and it must be COUNTED — an ignored population is how an unverified result starts reading as a pass');
});

test('the FIRST line decides: one header over six flag lines is 14% and the proportion rule cannot see it', () => {
  const block = USAGE.split('\n').map((l) => l.slice(3));
  assert.equal(classify(block), 'reference');
  const proportion = block.filter((l) => /^(usage|exit|env|flags?|options?)\b/i.test(l)).length / block.length;
  assert.ok(proportion < 0.34,
    'if this ever reaches the threshold the fixture stopped reproducing the defect — it called EVERY reference block in the tree narrative');
});

test('a narrative block is still gated — the exemption is for reference material, not for length', () => {
  const block = Array.from({ length: MAX_RUN + 1 },
    (_, i) => `// because the resolver would otherwise drift ${i}`).join('\n');
  const r = scanFile('a.mjs', `${block}\nconst x = 1;\n`);
  assert.equal(r.long, 1);
  assert.equal(r.reference, 0);
});

test('the classifier has ONE definition — the suggester re-exports the gate\'s', async () => {
  const s = await import('../comment-suggest.mjs');
  assert.equal(s.classify, classify,
    'it was defined in the suggester, which imports the gate, so the gate could not reach it without a second copy');
});

test('a baseline seeded under another basis is REFUSED, never compared', () => {
  const d = sandbox({ 'a.mjs': `${GOOD}\nconst x = 1;\n` });
  const b = join(d, 'base.json');
  writeFileSync(b, JSON.stringify({ seededAt: '2026-01-01', maxRun: MAX_RUN, counts: { 'a.mjs': 9 } }));
  const r = run(d, b);
  assert.equal(r.status, 3, 'combined counts against narrative counts would read as an improvement nobody made');
  assert.match(r.stderr, /basis/);
});

test('a seeded baseline records the basis that produced its numbers', () => {
  const d = sandbox({ 'a.mjs': `${GOOD}\nconst x = 1;\n` });
  const b = join(d, 'base.json');
  run(d, b, ['--seed']);
  assert.equal(JSON.parse(readFileSync(b, 'utf8')).basis, BASIS);
});

test('the reference population is REPORTED on a passing run, not only under --status', () => {
  const d = sandbox({ 'a.mjs': `${USAGE}\nconst x = 1;\n` });
  const b = join(d, 'base.json');
  run(d, b, ['--seed']);
  const r = run(d, b);
  assert.equal(r.status, 0, 'reference blocks must not fail the gate');
  assert.match(r.stdout, /REFERENCE/, 'a population the gate ignores must still be visible');
});

test('a schema violation fails even when the ratchet is satisfied', () => {
  const d = sandbox({ 'a.mjs': `${GOOD}\nconst x = 1;\n` });
  const b = join(d, 'base.json');
  run(d, b, ['--seed']);
  writeFileSync(join(d, 'a.mjs'), '// fact: a placeholder trailer (expiry: TODO, prev: unknown)\nconst x = 1;\n');
  const r = run(d, b);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /SCHEMA/);
});
