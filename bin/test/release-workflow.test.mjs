// .github/workflows/release.yml and scorecard.yml: pins, per-job permissions, the approval gate, the
// order publish waits on, and the tag check executed by bash against throwaway repositories.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../actions-gaps.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WF = join(ROOT, '.github', 'workflows');
const read = (name) => readFileSync(join(WF, name), 'utf8');
const RELEASE = read('release.yml');
const doc = parseYaml(RELEASE);

const get = (n, ...keys) => keys.reduce((m, k) => (m && m.type === 'map' ? m.entries.get(k) : undefined), n);
const values = (n) => (!n ? [] : n.type === 'seq' ? n.items.map((i) => String(i.value)) : [String(n.value)]);
const jobs = () => [...get(doc, 'jobs').entries];
const steps = (job) => get(job, 'steps')?.items || [];
const usesOf = (job) => steps(job).map((s) => String(get(s, 'uses')?.value || '')).filter(Boolean);
const perms = (node) => {
  const p = get(node, 'permissions');
  if (!p) return null;
  if (p.type !== 'map') return String(p.value);
  return Object.fromEntries([...p.entries].map(([k, v]) => [k, String(v.value)]));
};
const dedent = (s) => {
  const ls = s.split('\n');
  const n = Math.min(...ls.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length));
  return ls.map((l) => l.slice(n)).join('\n');
};
const job = (name) => get(doc, 'jobs', name);

test('the release runs on a pushed v* tag and nothing else', () => {
  const on = get(doc, 'on');
  assert.deepEqual([...on.entries.keys()], ['push']);
  assert.deepEqual(values(get(on, 'push', 'tags')), ['v*']);
  assert.equal(get(on, 'push', 'branches'), undefined);
});

// A text scan, not the parser, so a `uses:` the parser mis-nests is still counted.
for (const name of ['release.yml', 'scorecard.yml']) {
  test(`${name}: every action is pinned to a full commit SHA`, () => {
    const refs = [...read(name).matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map((m) => m[1]);
    assert.ok(refs.length >= 4, `${name}: only ${refs.length} uses: lines found`);
    for (const r of refs) {
      if (r.startsWith('./')) continue;
      assert.match(r, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${name}: ${r} is not pinned to a 40-hex SHA`);
    }
  });
}

test('the workflow grants nothing by default and no job holds write-all', () => {
  assert.deepEqual(perms(doc), {}, 'top-level permissions must be {}');
  for (const [name, j] of jobs()) {
    const p = perms(j);
    assert.ok(p && typeof p === 'object', `job ${name} must declare its own permissions map`);
    assert.ok(!/write-all/.test(JSON.stringify(p)), `job ${name} holds write-all`);
  }
  assert.doesNotMatch(RELEASE, /write-all/);
});

test('the tag is checked against package.json before anything else runs', () => {
  const run = steps(job('version')).map((s) => String(get(s, 'run')?.value || '')).join('\n');
  assert.match(run, /bin\/release-tag\.mjs --ref "\$GITHUB_SHA"/);
  assert.match(run, /"\$GITHUB_REF_NAME" != "\$expected"/);
  for (const [name, j] of jobs()) {
    if (name === 'version') continue;
    assert.ok(values(get(j, 'needs')).includes('version'), `job ${name} does not wait for the tag check`);
  }
});

test('attestation jobs hold id-token and attestations write, and only they do', () => {
  const attesting = jobs().filter(([, j]) => usesOf(j).some((u) => /^actions\/attest(-[\w-]+)?@/.test(u)));
  assert.deepEqual(attesting.map(([n]) => n), ['attest']);
  const kinds = usesOf(job('attest')).map((u) => u.split('@')[0]);
  assert.ok(kinds.includes('actions/attest-build-provenance'), 'no provenance attestation');
  assert.ok(steps(job('attest')).some((s) => get(s, 'with', 'sbom-path')), 'no SBOM attestation');
  for (const [name, j] of jobs()) {
    const p = perms(j);
    const holds = p['id-token'] === 'write' || p.attestations === 'write';
    if (name === 'attest') assert.deepEqual(p, { 'id-token': 'write', attestations: 'write' });
    else assert.ok(!holds, `job ${name} holds id-token or attestations write`);
  }
});

test('only the publish job writes contents, behind the release environment', () => {
  const publishing = jobs().filter(([, j]) => steps(j).some((s) => /gh release create/.test(String(get(s, 'run')?.value || ''))));
  assert.deepEqual(publishing.map(([n]) => n), ['publish']);
  assert.equal(String(get(job('publish'), 'environment')?.value), 'release');
  for (const [name, j] of jobs()) {
    if (name !== 'publish') assert.notEqual(perms(j).contents, 'write', `job ${name} writes contents`);
  }
  assert.equal(perms(job('publish')).contents, 'write');
  assert.match(RELEASE, /gh release create [^\n]*--verify-tag/, 'publish must never create the tag');
});

test('publish waits on CI, the build and the attestation', () => {
  const closure = (name, seen = new Set()) => {
    for (const n of values(get(job(name), 'needs'))) if (!seen.has(n)) { seen.add(n); closure(n, seen); }
    return seen;
  };
  const before = closure('publish');
  for (const n of ['version', 'ci', 'build', 'attest']) assert.ok(before.has(n), `publish does not wait for ${n}`);
  assert.equal(String(get(job('ci'), 'uses').value), './.github/workflows/ci.yml');
  const ci = parseYaml(read('ci.yml'));
  assert.ok(get(ci, 'on', 'workflow_call'), 'ci.yml must declare workflow_call for release.yml to call it');
  assert.deepEqual(values(get(ci, 'on', 'push', 'branches')), ['**'], 'ci.yml must leave tags to release.yml');
});

test('scorecard does not publish results while the repository is private', () => {
  const sc = parseYaml(read('scorecard.yml'));
  const step = steps(get(sc, 'jobs', 'analysis')).find((s) => /^ossf\/scorecard-action@/.test(String(get(s, 'uses')?.value)));
  assert.ok(step, 'no scorecard-action step');
  assert.equal(String(get(step, 'with', 'publish_results').value), 'false');
  assert.deepEqual(perms(sc), {});
});

// ── the tag check, executed ────────────────────────────────────────────────────────────────────
const shell = spawnSync('bash', ['-c', 'command -v jq'], { encoding: 'utf8' });
const runnable = { skip: process.platform === 'win32' ? 'the step is a bash script' : shell.status !== 0 && 'jq is not installed' };

function versionStep() {
  const step = steps(job('version')).find((s) => get(s, 'id')?.value === 'plan');
  const script = dedent(String(get(step, 'run').value));
  const swapped = script.replace('node bin/release-tag.mjs', `node ${JSON.stringify(join(ROOT, 'bin', 'release-tag.mjs'))}`);
  assert.notEqual(swapped, script, 'the step no longer calls bin/release-tag.mjs');
  return swapped;
}

function repo(version) {
  const dir = mkdtempSync(join(tmpdir(), 'cw-release-wf-'));
  const git = (...a) => {
    const r = spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version }));
  git('add', 'package.json');
  git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '-m', 'release');
  const sha = git('rev-parse', 'HEAD');
  return { dir, git, sha };
}

function runStep(dir, sha, ref) {
  const out = join(dir, '.out');
  writeFileSync(out, '');
  const r = spawnSync('bash', ['--noprofile', '--norc', '-eo', 'pipefail', '-c', versionStep()], {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, CW_REPO_ROOT: dir, GITHUB_SHA: sha, GITHUB_REF_NAME: ref, RUNNER_TEMP: dir, GITHUB_OUTPUT: out },
  });
  return { ...r, output: readFileSync(out, 'utf8') };
}

test('a tag naming the commit\'s minor version on main passes and outputs the version', runnable, () => {
  const { dir, git, sha } = repo('0.9.0');
  try {
    git('update-ref', 'refs/remotes/origin/main', sha);
    const r = runStep(dir, sha, 'v0.9.0');
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.equal(r.output, 'version=0.9.0\n');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a tag that disagrees with package.json is refused', runnable, () => {
  const { dir, git, sha } = repo('0.9.0');
  try {
    git('update-ref', 'refs/remotes/origin/main', sha);
    const r = runStep(dir, sha, 'v0.10.0');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /tag v0\.10\.0 does not match package\.json version 0\.9\.0/);
    assert.equal(r.output, '');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a patch version is refused even when the tag matches it', runnable, () => {
  const { dir, git, sha } = repo('0.9.4');
  try {
    git('update-ref', 'refs/remotes/origin/main', sha);
    const r = runStep(dir, sha, 'v0.9.4');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /is a patch version/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a commit off main is refused', runnable, () => {
  const { dir, git, sha } = repo('0.9.0');
  try {
    git('update-ref', 'refs/remotes/origin/main', sha);
    git('-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'off main');
    const off = git('rev-parse', 'HEAD');
    const r = runStep(dir, off, 'v0.9.0');
    assert.equal(r.status, 1);
    assert.match(r.stdout, /is not on main/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
