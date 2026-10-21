// node --test bin/test/container-workflow.test.mjs
//
// .github/workflows/container.yml: it builds the image and runs container/smoke.sh, only on pull
// requests and on main, only when what the image installs or confines changes, with SHA-pinned
// actions, a read-only token and no registry credential or push.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseYaml } from '../actions-gaps.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TEXT = readFileSync(join(ROOT, '.github', 'workflows', 'container.yml'), 'utf8');
const doc = parseYaml(TEXT);
const get = (n, ...keys) => keys.reduce((m, k) => (m && m.type === 'map' ? m.entries.get(k) : undefined), n);
const values = (n) => (!n ? [] : n.type === 'seq' ? n.items.map((i) => String(i.value)) : [String(n.value)]);
const jobs = () => [...get(doc, 'jobs').entries];
const steps = (job) => get(job, 'steps')?.items || [];
const runs = () => jobs().flatMap(([, j]) => steps(j).map((s) => String(get(s, 'run')?.value || ''))).join('\n');
// What decides the image's contents or its confinement; a change to any of them must build it.
const WATCHED = ['container/**', 'bin/lib/sandbox*.mjs', 'bin/setup.mjs', 'bin/install.sh', 'manifests/install-catalog.json', '.github/workflows/container.yml'];

test('it runs on pull requests and on pushes to main, and on nothing else', () => {
  const on = get(doc, 'on');
  assert.deepEqual([...on.entries.keys()].sort(), ['pull_request', 'push']);
  assert.deepEqual(values(get(on, 'push', 'branches')), ['main']);
  assert.equal(get(on, 'pull_request', 'branches'), undefined, 'every pull request, whatever its base');
});

test('both triggers are bounded by the same paths, and those cover what the image is built from', () => {
  const pr = values(get(doc, 'on', 'pull_request', 'paths'));
  assert.deepEqual(values(get(doc, 'on', 'push', 'paths')), pr);
  assert.deepEqual(pr, WATCHED);
  assert.ok(!pr.some((p) => p.startsWith('!')), 'no exclusions: an unbounded trigger is what this filter prevents');
});

test('every action is pinned to a full commit SHA', () => {
  const refs = [...TEXT.matchAll(/^\s*(?:-\s+)?uses:\s*(\S+)/gm)].map((m) => m[1]);
  assert.ok(refs.length >= 1);
  for (const r of refs) assert.match(r, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, `${r} is not pinned to a 40-hex SHA`);
});

test('a read-only token, no credential kept, no secret, no registry, no push', () => {
  assert.equal(String(get(doc, 'permissions', 'contents')?.value), 'read');
  assert.deepEqual([...get(doc, 'permissions').entries.keys()], ['contents']);
  for (const [name, j] of jobs()) assert.equal(get(j, 'permissions'), undefined, `job ${name} widens the token`);
  for (const [, j] of jobs()) {
    for (const s of steps(j)) {
      if (/^actions\/checkout@/.test(String(get(s, 'uses')?.value || ''))) assert.equal(String(get(s, 'with', 'persist-credentials')?.value), 'false');
    }
  }
  assert.doesNotMatch(TEXT, /\$\{\{\s*secrets\./);
  assert.doesNotMatch(TEXT, /docker\s+(?:login|push)\b|--push\b|\bpush:\s*true\b|docker\/login-action|docker\/build-push-action/);
});

test('it builds the image from git archive and runs the smoke script against that image', () => {
  const r = runs();
  const build = /git archive --format=tar HEAD \| docker buildx build --load -f container\/Dockerfile -t (\S+) -/.exec(r);
  assert.ok(build, 'no docker buildx build of container/Dockerfile from git archive');
  assert.match(r, new RegExp(`sh container/smoke\\.sh ${build[1].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} --min \\d+`));
});
