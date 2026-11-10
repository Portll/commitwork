// Taxonomy distance of a document's classes from its reference sets, with unmeasured sets and stale proposals (bin/scanner-taxonomy-render.mjs measureDistance).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { measureDistance } from '../scanner-taxonomy-render.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'measureDistance-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const put = (dir, name, value) => {
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(value));
  return p;
};

const solo = [{ id: 'a', name: 'A', description: 'd', machine: 'm', inherits: [] }];
const row = (id) => ({ id, name: `name ${id}`, description: `about ${id}`, machine: `rule ${id}` });
const kin = [
  ['quorvel brandix', 'tamsel vintor', 'plexar'],
  ['quorvel nadrim', 'tamsel ozwick', 'fennow'],
  ['lustrem nadrim', 'harbix ozwick', 'plexar'],
].map(([name, description, machine], i) => ({ id: `k${i}`, name, description, machine, inherits: [] }));
const measure = (dir, file) =>
  measureDistance({ classes: kin, referenceSets: [{ name: 'ref', path: file }], parentRegistry: file }, { repo: dir });

test('returns no report and nothing unmeasured when the document declares no reference sets', () => {
  assert.deepEqual(measureDistance({ classes: solo }), { unmeasured: [], report: null });
});

test('lists a set whose file is absent as unmeasured and returns no report', () => withDir((dir) => {
  const p = join(dir, 'absent.json');
  const r = measureDistance({ classes: solo, referenceSets: [{ name: 'absent', path: p }] }, { repo: dir });
  assert.deepEqual(r, { unmeasured: [{ name: 'absent', path: p, why: 'file absent on this machine' }], report: null });
}));

test('lists sets whose environment variable is unset or names a missing directory as unmeasured', () => withDir((dir) => {
  delete process.env.CW_MDTEST_NONE;
  process.env.CW_MDTEST_GONE = join(dir, 'nope');
  try {
    const r = measureDistance({
      classes: solo,
      referenceSets: [
        { name: 'unset', path: '$CW_MDTEST_NONE/a.json' },
        { name: 'gone', path: '$CW_MDTEST_GONE/b.json' },
      ],
    }, { repo: dir });
    assert.deepEqual(r, {
      unmeasured: [
        { name: 'unset', path: '$CW_MDTEST_NONE/a.json', why: 'missing input: CW_MDTEST_NONE is unset and has no default' },
        { name: 'gone', path: '$CW_MDTEST_GONE/b.json', why: `missing input: CW_MDTEST_GONE names ${join(dir, 'nope')}, which does not exist` },
      ],
      report: null,
    });
  } finally {
    delete process.env.CW_MDTEST_GONE;
  }
}));

test('throws when a set path exists but cannot be read as a file', () => withDir((dir) => {
  const p = join(dir, 'set.json');
  mkdirSync(p);
  assert.throws(() => measureDistance({ classes: solo, referenceSets: [{ name: 'dirset', path: p }] }, { repo: dir }), {
    name: 'Error',
    message: `referenceSet dirset at ${p} could not be read (EISDIR) \u2014 a set that fails to read is not an empty set`,
  });
}));

test('reports proposed ids that the landed classes already hold as stale proposals', () => withDir((dir) => {
  mkdirSync(join(dir, 'side'));
  process.env.CW_MDTEST_SIDE = join(dir, 'side');
  try {
    put(join(dir, 'side'), 'proposals.json', { x1: row('p1'), x2: row('p2'), x3: row('p3') });
    const landed = put(dir, 'landed.json', { classes: [row('p3'), row('q9'), row('p1')] });
    const r = measureDistance({
      classes: solo,
      referenceSets: [
        { name: 'proposed', path: '$CW_MDTEST_SIDE/proposals.json' },
        { name: 'landed', path: landed, pick: 'classes' },
      ],
      parentRegistry: landed,
    }, { repo: dir });
    assert.deepEqual(r.unmeasured, []);
    assert.deepEqual(r.staleProposals, ['p1', 'p3']);
  } finally {
    delete process.env.CW_MDTEST_SIDE;
  }
}));

test('reports no stale proposals when the landed set is absent', () => withDir((dir) => {
  const proposed = put(dir, 'p.json', [row('p1'), row('p2')]);
  const lp = join(dir, 'l.json');
  const r = measureDistance({
    classes: solo,
    referenceSets: [{ name: 'proposed', path: proposed }, { name: 'landed', path: lp }],
  }, { repo: dir });
  assert.deepEqual(r.unmeasured, [{ name: 'landed', path: lp, why: 'file absent on this machine' }]);
  assert.deepEqual(r.staleProposals, []);
}));

test('reads sidecar title and def and parent name and description as the same text', () => withDir((dir) => {
  const side = put(dir, 'side.json', kin.map(({ id, name, description, machine }) => ({ id, title: name, def: description, machine })));
  const parent = put(dir, 'parent.json', kin.map(({ id, name, description, machine }) => ({ id, name, description, machine })));
  const both = put(dir, 'both.json', kin.map(({ id, name, description, machine }) => ({ id, name, title: name, description, def: description, machine })));
  const expected = measure(dir, both);
  assert.deepEqual(expected.unmeasured, []);
  assert.deepEqual(expected.staleProposals, []);
  assert.deepEqual(measure(dir, side), expected);
  assert.deepEqual(measure(dir, parent), expected);
}));

test('treats a false, empty or missing machine field as the same empty text', () => withDir((dir) => {
  const make = (extra) => kin.map(({ id, name, description }) => ({ id, title: name, def: description, ...extra }));
  const files = [{ machine: '' }, { machine: false }, {}].map((extra, i) => put(dir, `m${i}.json`, make(extra)));
  const [blank, falsy, missing] = files.map((f) => measure(dir, f));
  assert.deepEqual(blank.staleProposals, []);
  assert.deepEqual(falsy, blank);
  assert.deepEqual(missing, blank);
}));

test('resolves citations only against the set whose path is the parent registry', () => withDir((dir) => {
  const one = put(dir, 'one.json', { classes: [{ id: 'c1', name: 'quorvel brandix', description: 'tamsel vintor', machine: 'plexar' }] });
  const two = put(dir, 'two.json', { classes: [{ id: 'c1', name: 'lustrem harbix', description: 'ozwick', machine: 'fennow' }] });
  const gone = join(dir, 'gone.json');
  const classes = [{ ...kin[0], inherits: ['c1'] }];
  const sets = [{ name: 'one', path: one, pick: 'classes' }, { name: 'two', path: two, pick: 'classes' }];
  const direct = measureDistance({ classes, referenceSets: sets, parentRegistry: one }, { repo: dir });
  const behind = measureDistance({ classes, referenceSets: [{ name: 'gone', path: gone }, ...sets], parentRegistry: one }, { repo: dir });
  assert.deepEqual(direct.unmeasured, []);
  assert.deepEqual(behind.unmeasured, [{ name: 'gone', path: gone, why: 'file absent on this machine' }]);
  assert.deepEqual(behind.report, direct.report);
}));
