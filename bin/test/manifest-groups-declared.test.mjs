// `commitwork list` prints the top-level `groups` map alone while groupMembers() runs the union with
// each check's own `groups` tags, so a tag-only group runs and is never listed.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { groupMembers } from '../commitwork.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MANIFEST_DIR = path.join(ROOT, 'manifests');

const manifests = fs.readdirSync(MANIFEST_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => ({ name: f, doc: JSON.parse(fs.readFileSync(path.join(MANIFEST_DIR, f), 'utf8')) }))
  .filter((m) => Array.isArray(m.doc.checks));

describe('manifest groups — runnable implies discoverable', () => {
  test('every group a check tags itself with is declared in the top-level map', () => {
    assert.ok(manifests.length, 'no manifests with checks were read — a vacuous pass');
    for (const { name, doc } of manifests) {
      const top = Object.keys(doc.groups || {});
      const tagged = new Map();
      for (const c of doc.checks) for (const g of (c.groups || [])) {
        if (!tagged.has(g)) tagged.set(g, []);
        tagged.get(g).push(c.id);
      }
      const undeclared = [...tagged.keys()].filter((g) => !top.includes(g));
      assert.deepEqual(undeclared, [],
        `${name}: ${undeclared.map((g) => `${g} (${tagged.get(g).join(', ')})`).join('; ')} `
        + 'runs but is not in the top-level `groups` map, so `commitwork list` never prints it');
    }
  });

  test('every id in the top-level map names a check that exists', () => {
    for (const { name, doc } of manifests) {
      const ids = new Set(doc.checks.map((c) => c.id));
      for (const [g, members] of Object.entries(doc.groups || {})) {
        const ghosts = members.filter((id) => !ids.has(id));
        assert.deepEqual(ghosts, [],
          `${name}: groups.${g} names ${ghosts.join(', ')}, which no check declares — `
          + 'the group resolves smaller than it reads');
      }
    }
  });

  test('the runner\'s own resolver reaches every check that claims a group', () => {
    // groupMembers itself, not a copy, so drift in the shipped union fails here.
    let checked = 0;
    for (const { name, doc } of manifests) {
      for (const c of doc.checks) {
        for (const g of (c.groups || [])) {
          const resolved = groupMembers(doc, g).map((x) => x.id);
          assert.ok(resolved.includes(c.id),
            `${name}: ${c.id} tags itself into group ${g}, and groupMembers(${g}) returns `
            + `[${resolved.join(', ')}] without it`);
          checked += 1;
        }
      }
    }
    assert.ok(checked > 0, 'no check claimed any group — the assertion never ran');
  });

  test('the resolver is non-vacuous — an unknown group resolves empty', () => {
    const doc = manifests[0].doc;
    assert.deepEqual(groupMembers(doc, 'no-such-group-exists'), [],
      'an undeclared group resolved to a non-empty set, so membership means nothing');
  });
});
