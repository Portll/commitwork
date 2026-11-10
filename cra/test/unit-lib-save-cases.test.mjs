// writes the case document as indented JSON only while its lock is held (cra/lib.mjs saveCases).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveCases } from '../lib.mjs';
import { updateCases } from '../lib.mjs';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const refusal = (t) => `refusing to save the CRA case log at ${t} without its lock \u2014 go through updateCases(). `
  + 'The write is atomic, which prevents a torn file and not a lost one: a concurrent writer\'s '
  + 'document replaces yours, and verify() certifies the survivor because the events you appended '
  + 'were never in the file it hashes.';

function withDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'saveCases-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Saving without holding the lock throws and writes nothing', () => {
  withDir((dir) => {
    const target = join(dir, 'cases.json');
    assert.throws(() => saveCases({ cases: target }, { events: [], cases: {} }), {
      name: 'Error',
      message: refusal(target),
    });
    assert.equal(existsSync(target), false);
  });
});

test('Saving inside the lock writes the given document as indented JSON with a trailing newline', () => {
  withDir((dir) => {
    const target = join(dir, 'cases.json');
    const doc = { events: [], cases: {}, n: Array.from({ length: 3 }, (_, i) => i) };
    const r = updateCases({ cases: target }, () => {
      saveCases({ cases: target }, doc);
      return { save: false };
    });
    assert.equal(r.ok, true);
    assert.equal(r.saved, false);
    assert.deepEqual(r.result, { save: false });
    assert.deepEqual(r.deferred, []);
    assert.equal(readFileSync(target, 'utf8'), `${JSON.stringify(doc, null, 2)}\n`);
    assert.deepEqual(JSON.parse(readFileSync(target, 'utf8')), doc);
  });
});

test('A non-normalized path that resolves to the held target is accepted and written', () => {
  withDir((dir) => {
    const target = join(dir, 'cases.json');
    const doc = { events: [], cases: {}, tag: 'y'.repeat(5) };
    updateCases({ cases: target }, () => {
      saveCases({ cases: `${dir}/sub/../cases.json` }, doc);
      return { save: false };
    });
    assert.equal(readFileSync(target, 'utf8'), `${JSON.stringify(doc, null, 2)}\n`);
  });
});

test('Holding the lock for one case log does not permit saving a different one', () => {
  withDir((dir) => {
    const target = join(dir, 'cases.json');
    const other = join(dir, 'other.json');
    updateCases({ cases: target }, () => {
      assert.throws(() => saveCases({ cases: other }, { events: [], cases: {} }), {
        name: 'Error',
        message: refusal(other),
      });
      return { save: false };
    });
    assert.equal(existsSync(other), false);
    assert.equal(existsSync(target), false);
  });
});

test('After updateCases returns the lock is released and saving throws again', () => {
  withDir((dir) => {
    const target = join(dir, 'cases.json');
    const r = updateCases({ cases: target }, () => false);
    assert.equal(r.ok, true);
    assert.equal(r.saved, false);
    assert.equal(r.result, false);
    assert.deepEqual(r.deferred, []);
    assert.throws(() => saveCases({ cases: target }, { events: [], cases: {} }), {
      name: 'Error',
      message: refusal(target),
    });
    assert.equal(existsSync(target), false);
  });
});

test('A mutation that asks to save is persisted through saveCases', () => {
  withDir((dir) => {
    const target = join(dir, 'cases.json');
    const r = updateCases({ cases: target }, (doc) => {
      doc.note = 'x';
      return { save: true, result: 7 };
    });
    const { waitedMs, ...rest } = r;
    const expectedDoc = { note: 'x', events: [], cases: {} };
    assert.deepEqual(rest, { ok: true, doc: expectedDoc, saved: true, result: 7, deferred: [] });
    assert.equal(readFileSync(target, 'utf8'), `${JSON.stringify(expectedDoc, null, 2)}\n`);
  });
});
