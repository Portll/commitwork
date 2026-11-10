// Resolves a project's repository path, repo name and fleet names from launchlist config and fleet (bin/release-candidate.mjs projectPlan).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectPlan } from '../release-candidate.mjs';

test('rejects when the project has no entry in the config projects map', async () => {
  const config = { projects: { other: { repo: '/x/other' } }, absent: false };
  await assert.rejects(
    () => projectPlan('missing', { config, fleet: [{ name: 'a' }] }),
    { name: 'Error', message: 'no launchlist config for missing: its repository, tests and self-names are declared there' }
  );
});

test('rejects with an absent suffix when the config is absent and the projects map is empty', async () => {
  const config = { projects: {}, absent: true };
  await assert.rejects(
    () => projectPlan('ghost', { config, fleet: [{ name: 'a' }] }),
    { name: 'Error', message: 'no launchlist config for ghost (the config is absent): its repository, tests and self-names are declared there' }
  );
});

test('rejects with an absent suffix when the config has no projects map at all', async () => {
  const config = { absent: true };
  await assert.rejects(
    () => projectPlan('ghost', { config, fleet: [{ name: 'a' }] }),
    { name: 'Error', message: 'no launchlist config for ghost (the config is absent): its repository, tests and self-names are declared there' }
  );
});

test('rejects when the project has no repository path in config or fleet', async () => {
  const config = { projects: { p: {} } };
  await assert.rejects(
    () => projectPlan('p', { config, fleet: [{ name: 'a' }] }),
    { name: 'Error', message: 'p has no repository path (config repo, or a fleet registry entry)' }
  );
});

test('rejects when the fleet is empty and the config has no repo', async () => {
  const config = { projects: { p: {} } };
  await assert.rejects(
    () => projectPlan('p', { config, fleet: [] }),
    { name: 'Error', message: 'p has no repository path (config repo, or a fleet registry entry)' }
  );
});

test('returns the resolved repo path and fleet names when the config declares a repo', async () => {
  const config = { projects: { p: { repo: '/repos/p' } } };
  const r = await projectPlan('p', { config, fleet: [{ name: 'a' }, { name: 'b' }] });
  assert.deepEqual(r, {
    project: 'p',
    repo: '/repos/p',
    repoName: 'p',
    cfg: { repo: '/repos/p' },
    config: { projects: { p: { repo: '/repos/p' } } },
    fleetNames: ['a', 'b'],
  });
});

test('returns the fleet registry path when the config has no repo but the fleet has an entry', async () => {
  const config = { projects: { p: {} } };
  const r = await projectPlan('p', { config, fleet: [{ name: 'p', path: '/fleet/p' }] });
  assert.deepEqual(r, {
    project: 'p',
    repo: '/fleet/p',
    repoName: 'p',
    cfg: {},
    config: { projects: { p: {} } },
    fleetNames: ['p'],
  });
});

test('returns the config repo path with no fleet names when the fleet is empty', async () => {
  const config = { projects: { p: { repo: '/repos/p' } } };
  const r = await projectPlan('p', { config, fleet: [] });
  assert.deepEqual(r, {
    project: 'p',
    repo: '/repos/p',
    repoName: 'p',
    cfg: { repo: '/repos/p' },
    config: { projects: { p: { repo: '/repos/p' } } },
    fleetNames: [],
  });
});
