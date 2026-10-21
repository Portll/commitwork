// THE ATTRIBUTION LEXICON — every term in this subsystem is declared, and no term may be added
// without declaring it.
//
// WHY. Four vocabularies grew across this subsystem in one day and collided. `undetermined` came to
// mean FOUR different things — the recorder could not tell, the touches predate the commit, HEAD ran
// fewer cases, the disk was unreadable — and three near-synonyms (`unknown`, `undetermined`,
// `unevidenced`) ended up in ONE result object with nothing to tell a reader them apart.
//
// That is the same defect the rest of this work exists to fix, one level up: a word that answers two
// questions answers neither. GATE_REGISTRY already proved the remedy — a registry plus a test that
// the registry is complete is what caught `regression-incomparable` being added silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ATTRIBUTION_LEXICON, LEXICON_TERMS, lexiconCollisions, ACCESS_KINDS } from '../lib/touch-ledger-core.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');

test('every ACCESS_KIND is declared in the lexicon', () => {
  for (const k of ACCESS_KINDS) {
    assert.ok(LEXICON_TERMS.has(`access.${k}`),
      `access kind "${k}" is in use but undeclared — declare it or stop emitting it`);
  }
});

test('every authorOf basis is declared', () => {
  const src = read('bin/gate-tests-core.mjs');
  const used = new Set([...src.matchAll(/basis: '([a-z-]+)'/g)].map((m) => m[1]));
  assert.ok(used.size >= 3, 'the scan must actually find the bases');
  for (const b of used) {
    assert.ok(LEXICON_TERMS.has(`basis.${b}`), `authorOf basis "${b}" is undeclared`);
  }
});

test('every unattributedKind is declared', () => {
  const src = read('bin/gate-tests-core.mjs');
  const used = new Set([...src.matchAll(/return '(no-ledger|no-session|no-entry)'/g)].map((m) => m[1]));
  assert.equal(used.size, 3, 'all three kinds must be reachable in source');
  for (const k of used) assert.ok(LEXICON_TERMS.has(`kind.${k}`), `kind "${k}" is undeclared`);
});

test('every emptyReason is declared', () => {
  const src = read('bin/gate-ratchet-core.mjs');
  const m = src.match(/EMPTY_REASONS = new Set\(\[([^\]]+)\]/);
  assert.ok(m, 'EMPTY_REASONS must be findable');
  for (const r of [...m[1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1])) {
    assert.ok(LEXICON_TERMS.has(`empty.${r}`), `emptyReason "${r}" is undeclared`);
  }
});

test('every attributeFiles bucket is declared', () => {
  const src = read('bin/gate-tests-core.mjs');
  const m = src.match(/const base = \{([^}]+)\}/);
  assert.ok(m, 'the base result shape must be findable');
  for (const b of ['unknown', 'undetermined', 'unevidenced']) {
    assert.ok(m[1].includes(`${b}: []`), `${b} must still be a bucket — this test tracks the real shape`);
    assert.ok(LEXICON_TERMS.has(`bucket.${b}`), `bucket "${b}" is undeclared`);
  }
});

test('NO TWO TERMS SHARE A DISCRIMINATOR — same concept, two names, is a defect', () => {
  const collisions = lexiconCollisions();
  assert.deepEqual(collisions, [],
    `these terms mean the same thing in the same scope and one should go: ${JSON.stringify(collisions)}`);
});

test('every declared term carries a scope and a meaning — a row that explains nothing is not a declaration', () => {
  for (const [k, v] of Object.entries(ATTRIBUTION_LEXICON)) {
    assert.ok(v.field, `${k} has no field`);
    assert.ok(v.scope, `${k} has no scope`);
    assert.ok(v.means && v.means.length > 15, `${k} has no usable meaning`);
  }
});

test('the known DUPLICATE is documented rather than silently tolerated', () => {
  // bucket.unevidenced and basis.unknown answer the same question at different granularity. They do
  // not collide on the discriminator because their scopes differ (run vs path), which is correct —
  // but a reader must be told, or they will wonder which is authoritative.
  assert.match(ATTRIBUTION_LEXICON['basis.unknown'].note, /DUPLICATE DISCRIMINATOR/);
  assert.match(ATTRIBUTION_LEXICON['bucket.unevidenced'].note, /SAME CONCEPT/);
});

test('access.read is declared as NEVER PRODUCED — the reserved-but-unreachable case', () => {
  assert.match(ATTRIBUTION_LEXICON['access.read'].note, /NEVER PRODUCED/,
    'the hook matches no read tool; declaring it stops a consumer inventing the category');
});
