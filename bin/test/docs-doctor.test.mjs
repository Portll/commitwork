// docs-doctor — pins the classification contract: explicit uncertainty, stale stamps orange, SUPERSEDED
// belongs in archive, the README index gates both directions, generated/archived/cycle docs are
// never freshness-gated, and <!-- living-doc --> claims the living tier explicitly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, statSync, utimesSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname, resolve, delimiter } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { collectDocs, verdict, realDate, datedCycleDoc, measurementRaw } from '../docs-doctor.mjs';

const NOW = new Date('2026-07-29T12:00:00Z');

function fixtureRoot({ readmeIndex = '', extra = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'docs-doctor-'));
  writeFileSync(join(root, 'README.md'),
    `<!-- verified-against: 2026-07-29 -->\n# fixture\n\n## Documentation\n\n${readmeIndex}\n`);
  for (const [rel, content] of Object.entries(extra)) {
    mkdirSync(join(root, rel, '..'), { recursive: true });
    writeFileSync(join(root, rel), content);
  }
  return root;
}

const byPath = (r, p) => r.docs.find((d) => d.path === p);

test('an index entry may link out; a URL is not checked as a missing doc', () => {
  const root = fixtureRoot({
    readmeIndex: '- [m](mod/README.md) — repairs for [upstream/tool](https://example.com/upstream/tool)\n- [gone](mod/GONE.md)',
    extra: { 'mod/README.md': '<!-- verified-against: 2026-07-29 -->\n# mod\n' },
  });
  const reasons = collectDocs({ root, now: NOW }).indexFindings.map((f) => f.reason);
  assert.deepEqual(reasons, ['doc index links to missing file: mod/GONE.md']);
});

test('prompt inputs and upstream drafts are not docs of this repo, so they are not gated', () => {
  const root = fixtureRoot({
    extra: {
      'prompts/overwatch.md': '# a prompt an LLM tool sends\n',
      'joernwork/upstream-drafts/01-fix.md': '# an issue text for another project\n',
      'mod/README.md': '# a real doc, unstamped\n',
    },
  });
  const r = collectDocs({ root, now: NOW });
  assert.equal(byPath(r, 'prompts/overwatch.md'), undefined);
  assert.equal(byPath(r, 'joernwork/upstream-drafts/01-fix.md'), undefined);
  assert.equal(byPath(r, 'mod/README.md').status, 'orange', 'the control: an ordinary doc is still gated');
});

test('unstamped durable doc is explicit uncertainty', () => {
  const root = fixtureRoot({
    readmeIndex: '- [m](mod/README.md)',
    extra: { 'mod/README.md': '# mod\nno stamp here\n' },
  });
  const r = collectDocs({ root, now: NOW });
  const d = byPath(r, 'mod/README.md');
  assert.equal(d.status, 'grey');
  assert.match(d.reasons.join(), /freshness unknown/);
  assert.equal(verdict(r), 2); // grey-only exit code
});

test('fresh stamp green; stale stamp orange; CW_NOW makes it deterministic', () => {
  const root = fixtureRoot({
    readmeIndex: '- [f](fresh/README.md)\n- [s](stale/README.md)',
    extra: {
      'fresh/README.md': '<!-- verified-against: 2026-07-20 -->\n# fresh\n',
      'stale/README.md': '<!-- verified-against: 2026-05-01 abc1234 -->\n# stale\n',
    },
  });
  const r = collectDocs({ root, now: NOW, maxAgeDays: 30 });
  assert.equal(byPath(r, 'fresh/README.md').status, 'green');
  const stale = byPath(r, 'stale/README.md');
  assert.equal(stale.status, 'orange');
  assert.equal(stale.stamp.sha, 'abc1234');
  assert.equal(verdict(r), 1);
});

test('SUPERSEDED outside archive is orange; inside archive is informational', () => {
  const root = fixtureRoot({
    extra: {
      'OLD-PLAN.md': '> **SUPERSEDED — archived 2026-07-29.** gone.\n\n# old\n',
      'evaluations/archive/DONE.md': '> **SUPERSEDED — archived 2026-07-29.** done.\n\n# done\n',
      'evaluations/archive/NAKED.md': '# archived without banner\n',
      'evaluations/CORRECTED.md': '> **SUPERSEDED IN PART — see the CORRECTION at the foot.**\n\n# bench\n',
    },
  });
  const r = collectDocs({ root, now: NOW });
  assert.equal(byPath(r, 'OLD-PLAN.md').status, 'orange');
  assert.ok(!byPath(r, 'evaluations/CORRECTED.md').reasons.some((x) => /SUPERSEDED/.test(x)), 'a partial supersession is not a closed cycle');
  assert.equal(byPath(r, 'evaluations/archive/DONE.md').status, 'archived');
  assert.equal(byPath(r, 'evaluations/archive/NAKED.md').status, 'orange');
});

test('index gates both directions: unlisted durable doc orange; dangling index link is a finding', () => {
  const root = fixtureRoot({
    readmeIndex: '- [ghost](ghost/README.md)',
    extra: { 'mod/README.md': '<!-- verified-against: 2026-07-29 -->\n# mod\n' },
  });
  const r = collectDocs({ root, now: NOW });
  const d = byPath(r, 'mod/README.md');
  assert.equal(d.status, 'orange');
  assert.match(d.reasons.join(), /not listed/);
  assert.equal(r.indexFindings.length, 1);
  assert.match(r.indexFindings[0].reason, /ghost\/README.md/);
});

test('diff cache: unchanged files are not reopened; changed files are; output identical either way', () => {
  const root = fixtureRoot({
    readmeIndex: '- [m](mod/README.md)',
    extra: { 'mod/README.md': '<!-- verified-against: 2026-07-20 -->\n# mod original\n' },
  });
  const cachePath = join(root, 'cache.json');
  // pin mtime to whole seconds: sub-ms filesystem precision must not decide a cache test
  const p = join(root, 'mod/README.md');
  const PINNED = new Date('2026-07-01T00:00:00Z');
  utimesSync(p, PINNED, PINNED);
  const cold = collectDocs({ root, now: NOW, cachePath });
  assert.equal(cold.readCount, cold.docs.length); // cold cache reads every head
  assert.ok(existsSync(cachePath));

  // warm run, nothing touched: zero reads, byte-identical result
  const warm = collectDocs({ root, now: NOW, cachePath });
  assert.equal(warm.readCount, 0);
  assert.deepEqual(warm.docs, cold.docs);

  // same byte length and mtime — the doctor must serve cached facts without reopening
  const st = statSync(p);
  writeFileSync(p, '<!-- verified-against: 2026-01-01 -->\n# mod POISONED\n'.padEnd(st.size, ' ').slice(0, st.size));
  utimesSync(p, PINNED, PINNED);
  const skipped = collectDocs({ root, now: NOW, cachePath });
  assert.equal(byPath(skipped, 'mod/README.md').title, 'mod original');

  // a real change (mtime moves) is picked up
  utimesSync(p, new Date(), new Date());
  const reread = collectDocs({ root, now: NOW, cachePath });
  assert.equal(byPath(reread, 'mod/README.md').title, 'mod POISONED');
  assert.equal(byPath(reread, 'mod/README.md').status, 'orange'); // 2026-01-01 stamp is stale now

  // cachePath: null disables the layer entirely
  const uncached = collectDocs({ root, now: NOW, cachePath: null });
  assert.equal(uncached.readCount, uncached.docs.length);
});

test('a 300KB doc costs a bounded head read, and its tail never affects classification', () => {
  const big = '<!-- verified-against: 2026-07-25 -->\n# big\n' + 'x'.repeat(300 * 1024) +
    '\n**SUPERSEDED** (a banner in the tail must NOT count — only the head is load-bearing)';
  const root = fixtureRoot({ readmeIndex: '- [big](mod/BIG.md)', extra: { 'mod/BIG.md': big } });
  const r = collectDocs({ root, now: NOW, cachePath: null });
  assert.equal(byPath(r, 'mod/BIG.md').status, 'green');
});

test('a dated root doc is a cycle artifact WHEREVER the date sits in the name', () => {
  const dated = {
    'REMEDIATION-2026-07-29.md': '# date is the whole suffix (the only shape that used to pass)',
    'REMEDIATION-client-d-2026-07-30.md': '# one project segment before the date',
    'REMEDIATION-client-a-2026-07-30.md': '# a project name that itself contains a dash',
    'SCANNER-BACKLOG-2026-07-31.md': '# not a REMEDIATION at all, but still a dated artifact',
    'REMEDIATION-2026-07-31-followup.md': '# date in the MIDDLE, trailing words after it',
  };
  const root = fixtureRoot({ extra: dated });
  const r = collectDocs({ root, now: NOW, cachePath: null });
  for (const name of Object.keys(dated)) {
    const d = byPath(r, name);
    assert.equal(d.status, 'cycle', `${name} carries a real date and must classify as a cycle artifact`);
    assert.match(d.reasons.join(), /move under evaluations/,
      `${name} is still at root — the reminder to file it must survive the reclassification`);
  }
});

test('a date-SHAPED name that names no real day stays durable and is still gated', () => {
  const fake = {
    'REMEDIATION-bad-2026-13-45.md': 'month 13, day 45',
    'REMEDIATION-bad-2026-02-30.md': 'February never has 30 days',
    'REMEDIATION-bad-2026-00-10.md': 'month zero',
    'REMEDIATION-bad-2026-7-3.md': 'unpadded — not the ISO shape at all',
    'REMEDIATION-bad-20260730.md': 'no separators',
  };
  const root = fixtureRoot({ extra: fake });
  const r = collectDocs({ root, now: NOW, cachePath: null });
  for (const name of Object.keys(fake)) {
    assert.notEqual(byPath(r, name).status, 'cycle',
      `${name} must NOT buy the cycle exemption with a date that does not exist`);
  }
});

// Cycle status suppresses the stamp gate, the index gate AND the root allowlist at once.
test('a dated root doc of an UNKNOWN kind is still gated — the date is not a skeleton key', () => {
  const strays = {
    'NOTES-2026-07-31.md': 'a real date, but not a cycle artifact',
    'ARCHITECTURE-2026-07-31.md': 'ditto — durable content wearing a date',
    'TODO-2026-07-30.md': 'ditto',
  };
  const root = fixtureRoot({ extra: strays });
  const r = collectDocs({ root, now: NOW, cachePath: null });
  for (const name of Object.keys(strays)) {
    const d = byPath(r, name);
    assert.notEqual(d.status, 'cycle', `${name} is not a REMEDIATION/SCANNER-BACKLOG — a date must not exempt it`);
    assert.match(d.reasons.join(), /root is reserved/,
      `${name} must still be told it does not belong at root`);
  }
});

test('realDate accepts real days and refuses impossible ones', () => {
  for (const ok of ['2026-07-31', '2024-02-29', '2026-01-01', '2026-12-31', '2000-02-29'])
    assert.equal(realDate(ok), true, `${ok} is a real day`);
  for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '2026-04-31', '2023-02-29',
    '2026-7-31', '20260731', '', 'not-a-date'])
    assert.equal(realDate(bad), false, `${bad} names no real day`);
});

// Root-only: inside a module a dated filename is just a filename, and module docs stay durable.
test('a dated doc inside a module is NOT reclassified — it still answers to the stamp', () => {
  const root = fixtureRoot({
    readmeIndex: '- [m](mod/NOTES-2026-07-30.md)',
    extra: { 'mod/NOTES-2026-07-30.md': '# a module doc that happens to carry a date\n' },
  });
  const r = collectDocs({ root, now: NOW, cachePath: null });
  const d = byPath(r, 'mod/NOTES-2026-07-30.md');
  assert.notEqual(d.status, 'cycle', 'a module doc must not escape the stamp gate via its filename');
  assert.equal(d.status, 'grey', 'unstamped module doc is unmeasured because freshness is unknown');
});

test('generated and cycle docs are never freshness-gated; stray root doc is orange', () => {
  const root = fixtureRoot({
    extra: {
      'evaluations/audit-x/queue-copy.md': '# q\nGenerated by node bin/reconcile-findings.mjs\n',
      'evaluations/audit-x/notes.md': '# cycle notes\n',
      'REMEDIATION-2026-07-29.md': '# master audit\n',
      'STRAY.md': '<!-- verified-against: 2026-07-29 -->\n# stray at root\n',
    },
  });
  const r = collectDocs({ root, now: NOW });
  assert.equal(byPath(r, 'evaluations/audit-x/queue-copy.md').status, 'generated');
  assert.equal(byPath(r, 'evaluations/audit-x/notes.md').status, 'cycle');
  const rem = byPath(r, 'REMEDIATION-2026-07-29.md');
  assert.equal(rem.status, 'cycle');
  assert.match(rem.reasons.join(), /move under evaluations/);
  assert.equal(byPath(r, 'STRAY.md').status, 'orange');
});

// ── THE LIVING TIER ─────────────────────────────────────────────────────────────────────────────
// The marker is explicit so the tier is claimed in a reviewable diff, never inherited from a path.
test('a living-marked doc in evaluations/ is living, not cycle, and an ancient stamp does not gate it', () => {
  const root = fixtureRoot({
    readmeIndex: '- [d](evaluations/DECISIONS.md)',
    extra: { 'evaluations/DECISIONS.md': '<!-- living-doc -->\n<!-- verified-against: 2025-01-01 -->\n# decisions\n' },
  });
  const r = collectDocs({ root, now: NOW, maxAgeDays: 30 });
  const d = byPath(r, 'evaluations/DECISIONS.md');
  assert.equal(d.status, 'living', 'the marker outranks the evaluations/ path rule');
  assert.equal(d.stamp.date, '2025-01-01', 'the stamp is carried as information');
  assert.equal(verdict(r), 0, 'a year-old stamp on a living register gates nothing');
});

test('a living register must still be findable — unlisted in the README index is orange', () => {
  const root = fixtureRoot({
    extra: { 'evaluations/DECISIONS.md': '<!-- living-doc -->\n# decisions\n' },
  });
  const d = byPath(collectDocs({ root, now: NOW }), 'evaluations/DECISIONS.md');
  assert.equal(d.status, 'orange');
  assert.match(d.reasons.join(), /not listed/);
});

test('the living marker is not a root skeleton key — a living stray at root is still orange', () => {
  const root = fixtureRoot({
    readmeIndex: '- [s](STRAY-REGISTER.md)',
    extra: { 'STRAY-REGISTER.md': '<!-- living-doc -->\n# stray\n' },
  });
  const d = byPath(collectDocs({ root, now: NOW }), 'STRAY-REGISTER.md');
  assert.equal(d.status, 'orange');
  assert.match(d.reasons.join(), /root is reserved/);
});

test('editing a living doc after its stamp is its NORMAL state — the git drift check must not fire', () => {
  const { root, sha } = gitFixture({ 'mod/M.md': '<!-- verified-against: 2026-07-29 PLACEHOLDER -->\n# m\n' });
  writeFileSync(join(root, 'README.md'), '<!-- verified-against: 2026-07-29 -->\n# r\n\n## Documentation\n\n- [m](mod/M.md)\n- [d](evaluations/DECISIONS.md)\n');
  mkdirSync(join(root, 'evaluations'), { recursive: true });
  writeFileSync(join(root, 'evaluations/DECISIONS.md'), `<!-- living-doc -->\n<!-- verified-against: 2026-07-29 ${sha} -->\n# decisions\noriginal\n`);
  git(root, 'add', '-A'); git(root, 'commit', '-qm', 'stamp');
  writeFileSync(join(root, 'evaluations/DECISIONS.md'), `<!-- living-doc -->\n<!-- verified-against: 2026-07-29 ${sha} -->\n# decisions\nrulings recorded, register updated\n`);
  git(root, 'commit', '-qam', 'the register doing its job');
  const d = byPath(collectDocs({ root, now: NOW, cachePath: null }), 'evaluations/DECISIONS.md');
  assert.equal(d.status, 'living', 'edited-since-stamp is what a living register is FOR');
});

// ── THE SHA HALF OF THE STAMP ───────────────────────────────────────────────────────────────────
// The stamp's sha is compared against real history; these tests build a REAL git repo because the
// property under test is a git one.
const git = (cwd, ...args) => {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
  return r.stdout.trim();
};

function gitFixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'cw-dd-git-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 't@example.com');
  git(root, 'config', 'user.name', 'T');
  writeFileSync(join(root, 'README.md'), '<!-- verified-against: 2026-07-29 -->\n# r\n\n## Documentation\n\n- [m](mod/M.md)\n');
  mkdirSync(join(root, 'mod'), { recursive: true });
  for (const [p, body] of Object.entries(files)) writeFileSync(join(root, p), body);
  git(root, 'add', '-A');
  git(root, 'commit', '-qm', 'base');
  return { root, sha: git(root, 'rev-parse', '--short', 'HEAD') };
}

test('a doc EDITED after the commit its stamp names is orange, not green', () => {
  const { root, sha } = gitFixture({ 'mod/M.md': '<!-- verified-against: 2026-07-29 PLACEHOLDER -->\n# m\noriginal\n' });
  // stamp it at the base commit, commit that, THEN change the content in a later commit
  writeFileSync(join(root, 'mod/M.md'), `<!-- verified-against: 2026-07-29 ${sha} -->\n# m\noriginal\n`);
  git(root, 'commit', '-qam', 'stamp');
  writeFileSync(join(root, 'mod/M.md'), `<!-- verified-against: 2026-07-29 ${sha} -->\n# m\nREWRITTEN without re-stamping\n`);
  git(root, 'commit', '-qam', 'edit the content, leave the stamp alone');

  const d = byPath(collectDocs({ root, now: NOW, cachePath: null }), 'mod/M.md');
  assert.equal(d.status, 'orange', 'content moved after the commit the stamp claims — that is not verified');
  assert.match(d.reasons.join(), /changed in 1 commit\(s\) since the stamp was written/);
});

// Recording a stamp necessarily edits the doc AFTER the commit the stamp names.
test('a change confined to the STAMP LINE is the act of stamping, not un-restamped drift', () => {
  const { root, sha } = gitFixture({ 'mod/M.md': '<!-- verified-against: 2026-07-29 -->\n# m\nbody\n' });
  writeFileSync(join(root, 'mod/M.md'), `<!-- verified-against: 2026-07-29 ${sha} -->\n# m\nbody\n`);
  git(root, 'commit', '-qam', 'stamp only');

  const d = byPath(collectDocs({ root, now: NOW, cachePath: null }), 'mod/M.md');
  assert.equal(d.status, 'green', 'stamping must not flag the doc it just stamped');
});

// Verifying usually means CORRECTING, so the fix and the refreshed stamp land in ONE commit:
// the stamp names the parent while the content lands in the child.
test('verifying a doc and re-stamping it in ONE commit is not drift', () => {
  const { root, sha } = gitFixture({ 'mod/M.md': '<!-- verified-against: 2026-07-29 -->\n# m\nclaim: 541 widgets\n' });
  writeFileSync(join(root, 'mod/M.md'), `<!-- verified-against: 2026-07-29 ${sha} -->\n# m\nclaim: 586 widgets\n`);
  git(root, 'commit', '-qam', 'correct the claim AND refresh the stamp, together');

  const d = byPath(collectDocs({ root, now: NOW, cachePath: null }), 'mod/M.md');
  assert.equal(d.status, 'green', 'the content change IS the verification the stamp records');
});

test('a stamp naming a commit this repo does not contain is orange — a foreign sha attests nothing', () => {
  // the realistic source: a per-project audit doc stamped with the AUDITED repo's HEAD
  const { root } = gitFixture({ 'mod/M.md': '<!-- verified-against: 2026-07-29 deadbee -->\n# m\nbody\n' });
  const d = byPath(collectDocs({ root, now: NOW, cachePath: null }), 'mod/M.md');
  assert.equal(d.status, 'orange');
  assert.match(d.reasons.join(), /does not contain/);
});

test('a stamp naming a commit outside HEAD\'s history is orange even though the object exists', () => {
  // the realistic source: a history rewrite, which leaves the old commits in the object store
  const { root } = gitFixture({ 'mod/M.md': '<!-- verified-against: 2026-07-29 -->\n# m\nbody\n' });
  git(root, 'checkout', '-qb', 'side');
  writeFileSync(join(root, 'side.txt'), 'x\n');
  git(root, 'add', 'side.txt'); git(root, 'commit', '-qm', 'side only');
  const orphan = git(root, 'rev-parse', '--short', 'HEAD');
  git(root, 'checkout', '-q', '-');
  writeFileSync(join(root, 'mod/M.md'), `<!-- verified-against: 2026-07-29 ${orphan} -->\n# m\nbody\n`);
  git(root, 'commit', '-qam', 'stamp against a commit this branch does not contain');
  const d = byPath(collectDocs({ root, now: NOW, cachePath: null }), 'mod/M.md');
  assert.equal(d.status, 'orange', 'an object that exists is not a commit this history contains');
  assert.match(d.reasons.join(), /not in HEAD's history/);
  // an off-history stamp must not hide later edits: translating the sha would otherwise clear both
  writeFileSync(join(root, 'mod/M.md'), `<!-- verified-against: 2026-07-29 ${orphan} -->\n# m\nedited after the stamp\n`);
  git(root, 'commit', '-qam', 'edit');
  const both = byPath(collectDocs({ root, now: NOW, cachePath: null }), 'mod/M.md').reasons.join('\n');
  assert.match(both, /not in HEAD's history/);
  assert.match(both, /changed in 1 commit\(s\) since the stamp was written/);
});

test('a doc with a date-only stamp is unaffected — the sha is optional and its absence is not a claim', () => {
  const { root } = gitFixture({ 'mod/M.md': '<!-- verified-against: 2026-07-29 -->\n# m\nbody\n' });
  writeFileSync(join(root, 'mod/M.md'), '<!-- verified-against: 2026-07-29 -->\n# m\nchanged freely\n');
  git(root, 'commit', '-qam', 'edit');
  assert.equal(byPath(collectDocs({ root, now: NOW, cachePath: null }), 'mod/M.md').status, 'green');
});

test('the git check is a JUDGMENT, never cached — a cache hit cannot carry a stale verdict', () => {
  const { root, sha } = gitFixture({ 'mod/M.md': '<!-- verified-against: 2026-07-29 -->\n# m\nbody\n' });
  writeFileSync(join(root, 'mod/M.md'), `<!-- verified-against: 2026-07-29 ${sha} -->\n# m\nbody\n`);
  git(root, 'commit', '-qam', 'stamp');
  const cache = join(root, 'cache.json');
  assert.equal(byPath(collectDocs({ root, now: NOW, cachePath: cache }), 'mod/M.md').status, 'green');
  // same bytes on disk, but HEAD moves underneath it — the verdict must change even on a cache hit
  writeFileSync(join(root, 'other.md'), '<!-- verified-against: 2026-07-29 -->\n# o\n');
  writeFileSync(join(root, 'mod/M.md'), `<!-- verified-against: 2026-07-29 ${sha} -->\n# m\nbody edited\n`);
  git(root, 'add', '-A'); git(root, 'commit', '-qm', 'move HEAD and edit');
  assert.equal(byPath(collectDocs({ root, now: NOW, cachePath: cache }), 'mod/M.md').status, 'orange',
    'the cache stores facts, not verdicts');
});

test('CW_DOCS_GIT=0 disables the check, and a non-git tree is inapplicable rather than failed', () => {
  const { root, sha } = gitFixture({ 'mod/M.md': '<!-- verified-against: 2026-07-29 -->\n# m\nbody\n' });
  writeFileSync(join(root, 'mod/M.md'), `<!-- verified-against: 2026-07-29 ${sha} -->\n# m\nbody\n`);
  git(root, 'commit', '-qam', 'stamp');
  writeFileSync(join(root, 'mod/M.md'), `<!-- verified-against: 2026-07-29 ${sha} -->\n# m\nedited\n`);
  git(root, 'commit', '-qam', 'edit');
  assert.equal(byPath(collectDocs({ root, now: NOW, cachePath: null, git: false }), 'mod/M.md').status, 'green',
    'explicitly disabled');
  // a plain fixture dir is not a versioned tree, so it carries no git claims at all
  const plain = fixtureRoot({ readmeIndex: '- [m](mod/M.md)', extra: { 'mod/M.md': '<!-- verified-against: 2026-07-29 abc1234 -->\n# m\n' } });
  assert.equal(byPath(collectDocs({ root: plain, now: NOW, cachePath: null }), 'mod/M.md').status, 'green',
    'no repo means no git claim to check — not a silent pass over a real one');
});

// ── MEASUREMENT PROVENANCE (P1-EXTEND, cw-adjudication-integrity task 10) ───────────────────────
// Raw --json output differs run-to-run only in `generatedAt` and `readCount` — properties of the
// RUN, not the doc set — so measurementRaw() strips them and digests the rest.
test('measurementRaw is stable across clock and cache warmth, and moves when a doc moves', () => {
  const root = fixtureRoot({
    readmeIndex: '- [m](mod/README.md)',
    extra: { 'mod/README.md': '<!-- verified-against: 2026-07-20 -->\n# mod\n' },
  });
  const cachePath = join(root, 'cache.json');
  const cold = collectDocs({ root, now: NOW, cachePath });
  const warm = collectDocs({ root, now: new Date('2026-07-29T12:00:07Z'), cachePath });
  assert.notEqual(cold.readCount, warm.readCount, 'the fixture must actually vary cache warmth');
  assert.notEqual(cold.generatedAt, warm.generatedAt, 'and the clock');
  assert.equal(measurementRaw(cold), measurementRaw(warm),
    'same doc set, different run — the stable raw must not move');

  writeFileSync(join(root, 'mod/README.md'), '<!-- verified-against: 2026-05-01 -->\n# mod went stale\n');
  const moved = collectDocs({ root, now: NOW, cachePath: null });
  assert.notEqual(measurementRaw(cold), measurementRaw(moved),
    'a doc that moved must move the digest — that is the discrimination the digest buys');
});

test('the journal record carries a measured block for the in-process scan', () => {
  // Journaling is gated on root === repoRoot(), so this one spawn runs against the REAL repo with
  // every store pointed at scratch; only the record's shape is asserted here.
  const HERE = dirname(fileURLToPath(import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'cw-dd-prov-'));
  const r = spawnSync(process.execPath, [resolve(HERE, '..', 'docs-doctor.mjs')], {
    encoding: 'utf8', timeout: 120_000,
    env: {
      ...process.env,
      CW_VERDICT_DIR: join(dir, 'verdicts'),
      CW_DOCS_CACHE: join(dir, 'cache.json'),
      CW_DOCS_GIT: '0',
    },
  });
  assert.ok([0, 1, 2].includes(r.status), `docs-doctor exits its verdict, got ${r.status}: ${r.stderr}`);
  const recs = readFileSync(join(dir, 'verdicts', 'docs-doctor.jsonl'), 'utf8')
    .split('\n').filter(Boolean).map((l) => JSON.parse(l));
  assert.equal(recs.length, 1);
  const m = recs[0].measured;
  assert.ok(m, 'a record with no measured block cannot prove the scan ran');
  assert.match(m.digest, /^sha256:[0-9a-f]{16}$/);
  assert.match(m.source, /in-process/, 'the source says there was no child — the gate IS the scanner');
  assert.equal(m.ok, true);
  assert.ok(recs[0].headSha, 'and which tree, or responsiveness can never be computed');
});

test('check-failed: a git failure MID-CHECK fails the doc closed (orange), never green', (t) => {
  // rev-parse/cat-file succeed, then a later git call fails — a PATH shim fails exactly the
  // subcommand under test; both check-failed branches are exercised
  //
  // WINDOWS: this technique is POSIX-only, in three independent ways, and the honest response is
  // to SKIP rather than to fake it. The shim is a `#!/bin/sh` script written to a file named `git`
  // with no extension — Windows will not execute that whatever the PATH says, because a shebang is
  // not an executable format there and PATHEXT has nothing to match. Reproducing the shim as a
  // .cmd would be a different test of a different thing.
  //
  // Two smaller Windows bugs were in here too and are fixed rather than skipped around, because
  // they would have silently mis-set PATH on any future win32 branch: `spawnSync('sh', …)` assumed
  // a shell that is absent from a stock PATH, and the shim directory was joined onto PATH with a
  // LITERAL COLON. The PATH separator is `;` on Windows, so that line did not prepend a directory —
  // it corrupted the whole variable into one unusable entry.
  if (process.platform === 'win32') {
    t.skip('POSIX-only: a #!/bin/sh shim named `git` is not executable on Windows');
    return;
  }
  const realGit = spawnSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).stdout.trim();
  assert.ok(realGit, 'need a real git to shim around');
  for (const [failCmd, expect] of [
    ['rev-list', /could not count commits .* refusing to report this as verified/],
    ['log', /could not locate the commit that wrote this stamp; refusing/],
  ]) {
    const { root, sha } = gitFixture({ 'mod/M.md': '<!-- verified-against: 2026-07-28 PLACEHOLDER -->\n# m\nbody\n' });
    writeFileSync(join(root, 'mod/M.md'), `<!-- verified-against: 2026-07-28 ${sha} -->\n# m\nbody\n`);
    git(root, 'commit', '-qam', 'stamp');
    const shimDir = mkdtempSync(join(tmpdir(), 'cw-dd-shim-'));
    writeFileSync(join(shimDir, 'git'),
      `#!/bin/sh\nfor a in "$@"; do [ "$a" = "${failCmd}" ] && exit 1; done\nexec "${realGit}" "$@"\n`,
      { mode: 0o755 });
    const prevPath = process.env.PATH;
    process.env.PATH = `${shimDir}${delimiter}${prevPath}`;   // `;` on Windows, `:` elsewhere
    try {
      const d = byPath(collectDocs({ root, now: NOW, cachePath: null }), 'mod/M.md');
      assert.equal(d.status, 'orange', `${failCmd} failure must fail the doc CLOSED — a fresh stamp it could not verify is not green`);
      assert.match(d.reasons.join('\n'), expect);
    } finally {
      process.env.PATH = prevPath;
    }
  }
});

// ── WINDOWS ────────────────────────────────────────────────────────────────────────────────────
test('WINDOWS — a doc rel path is POSIX-separated, so the root and tracked checks are right', () => {
  // `relative()` is path.win32.relative on Windows, so collectDocs() used to yield
  // `sitemap\README.md`. Two downstream checks compare that against forward-slash data: the
  // `git ls-files` tracked set, and `rel.includes('/')` as the test for "is this at the root".
  // Both answered wrongly for EVERY module doc — each was reported as living at the root AND as
  // untracked, while sitting in git the whole time. Measured 2026-09-04: docs-doctor emitted those
  // two complaints for every doc outside the root, which makes the gate unreadable, which is the
  // same as not having one.
  const root = mkdtempSync(join(tmpdir(), 'cw-docs-sep-'));
  mkdirSync(join(root, 'sitemap'), { recursive: true });
  mkdirSync(join(root, 'a', 'b'), { recursive: true });
  writeFileSync(join(root, 'README.md'), '# root\n');
  writeFileSync(join(root, 'sitemap', 'README.md'), '# module\n');
  writeFileSync(join(root, 'a', 'b', 'DEEP.md'), '# deep\n');

  // git off and cache off: this test is about path SHAPE, and neither a git probe nor a cache
  // read should be able to change the answer or slow it down.
  const r = collectDocs({ root, git: false, cachePath: null });
  const rels = r.docs.map((d) => d.path).sort();
  for (const r of rels) {
    assert.ok(!r.includes(String.fromCharCode(92)), `a rel path must never carry a backslash: ${JSON.stringify(r)}`);
  }
  assert.ok(rels.includes('sitemap/README.md'), `expected sitemap/README.md, got ${JSON.stringify(rels)}`);
  assert.ok(rels.includes('a/b/DEEP.md'));
  assert.ok(rels.includes('README.md'));

  // The property the two downstream checks actually depend on: only the ROOT doc has no separator.
  const atRoot = rels.filter((r) => !r.includes('/'));
  assert.deepEqual(atRoot, ['README.md'],
    'exactly one doc is at the root here — if a module doc looks root-level, the gate flags every doc');
});
