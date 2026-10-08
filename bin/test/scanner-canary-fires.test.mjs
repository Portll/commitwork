// Do commitwork's own scanners actually FIRE?
//
// THE GAP THIS CLOSES. fixtures/scan-canary holds twenty deliberately planted defects and
// bin/test/scan-canary.test.mjs proves they are still physically present — then says, correctly,
// that scanner BEHAVIOUR against them belongs in the sweep. Nothing was making that check. So the
// corpus existed, its integrity was gated, and no test anywhere asserted that pointing a scanner at
// it produced anything at all. A clean result from this repository's own security scan rested on an
// instrument nobody had proved was switched on.
//
// BOTH DIRECTIONS, SEPARATELY. The dirty tree must produce findings and the clean tree must produce
// none, asserted apart rather than as one score, because only one of them is the direction that
// lies to you: a scanner that has silently stopped matching reports a clean tree exactly as a
// genuinely clean tree does. The clean-tree assertion is the weaker claim and is here to catch a
// rule so broad it fires on anything; the dirty-tree assertion is the one that matters.
//
// AN ABSENT TOOL SKIPS WITH A STATED REASON, never passes. That is the same shape .github/ci.yml
// uses for fleet-dependent tests, and the reason is identical: on this operator's machine the
// binaries are present and these run in full; on a hosted runner they are not, and five red tests
// nobody can go green is exactly how a check gets switched off. The reason is printed, so a skipped
// lane is visible in the log rather than silently absent.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CANARY = process.env.CW_CANARY_DIR || join(REPO, 'fixtures', 'scan-canary');
const EXPECTED = JSON.parse(readFileSync(join(CANARY, 'EXPECTED.json'), 'utf8'));

/** Is a tool on PATH? Absence is a stated skip, never a pass. */
function toolPresent(bin) {
  try {
    execFileSync('command', ['-v', bin], { shell: '/bin/sh', stdio: 'ignore' });
    return true;
  } catch { return false; }
}

const plantsFor = (lane) => EXPECTED.dirty.plants.filter((p) => p.lane === lane);

/** gitleaks over a directory → findings array. A missing report is UNKNOWN, never an empty result. */
function gitleaksOn(dir) {
  const out = mkdtempSync(join(tmpdir(), 'cw-canary-gl-'));
  const report = join(out, 'r.json');
  try {
    execFileSync('gitleaks', [
      'detect', '--no-git', '--source', dir,
      '--report-format', 'json', '--report-path', report,
      '--exit-code', '0', '--no-banner',
    ], { stdio: 'ignore' });
  } catch (e) {
    rmSync(out, { recursive: true, force: true });
    // A crashed scanner is not a clean scan. Distinguished from "ran and found nothing".
    throw new Error(`gitleaks could not run over ${dir}: ${e?.status ?? e?.message}`);
  }
  if (!existsSync(report)) {
    rmSync(out, { recursive: true, force: true });
    throw new Error(`gitleaks wrote no report for ${dir} — that is unknown, not zero findings`);
  }
  const raw = readFileSync(report, 'utf8').trim();
  rmSync(out, { recursive: true, force: true });
  return raw ? JSON.parse(raw) : [];
}

describe('the secrets instrument fires on planted secrets', () => {
  const have = toolPresent('gitleaks');

  test('NOT VACUOUS: the corpus actually plants secrets for this lane to find', () => {
    assert.ok(plantsFor('secrets').length >= 2,
      'with no planted secrets, a finding count of zero below would prove nothing about the scanner');
  });

  test('the DIRTY tree produces findings — the direction that catches a dead scanner', (t) => {
    if (!have) return t.skip('gitleaks is not installed on this machine — lane NOT measured, which is not a pass');
    const found = gitleaksOn(join(CANARY, 'dirty'));
    assert.ok(found.length >= plantsFor('secrets').length,
      `gitleaks found ${found.length} secret(s) against ${plantsFor('secrets').length} planted — an instrument that `
      + 'has stopped matching reports a clean tree exactly as a clean tree does');
  });

  test('the planted token is among what it found, not merely some other match', (t) => {
    if (!have) return t.skip('gitleaks is not installed on this machine — lane NOT measured, which is not a pass');
    const found = gitleaksOn(join(CANARY, 'dirty'));
    const files = new Set(found.map((f) => String(f.File || '')));
    const wanted = plantsFor('secrets')[0].file.replace(/^dirty\//, '');
    assert.ok([...files].some((f) => f.endsWith(wanted)),
      `nothing was reported in ${wanted}; the count alone could be satisfied by unrelated matches`);
  });

  test('the CLEAN tree produces none — the weaker claim, catching a rule that fires on anything', (t) => {
    if (!have) return t.skip('gitleaks is not installed on this machine — lane NOT measured, which is not a pass');
    assert.deepEqual(gitleaksOn(join(CANARY, 'clean')), [],
      'a rule broad enough to fire on the clean tree makes every dirty-tree finding meaningless');
  });
});

describe('the CI-hygiene instrument fires on a planted workflow defect', () => {
  const have = toolPresent('actionlint');
  const plant = plantsFor('ci-hygiene')[0];

  test('NOT VACUOUS: the corpus plants a workflow defect', () => {
    assert.ok(plant, 'no ci-hygiene plant — the assertion below would be vacuous');
  });

  test('actionlint reports the planted workflow, and says something about it', (t) => {
    if (!have) return t.skip('actionlint is not installed on this machine — lane NOT measured, which is not a pass');
    const wf = join(CANARY, plant.file);
    let output = '';
    let ran = false;
    try {
      execFileSync('actionlint', ['-no-color', wf], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
      ran = true;                       // exit 0 = no findings
    } catch (e) {
      // actionlint exits non-zero WHEN IT FINDS SOMETHING. Non-zero is the expected path here, so
      // the catch is the success branch — and a genuine crash has to be told apart from a finding,
      // which is what the output check below does.
      output = `${e.stdout || ''}${e.stderr || ''}`;
      ran = true;
    }
    assert.ok(ran, 'actionlint did not run at all');
    assert.match(output, /\.ya?ml:\d+:\d+:/,
      `actionlint produced no file:line:col finding for the planted workflow — output was: ${output.slice(0, 300)}`);
  });
});

describe('the agent-instructions instrument fires on a planted hidden-character file', () => {
  const plant = plantsFor('agent-instructions')[0];
  const minifyOn = (dir) => JSON.parse(execFileSync(process.execPath, [join(REPO, 'bin', 'minify-detect.mjs'), dir], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }));

  test('NOT VACUOUS: the corpus plants an instruction file with a hidden character', () => {
    assert.ok(plant, 'no agent-instructions plant — the assertions below would be vacuous');
  });

  test('the DIRTY tree reports the planted file under bidi-homoglyph', () => {
    const r = minifyOn(join(CANARY, 'dirty'));
    const hit = r.findings.filter((f) => f.rule === 'bidi-homoglyph').map((f) => f.path);
    assert.ok(hit.includes(plant.file.replace(/^dirty\//, '')), `bidi-homoglyph fired on ${JSON.stringify(hit)}, not on the plant`);
  });

  test('the CLEAN tree, which carries RTL prose, ZWJ emoji and ZWNJ, produces no bidi-homoglyph finding', () => {
    const r = minifyOn(join(CANARY, 'clean'));
    assert.ok(r.summary.filesScanned > 0, 'the walk examined nothing — that is a void, not a clean tree');
    assert.deepEqual(r.findings.filter((f) => f.rule === 'bidi-homoglyph'), []);
  });
});

describe('the agent-instructions scanner fires on every planted rule, and stays quiet on the benign twins', () => {
  const SCANNER = join(REPO, 'bin', 'agent-instructions.mjs');
  const plants = plantsFor('agent-instructions');
  const run = (dir) => JSON.parse(execFileSync(process.execPath, [SCANNER, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const CLAUDE_RULES = ['hidden-unicode', 'html-comment-directive', 'agent-directive-exec', 'agent-directive-exfil', 'encoded-blob', 'directive-split-across-files', 'instruction-env-indirection'];

  test('NOT VACUOUS: every plant is still physically present in the file it names, and every rule the lane declares is planted', async () => {
    const { RULE_CWE } = await import('../agent-instructions.mjs');
    const planted = new Set(plants.flatMap((p) => p.rules || []));
    assert.deepEqual([...planted].sort(), Object.keys(RULE_CWE).sort(), 'a rule with no plant has no proof it can fire');
    for (const p of plants) {
      const src = readFileSync(join(CANARY, p.file), 'utf8');
      for (const s of p.mustMatch) assert.ok(src.includes(s), `${p.file} no longer contains ${JSON.stringify(s)} — the plant was tidied away`);
    }
  });

  test('the DIRTY tree fires every planted rule in the planted file, and NOT the rules a plant declares must stay quiet — the direction that catches a dead scanner', () => {
    const r = run(join(CANARY, 'dirty'));
    assert.ok(r.summary.filesScanned > 0, 'a zero-file walk is a void, and a void would pass here for the wrong reason');
    const fired = r.findings.filter((f) => f.path === 'CLAUDE.md').map((f) => f.rule).sort();
    assert.deepEqual(fired, [...CLAUDE_RULES].sort(), `rules fired on CLAUDE.md: ${JSON.stringify(fired)}`);
    for (const p of plants) {
      const file = p.file.replace(/^dirty\//, '');
      const on = r.findings.filter((f) => f.path === file).map((f) => f.rule);
      for (const rule of p.rules || []) assert.ok(on.includes(rule), `${rule} did not fire on ${file}; fired: ${JSON.stringify(on)}`);
      for (const rule of p.mustNotFire || []) assert.ok(!on.includes(rule), `${rule} fired on ${file} alone — the plant is meant to be reachable only through the join`);
    }
    const split = r.findings.find((f) => f.rule === 'directive-split-across-files');
    assert.match(split.detail, /docs\/setup\.md \(fetch-and-execute ×1/, 'the split row names the target file and what it carries');
    assert.match(r.findings.find((f) => f.rule === 'instruction-env-indirection').detail, /variables INSTRUCTIONS_URL, SETUP_URL/);
    for (const f of r.findings) assert.match(f.cwe, /^CWE-\d+$/, `${f.rule} carries no CWE`);
    const raw = JSON.stringify(r);
    assert.ok(!raw.includes('canary.invalid') && !raw.includes('VGhpcyBjYW5hcnk'), 'planted text reached the report — counts, code points, paths and rule ids only');
  });

  test('the CLEAN tree carries the benign twin of every surface and produces none — the weaker claim', () => {
    const r = run(join(CANARY, 'clean'));
    assert.ok(r.summary.filesScanned >= 4, 'clean means examined-and-found-nothing, not examined-nothing');
    assert.deepEqual(r.findings, [], `a benign look-alike fired: ${JSON.stringify(r.findings)}`);
    const twin = readFileSync(join(CANARY, 'clean', 'CLAUDE.md'), 'utf8');
    // a negative control has to have something to be quiet about
    assert.match(twin, /<!-- SPDX-License-Identifier/, 'licence comment with a URL');
    assert.match(twin, /## Install\n\n```sh\ncurl [^\n]*\| sh/, 'curl-pipe-shell under an Install heading');
    assert.match(twin, /`\.env` to `\.gitignore`/, '.env in a gitignore sentence');
    assert.match(twin, /data:image\/png;base64,[A-Za-z0-9+/=]{200,}/, 'a data URI over the blob threshold');
    assert.match(twin, /\u200c/, 'a ZWNJ inside a Persian word');
    assert.match(twin, /follow the steps in \[docs\/setup\.md\]\(docs\/setup\.md\)/, 'the same split reference the dirty tree carries');
    assert.match(twin, /`\$PORT`[^\n]*run `npm start`/, 'a variable beside a run verb that names no instruction source');
    assert.match(readFileSync(join(CANARY, 'clean', 'docs', 'setup.md'), 'utf8'), /```sh\nnpm ci\n/, 'the linked setup file documents a lockfile install only');
    assert.match(readFileSync(join(CANARY, 'clean', '.claude', 'commands', 'lint.md'), 'utf8'), /never pass `--no-verify`/, 'a negated bypass mention in a command file');
    for (const p of plants) if (p.cleanTwin) assert.ok(existsSync(join(CANARY, p.cleanTwin)), `${p.file} names a clean twin that does not exist: ${p.cleanTwin}`);
  });
});

describe('the deps-content instrument fires on a planted install hook', () => {
  const SCANNER = join(REPO, 'bin', 'deps-content.mjs');
  const plants = plantsFor('deps-content');
  const run = (dir) => JSON.parse(execFileSync('node', [SCANNER, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const hooked = (tree) => {
    const lock = JSON.parse(readFileSync(join(CANARY, tree, 'package-lock.json'), 'utf8'));
    return Object.entries(lock.packages).filter(([k, v]) => k.startsWith('node_modules/') && v.hasInstallScript).map(([k]) => k);
  };

  test('NOT VACUOUS: the corpus plants an install hook, and every plant is still physically present', () => {
    assert.ok(plants.length >= 1, 'no deps-content plant — the assertions below would be vacuous');
    for (const p of plants) {
      const src = readFileSync(join(CANARY, p.file), 'utf8');
      for (const s of p.mustMatch) assert.ok(src.includes(s), `${p.file} no longer contains ${JSON.stringify(s)} — the plant was tidied away`);
    }
  });

  test('the DIRTY tree produces dep-install-exec for the planted package — the direction that catches a dead scanner', () => {
    const r = run(join(CANARY, 'dirty'));
    assert.ok(r.summary.filesScanned > 0, 'a zero-file walk is a void, and a void would pass here for the wrong reason');
    const hits = r.findings.filter((f) => f.rule === 'dep-install-exec');
    for (const key of hooked('dirty')) {
      assert.ok(hits.some((f) => f.path === key), `nothing reported for ${key}: ${JSON.stringify(r.summary)}`);
    }
    assert.ok(hits.length >= 1);
    assert.ok(!JSON.stringify(r).includes('example.invalid'), 'the hook command is never echoed into the report');
  });

  test('the CLEAN tree examines the same surface and produces none — the weaker claim', () => {
    const r = run(join(CANARY, 'clean'));
    assert.ok(r.summary.filesScanned > 0, 'clean means examined-and-found-nothing, not examined-nothing');
    assert.ok(r.summary.packagesChecked >= 1);
    assert.deepEqual(r.findings, [], `a benign install hook fired: ${JSON.stringify(r.findings)}`);
  });

  test('the clean tree carries the SAME surface: a hasInstallScript package whose hook is on disk', () => {
    // A negative control has to have something to be quiet about, or its silence is assumed.
    const keys = hooked('clean');
    assert.ok(keys.length >= 1, 'clean/ has no hasInstallScript package, so its silence on this lane is assumed rather than measured');
    for (const k of keys) {
      const pkg = JSON.parse(readFileSync(join(CANARY, 'clean', k, 'package.json'), 'utf8'));
      const s = pkg.scripts || {};
      assert.ok(s.preinstall || s.install || s.postinstall, `${k} declares hasInstallScript but its package.json has no hook — the scanner would read nothing`);
    }
  });
});

// The provenance fixture is a DESCRIPTION of a history, not a repository — a nested .git cannot be
// committed — so the helper turns it into real commits in a temp dir first, and the scanner runs
// over that. Both files are materialised the same way; only their contents differ.
describe('the commit-provenance instrument fires on a planted synthetic history', () => {
  const plant = plantsFor('commit-provenance')[0];
  const SCANNER = join(REPO, 'bin', 'commit-provenance.mjs');

  /** Materialise a fixture and run the scanner CLI over it → { exit, report }. */
  async function provenanceOn(kind) {
    const { materialiseHistory, writeProtectionManifest } = await import('../lib/provenance-fixture.mjs');
    const { dir, spec } = materialiseHistory(join(CANARY, kind, '.commitwork-provenance-fixture.json'));
    const bp = writeProtectionManifest(spec, dir);
    const env = { ...process.env, CW_PROVENANCE_REPO: spec.repo, CW_BRANCH_PROTECTION: bp || join(dir, 'no-such-manifest.json') };
    delete env.CW_PROVENANCE_BOTS; delete env.CW_PROVENANCE_BOT_FILE; delete env.CW_PROVENANCE_DEPTH;
    const r = spawnSync(process.execPath, [SCANNER, dir], { env, encoding: 'utf8' });
    rmSync(dir, { recursive: true, force: true });
    if (!r.stdout.trim()) throw new Error(`commit-provenance wrote nothing for ${kind} — that is unknown, not zero findings (stderr: ${r.stderr.slice(0, 300)})`);
    return { exit: r.status, report: JSON.parse(r.stdout), raw: r.stdout, spec };
  }

  test('NOT VACUOUS: the corpus plants a provenance history and its mustMatch strings are present', () => {
    assert.ok(plant, 'no commit-provenance plant — every assertion below would be vacuous');
    const src = readFileSync(join(CANARY, plant.file), 'utf8');
    for (const s of plant.mustMatch) assert.ok(src.includes(s), `planted marker missing from ${plant.file}: ${s}`);
    assert.ok(existsSync(join(CANARY, 'clean', '.commitwork-provenance-fixture.json')),
      'the clean counterpart is missing — the dirty result would have no negative control');
  });

  test('the DIRTY history produces every rule the fixture declares — the direction that catches a dead scanner', async () => {
    const { exit, report, raw, spec } = await provenanceOn('dirty');
    assert.equal(exit, 0, 'the scanner ran (exit 0); exit 2 would be could-not-run, not a finding count');
    assert.equal(report.summary.commitsScanned, spec.expect.commits, 'the materialised history has the declared number of commits');
    assert.deepEqual(report.summary.byRule, spec.expect.byRule,
      'every rule fires exactly as the fixture declares — a rule that stopped matching reads as a clean history');
    assert.ok(report.findings.length >= 4, 'at least one finding per rule');
    for (const id of ['dependabot', 'example.test', 'bump a dependency', 'Ada Example', 'Bob Example']) {
      assert.ok(!raw.includes(id), `the report leaked an identity or subject it must never carry: ${id}`);
    }
  });

  test('the CLEAN history produces none — the weaker claim, catching a rule that fires on anything', async () => {
    const { exit, report, spec } = await provenanceOn('clean');
    assert.equal(exit, 0);
    assert.equal(report.summary.commitsScanned, spec.expect.commits, 'the negative control was actually scanned, not empty');
    assert.equal(report.summary.findings, 0, `clean history reported ${JSON.stringify(report.summary.byRule)}`);
    assert.equal(report.summary.notApplicable, spec.expect.notApplicable,
      'unsigned-on-protected-branch is NOT-APPLICABLE with no branch-protection entry — neither a pass nor a finding');
  });
});

describe('the agent-config instrument fires on planted agent configuration', () => {
  const plants = plantsFor('agent-config');
  const scanner = join(REPO, 'bin', 'agent-config.mjs');
  const runOn = (dir) => execFileSync(process.execPath, [scanner, dir], { encoding: 'utf8' });

  test('NOT VACUOUS: the corpus plants every rule the lane declares, and every plant is still physically present', async () => {
    const { RULE_CWE } = await import('../agent-config.mjs');
    const planted = new Set(plants.flatMap((p) => p.rules || []));
    assert.deepEqual([...planted].sort(), Object.keys(RULE_CWE).sort(), 'a rule with no plant has no proof it can fire');
    for (const p of plants) {
      const src = readFileSync(join(CANARY, p.file), 'utf8');
      for (const s of p.mustMatch) assert.ok(src.includes(s), `${p.file} no longer contains ${JSON.stringify(s)} — the plant was tidied away`);
    }
  });

  test('the DIRTY tree fires every planted rule in the planted file — the direction that catches a dead scanner', () => {
    const r = JSON.parse(runOn(join(CANARY, 'dirty')));
    assert.ok(r.summary.filesScanned > 0, 'the dirty tree was not examined');
    assert.equal(r.summary.unreadableHookScripts, 0, `a planted hook script the scanner could not read is not a plant: ${JSON.stringify(r.summary.unreadableHookScriptFiles)}`);
    for (const p of plants) {
      const file = p.file.replace(/^dirty\//, '');
      for (const rule of p.rules) {
        assert.ok(r.findings.some((f) => f.rule === rule && f.path === file),
          `${rule} did not fire on ${file}; byRule=${JSON.stringify(r.summary.byRule)}`);
      }
    }
    // the script name comes from the plant that owns it, never a literal: the dirty hook is named
    // apart from its clean twin on purpose (see the hook-script-content plant's note)
    const script = plants.find((p) => p.id === 'agent-config-hook-script-body').file.replace(/^dirty\//, '');
    assert.match(r.findings.find((f) => f.rule === 'hook-script-content').detail, new RegExp(`runs ${script.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}: `), 'the settings row names the script it read');
    assert.match(r.findings.find((f) => f.rule === 'mcp-host-from-env').detail, /url host from MCP_HOST$/);
  });

  test('the planted value never reaches the report — the key name does', () => {
    const out = runOn(join(CANARY, 'dirty'));
    const plant = plants.find((p) => p.rules.includes('env-secret-inline'));
    const value = plant.mustMatch[0].split(': ')[1].replace(/"/g, '');
    assert.ok(value.startsWith('ghp_'), 'the plant changed shape; fix this extraction before trusting the assertion below');
    assert.ok(!out.includes(value), 'the fake token leaked into the report');
    assert.ok(out.includes('CANARY_API_TOKEN'), 'the key name is what the report should carry');
  });

  test('the CLEAN tree carries the same surface and none of it fires — the weaker claim', () => {
    const r = JSON.parse(runOn(join(CANARY, 'clean')));
    assert.ok(r.summary.filesScanned >= 5, 'the clean tree must carry an .mcp.json, a settings.json, a command prompt and hook scripts, or its silence proves nothing');
    assert.equal(r.summary.void, false);
    assert.equal(r.summary.unreadableHookScripts, 0, 'every hook script the clean settings name was read — an unread twin is no control');
    assert.deepEqual(r.findings, [], `a rule broad enough to fire on the clean tree: ${JSON.stringify(r.summary.byRule)}`);
    const settings = JSON.parse(readFileSync(join(CANARY, 'clean', '.claude', 'settings.json'), 'utf8'));
    assert.ok(settings.permissions.allow.some((e) => /^Bash\(/.test(e)) && Array.isArray(settings.permissions.deny), 'the clean twin grants Bash beside a deny list — the shape the low rule must accept');
    assert.match(readFileSync(join(CANARY, 'clean', '.mcp.json'), 'utf8'), /\$\{HOME\}\/docs/, 'a local-path variable the env rule must ignore');
  });

  test('surface correspondence: every file planted dirty has a clean counterpart to stay quiet on', () => {
    for (const p of plants) {
      const twin = p.cleanTwin || p.file.replace(/^dirty\//, 'clean/');
      assert.ok(existsSync(join(CANARY, twin)), `dirty plants ${p.file} but ${twin} does not exist — that file has no negative control`);
    }
  });
});

describe('the model-artefacts instrument fires on a planted pickle, dataset config and hub load', () => {
  const SCANNER = join(REPO, 'bin', 'model-artefacts.mjs');
  const plants = plantsFor('model-artefacts');
  const env = { ...process.env, CW_MODELSCAN: 'off' };
  const run = (dir) => JSON.parse(execFileSync(process.execPath, [SCANNER, dir], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const RULES = ['pickle-dangerous-global', 'dataset-config-template', 'dataset-config-remote-scheme', 'hf-trust-remote-code', 'hf-unpinned-revision', 'keras-lambda-layer', 'tf-graph-file-op', 'tf-graph-python-op'];

  test('NOT VACUOUS: the corpus plants every rule this lane can fire, and each plant is still physically present', () => {
    assert.ok(plants.length >= RULES.length, `only ${plants.length} model-artefacts plant(s) for ${RULES.length} rules`);
    for (const p of plants) {
      const src = readFileSync(join(CANARY, p.file), 'utf8');
      for (const s of p.mustMatch) assert.ok(src.includes(s), `${p.file} no longer contains ${JSON.stringify(s)} — the plant was tidied away`);
    }
  });

  test('the DIRTY tree produces every planted rule — the direction that catches a dead scanner', () => {
    const r = run(join(CANARY, 'dirty'));
    assert.ok(r.summary.filesScanned > 0, 'a zero-file walk is a void, and a void would pass here for the wrong reason');
    assert.equal(r.summary.unreadable, 0, `a plant the walker could not read is not a plant: ${JSON.stringify(r.summary.unreadableFiles)}`);
    for (const rule of RULES) {
      assert.ok(r.findings.some((f) => f.rule === rule), `${rule} did not fire: ${JSON.stringify(r.summary.byRule)}`);
    }
    const pk = r.findings.find((f) => f.rule === 'pickle-dangerous-global');
    assert.equal(pk.path, 'model.pkl');
    assert.match(pk.detail, /os\.system \(GLOBAL\+REDUCE\)/, 'the global and the REDUCE that calls it are both named');
    assert.ok(!JSON.stringify(r).includes('/etc/passwd'), 'the template body is never echoed into the report');
    assert.ok(!JSON.stringify(r).includes('canary.invalid'), 'the remote URL is never echoed into the report');
    assert.ok(!JSON.stringify(r).includes('INERT'), 'the Lambda function field is never echoed into the report');
    assert.match(r.findings.find((f) => f.rule === 'keras-lambda-layer').detail, /canary_lambda/);
    assert.match(r.findings.find((f) => f.rule === 'tf-graph-file-op').detail, /ReadFile ×1/);
    for (const p of ['real/real.keras', 'real/real_legacy.h5', 'real/real_savedmodel/saved_model.pb']) assert.ok(r.findings.some((f) => f.path === p), `the real ${p} written by Keras/TensorFlow did not fire: ${JSON.stringify(r.summary.byRule)}`);
  });

  test('the CLEAN tree examines the same surfaces and produces none — the weaker claim', () => {
    const r = run(join(CANARY, 'clean'));
    assert.ok(r.summary.filesScanned > 0, 'clean means examined-and-found-nothing, not examined-nothing');
    for (const k of ['modelArtefacts', 'datasetConfigs', 'python', 'kerasConfigs', 'tfGraphs']) {
      assert.ok(r.summary.surfaces[k] >= 1, `clean/ has no ${k} surface, so its silence on that rule is assumed rather than measured`);
    }
    assert.equal(r.summary.pickleMembersWalked, 1, 'the benign pickle was walked, not skipped');
    assert.deepEqual([r.summary.kerasWithoutConfig, r.summary.tfGraphsWithoutNodes], [0, 0], 'the clean Keras config and graph were READ, so their silence is about content');
    assert.equal(r.summary.unreadable, 0);
    assert.deepEqual(r.findings, [], `a benign artefact fired: ${JSON.stringify(r.findings)}`);
  });
});

describe('the actions-gaps instrument fires on a planted self-hosted, workflow_run-checkout, permissionless job', () => {
  const SCANNER = join(REPO, 'bin', 'actions-gaps.mjs');
  const plants = plantsFor('actions-gaps');
  const run = (dir) => JSON.parse(execFileSync(process.execPath, [SCANNER, dir], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }));
  const RULES = ['self-hosted-runner', 'workflow-run-trigger', 'permissions-absent'];
  const DIRTY_WF = join(CANARY, 'dirty', '.github', 'workflows', 'deploy.yml');

  test('NOT VACUOUS: the corpus plants every rule this lane can fire, and each plant is still physically present', () => {
    assert.ok(plants.length >= RULES.length, `only ${plants.length} actions-gaps plant(s) for ${RULES.length} rules`);
    for (const p of plants) {
      const src = readFileSync(join(CANARY, p.file), 'utf8');
      for (const s of p.mustMatch) assert.ok(src.includes(s), `${p.file} no longer contains ${JSON.stringify(s)} — the plant was tidied away`);
    }
    // the third plant is an absence, which mustMatch cannot pin on its own
    assert.doesNotMatch(readFileSync(DIRTY_WF, 'utf8'), /^\s*permissions\s*:/m, 'dirty/deploy.yml gained a permissions: key — the permissions-absent plant is gone');
  });

  test('the DIRTY tree produces every planted rule — the direction that catches a dead scanner', () => {
    const r = run(join(CANARY, 'dirty'));
    assert.ok(r.summary.filesScanned > 0, 'a zero-file walk is a void, and a void would pass here for the wrong reason');
    assert.equal(r.summary.unparseable, 0, `a plant the reader could not parse is not a plant: ${JSON.stringify(r.summary.unparseableFiles)}`);
    for (const rule of RULES) {
      const hit = r.findings.find((f) => f.rule === rule && f.path === '.github/workflows/deploy.yml' && f.job === 'publish');
      assert.ok(hit, `${rule} did not fire on deploy.yml job publish: ${JSON.stringify(r.summary.byRule)}`);
    }
    assert.equal(r.findings.find((f) => f.rule === 'workflow-run-trigger').step, 'Check out the triggering head');
    const text = JSON.stringify(r);
    assert.ok(!text.includes('./deploy.sh'), 'a run: body reached the report');
    assert.ok(!text.includes('head_sha'), 'an expression reached the report');
    assert.ok(!text.includes('actions/checkout'), 'an action reference reached the report');
  });

  test('the CLEAN tree examines the same surfaces and produces none — the weaker claim', () => {
    const r = run(join(CANARY, 'clean'));
    assert.ok(r.summary.filesScanned >= 2, 'clean means examined-and-found-nothing, not examined-nothing');
    assert.ok(r.summary.jobsScanned >= 2, 'clean/ has fewer than two jobs, so its silence is assumed rather than measured');
    assert.equal(r.summary.unparseable, 0);
    assert.deepEqual(r.findings, [], `a benign workflow fired: ${JSON.stringify(r.findings)}`);
  });

  test('SECOND WITNESS: zizmor at the fleet persona reports the absent block and the trigger on dirty/deploy.yml, and neither on clean/deploy.yml', (t) => {
    if (!toolPresent('zizmor')) return t.skip('zizmor is not installed on this machine — the second witness is NOT measured, which is not a pass');
    const sarifOn = (dir) => {
      const r = spawnSync('zizmor', ['--offline', '--format', 'sarif', dir], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
      // zizmor exits 10-14 when it finds something, 0 when it finds nothing; anything else is a crash
      assert.ok(r.status === 0 || (r.status >= 10 && r.status <= 14), `zizmor could not run over ${dir}: status ${r.status} ${r.stderr.slice(0, 300)}`);
      const s = JSON.parse(r.stdout);
      return s.runs[0].results.filter((x) => /\/deploy\.yml$/.test(x.locations[0].physicalLocation.artifactLocation.uri)).map((x) => x.ruleId);
    };
    const dirty = sarifOn(join(CANARY, 'dirty'));
    assert.ok(dirty.includes('zizmor/excessive-permissions'), `zizmor did not report the absent permissions block: ${JSON.stringify(dirty)}`);
    assert.ok(dirty.includes('zizmor/dangerous-triggers'), `zizmor did not report workflow_run: ${JSON.stringify(dirty)}`);
    assert.ok(!dirty.includes('zizmor/self-hosted-runner'), 'zizmor now emits self-hosted-runner at the regular persona — re-measure and revisit ZIZMOR_SEV and the lane\'s formatNotes');
    const clean = sarifOn(join(CANARY, 'clean'));
    assert.deepEqual(clean.filter((id) => /excessive-permissions|dangerous-triggers|self-hosted-runner/.test(id)), [], `zizmor fired on the clean twin: ${JSON.stringify(clean)}`);
  });
});

describe('the SAST instrument fires on explicit untrusted input', () => {
  const have = toolPresent('semgrep');
  const rules = join(REPO, 'manifests', 'semgrep-taint');

  // Each SAST plant names the local rule that must fire on it, or why none can. The local taint rules
  // have shell sinks only; the lane's eval rules come from the p/default and p/security-audit
  // registry packs, which this offline test does not fetch.
  const PLANT_RULES = { 'sast-command-injection': 'cw-env-to-shell' };
  const PLANTS_UNEXERCISED = { 'sast-eval': 'no local taint rule has an eval sink; the lane fetches its eval rules from the registry' };

  function scan(kind) {
    const dir = mkdtempSync(join(tmpdir(), `cw-canary-sast-${kind}-`));
    const target = kind === 'dirty'
      ? join(CANARY, 'dirty', 'src', 'injection.mjs')
      : join(CANARY, 'clean', 'src', 'index.mjs');
    const report = join(dir, 'result.json');
    const r = spawnSync('semgrep', [
      'scan', '--config', rules, '--metrics=off', '--json', '--output', report, target,
    ], { encoding: 'utf8', timeout: 300000 });
    try {
      assert.equal(r.status, 0, `semgrep could not scan ${kind}: ${r.stderr.slice(0, 300)}`);
      assert.ok(existsSync(report), `semgrep wrote no report for ${kind} — that is unknown, not clean`);
      return JSON.parse(readFileSync(report, 'utf8'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('NOT VACUOUS: both SAST plants name explicit environment sources', () => {
    const plants = plantsFor('sast');
    assert.equal(plants.length, 2);
    for (const plant of plants) {
      assert.match(plant.mustMatch.join(' '), /process\.env\./,
        `${plant.id} has no explicit untrusted source, so a scanner is right to leave it untainted`);
    }
  });

  test('every SAST plant is asserted here or named as unexercised', () => {
    assert.deepEqual(plantsFor('sast').map((p) => p.id).sort(),
      [...Object.keys(PLANT_RULES), ...Object.keys(PLANTS_UNEXERCISED)].sort());
  });

  test('the DIRTY source fires the local rule for each plant it can detect', (t) => {
    if (!have) return t.skip('semgrep is not installed on this machine — lane NOT measured, which is not a pass');
    const result = scan('dirty');
    assert.ok(result.paths?.scanned?.length > 0, 'Semgrep examined no file — zero findings would be a void');
    for (const [plant, rule] of Object.entries(PLANT_RULES)) {
      assert.ok(result.results.some((x) => String(x.check_id).endsWith(rule)),
        `${rule} did not fire for ${plant}: ${JSON.stringify(result.results.map((x) => x.check_id))}`);
    }
  });

  test('the CLEAN source is examined and produces no findings', (t) => {
    if (!have) return t.skip('semgrep is not installed on this machine — lane NOT measured, which is not a pass');
    const result = scan('clean');
    assert.ok(result.paths?.scanned?.length > 0, 'Semgrep examined no file — zero findings would be a void');
    assert.deepEqual(result.results, []);
  });
});

describe('the container instruments fire on the planted Dockerfile', () => {
  const haveHadolint = toolPresent('hadolint');
  const haveTrivy = toolPresent('trivy');

  function hadolintOn(kind) {
    const dockerfile = join(CANARY, kind, 'Dockerfile');
    assert.ok(existsSync(dockerfile), `${dockerfile} is missing — nothing to lint is not a clean result`);
    const r = spawnSync('hadolint', ['-f', 'json', dockerfile], { encoding: 'utf8' });
    assert.ok(r.status === 0 || r.status === 1, `hadolint could not scan ${kind}: status ${r.status}`);
    // A crash also exits 1, with nothing on stdout; only a JSON array is a result.
    assert.match(r.stdout.trim(), /^\[/, `hadolint produced no report for ${kind}: ${r.stderr.slice(0, 200)}`);
    return JSON.parse(r.stdout);
  }

  function trivyOn(kind) {
    const r = spawnSync('trivy', ['config', '--quiet', '--format', 'json', join(CANARY, kind)], {
      encoding: 'utf8', timeout: 300000, maxBuffer: 32 * 1024 * 1024,
    });
    assert.equal(r.status, 0, `trivy could not scan ${kind}: ${r.stderr.slice(0, 300)}`);
    const body = JSON.parse(r.stdout);
    // An empty directory returns no Results at all; the Dockerfile must be among the targets examined.
    assert.ok((body.Results || []).some((x) => x.Target === 'Dockerfile' && x.MisconfSummary),
      `trivy examined no Dockerfile in ${kind}: ${JSON.stringify((body.Results || []).map((x) => x.Target))}`);
    return body.Results.flatMap((x) => x.Misconfigurations || []);
  }

  test('Hadolint finds the dirty Dockerfile and stays quiet on its clean twin', (t) => {
    if (!haveHadolint) return t.skip('hadolint is not installed on this machine — lane NOT measured, which is not a pass');
    const dirty = new Set(hadolintOn('dirty').map((x) => x.code));
    for (const id of ['DL3007', 'DL3008', 'DL3015', 'DL3009', 'DL4006']) assert.ok(dirty.has(id), `${id} did not fire`);
    assert.deepEqual(hadolintOn('clean'), []);
  });

  test('Trivy finds the dirty Dockerfile and stays quiet on its clean twin', (t) => {
    if (!haveTrivy) return t.skip('trivy is not installed on this machine — lane NOT measured, which is not a pass');
    const dirty = new Set(trivyOn('dirty').map((x) => x.ID));
    for (const id of ['DS-0001', 'DS-0002', 'DS-0026', 'DS-0029']) assert.ok(dirty.has(id), `${id} did not fire`);
    assert.deepEqual(trivyOn('clean'), []);
  });
});

describe('the canary declares which lanes have a working instrument here', () => {
  test('every lane in the corpus is either exercised above or NAMED as unexercised', () => {
    // Lanes with no assertion in this file are listed explicitly. A lane that quietly has no
    // instrument check is indistinguishable from one that passes, which is the whole defect this
    // file exists to remove — so the gap is written down rather than left to be noticed.
	const exercised = new Set(['secrets', 'ci-hygiene', 'agent-config', 'agent-instructions', 'commit-provenance', 'deps-content', 'model-artefacts', 'actions-gaps', 'sast', 'container']);
	const unexercised = ['dependency-cve'];
    const lanes = new Set(EXPECTED.dirty.plants.map((p) => p.lane));
    for (const lane of lanes) {
      assert.ok(exercised.has(lane) || unexercised.includes(lane),
        `lane '${lane}' is planted in the corpus but neither exercised nor declared unexercised here — `
        + 'add an instrument check or name it in the unexercised list, so the gap stays visible');
    }
    assert.deepEqual([...lanes].filter((l) => !exercised.has(l)).sort(), [...unexercised].sort(),
      'the unexercised list has drifted from the corpus — it must name exactly the lanes with no check');
  });
});
