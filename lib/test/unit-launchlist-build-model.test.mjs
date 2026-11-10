// Builds the launchlist report model with one evaluated entry per project (lib/launchlist.mjs buildModel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildModel } from '../launchlist.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const baseSpec = (items = []) => ({ sections: { s1: { title: 'S1' } }, profiles: { p1: { sections: ['s1'] }, p2: { sections: ['s1'] } }, items });
const makeState = (extra = {}) => ({ version: 1, ticks: {}, items: {}, log: [], ...extra });
const zeroSummary = { total: 0, done: 0, openHard: 0, openShould: 0, openLater: 0, unmeasured: 0 };
const emptyProject = (project, profiles) => ({ project, profiles, measuredAt: null, repo: null, rows: [], summary: zeroSummary });
const run = (args) => {
  const dir = mkdtempSync(join(tmpdir(), 'buildModel-'));
  try {
    const { generatedAt, ...rest } = buildModel(args);
    assert.match(generatedAt, ISO);
    return rest;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('An explicit projects list is used instead of the projects found in the store', () => {
  const spec = baseSpec();
  const config = { projects: { 'zz-bm-stored': { profiles: ['p2'] } }, defaults: { profiles: ['p1'] } };
  const r = run({ spec, config, state: makeState(), projects: ['zz-bm-given'] });
  assert.deepEqual(r, { sections: spec.sections, profiles: spec.profiles, configAbsent: false, projects: [emptyProject('zz-bm-given', ['p1'])] });
});

test('A null projects list falls back to the sorted union of config projects, state items and state ticks', () => {
  const spec = baseSpec();
  const config = { projects: { 'zz-bm-c': { profiles: ['p2'] } }, defaults: { profiles: ['p1'] } };
  const state = makeState({ ticks: { 'zz-bm-b': {}, 'zz-bm-c': {} }, items: { 'zz-bm-a': [] } });
  const r = run({ spec, config, state, projects: null });
  assert.deepEqual(r, {
    sections: spec.sections, profiles: spec.profiles, configAbsent: false,
    projects: [emptyProject('zz-bm-a', ['p1']), emptyProject('zz-bm-b', ['p1']), emptyProject('zz-bm-c', ['p2'])],
  });
});

test('Omitting projects with an empty store and an absent config yields no projects and marks the config absent', () => {
  const spec = baseSpec();
  const config = { projects: {}, defaults: { profiles: ['p1'] }, absent: true };
  const r = run({ spec, config, state: makeState() });
  assert.deepEqual(r, { sections: spec.sections, profiles: spec.profiles, configAbsent: true, projects: [] });
});

test('An empty explicit projects list yields no projects even when the store has some', () => {
  const spec = baseSpec();
  const config = { projects: { 'zz-bm-stored': { profiles: ['p1'] } }, defaults: { profiles: ['p1'] } };
  const state = makeState({ ticks: { 'zz-bm-ticked': {} } });
  const r = run({ spec, config, state, projects: [] });
  assert.deepEqual(r, { sections: spec.sections, profiles: spec.profiles, configAbsent: false, projects: [] });
});

test('Sections and profiles in the model are the spec objects themselves', () => {
  const spec = baseSpec();
  const r = run({ spec, config: { projects: {}, defaults: { profiles: ['p1'] } }, state: makeState(), projects: [] });
  assert.equal(r.sections, spec.sections);
  assert.equal(r.profiles, spec.profiles);
});

test('A project with an empty profiles list and no config defaults is evaluated under the publication profile', () => {
  const spec = baseSpec();
  const config = { projects: { 'zz-bm-e': { profiles: [] } } };
  const r = run({ spec, config, state: makeState(), projects: null });
  assert.deepEqual(r, { sections: spec.sections, profiles: spec.profiles, configAbsent: false, projects: [emptyProject('zz-bm-e', ['publication'])] });
});

test('Each project row reflects its checks, ticks and custom items when no results file exists', () => {
  const items = [
    { id: 'a', title: 'A', section: 's1', severity: 'HARD', owner: 'o', size: 'S', profile: 'p1', check: 'chk' },
    { id: 'b', title: 'B', section: 's1', severity: 'SHOULD', owner: 'o', size: 'M', profile: ['p1'] },
    { id: 'd', title: 'D', section: 's1', severity: 'HARD', owner: 'o', size: 'S', profile: 'p2' },
  ];
  const spec = baseSpec(items);
  const config = { projects: { 'zz-bm-rows': { profiles: ['p1'] } }, defaults: { profiles: ['p2'] } };
  const state = makeState({
    ticks: { 'zz-bm-rows': { b: { state: 'done' } } },
    items: { 'zz-bm-rows': [{ id: 'c', title: 'C', section: 's1', severity: 'LATER', owner: 'me', size: 'L', evidence: ['e1'] }] },
  });
  const r = run({ spec, config, state, projects: ['zz-bm-rows'] });
  const common = { why: '', how: '', source: '', accepted: false, lapsed: false, stale: false, na: false };
  assert.deepEqual(r, {
    sections: spec.sections, profiles: spec.profiles, configAbsent: false,
    projects: [{
      project: 'zz-bm-rows', profiles: ['p1'], measuredAt: null, repo: null,
      rows: [
        { ...common, id: 'a', title: 'A', section: 's1', severity: 'HARD', owner: 'o', size: 'S', check: 'chk', custom: false, evidence: [],
          result: { status: 'unmeasured', summary: 'launchlist has not run for this project', evidence: [] }, tick: null, done: false },
        { ...common, id: 'b', title: 'B', section: 's1', severity: 'SHOULD', owner: 'o', size: 'M', check: null, custom: false, evidence: [],
          result: null, tick: { state: 'done' }, done: true },
        { ...common, id: 'c', title: 'C', section: 's1', severity: 'LATER', owner: 'me', size: 'L', check: null, custom: true, evidence: ['e1'],
          result: null, tick: null, done: false },
      ],
      summary: { total: 3, done: 1, openHard: 1, openShould: 0, openLater: 1, unmeasured: 1 },
    }],
  });
});
