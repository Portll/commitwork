// Merges a mitigation overlay file's products and class entries into a taxonomy register document (bin/taxonomy-render.mjs mergeMitigationOverlay).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeMitigationOverlay } from '../taxonomy-render.mjs';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'mergeMitigationOverlay-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function overlayAt(dir, value) {
  const p = join(dir, 'overlay.json');
  writeFileSync(p, typeof value === 'string' ? value : JSON.stringify(value));
  return p;
}

test('returns the same document untouched when the overlay file does not exist', () => {
  withDir((dir) => {
    const doc = { mitigationVocabulary: { products: {} }, classes: [] };
    const r = mergeMitigationOverlay(doc, { path: join(dir, 'missing.json') });
    assert.equal(r, doc);
    assert.deepEqual(r, { mitigationVocabulary: { products: {} }, classes: [] });
  });
});

test('throws naming the error code when the overlay path is a directory', () => {
  withDir((dir) => {
    const doc = { mitigationVocabulary: { products: {} }, classes: [] };
    assert.throws(() => mergeMitigationOverlay(doc, { path: dir }), {
      name: 'Error',
      message: `taxonomy mitigations overlay at ${dir} could not be read (EISDIR) \u2014 refusing to render a register that is missing layers it may carry`,
    });
  });
});

test('throws with the parser message when the overlay file is not valid JSON', () => {
  withDir((dir) => {
    const p = overlayAt(dir, 'not json');
    let parseMsg = '';
    try { JSON.parse('not json'); } catch (e) { parseMsg = e.message; }
    const doc = { mitigationVocabulary: { products: {} }, classes: [] };
    assert.throws(() => mergeMitigationOverlay(doc, { path: p }), {
      name: 'Error',
      message: `taxonomy mitigations overlay at ${p} is not valid JSON: ${parseMsg}`,
    });
  });
});

test('throws when the register has no mitigationVocabulary at all', () => {
  withDir((dir) => {
    const p = overlayAt(dir, {});
    assert.throws(() => mergeMitigationOverlay({ classes: [] }, { path: p }), {
      name: 'Error',
      message: `taxonomy mitigations overlay at ${p} has nothing to merge into: the register declares no mitigationVocabulary.products`,
    });
  });
});

test('throws when the register vocabulary products is an array rather than an object', () => {
  withDir((dir) => {
    const p = overlayAt(dir, {});
    const doc = { mitigationVocabulary: { products: [] }, classes: [] };
    assert.throws(() => mergeMitigationOverlay(doc, { path: p }), {
      name: 'Error',
      message: `taxonomy mitigations overlay at ${p} has nothing to merge into: the register declares no mitigationVocabulary.products`,
    });
  });
});

test('an empty overlay leaves a valid register unchanged', () => {
  withDir((dir) => {
    const p = overlayAt(dir, {});
    const doc = { mitigationVocabulary: { products: { a: { desc: 'a' } } }, classes: [{ id: 'c1' }] };
    const r = mergeMitigationOverlay(doc, { path: p });
    assert.equal(r, doc);
    assert.deepEqual(r, { mitigationVocabulary: { products: { a: { desc: 'a' } } }, classes: [{ id: 'c1' }] });
  });
});

test('adds new overlay products but keeps the register definition for a shared key', () => {
  withDir((dir) => {
    const p = overlayAt(dir, { products: { existing: { desc: 'overlay' }, newProd: { desc: 'd' } } });
    const doc = { mitigationVocabulary: { products: { existing: { desc: 'register' } } }, classes: [] };
    const r = mergeMitigationOverlay(doc, { path: p });
    assert.deepEqual(r, {
      mitigationVocabulary: { products: { existing: { desc: 'register' }, newProd: { desc: 'd' } } },
      classes: [],
    });
  });
});

test('throws when the overlay carries entries for a class the register does not declare', () => {
  withDir((dir) => {
    const p = overlayAt(dir, { entries: { ghost: [{ product: 'p', what: 'w' }] } });
    const doc = { mitigationVocabulary: { products: {} }, classes: [{ id: 'real' }] };
    assert.throws(() => mergeMitigationOverlay(doc, { path: p }), {
      name: 'Error',
      message: `taxonomy mitigations overlay at ${p} carries entries for class ghost, which the register does not declare`,
    });
  });
});

test('creates the mitigations list on a class that has none and appends the overlay entries', () => {
  withDir((dir) => {
    const p = overlayAt(dir, { entries: { c1: [{ product: 'p1', what: 'w1' }, { product: 'p2', what: 'w2' }] } });
    const doc = { mitigationVocabulary: { products: {} }, classes: [{ id: 'c1' }, { id: 'c2' }] };
    const r = mergeMitigationOverlay(doc, { path: p });
    assert.deepEqual(r, {
      mitigationVocabulary: { products: {} },
      classes: [
        { id: 'c1', mitigations: [{ product: 'p1', what: 'w1' }, { product: 'p2', what: 'w2' }] },
        { id: 'c2' },
      ],
    });
  });
});

test('skips overlay entries matching an existing product and what, appending only the new ones', () => {
  withDir((dir) => {
    const p = overlayAt(dir, { entries: { c1: [{ product: 'p1', what: 'w1' }, { product: 'p1', what: 'w2' }] } });
    const doc = {
      mitigationVocabulary: { products: {} },
      classes: [{ id: 'c1', mitigations: [{ product: 'p1', what: 'w1', note: 'kept' }] }],
    };
    const r = mergeMitigationOverlay(doc, { path: p });
    assert.deepEqual(r, {
      mitigationVocabulary: { products: {} },
      classes: [{ id: 'c1', mitigations: [{ product: 'p1', what: 'w1', note: 'kept' }, { product: 'p1', what: 'w2' }] }],
    });
  });
});
