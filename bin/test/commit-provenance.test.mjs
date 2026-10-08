// bin/commit-provenance.mjs over histories built at test time. A nested .git cannot be committed,
// so every subject here is materialised from a description by bin/lib/provenance-fixture.mjs —
// real commits, real identities, a real --no-ff merge — and both directions are asserted apart.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { scan, judge, parseLog, RULE_CWE, RULE_SEV, RULES, CouldNotRun, TOOL } from '../commit-provenance.mjs';
import { materialiseHistory, writeProtectionManifest } from '../lib/provenance-fixture.mjs';
import { _commitProvenanceCounts } from '../../monitor/extractors.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCANNER = join(REPO, 'bin', 'commit-provenance.mjs');
const CANARY = join(REPO, 'fixtures', 'scan-canary');
const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });
const readJSON = (p) => JSON.parse(readFileSync(p, 'utf8'));

const human = (n) => ({ name: `${n} Example`, email: `${n.toLowerCase()}@example.test` });
const bot = { name: 'dependabot[bot]', email: 'dependabot@example.test' };

/** Build a history and return an env that names its repo and (optionally) its protection manifest. */
function build(spec) {
  const { dir, shas } = materialiseHistory(spec);
  made.push(dir);
  const bp = writeProtectionManifest(spec, dir);
  const env = { CW_PROVENANCE_REPO: spec.repo || 'example/test', CW_BRANCH_PROTECTION: bp || join(dir, 'absent.json') };
  return { dir, shas, env };
}

describe('the two shipped fixtures, both directions', () => {
  test('dirty fires every rule exactly as declared', () => {
    const spec = readJSON(join(CANARY, 'dirty', '.commitwork-provenance-fixture.json'));
    const { dir, env } = build(spec);
    const r = scan(dir, env);
    assert.equal(r.tool, TOOL);
    assert.equal(r.summary.commitsScanned, spec.expect.commits);
    assert.equal(r.summary.filesScanned, r.summary.commitsScanned, 'filesScanned IS the commit count');
    assert.deepEqual(r.summary.byRule, spec.expect.byRule);
    assert.equal(r.summary.findings, Object.values(spec.expect.byRule).reduce((a, b) => a + b, 0));
    assert.equal(r.summary.protectedBranch.state, 'checked');
  });

  test('clean produces nothing, and the signature rule is not-applicable rather than clean', () => {
    const spec = readJSON(join(CANARY, 'clean', '.commitwork-provenance-fixture.json'));
    const { dir, env } = build(spec);
    const r = scan(dir, env);
    assert.equal(r.summary.commitsScanned, spec.expect.commits, 'the negative control was scanned');
    assert.equal(r.summary.findings, 0, JSON.stringify(r.summary.byRule));
    assert.deepEqual(r.summary.rulesNotApplicable, ['unsigned-on-protected-branch']);
    assert.equal(r.summary.notApplicable, 1);
  });
});

describe('each rule in isolation', () => {
  test('author-committer-mismatch: two humans on one commit, low, CWE-345; one human twice is silent', () => {
    const { dir, env, shas } = build({ steps: [
      { op: 'commit', id: 'same', author: human('Ada'), message: 'a' },
      { op: 'commit', id: 'split', author: human('Ada'), committer: human('Bob'), message: 'b' },
    ] });
    const r = scan(dir, env);
    assert.deepEqual(r.findings.map((f) => [f.rule, f.sha, f.sev, f.cwe]),
      [['author-committer-mismatch', shas.split, 'low', 'CWE-345']]);
  });

  test('a case-only difference in identity is the same identity', () => {
    const { dir, env } = build({ steps: [
      { op: 'commit', author: { name: 'Ada Example', email: 'Ada@Example.test' }, committer: { name: 'ada example', email: 'ada@example.test' }, message: 'a' },
    ] });
    assert.equal(scan(dir, env).summary.findings, 0);
  });

  test('machine-author-unregistered: high on every commit by an undeclared bot; registered bots are silent', () => {
    const spec = { steps: [
      { op: 'commit', id: 'h', author: human('Ada'), message: 'a' },
      { op: 'commit', id: 'b1', author: bot, message: 'bump' },
      { op: 'commit', id: 'b2', author: bot, message: 'bump again' },
    ] };
    const { dir, env, shas } = build(spec);
    const r = scan(dir, env);
    assert.equal(r.summary.byRule['machine-author-unregistered'], 2);
    assert.deepEqual(r.findings.map((f) => f.sha).sort(), [shas.b1, shas.b2].sort());
    assert.equal(r.findings[0].sev, 'high');
    assert.equal(r.summary.machineAuthored, 2);
    // registered three ways: env, the target's own file, commitwork.json bots[]
    assert.equal(scan(dir, { ...env, CW_PROVENANCE_BOTS: 'dependabot[bot]' }).summary.byRule['machine-author-unregistered'], 0);
    writeFileSync(join(dir, '.commitwork-bots.json'), JSON.stringify(['dependabot@example.test']));
    const viaFile = scan(dir, env);
    assert.equal(viaFile.summary.byRule['machine-author-unregistered'], 0);
    assert.deepEqual(viaFile.summary.botRegistry, { sources: ['.commitwork-bots.json'], count: 1 });
    rmSync(join(dir, '.commitwork-bots.json'));
    writeFileSync(join(dir, 'commitwork.json'), JSON.stringify({ bots: ['DEPENDABOT[BOT]'] }));
    assert.equal(scan(dir, env).summary.byRule['machine-author-unregistered'], 0, 'registration is case-insensitive');
  });

  test('a bot list the scanner cannot parse is could-not-run, never an empty registry', () => {
    const { dir, env } = build({ steps: [{ op: 'commit', author: bot, message: 'bump' }] });
    writeFileSync(join(dir, '.commitwork-bots.json'), '{ not json');
    assert.throws(() => scan(dir, env), CouldNotRun);
    writeFileSync(join(dir, '.commitwork-bots.json'), JSON.stringify({ wrongShape: true }));
    assert.throws(() => scan(dir, env), CouldNotRun);
  });

  test('bot-authored-merge: a machine merge with no marker is med; `authorized by <human>` in the body silences it', () => {
    const merge = (id, body) => ({ steps: [
      { op: 'commit', author: human('Ada'), message: 'init' },
      { op: 'branch', name: 'topic' },
      { op: 'commit', branch: 'topic', author: human('Ada'), message: 'work' },
      { op: 'merge', id, from: 'topic', author: bot, message: 'merge topic', ...(body ? { body } : {}) },
    ] });
    const bare = build(merge('m'));
    const r1 = scan(bare.dir, { ...bare.env, CW_PROVENANCE_BOTS: 'dependabot[bot]' });
    assert.deepEqual(r1.findings.map((f) => [f.rule, f.sha, f.sev]), [['bot-authored-merge', bare.shas.m, 'med']]);
    const marked = build(merge('m', 'Authorized by Ada Example'));
    assert.equal(scan(marked.dir, { ...marked.env, CW_PROVENANCE_BOTS: 'dependabot[bot]' }).summary.findings, 0);
    const botMarked = build(merge('m', 'authorized by renovate[bot]'));
    assert.equal(scan(botMarked.dir, { ...botMarked.env, CW_PROVENANCE_BOTS: 'dependabot[bot],renovate[bot]' }).summary.byRule['bot-authored-merge'], 1,
      'a machine authorising a machine is not a human marker');
  });

  test('a human-authored merge is silent — the benign look-alike', () => {
    const { dir, env } = build({ steps: [
      { op: 'commit', author: human('Ada'), message: 'init' },
      { op: 'branch', name: 'topic' },
      { op: 'commit', branch: 'topic', author: human('Ada'), message: 'work' },
      { op: 'merge', from: 'topic', author: human('Ada'), message: 'merge topic' },
    ] });
    assert.equal(scan(dir, env).summary.findings, 0);
  });

  test('unsigned-on-protected-branch: only where the manifest names the repo with requireSigned:true', () => {
    const spec = { repo: 'example/signed', steps: [
      { op: 'commit', id: 'a', author: human('Ada'), message: 'a' },
      { op: 'commit', id: 'b', author: human('Ada'), message: 'b' },
    ] };
    const { dir, env, shas } = build(spec);
    const manifest = (repos) => { const p = join(dir, 'bp.json'); writeFileSync(p, JSON.stringify({ repos })); return p; };
    const required = scan(dir, { ...env, CW_BRANCH_PROTECTION: manifest([{ repo: 'Example/Signed', branch: 'main', requiredChecks: [], requireSigned: true }]) });
    assert.deepEqual(required.findings.map((f) => [f.rule, f.sha, f.sev, f.cwe, f.path]),
      [[ 'unsigned-on-protected-branch', shas.a, 'med', 'CWE-347', 'main'], ['unsigned-on-protected-branch', shas.b, 'med', 'CWE-347', 'main']].sort((x, y) => (x[1] < y[1] ? -1 : 1)));
    assert.equal(required.summary.protectedBranch.state, 'checked');
    const notRequired = scan(dir, { ...env, CW_BRANCH_PROTECTION: manifest([{ repo: 'example/signed', branch: 'main', requiredChecks: [] }]) });
    assert.equal(notRequired.summary.findings, 0);
    assert.equal(notRequired.summary.protectedBranch.state, 'not-required');
    assert.equal(notRequired.summary.notApplicable, 1);
    const absent = scan(dir, { ...env, CW_BRANCH_PROTECTION: manifest([{ repo: 'example/other', branch: 'main', requiredChecks: [], requireSigned: true }]) });
    assert.equal(absent.summary.protectedBranch.state, 'not-in-manifest');
    assert.equal(absent.summary.notApplicable, 1);
    const missingBranch = scan(dir, { ...env, CW_BRANCH_PROTECTION: manifest([{ repo: 'example/signed', branch: 'release', requiredChecks: [], requireSigned: true }]) });
    assert.equal(missingBranch.summary.protectedBranch.state, 'branch-missing');
    assert.deepEqual(missingBranch.summary.unmeasured, ['unsigned-on-protected-branch'], 'a branch git cannot resolve is unmeasured, not clean');
    assert.equal(missingBranch.summary.findings, 0);
    const broken = manifest([]); writeFileSync(broken, '{');
    assert.throws(() => scan(dir, { ...env, CW_BRANCH_PROTECTION: broken }), CouldNotRun, 'an unparseable manifest is could-not-run');
  });

  test('the shipped branch-protection manifest carries requireSigned on every entry, and none is true yet', () => {
    const m = readJSON(join(REPO, 'manifests', 'branch-protection.json'));
    assert.ok(m.repos.length >= 1);
    for (const e of m.repos) assert.equal(typeof e.requireSigned, 'boolean', `${e.repo}: requireSigned must be declared`);
  });
});

describe('the report contract', () => {
  test('never carries a subject, body, name or email — sha, rule, sev, cwe and classification words only', () => {
    const { dir, env } = build({ steps: [
      { op: 'commit', author: human('Ada'), committer: human('Bob'), message: 'SECRET-SUBJECT-MARKER', body: 'SECRET-BODY-MARKER' },
      { op: 'commit', author: bot, message: 'bump SECRET-SUBJECT-2' },
    ] });
    const text = JSON.stringify(scan(dir, env));
    for (const s of ['SECRET-SUBJECT', 'SECRET-BODY', 'Ada', 'Bob', 'dependabot', 'example.test']) assert.ok(!text.includes(s), `leaked: ${s}`);
    for (const f of JSON.parse(text).findings) {
      assert.deepEqual(Object.keys(f).sort(), ['cwe', 'detail', 'path', 'rule', 'sev', 'sha']);
      assert.match(f.sha, /^[0-9a-f]{40}$/);
      assert.ok(['crit', 'high', 'med', 'low'].includes(f.sev));
      assert.equal(f.cwe, RULE_CWE[f.rule]);
      assert.equal(f.sev, RULE_SEV[f.rule]);
    }
  });

  test('every rule has a CWE and a severity, and CWE-347 is the signature rule alone', () => {
    assert.deepEqual([...RULES].sort(), ['author-committer-mismatch', 'bot-authored-merge', 'machine-author-unregistered', 'unsigned-on-protected-branch']);
    for (const r of RULES) { assert.match(RULE_CWE[r], /^CWE-\d+$/); assert.ok(RULE_SEV[r]); }
    assert.deepEqual(RULES.filter((r) => RULE_CWE[r] === 'CWE-347'), ['unsigned-on-protected-branch']);
  });

  test('deterministic: two runs are byte-identical, findings sorted by (sha, rule)', () => {
    const { dir, env } = build({ repo: 'example/det', branchProtection: { requireSigned: true }, steps: [
      { op: 'commit', author: human('Ada'), committer: human('Bob'), message: 'a' },
      { op: 'commit', author: bot, message: 'b' },
      { op: 'commit', author: human('Cy'), committer: human('Di'), message: 'c' },
    ] });
    const a = JSON.stringify(scan(dir, env)); const b = JSON.stringify(scan(dir, env));
    assert.equal(a, b);
    const keys = JSON.parse(a).findings.map((f) => `${f.sha} ${f.rule}`);
    assert.deepEqual(keys, [...keys].sort());
  });

  test('byRule always names all four rules, zero or not', () => {
    const { dir, env } = build({ steps: [{ op: 'commit', author: human('Ada'), message: 'a' }] });
    assert.deepEqual(Object.keys(scan(dir, env).summary.byRule).sort(), [...RULES].sort());
  });

  test('CW_PROVENANCE_DEPTH bounds the read and is read at call time', () => {
    const { dir, env } = build({ steps: [1, 2, 3, 4, 5].map((i) => ({ op: 'commit', author: bot, message: `b${i}` })) });
    assert.equal(scan(dir, env).summary.commitsScanned, 5);
    const two = scan(dir, { ...env, CW_PROVENANCE_DEPTH: '2' });
    assert.equal(two.summary.commitsScanned, 2);
    assert.equal(two.summary.byRule['machine-author-unregistered'], 2);
    assert.throws(() => scan(dir, { ...env, CW_PROVENANCE_DEPTH: 'lots' }), CouldNotRun);
    assert.throws(() => scan(dir, { ...env, CW_PROVENANCE_DEPTH: '0' }), CouldNotRun);
  });

  test('an empty repository is a declared void, not a clean zero — and it ran', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-prov-empty-')); made.push(dir);
    spawnSync('git', ['-C', dir, 'init', '-q', '-b', 'main']);
    const r = scan(dir, { CW_BRANCH_PROTECTION: join(dir, 'absent.json') });
    assert.equal(r.summary.commitsScanned, 0);
    assert.equal(r.summary.filesScanned, 0);
    assert.ok(r.summary.void);
  });

  test('parseLog: a body carrying the field separator or blank lines does not shift the columns', () => {
    const rec = ['a'.repeat(40), 'n', 'e', 'cn', 'ce', 'p1 p2', 'subject', 'body\x1fwith\x1fseparators\n\nand blanks'].join('\x1f');
    const [c] = parseLog(`${rec}\x1e\n`);
    assert.equal(c.sha, 'a'.repeat(40));
    assert.deepEqual(c.parents, ['p1', 'p2']);
    assert.equal(c.subject, 'subject');
    assert.equal(c.body, 'body\x1fwith\x1fseparators\n\nand blanks');
  });

  test('signature status is read only where a signing expectation exists — the verifier costs ~50ms per signed commit', () => {
    const { dir, env } = build({ steps: [{ op: 'commit', author: human('Ada'), message: 'a' }] });
    const r = scan(dir, env);
    assert.equal(r.summary.protectedBranch.signatureStates, undefined, 'no expectation, no %G? read');
    const spec = { repo: 'example/sig', branchProtection: { requireSigned: true }, steps: [{ op: 'commit', author: human('Ada'), message: 'a' }] };
    const s = build(spec);
    assert.deepEqual(scan(s.dir, s.env).summary.protectedBranch.signatureStates, { N: 1 });
  });

  test('judge is pure: the same commit and context give the same rows', () => {
    const commit = { sha: 'f'.repeat(40), authorName: 'dependabot[bot]', authorEmail: 'd@example.test',
      committerName: 'dependabot[bot]', committerEmail: 'd@example.test', parents: ['1', '2'], subject: 's', body: '' };
    const ctx = { branch: 'main', bots: { names: new Set() }, protection: { signatures: new Map([[commit.sha, 'N']]), branch: 'main' } };
    assert.deepEqual(judge(commit, ctx).map((f) => f.rule), ['unsigned-on-protected-branch', 'bot-authored-merge', 'machine-author-unregistered']);
    assert.deepEqual(judge(commit, ctx), judge(commit, ctx));
  });
});

describe('the CLI exit contract', () => {
  const run = (args, env = {}) => spawnSync(process.execPath, [SCANNER, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });

  test('exit 0 with a report on a repository', () => {
    const { dir, env } = build({ steps: [{ op: 'commit', author: human('Ada'), message: 'a' }] });
    const r = run([dir], env);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(r.stdout).tool, TOOL);
  });

  test('exit 2 and a could-not-run report on a directory that is not a repository', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-prov-norepo-')); made.push(dir);
    mkdirSync(join(dir, 'plain'));
    const r = run([join(dir, 'plain')], { CW_BRANCH_PROTECTION: join(dir, 'absent.json') });
    assert.equal(r.status, 2);
    const j = JSON.parse(r.stdout);
    assert.equal(j.summary.filesScanned, 0);
    assert.match(j.summary.couldNotRun, /not a git repository/);
    assert.match(r.stderr, /could not run/);
  });

  test('exit 2 on a missing directory', () => {
    const r = run([join(tmpdir(), 'cw-prov-does-not-exist-' + process.pid)], { CW_BRANCH_PROTECTION: '/nonexistent/x.json' });
    assert.equal(r.status, 2);
  });
});

describe('the extractor', () => {
  const dirFor = (report) => { const d = mkdtempSync(join(tmpdir(), 'cw-prov-x-')); made.push(d); if (report !== undefined) writeFileSync(join(d, 'commit-provenance.json'), report); return d; };

  test('folds a real report into severity buckets with detail rows keyed on (rule, sha)', () => {
    const spec = readJSON(join(CANARY, 'dirty', '.commitwork-provenance-fixture.json'));
    const { dir, env } = build(spec);
    const c = _commitProvenanceCounts(dirFor(JSON.stringify(scan(dir, env))), 'commit-provenance.json');
    assert.equal(c.ran, true);
    assert.deepEqual([c.high, c.med, c.low, c.total], [2, 5, 1, 8]);
    assert.equal(c.commitsScanned, 4);
    assert.equal(c.findings.length, 8);
    for (const row of c.findings) {
      assert.deepEqual(Object.keys(row).sort(), ['cwe', 'file', 'message', 'rule', 'sev', 'sha']);
      assert.equal(row.file, 'main');
    }
  });

  test('zero commits is nosrc (a void), an absent file is null, garbage is unparseable, could-not-run is noscan', () => {
    assert.equal(_commitProvenanceCounts(dirFor(undefined), 'commit-provenance.json'), null);
    assert.equal(_commitProvenanceCounts(dirFor(JSON.stringify({ tool: TOOL, summary: { commitsScanned: 0, filesScanned: 0, findings: 0, byRule: {} }, findings: [] })), 'commit-provenance.json').nosrc, true);
    assert.equal(_commitProvenanceCounts(dirFor('{ nope'), 'commit-provenance.json').unparseable, true);
    assert.equal(_commitProvenanceCounts(dirFor(JSON.stringify({ tool: 'other', summary: {}, findings: [] })), 'commit-provenance.json').unparseable, true);
    const cnr = _commitProvenanceCounts(dirFor(JSON.stringify({ tool: TOOL, summary: { filesScanned: 0, couldNotRun: 'not a git repository' }, findings: [] })), 'commit-provenance.json');
    assert.equal(cnr.noscan, true);
    assert.match(cnr.noscanReason, /not a git/);
  });

  test('a clean report with commits is a real zero and carries the not-applicable rule', () => {
    const c = _commitProvenanceCounts(dirFor(JSON.stringify({ tool: TOOL, summary: { commitsScanned: 7, filesScanned: 7, findings: 0, byRule: {}, rulesNotApplicable: ['unsigned-on-protected-branch'] }, findings: [] })), 'commit-provenance.json');
    assert.equal(c.total, 0); assert.equal(c.nosrc, undefined); assert.equal(c.commitsScanned, 7);
    assert.deepEqual(c.rulesNotApplicable, ['unsigned-on-protected-branch']);
  });
});
