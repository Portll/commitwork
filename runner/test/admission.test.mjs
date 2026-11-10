import { test } from 'node:test';
import assert from 'node:assert/strict';
import { admit } from '../admission.mjs';
import { CLEAN, PUBLIC, exampleConfig, makeJob, makeRun, withBuild, withStep } from './lib/fixtures.mjs';

const config = exampleConfig();
const SHA = makeRun().head_sha;
const check = (code, { run = makeRun(), job = makeJob(), text = CLEAN, actions = {} } = {}) => {
  const v = admit(run, job, text, config, actions);
  assert.equal(v.code, code, v.reason);
  assert.equal(v.admit, code === 'admitted');
  assert.ok(v.reason.length > 0);
  return v;
};
const action = (dir, text) => ({ [`${dir}@${SHA}`]: text });
const LOCAL = withStep('- uses: ./.github/actions/setup');

test('a clean push job is admitted', () => check('admitted'));

test('a same-repo pull_request is admitted', () => check('admitted', { run: makeRun({ event: 'pull_request' }) }));

test('a job not naming commitwork is not addressed: never refused, never cancelled', () => {
  check('not-addressed', { job: makeJob({ labels: ['ubuntu-latest'] }) });
  check('not-addressed', { job: makeJob({ labels: ['self-hosted', 'lmstudio'] }) });
});

test('an undeclared repository is skipped', () => check('repo-undeclared', { run: makeRun({ repo: 'example-owner/elsewhere' }) }));

test('pull_request_target and workflow_run are refused', () => {
  assert.match(check('event-privileged', { run: makeRun({ event: 'pull_request_target' }) }).reason, /pull_request_target/);
  check('event-privileged', { run: makeRun({ event: 'workflow_run' }) });
});

test('a fork pull_request is refused, and so is an unknown head', () => {
  const fork = makeRun({ event: 'pull_request', head_repository: { full_name: 'someone/example-private' } });
  assert.match(check('head-foreign', { run: fork }).reason, /someone\/example-private/);
  check('head-foreign', { run: makeRun({ event: 'pull_request_review', head_repository: { full_name: 'someone/x' } }) });
  check('head-foreign', { run: makeRun({ head_repository: null }) });
});

test('runs-on labels outside the set are refused; matching is case-insensitive', () => {
  assert.match(check('labels-outside-set', { job: makeJob({ labels: ['self-hosted', 'commitwork', 'gpu'] }) }).reason, /gpu/);
  check('admitted', { job: makeJob({ labels: ['Self-Hosted', 'Linux', 'ARM64', 'commitwork'] }) });
});

test('a per-repo label set replaces the global one', () => {
  const job = makeJob({ labels: ['self-hosted', 'commitwork', 'scan'] });
  check('admitted', { run: makeRun({ repo: PUBLIC }), job });
  check('labels-outside-set', { job });
});

test('container: and services: need docker', () => {
  assert.match(check('needs-container', { text: withBuild('    container: node:22') }).reason, /slots have none/);
  check('needs-services', { text: withBuild('    services:\n      db:\n        image: postgres') });
});

test('a docker:// step needs docker, and the reason says the check is static', () => {
  assert.match(check('needs-docker-action', { text: withStep('- uses: docker://alpine:3') }).reason, /statically visible/);
});

test('a local action whose action.yml is not visible is refused', () => {
  check('local-action-unseen', { text: LOCAL });
  check('local-action-unseen', { text: LOCAL, actions: action('.github/actions/setup', { error: { status: 404, reason: 'Not Found' } }) });
});

test('a visible local action is judged by runs.using, through composites', () => {
  check('needs-docker-action', { text: LOCAL, actions: action('.github/actions/setup', 'runs:\n  using: docker\n  image: Dockerfile\n') });
  check('admitted', { text: LOCAL, actions: action('.github/actions/setup', "runs:\n  using: node20\n  main: index.js\n") });
  const composite = 'runs:\n  using: composite\n  steps:\n    - uses: docker://alpine:3\n';
  check('needs-docker-action', { text: LOCAL, actions: action('.github/actions/setup', composite) });
});

test('a local action that failed to fetch waits rather than refusing', () => {
  check('workflow-unmeasured', { text: LOCAL, actions: action('.github/actions/setup', { error: { status: 502, reason: 'Bad Gateway' } }) });
});

test('a reusable workflow call is refused: the callee is not inspected', () => {
  const text = `${CLEAN}  call:\n    uses: ./.github/workflows/inner.yml\n`;
  check('reusable-workflow', { text, job: makeJob({ name: 'call / inner' }) });
});

test('workflow reads: dynamic path, 404, fetch failure, unparseable, unmapped job', () => {
  check('workflow-unseen', { run: makeRun({ path: 'dynamic/github-code-scanning/codeql' }) });
  check('workflow-unseen', { text: { error: { status: 404, reason: 'Not Found' } } });
  check('workflow-unmeasured', { text: { error: { status: 502, reason: 'Bad Gateway' } } });
  assert.equal(admit(makeRun(), makeJob(), undefined, config).code, 'workflow-unmeasured', 'never fetched');
  assert.match(check('workflow-unreadable', { text: `x: &a 1\n${CLEAN}` }).reason, /anchors/);
  check('job-unmapped', { job: makeJob({ name: 'deploy' }) });
});

test('matrix and expression-named jobs map to their workflow job', () => {
  const matrix = withBuild('    strategy:\n      matrix:\n        v: [1, 2]\n    container: node:22');
  check('needs-container', { text: matrix, job: makeJob({ name: 'build (1)' }) });
  const named = CLEAN.replace('  build:\n', '  build:\n    name: Build ${{ github.ref }}\n');
  check('admitted', { text: named, job: makeJob({ name: 'Build refs/heads/main' }) });
});

test('a definite refusal outranks an unreadable action', () => {
  const text = withStep('- uses: ./.github/actions/setup\n      - uses: docker://alpine:3');
  check('needs-docker-action', { text, actions: action('.github/actions/setup', { error: { status: 502, reason: 'x' } }) });
});

const by = (actor, triggering = actor) => makeRun({ actor: { login: actor }, triggering_actor: { login: triggering } });

test('only the declared actors: the owner by default, never a write collaborator', () => {
  check('admitted', { run: by('example-owner') });
  check('admitted', { run: by('Example-Owner') });
  const v = check('actor-foreign', { run: by('collaborator') });
  assert.match(v.reason, /run by collaborator, outside \[example-owner\]/);
  check('actor-foreign', { run: by('example-owner', 'collaborator') });
  check('actor-unknown', { run: makeRun({ actor: null, triggering_actor: null }) });
});

test('a same-repo pull request from a collaborator is refused like a fork', () => {
  const run = makeRun({ event: 'pull_request', actor: { login: 'collaborator' }, triggering_actor: { login: 'collaborator' } });
  check('actor-foreign', { run });
});
