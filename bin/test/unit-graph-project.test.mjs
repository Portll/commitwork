// The graph of lanes, findings, repos, areas and classes with per-relation build status (bin/graph.mjs project).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { project } from '../graph.mjs';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const ABSENT = { issues: 'no issues', taxonomy: 'no taxonomy', registry: 'no registry' };
const CLASSIFIED = { status: 'not-built', reason: 'the issue store records no weakness class per finding; a finding reaches the classes its lane covers through found-by then covers' };
const NOTE = 'claims that recorded a session id; no other issue event records one';
const off = (reason) => ({ status: 'not-built', reason });
const built = (edges, extra = {}) => ({ status: 'built', edges, ...extra });
const status = (over) => ({
  'finding-classified-as-class': CLASSIFIED, 'finding-found-by-lane': off('no issues'), 'finding-in-repo': off('no issues'),
  'lane-covers-class': off('no taxonomy'), 'lane-ran-on-repo': off('no registry'), 'repo-in-area': off('no registry'),
  'session-claimed-finding': off('no issues'), ...over,
});
const sessionNode = (s) => `session:${createHash('sha256').update(`session:${s}`).digest('hex').slice(0, 16)}`;
const run = (over) => project({ issues: null, taxonomy: null, registry: null, rollups: [], absent: ABSENT, ...over });
const others = (r) => r.nodes.filter((n) => n.kind !== 'lane');
const lane = (r, cat) => r.nodes.find((n) => n.id === `lane:${cat}`);
const node = (id, kind, label) => ({ id, kind, label });
const edge = (src, rel, dst) => ({ src, rel, dst });

test('findings link to their lane and repo, and only well-formed claims link a session', () => {
  const s1 = sessionNode('s1');
  const claim = (issueId, sessionId, type = 'issue-claimed') => ({ type, issueId, data: { sessionId } });
  const r = run({ issues: {
    issues: {
      i1: { id: 'i1', severity: 'high', state: 'open', title: 'Bug', source: { tool: 'accessibility' }, repo: 'alpha' },
      i2: { id: 'i2', severity: 'low', state: 'closed', source: { tool: 'hand-review' } },
    },
    events: [claim('i2', 's1'), claim('i1', 's1'), claim('i1', ''), claim('i1', 7), claim('i1', 's2', 'issue-noted'), claim('nope', 's3'), null],
  } });
  assert.deepEqual(others(r), [node('finding:i1', 'finding', 'high open Bug'), node('finding:i2', 'finding', 'low closed'),
    node('repo:alpha', 'repository', 'alpha'), node(s1, 'session', 'session')]);
  assert.deepEqual(lane(r, 'accessibility'), node('lane:accessibility', 'lane', 'accessibility (a11y-wcag)'));
  assert.deepEqual(lane(r, 'hand-review'), node('lane:hand-review', 'lane', 'hand-review'));
  assert.deepEqual(r.edges, [edge('finding:i1', 'found-by', 'lane:accessibility'), edge('finding:i1', 'in-repo', 'repo:alpha'),
    edge('finding:i2', 'found-by', 'lane:hand-review'), edge(s1, 'claimed', 'finding:i1'), edge(s1, 'claimed', 'finding:i2')]);
  assert.deepEqual(r.status, status({ 'finding-found-by-lane': built(2), 'finding-in-repo': built(1),
    'session-claimed-finding': built(2, { note: NOTE }) }));
});

test('an empty issue store builds each finding relation with no edges and leaves only scanner lanes', () => {
  const r = run({ issues: {} });
  assert.deepEqual(others(r), []);
  assert.deepEqual(r.edges, []);
  assert.deepEqual(r.nodes.slice(0, 3), [node('lane:accessibility', 'lane', 'accessibility (a11y-wcag)'),
    node('lane:actionsGaps', 'lane', 'actionsGaps (actions-gaps)'), node('lane:actionsHealth', 'lane', 'actionsHealth (actions-health)')]);
  assert.deepEqual(lane(r, 'bola'), node('lane:bola', 'lane', 'bola (dast-authz-bola)'));
  assert.deepEqual(Object.keys(r.status), ['finding-classified-as-class', 'finding-found-by-lane', 'finding-in-repo',
    'lane-covers-class', 'lane-ran-on-repo', 'repo-in-area', 'session-claimed-finding']);
  assert.deepEqual(r.status, status({ 'finding-found-by-lane': built(0), 'finding-in-repo': built(0),
    'session-claimed-finding': built(0, { note: NOTE }) }));
});

test('a repo known only from the issue store counts as outside the declared areas when no rollup ran', () => {
  const r = run({
    issues: { issues: { i9: { id: 'i9', severity: 'low', state: 'new', repo: 'alpha' } } },
    registry: { areas: [{ slug: 'area-a', label: 'Area A' }] },
  });
  assert.deepEqual(others(r), [node('area:area-a', 'area', 'Area A'), node('finding:i9', 'finding', 'low new'),
    node('repo:alpha', 'repository', 'alpha')]);
  assert.deepEqual(r.edges, [edge('finding:i9', 'in-repo', 'repo:alpha')]);
  assert.deepEqual(r.status, status({ 'finding-found-by-lane': built(0), 'finding-in-repo': built(1),
    'session-claimed-finding': built(0, { note: NOTE }), 'lane-ran-on-repo': built(0, { areasWithoutRollup: 0 }),
    'repo-in-area': built(0, { reposOutsideDeclaredAreas: 1 }) }));
});

test('a lane covers the known classes of the approach for its check, and a check-less approach covers no lane', () => {
  const r = run({ taxonomy: {
    weaknessClassVocab: { c1: { label: 'Injection' }, c2: {}, c3: null },
    approaches: [{ weaknessClasses: ['c2'] }, { check: 'a11y-wcag', weaknessClasses: ['c1', 'c3', 'zz'] }],
  } });
  const lanes = r.nodes.filter((n) => n.kind === 'lane').length;
  assert.deepEqual(others(r), [node('class:c1', 'class', 'Injection'), node('class:c2', 'class', 'c2'),
    node('class:c3', 'class', 'c3')]);
  assert.deepEqual(r.edges, [edge('lane:accessibility', 'covers', 'class:c1'), edge('lane:accessibility', 'covers', 'class:c3')]);
  assert.deepEqual(r.status, status({ 'lane-covers-class': built(2, { lanesWithoutTaxonomyEntry: lanes - 1 }) }));
});

test('ran-on edges come only from scanners that ran in rollups that exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'project-'));
  try {
    const file = join(dir, 'a.json');
    writeFileSync(file, JSON.stringify({ repos: [
      { name: 'alpha', scanners: { accessibility: { ran: true }, 'hand-review': { ran: false } } },
      { scanners: { accessibility: { ran: true } } }, null, { name: 'zeta' },
    ] }));
    const r = run({
      registry: { areas: [{ slug: 'area-a', label: 'Area A' }, { slug: 'area-b' }] },
      rollups: [
        { area: 'area-a', file },
        { area: 'area-b', doc: { repos: [{ name: 'beta', scanners: { 'hand-review': { ran: true }, accessibility: { ran: 'yes' }, other: null } }] } },
        { area: 'area-c', file: join(dir, 'missing.json') }, { area: 'area-d', doc: null }, { area: 'area-e', doc: { repos: 'none' } },
      ],
    });
    assert.deepEqual(others(r), [node('area:area-a', 'area', 'Area A'), node('area:area-b', 'area', 'area-b'),
      node('repo:alpha', 'repository', 'alpha'), node('repo:beta', 'repository', 'beta')]);
    assert.deepEqual(lane(r, 'hand-review'), node('lane:hand-review', 'lane', 'hand-review'));
    assert.equal(lane(r, 'other'), undefined);
    assert.deepEqual(r.edges, [edge('lane:accessibility', 'ran-on', 'repo:alpha'), edge('lane:hand-review', 'ran-on', 'repo:beta')]);
    assert.deepEqual(r.status, status({ 'lane-ran-on-repo': built(2, { areasWithoutRollup: 2 }),
      'repo-in-area': built(0, { reposOutsideDeclaredAreas: 2 }) }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a rollup path that is a directory or holds broken JSON makes project throw', () => {
  const dir = mkdtempSync(join(tmpdir(), 'project-'));
  try {
    const sub = join(dir, 'sub');
    const bad = join(dir, 'bad.json');
    mkdirSync(sub);
    writeFileSync(bad, '{oops');
    let parseMessage = '';
    try { JSON.parse('{oops'); } catch (e) { parseMessage = e.message; }
    const load = (file) => run({ registry: { areas: [] }, rollups: [{ area: 'area-a', file }] });
    assert.throws(() => load(sub), { name: 'Error', message: `a rollup at ${sub} is unreadable (EISDIR); refusing to build from it` });
    assert.throws(() => load(bad), { name: 'Error', message: `the rollup at ${bad} is not valid JSON (${parseMessage})` });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a finding label keeps the first one seen and is cut to 200 characters', () => {
  const finding = (id, title, severity = 'a') => ({ id, severity, state: 'b', title });
  const r = run({ issues: { issues: { k1: finding('i1', 'x'.repeat(196)), k2: finding('i2', 'y'.repeat(197)), k3: finding('i1', 'z', 'c') }, events: [] } });
  assert.deepEqual(others(r), [node('finding:i1', 'finding', `a b ${'x'.repeat(196)}`), node('finding:i2', 'finding', `a b ${'y'.repeat(196)}`)]);
  assert.deepEqual(r.edges, []);
});
