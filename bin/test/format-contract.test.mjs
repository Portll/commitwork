// Every `report.format` a committed manifest declares must have a committed reader — asserted over
// THIS repository at HEAD, and over two commits that prove the checker can fail and pass.
//
// The instance: a commit declared `report.format: "bearer"` in `manifests/security-baseline.json`
// without `bin/commitwork.mjs`'s bearer branch, and `parseReport('bearer', <a 171-finding report>)`
// returned `{ok:true, sev:'ok'}`. A later commit repaired it. A scratch repository replays that
// pair below: a test that only ever passes is an assertion, and this repository has been bitten by
// exactly that.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { contractViolations, setLiteral, hasBranch } from '../lib/format-contract.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const gitIn = (dir, ...a) => execFileSync('git', ['-C', dir, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const READER = 'bin/commitwork.mjs';

/** Manifests + reader source as they exist AT A COMMIT. No worktree, no checkout, no registry. */
function atRev(rev, dir = CW) {
  const paths = gitIn(dir, 'ls-tree', '-r', '--name-only', rev, 'manifests/').split('\n')
    .filter((f) => f.endsWith('.json'));
  const manifests = [];
  for (const p of paths) {
    let json; try { json = JSON.parse(gitIn(dir, 'show', `${rev}:${p}`)); } catch { continue; }
    manifests.push({ path: p, json });
  }
  return { manifests, readerSource: gitIn(dir, 'show', `${rev}:${READER}`) };
}

// The shipped defect and its repair as two commits: the manifest declares bearer before the reader
// can read it, then the reader gains the set entry and the branch.
function defectAndRepair(t) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-format-contract-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...a) => gitIn(dir, ...a);
  const commit = (msg) => { git('add', '-A'); git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', msg); return git('rev-parse', 'HEAD').trim(); };
  git('init', '-q');
  mkdirSync(join(dir, 'manifests')); mkdirSync(join(dir, 'bin'));
  writeFileSync(join(dir, 'manifests', 'security-baseline.json'), JSON.stringify({ checks: [
    { id: 'sast-semgrep', report: { format: 'sarif' } },
    { id: 'sast-bearer', report: { format: 'bearer' } },
  ] }));
  const reader = (formats, branches) => `export const PARSED_FORMATS = new Set([${formats.map((f) => `'${f}'`).join(', ')}]);\n`
    + "export const PASSTHROUGH_FORMATS = new Set(['json']);\n"
    + branches.map((f) => `if (format === '${f}') { }\n`).join('');
  writeFileSync(join(dir, READER), reader(['sarif'], ['sarif']));
  const defect = commit('declare bearer');
  writeFileSync(join(dir, READER), reader(['sarif', 'bearer'], ['sarif', 'bearer']));
  const repair = commit('read bearer');
  return { dir, defect, repair };
}

// ── the negative control, first ──────────────────────────────────────────────
// Everything below is consistent with a checker that returns [] for any input, and this repo has
// been bitten by exactly that (scanners.stubs read {high:4322, low:0} while every row said low).
test('the checker can FAIL — a declared format with no reader is reported', () => {
  const reader = "export const PARSED_FORMATS = new Set(['sarif']);\n"
    + "export const PASSTHROUGH_FORMATS = new Set(['json']);\n"
    + "if (format === 'sarif') { }\n";
  const m = [{ path: 'manifests/x.json', json: { checks: [{ id: 'lane', report: { format: 'bearer' } }] } }];
  const v = contractViolations(m, reader);
  assert.equal(v.length, 1, 'an unreadable declared format must be reported');
  assert.equal(v[0].format, 'bearer');
  assert.match(v[0].why, /no committed reader/);

  const ok = [{ path: 'manifests/x.json', json: { checks: [{ id: 'lane', report: { format: 'sarif' } }] } }];
  assert.deepEqual(contractViolations(ok, reader), [], 'and must NOT be reported once a reader exists');
});

// The second clause. A format can be IN PARSED_FORMATS and still have no branch — the set entry is
// a declaration, the branch is the effect. f2e7c79 trips either clause; a future commit that adds
// the entry and forgets the branch trips only this one.
test('a format in PARSED_FORMATS with no matching branch is reported', () => {
  const reader = "export const PARSED_FORMATS = new Set(['bearer']);\n"
    + "export const PASSTHROUGH_FORMATS = new Set(['json']);\n";   // declared, never branched
  const m = [{ path: 'manifests/x.json', json: { checks: [{ id: 'lane', report: { format: 'bearer' } }] } }];
  const v = contractViolations(m, reader);
  assert.equal(v.length, 1);
  assert.match(v[0].why, /no \`format === 'bearer'\` branch/);
  assert.deepEqual(contractViolations(m, `${reader}if (format === 'bearer') { }\n`), [],
    'and clears once the branch is committed');
});

// FAIL CLOSED. A reader refactor that renames or reshapes the declarations makes every format
// unverifiable — and "unverifiable" must not render as "satisfied", which is the whole defect class.
test('a reader whose declarations cannot be found is a VOID, not a pass', () => {
  const m = [{ path: 'manifests/x.json', json: { checks: [{ id: 'lane', report: { format: 'sarif' } }] } }];
  const v = contractViolations(m, 'export const SOMETHING_ELSE = new Set([]);\n');
  assert.equal(v.length, 1);
  assert.match(v[0].why, /unverifiable, which is not the same as satisfied/);
  assert.equal(setLiteral('nothing here', 'PARSED_FORMATS'), null, 'absent declaration is null, not an empty Set');
  assert.deepEqual(setLiteral("export const PARSED_FORMATS = new Set([]);", 'PARSED_FORMATS'), new Set(),
    'an empty declaration is an empty Set — a different claim from absent');
});

test('hasBranch is not fooled by a substring or a regex metacharacter', () => {
  assert.ok(hasBranch("if (format === 'npm-audit') {", 'npm-audit'));
  assert.ok(!hasBranch("if (format === 'npm-auditX') {", 'npm-audit'), 'a longer neighbouring format must not vouch');
  assert.ok(!hasBranch("if (format === 'npmXaudit') {", 'npm-audit'), 'the hyphen must be literal, not any-char');
});

// ── the fixtures: both directions, against commits ───────────────────────────
test('FAILS at the commit that shipped the silent green, PASSES at its repair', (t) => {
  const { dir, defect, repair } = defectAndRepair(t);
  const before = atRev(defect, dir);
  const v = contractViolations(before.manifests, before.readerSource);
  const bearer = v.find((x) => x.format === 'bearer');
  assert.ok(bearer, `expected a bearer violation at the defect, got ${JSON.stringify(v)}`);
  assert.equal(bearer.check, 'sast-bearer');
  assert.match(bearer.manifest, /security-baseline\.json$/);
  assert.equal(v.length, 1, 'the sarif check beside it is readable and must not be reported');

  const after = atRev(repair, dir);
  assert.deepEqual(contractViolations(after.manifests, after.readerSource), []);
});

// ── the live assertion ───────────────────────────────────────────────────────
// HEAD, not the working tree. The property is about what a CLONE gets, and this tree always has
// several sessions mid-edit — reading the working copy would fail on legitimate in-flight work.
// Committing a half of the pair is the moment it becomes everyone's problem, and that is the moment
// this must fail.
test('every format declared at HEAD has a committed reader', () => {
  const { manifests, readerSource } = atRev('HEAD');
  assert.ok(manifests.length > 0, 'fixture assumption: HEAD carries manifests/*.json');
  const v = contractViolations(manifests, readerSource);
  assert.deepEqual(v, [], v.map((x) => `${x.manifest} check '${x.check}' ${x.why}`).join('\n  '));
});
