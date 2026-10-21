// docs/INVARIANTS.md is a register of claims about what this repository guards. Without a consumer
// every row is prose: a Guard column naming a test that was deleted, or that never ran under
// `npm test`, reads exactly like one that does. This test is that consumer, and it judges HEAD
// rather than the working tree for the same reason bin/test/tracked-imports.test.mjs does — the
// property is about what a clone gets, and this tree always has several sessions mid-edit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { TEST_GLOBS } from '../test-run.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REGISTER = 'docs/INVARIANTS.md';
const COLUMNS = ['Property', 'Guard', 'Witness', 'Ratchet', 'State', 'Incident'];
const STATES = ['stated', 'guarded', 'witnessed', 'measured'];

// ── reading the register ──────────────────────────────────────────────────────────────────────
// Env read at CALL time. A `const X = process.env.Y` at import would make the planted fixtures
// below read whatever the suite's environment held when the module loaded, not what they set.
export function readRegister(env = process.env) {
  const override = env.CW_INVARIANTS_REGISTER;
  if (override) return { source: override, text: readFileSync(override, 'utf8') };
  try {
    return { source: `HEAD:${REGISTER}`, text: execFileSync('git', ['-C', CW, 'show', `HEAD:${REGISTER}`], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (e) {
    const stderr = String(e.stderr || e.message).trim();
    // Only "the path is not in HEAD" is a verdict. Anything else — no git, no HEAD, a broken
    // object store — means nothing was read, and a read that did not happen is not an absent doc.
    if (/does not exist in 'HEAD'|exists on disk, but not in 'HEAD'/.test(stderr)) {
      throw new Error(`${REGISTER} is absent at HEAD (${stderr})`);
    }
    throw new Error(`could not read ${REGISTER} from HEAD, which is not the same as it being absent: ${stderr}`);
  }
}

// ── existence at HEAD ─────────────────────────────────────────────────────────────────────────
export function existsAtHead(path, cwd = CW) {
  try {
    execFileSync('git', ['-C', cwd, 'cat-file', '-e', `HEAD:${path}`], { stdio: ['ignore', 'ignore', 'pipe'] });
    return true;
  } catch (e) {
    const stderr = String(e.stderr || e.message);
    if (/Not a valid object name|does not exist in|exists on disk, but not in|invalid object name/i.test(stderr)) return false;
    throw new Error(`git cat-file could not answer for ${path}: ${stderr.trim()}`);
  }
}

// ── glob matching ─────────────────────────────────────────────────────────────────────────────
// TEST_GLOBS are the shape `area/**/*.test.mjs`, which is all this needs to honour. `**/` is zero
// or more directories, `*` never crosses a slash.
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i += 1) {
    if (glob.startsWith('**/', i)) { re += '(?:.*/)?'; i += 2; continue; }
    const c = glob[i];
    if (c === '*') re += '[^/]*';
    else if (/[.+?^${}()|[\]\\]/.test(c)) re += `\\${c}`;
    else re += c;
  }
  return new RegExp(`^${re}$`);
}

export function matchesAnyGlob(path, globs = TEST_GLOBS) {
  return globs.some((g) => globToRegExp(g).test(path));
}

// ── parsing ───────────────────────────────────────────────────────────────────────────────────
function cells(line) {
  const trimmed = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  return trimmed.split('|').map((c) => c.trim());
}
const isSeparator = (cs) => cs.every((c) => /^:?-+:?$/.test(c));
const clean = (c) => c.replace(/`/g, '').trim();

export function parseRegister(text) {
  const lines = text.split(/\r?\n/);
  const rows = [];
  const errors = [];
  let headerAt = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (!/^\s*\|/.test(lines[i])) continue;
    const cs = cells(lines[i]);
    if (headerAt < 0) {
      if (cs.map(clean).join('|').toLowerCase() === COLUMNS.join('|').toLowerCase()) headerAt = i;
      continue;
    }
    if (isSeparator(cs)) continue;
    if (cs.length !== COLUMNS.length) {
      errors.push(`line ${i + 1}: ${cs.length} columns, expected ${COLUMNS.length} (${COLUMNS.join(' | ')})`);
      continue;
    }
    const [property, guard, witness, ratchet, state, incident] = cs.map(clean);
    rows.push({ line: i + 1, property, guard, witness, ratchet, state, incident });
  }
  if (headerAt < 0) errors.unshift(`no table with header ${COLUMNS.join(' | ')} found`);
  return { rows, errors };
}

// ── the check ─────────────────────────────────────────────────────────────────────────────────
// A cell is `none` or one or more repo-relative paths. Splitting on commas and whitespace means a
// cell holding prose produces garbage paths that fail, which is the direction a register should
// fail in — the alternative is a cell that says "none (see below)" reading as absent-and-fine.
function pathsOf(cell) {
  if (cell.toLowerCase() === 'none' || cell === '') return [];
  return cell.split(/[,\s]+/).filter(Boolean);
}

export function checkRegister(text, { exists = existsAtHead, globs = TEST_GLOBS } = {}) {
  const { rows, errors } = parseRegister(text);
  const failures = [...errors];
  const counts = Object.fromEntries(STATES.map((s) => [s, 0]));

  for (const r of rows) {
    const where = `line ${r.line} "${r.property}"`;
    const rank = STATES.indexOf(r.state);
    if (rank < 0) { failures.push(`${where}: unknown State "${r.state}" (one of ${STATES.join(', ')})`); continue; }
    counts[r.state] += 1;

    const guard = pathsOf(r.guard);
    const witness = pathsOf(r.witness);
    if (rank >= 1 && !guard.length) failures.push(`${where}: State ${r.state} with Guard none`);
    if (rank >= 2 && !witness.length) failures.push(`${where}: State ${r.state} with Witness none`);
    if (rank >= 3 && pathsOf(r.ratchet).length === 0) failures.push(`${where}: State measured with Ratchet none`);

    for (const [col, paths] of [['Guard', guard], ['Witness', witness]]) {
      for (const p of paths) {
        if (/^[/\\]|^[A-Za-z]:|\\|(^|\/)\.\.(\/|$)/.test(p)) { failures.push(`${where}: ${col} "${p}" is not a repo-relative path`); continue; }
        if (!exists(p)) failures.push(`${where}: ${col} "${p}" is not at HEAD`);
        else if (!matchesAnyGlob(p, globs)) failures.push(`${where}: ${col} "${p}" is at HEAD but matches no TEST_GLOBS entry, so npm test never runs it`);
      }
    }
  }
  return { rows, counts, failures };
}

const summary = (counts) => `rows: ${STATES.map((s) => `${s} ${counts[s]}`).join(' ')}`;

// ── the checker can FAIL ──────────────────────────────────────────────────────────────────────
// First, because every assertion below is consistent with a checker that returns [] for any input.
const fixture = (rows) => [
  `| ${COLUMNS.join(' | ')} |`,
  `|${COLUMNS.map(() => '---').join('|')}|`,
  ...rows.map((r) => `| ${r.join(' | ')} |`),
].join('\n') + '\n';

function withFixture(text, fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-invariants-'));
  const file = join(dir, 'INVARIANTS.md');
  writeFileSync(file, text);
  try { return fn(file); } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('PLANTED NEGATIVE — a guard path absent from HEAD is reported, and only that', () => {
  const text = fixture([['Fake property', '`bin/test/does-not-exist-anywhere.test.mjs`', 'none', 'none', 'guarded', 'none']]);
  withFixture(text, (file) => {
    const { text: read, source } = readRegister({ CW_INVARIANTS_REGISTER: file });
    assert.equal(source, file, 'the override must be the source when it is set');
    const r = checkRegister(read);
    assert.deepEqual(r.failures, ['line 3 "Fake property": Guard "bin/test/does-not-exist-anywhere.test.mjs" is not at HEAD']);
    assert.deepEqual(r.counts, { stated: 0, guarded: 1, witnessed: 0, measured: 0 });
  });
});

test('PLANTED POSITIVE — a guard that is at HEAD and under TEST_GLOBS passes', () => {
  const real = 'bin/test/tracked-imports.test.mjs';
  assert.ok(existsAtHead(real), `fixture assumption: ${real} is tracked at HEAD`);
  const text = fixture([
    ['Tracked imports', `\`${real}\``, 'none', 'none', 'guarded', '2026-08-25'],
    ['Something stated', 'none', 'none', 'none', 'stated', 'none'],
  ]);
  withFixture(text, (file) => {
    const r = checkRegister(readRegister({ CW_INVARIANTS_REGISTER: file }).text);
    assert.deepEqual(r.failures, []);
    assert.deepEqual(r.counts, { stated: 1, guarded: 1, witnessed: 0, measured: 0 });
  });
});

test('a path at HEAD but outside TEST_GLOBS fails — tracked is not the same as run', () => {
  const r = checkRegister(fixture([['Doc as guard', '`docs/TRAPS.md`', 'none', 'none', 'guarded', 'none']]));
  assert.equal(r.failures.length, 1);
  assert.match(r.failures[0], /matches no TEST_GLOBS entry/);
});

test('state ladder — each rung requires its column', () => {
  const real = 'bin/test/tracked-imports.test.mjs';
  const r = checkRegister(fixture([
    ['g none', 'none', 'none', 'none', 'guarded', 'none'],
    ['w none', `${real}`, 'none', 'none', 'witnessed', 'none'],
    ['r none', `${real}`, `${real}`, 'none', 'measured', 'none'],
    ['ok', `${real}`, `${real}`, 'bin/ratchet.mjs', 'measured', 'none'],
  ]));
  assert.deepEqual(r.failures, [
    'line 3 "g none": State guarded with Guard none',
    'line 4 "w none": State witnessed with Witness none',
    'line 5 "r none": State measured with Ratchet none',
  ]);
});

test('malformed rows and unknown states fail rather than parse as something', () => {
  const bad = fixture([['five', 'none', 'none', 'none', 'stated']]) + '| x | none | none | none | proven | none |\n';
  const r = checkRegister(bad);
  assert.deepEqual(r.failures, [
    'line 3: 5 columns, expected 6 (Property | Guard | Witness | Ratchet | State | Incident)',
    'line 4 "x": unknown State "proven" (one of stated, guarded, witnessed, measured)',
  ]);
  assert.deepEqual(checkRegister('# no table here\n').failures,
    ['no table with header Property | Guard | Witness | Ratchet | State | Incident found']);
});

test('glob matching is the runner\'s shape, in both directions', () => {
  assert.ok(matchesAnyGlob('bin/test/x.test.mjs'));
  assert.ok(matchesAnyGlob('bin/x.test.mjs'), '**/ matches zero directories');
  assert.ok(matchesAnyGlob('admin/test/deep/er/x.test.mjs'));
  assert.ok(!matchesAnyGlob('bin/lib/x.mjs'), 'a non-test module is not run by npm test');
  assert.ok(!matchesAnyGlob('docs/INVARIANTS.md'));
  assert.ok(!matchesAnyGlob('workflows/x.test.mjs'), 'an area not in TEST_GLOBS is not run');
  assert.ok(!globToRegExp('bin/**/*.test.mjs').test('bin/test/x.test.mjsx'));
});

test('a HEAD read that is not "absent" fails closed', () => {
  // The git invocation cannot be made to break from here without breaking the repo, so the
  // classification is exercised through the override path on a file that does not exist: ENOENT
  // from readFileSync must propagate, never read as an empty register.
  assert.throws(() => readRegister({ CW_INVARIANTS_REGISTER: join(tmpdir(), `cw-no-such-${process.pid}.md`) }), /ENOENT/);
});

// ── THE REGISTER AT HEAD ──────────────────────────────────────────────────────────────────────
test('EVERY ROW OF docs/INVARIANTS.md NAMES GUARDS THAT EXIST AT HEAD AND RUN UNDER npm test', () => {
  let reg;
  try { reg = readRegister(); } catch (e) { assert.fail(e.message); }
  const r = checkRegister(reg.text);
  console.log(summary(r.counts));
  assert.ok(r.rows.length > 0, `${reg.source} has no rows — a register with nothing in it is not a pass`);
  assert.deepEqual(r.failures, [], `${reg.source}: a row claims a guard the repository does not have`);
});
