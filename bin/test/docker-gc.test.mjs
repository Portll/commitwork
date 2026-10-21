import { test } from 'node:test';
import assert from 'node:assert/strict';
import { retention, parseReclaimed, dockerRun, collect, describe } from '../docker-gc.mjs';

const withEnv = (k, v, fn) => {
  const prev = process.env[k];
  try { if (v === undefined) delete process.env[k]; else process.env[k] = v; return fn(); }
  finally { if (prev === undefined) delete process.env[k]; else process.env[k] = prev; }
};

/** A fake `docker` that answers per-subcommand and records what it was asked. */
const fakeDocker = (answers) => {
  const calls = [];
  const exec = (bin, args) => {
    calls.push(args.join(' '));
    const key = args.slice(0, 2).join(' ');
    const a = answers[key];
    if (a === undefined) throw new Error(`unexpected: ${args.join(' ')}`);
    if (a instanceof Error) throw a;
    return a;
  };
  exec.calls = calls;
  return exec;
};

test('retention is read at CALL time, so an override set after import still applies', () => {
  withEnv('CW_DOCKER_GC_UNTIL', undefined, () => assert.equal(retention(), '720h'));
  withEnv('CW_DOCKER_GC_UNTIL', '168h', () => assert.equal(retention(), '168h',
    'a module-load const would have frozen 720h here'));
  withEnv('CW_DOCKER_GC_UNTIL', '', () => assert.equal(retention(), '720h', 'empty falls back'));
});

test('an unreachable daemon is UNMEASURED, never "nothing to reclaim"', () => {
  const exec = fakeDocker({ 'version --format': new Error('Cannot connect to the Docker daemon') });
  const r = collect({ exec });
  assert.equal(r.ran, false);
  assert.match(r.reason, /unreachable/);
  assert.equal(r.reclaimed, undefined, 'a GC that could not run must not report a reclaim figure');
  assert.match(describe(r), /NOT RUN/);
});

test('a prune that errors is reported as a failure, not as a clean run', () => {
  const exec = fakeDocker({
    'version --format': '29.6.2\n',
    'image prune': new Error('input/output error'),
  });
  const r = collect({ exec });
  assert.equal(r.ran, false);
  assert.match(r.reason, /prune failed.*input\/output error/);
});

test('--dry names the exact command and runs no prune — the whole point of a dry run', () => {
  const exec = fakeDocker({ 'version --format': '29.6.2\n' });
  const r = collect({ dry: true, exec });
  assert.equal(r.ran, false);
  assert.match(r.reason, /would run: docker image prune -a --filter until=720h/);
  assert.equal(exec.calls.some((c) => c.startsWith('image prune')), false,
    'a dry run that actually pruned would be the failure this flag exists to prevent');
});

test('the real run carries -f and the retention filter, and never touches volumes', () => {
  const exec = fakeDocker({
    'version --format': '29.6.2\n',
    'image prune': 'deleted: sha256:abc\nTotal reclaimed space: 36.76GB\n',
  });
  const r = collect({ exec });
  assert.equal(r.ran, true);
  assert.equal(r.reclaimed, '36.76GB');
  const pruneCall = exec.calls.find((c) => c.startsWith('image prune'));
  assert.match(pruneCall, /--filter until=720h/);
  assert.match(pruneCall, / -f\b/);
  assert.equal(exec.calls.some((c) => c.includes('volume')), false,
    'volumes hold state no registry can give back');
  assert.equal(exec.calls.some((c) => c.includes('container')), false);
});

test('an absent reclaim line is unknown, not 0B — docker printing nothing is not a measurement', () => {
  const exec = fakeDocker({ 'version --format': '29.6.2\n', 'image prune': '\n' });
  const r = collect({ exec });
  assert.equal(r.ran, true);
  assert.equal(r.reclaimed, null);
  assert.match(describe(r), /not reported by docker/);
});

test('parseReclaimed reads the figure it is given and invents none', () => {
  assert.equal(parseReclaimed('Total reclaimed space: 1.243GB'), '1.243GB');
  assert.equal(parseReclaimed('Total reclaimed space: 0B'), '0B');
  assert.equal(parseReclaimed('nothing of the sort'), null);
  assert.equal(parseReclaimed(undefined), null);
});

test('dockerRun never throws — a GC cannot take the host down for failing to tidy it', () => {
  assert.doesNotThrow(() => dockerRun(['version'], { exec: () => { throw new Error('boom'); } }));
  const r = dockerRun(['version'], { exec: () => { const e = new Error('x'); e.stderr = 'permission denied\n'; throw e; } });
  assert.equal(r.ok, false);
  assert.match(r.reason, /permission denied/);
});

test('the retention override reaches the command actually issued', () => {
  withEnv('CW_DOCKER_GC_UNTIL', '168h', () => {
    const exec = fakeDocker({ 'version --format': '29.6.2\n', 'image prune': 'Total reclaimed space: 1B\n' });
    collect({ exec });
    assert.match(exec.calls.find((c) => c.startsWith('image prune')), /until=168h/,
      'an override that stops at the config boundary proves nothing');
  });
});
