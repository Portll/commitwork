// EVERY TRACKED .mjs AT HEAD PARSES — asserted against V8, with a positive control that proves the
// gate can still fail.
//
// The instance: a rename sweep substituting a hyphenated pseudonym wrote
// `const client-d = dryRun('client-d')` into
// monitor/test/scope-containment.test.mjs. Valid text, invalid JavaScript. `node --test
// 'monitor/test/*.test.mjs'` then died with a SyntaxError attributed to the GLOB, so the whole
// monitor suite reported one failure naming nothing, and the actual broken file was invisible until
// somebody ran `node --check` over the tree by hand. Repaired by its owner.
//
// HEAD, NOT THE WORKING TREE, and this is a deliberate trade with a named cost:
//
//   COST — it would NOT have caught the case above while the file was merely dirty. The break was
//   uncommitted for hours and this gate would have been green throughout.
//   WHY ANYWAY — a working-tree parse check on a tree with this many concurrent sessions is red
//   continuously from other people's in-flight edits, and a gate that is always red is one nobody
//   reads. Landing is the moment a broken file becomes everyone's problem, and that is the moment
//   this must fail.
//
// The working tree is still WALKED, and reported as a diagnostic rather than asserted — early
// warning without the wallpaper.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { NOT_MODULES, classifyFailures } from '../lib/parse-gate.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIB = join(CW, 'bin/lib/parse-gate.mjs');

// One child, one walk. `parseFailures` needs --experimental-vm-modules, so everything that calls it
// — INCLUDING THE POSITIVE CONTROLS — runs in here. A control executed in the parent would not share
// this harness's failure mode, and proving a gate can fail somewhere it does not run proves nothing.
const RESULT = (() => {
  const script = `
    import { execFileSync } from 'node:child_process';
    import { readFileSync } from 'node:fs';
    import { parseFailures } from ${JSON.stringify(pathToFileURL(LIB).href)};
    const CW = ${JSON.stringify(CW)};

    const head = execFileSync('git', ['-C', CW, 'ls-tree', '-r', 'HEAD', '--format=%(objectname) %(path)'],
      { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).split('\\n').filter(Boolean)
      .map((l) => { const i = l.indexOf(' '); return { sha: l.slice(0, i), path: l.slice(i + 1) }; })
      .filter((e) => /\\.mjs$/.test(e.path) && !e.path.startsWith('.claude/'));

    // Byte-delimited batch, so no encoding on the buffer — this tree is multi-byte dense and
    // decoding first would put character offsets against byte lengths.
    const buf = execFileSync('git', ['-C', CW, 'cat-file', '--batch'],
      { input: head.map((e) => e.sha).join('\\n') + '\\n', maxBuffer: 512 * 1024 * 1024 });
    const headEntries = [];
    let off = 0;
    for (const e of head) {
      const nl = buf.indexOf(0x0a, off);
      const size = Number(buf.toString('utf8', off, nl).split(' ')[2]);
      headEntries.push([e.path, buf.toString('utf8', nl + 1, nl + 1 + size)]);
      off = nl + 1 + size + 1;
    }

    // The working tree, for the diagnostic half.
    const wtPaths = execFileSync('git', ['-C', CW, 'ls-files', '*.mjs'], { encoding: 'utf8' })
      .split('\\n').filter(Boolean).filter((f) => !f.startsWith('.claude/'));
    const wtEntries = [];
    for (const f of wtPaths) {
      try { wtEntries.push([f, readFileSync(CW + '/' + f, 'utf8')]); } catch { /* deleted mid-run */ }
    }

    // POSITIVE CONTROLS, through the same function in the same process.
    const controls = await parseFailures([
      // Hyphenated on purpose: this fixture IS the defect. A camelCase sweep that respells it makes
      // it parse, and the control then proves nothing.
      ['control/BROKEN.mjs', "const client-d = dryRun('client-d');\\n"],
      ['control/valid.mjs', "export const a = 1;\\nimport { x } from './y.mjs';\\n"],
      ['control/also-broken.mjs', 'function ( { }\\n'],
    ]);

    console.log(JSON.stringify({
      headCount: headEntries.length,
      wtCount: wtEntries.length,
      head: await parseFailures(headEntries),
      workingTree: await parseFailures(wtEntries),
      controls,
    }));
  `;
  const raw = execFileSync(process.execPath,
    ['--experimental-vm-modules', '--input-type=module', '-e', script],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  return JSON.parse(raw.trim().split('\n').pop());
})();

// ---- the control comes first ---------------------------------------------------------------------

test('THE CONTROL: the gate flags a broken source BY NAME, not merely by failing', () => {
  // A gate that fails for the wrong reason still passes a "does it fail?" control, so the assertion
  // is on the identity of what was flagged.
  // Sorted by localeCompare, which is case-insensitive: `also-broken` precedes `BROKEN`.
  const flagged = RESULT.controls.map((f) => f.path);
  assert.deepEqual(flagged, ['control/also-broken.mjs', 'control/BROKEN.mjs'],
    'exactly the two broken fixtures, named — and the valid one absent');
});

test('THE CONTROL names the actual defect, so a reader can act without re-running it', () => {
  const broken = RESULT.controls.find((f) => f.path === 'control/BROKEN.mjs');
  assert.match(broken.error, /SyntaxError/);
  // The real-world shape: a rename sweep substituting inside an identifier.
  assert.match(broken.error, /Missing initializer|Unexpected/);
});

// ---- non-vacuity ---------------------------------------------------------------------------------

test('the walk is not blind — HEAD and the working tree both enumerate', () => {
  assert.ok(RESULT.headCount > 300, `only ${RESULT.headCount} .mjs at HEAD — the walk is blind`);
  assert.ok(RESULT.wtCount > 300, `only ${RESULT.wtCount} .mjs in the working tree — the walk is blind`);
});

// ---- the gate ------------------------------------------------------------------------------------

test('EVERY TRACKED .mjs AT HEAD PARSES', () => {
  const { breakage } = classifyFailures(RESULT.head, NOT_MODULES);
  assert.deepEqual(breakage.map((f) => `${f.path} — ${f.error}`), [],
    'a committed source that does not parse takes down every suite that globs it, and the '
    + 'SyntaxError names the glob rather than the file');
});

test('the not-a-module declarations are still true, and none has gone stale', () => {
  // An allowlist entry whose file now parses is suppressing nothing, and is how a list outlives
  // every reason in it.
  const { expected, staleDeclarations } = classifyFailures(RESULT.head, NOT_MODULES);
  assert.deepEqual(staleDeclarations, [],
    'a declared not-a-module now parses — delete the declaration rather than leaving it to accrete');
  assert.deepEqual(expected.map((f) => f.path), Object.keys(NOT_MODULES),
    'every declared entry is accounted for in HEAD');
});

test('every declaration carries a reason a reader can evaluate', () => {
  for (const [path, why] of Object.entries(NOT_MODULES)) {
    assert.ok(why && why.length > 25, `${path}: a bare exemption is an assertion nobody can check`);
  }
});

// ---- the diagnostic half -------------------------------------------------------------------------

test('the working tree is WALKED and reported, but does not fail the gate', () => {
  // Deliberately not an assertion on the contents: on this tree it would be red from other
  // sessions' in-flight edits within a day, and a permanently red gate is one nobody reads.
  const { breakage } = classifyFailures(RESULT.workingTree, NOT_MODULES);
  if (breakage.length) {
    process.stderr.write(`\n[parse-gate] ${breakage.length} unparseable source(s) in the WORKING TREE `
      + '— in-flight, not a gate failure, and not necessarily yours:\n'
      + `${breakage.map((f) => `  ${f.path} — ${f.error}`).join('\n')}\n`);
  }
  // What IS asserted: the diagnostic ran. A silently empty walk would be indistinguishable from a
  // clean tree, which is the failure this whole file is about.
  assert.ok(Array.isArray(RESULT.workingTree), 'the working-tree walk must have produced an answer');
});
