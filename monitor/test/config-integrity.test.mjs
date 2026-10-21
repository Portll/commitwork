// node --test monitor/test/ — item 7. The two properties that make this lens worth having: a
// pinned config that VANISHES is a finding (the disabled-guard shape — deleting a hook
// registration must not be quiet), and a sidecar symlink REPLACED BY A REAL DIRECTORY reads
// CHANGED (the checkout-restored-over-the-link hazard, where every later durable write lands
// somewhere nobody reads).
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectConfigSurface, readBaseline, runLens, acceptBaseline, repin, readJournal } from '../config-integrity.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'cw-confint-')); dirs.push(d); return d; };

const env = (kv, fn) => async () => {
  const saved = {};
  for (const [k, v] of Object.entries(kv)) { saved[k] = process.env[k]; process.env[k] = v; }
  try { await fn(); } finally {
    for (const k of Object.keys(kv)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
};

function fakeSurface() {
  const dir = scratch();
  const settings = join(dir, 'settings.json');
  writeFileSync(settings, JSON.stringify({ hooks: { PostToolUse: [{ matcher: 'Edit|Write', command: 'node bin/touch-ledger.mjs' }] } }));
  const sidecar = join(dir, 'sidecar-store');
  mkdirSync(sidecar);
  const link = join(dir, 'store');
  symlinkSync('sidecar-store', link);
  const targets = [
    { path: settings, kind: 'config' },
    { path: join(dir, 'never-existed.json'), kind: 'config' },
    { path: link, kind: 'symlink' },
  ];
  return { dir, settings, link, targets };
}

describe('collection', () => {
  test('configs hash by content; symlinks record linkness + target; never-present paths are quiet', () => {
    const { targets, link } = fakeSurface();
    const r = collectConfigSurface({ targets });
    assert.deepEqual(r.unknowns, []);
    assert.equal(r.items.length, 2);
    const sym = r.items.find((i) => i.id === link);
    assert.equal(sym.value, 'link:sidecar-store');
  });

  test('deterministic — two observations are identical', () => {
    const { targets } = fakeSurface();
    assert.deepEqual(collectConfigSurface({ targets }), collectConfigSurface({ targets }));
  });
});

describe('the two load-bearing findings', () => {
  test('a pinned config that vanishes is REMOVED — deleting a hook registration is never quiet', async () => {
    const { dir, settings, targets } = fakeSurface();
    const tf = join(dir, 'targets.json');
    writeFileSync(tf, JSON.stringify(targets));
    const base = join(dir, 'confint.json');
    await env({ CW_CONFINT_BASELINE: base, CW_CONFINT_TARGETS: tf, CW_NOW: '2026-08-27T00:00:00.000Z' }, async () => {
      acceptBaseline();
      assert.equal(runLens().state, 'ok');
      unlinkSync(settings);
      const r = runLens();
      assert.equal(r.state, 'findings');
      assert.deepEqual(r.removed.map((i) => i.id), [settings]);
    })();
  });

  test('a sidecar link replaced by a real directory reads CHANGED — the orphaned-writes hazard', async () => {
    const { dir, link, targets } = fakeSurface();
    const tf = join(dir, 'targets.json');
    writeFileSync(tf, JSON.stringify(targets));
    const base = join(dir, 'confint.json');
    await env({ CW_CONFINT_BASELINE: base, CW_CONFINT_TARGETS: tf, CW_NOW: '2026-08-27T00:00:00.000Z' }, async () => {
      acceptBaseline();
      unlinkSync(link);
      mkdirSync(link);                       // a checkout restoring a tracked dir over the link
      const r = runLens();
      assert.equal(r.state, 'findings');
      assert.equal(r.changed.length, 1);
      assert.equal(r.changed[0].value, 'not-a-link:directory');
      assert.equal(r.changed[0].was.value, 'link:sidecar-store');
    })();
  });

  test('a repointed link reads CHANGED with both targets named', async () => {
    const { dir, link, targets } = fakeSurface();
    const tf = join(dir, 'targets.json');
    writeFileSync(tf, JSON.stringify(targets));
    mkdirSync(join(dir, 'elsewhere'));
    const base = join(dir, 'confint.json');
    await env({ CW_CONFINT_BASELINE: base, CW_CONFINT_TARGETS: tf, CW_NOW: '2026-08-27T00:00:00.000Z' }, async () => {
      acceptBaseline();
      unlinkSync(link);
      symlinkSync('elsewhere', link);
      const r = runLens();
      assert.equal(r.changed[0].value, 'link:elsewhere');
      assert.equal(r.changed[0].was.value, 'link:sidecar-store');
    })();
  });

  test('an edited hook config reads CHANGED', async () => {
    const { dir, settings, targets } = fakeSurface();
    const tf = join(dir, 'targets.json');
    writeFileSync(tf, JSON.stringify(targets));
    const base = join(dir, 'confint.json');
    await env({ CW_CONFINT_BASELINE: base, CW_CONFINT_TARGETS: tf, CW_NOW: '2026-08-27T00:00:00.000Z' }, async () => {
      acceptBaseline();
      writeFileSync(settings, JSON.stringify({ hooks: {} }));   // the hook registration quietly dropped
      const r = runLens();
      assert.equal(r.state, 'findings');
      assert.deepEqual(r.changed.map((i) => i.id), [settings]);
    })();
  });
});

describe('the journal', () => {
  test('a pin names who and why; the lens reads it back from the row the baseline references', async () => {
    const { dir, targets } = fakeSurface();
    const tf = join(dir, 'targets.json');
    writeFileSync(tf, JSON.stringify(targets));
    const base = join(dir, 'confint.json');
    await env({ CW_CONFINT_BASELINE: base, CW_CONFINT_TARGETS: tf, CW_NOW: '2026-09-15T00:00:00.000Z' }, async () => {
      const r = repin({ who: 'agent-surface:cw44', why: 'enable guard-destructive' });
      assert.equal(r.journal, join(dir, 'config-integrity-journal.jsonl'));
      const lens = runLens();
      assert.equal(lens.state, 'ok');
      assert.deepEqual(lens.journal, { state: 'journaled', who: 'agent-surface:cw44', why: 'enable guard-destructive', at: '2026-09-15T00:00:00.000Z' });
      assert.equal(readJournal().length, 1);
    })();
  });

  test('a baseline written without a journal row is a FINDING even when the surface is unchanged', async () => {
    const { dir, targets } = fakeSurface();
    const tf = join(dir, 'targets.json');
    writeFileSync(tf, JSON.stringify(targets));
    const base = join(dir, 'confint.json');
    await env({ CW_CONFINT_BASELINE: base, CW_CONFINT_TARGETS: tf, CW_NOW: '2026-09-15T00:00:00.000Z' }, async () => {
      repin({ who: 'x', why: 'first pin' });
      const doc = readBaseline();
      delete doc.journal;                                  // a hand-written or laundered pin
      writeFileSync(base, JSON.stringify(doc));
      const lens = runLens();
      assert.equal(lens.state, 'findings');
      assert.equal(lens.journal.state, 'unjournaled');
      assert.deepEqual(lens.changed, [], 'the surface itself did not move — only the pin is unsigned');
    })();
  });

  test('a baseline referencing a row the journal lacks is unjournaled', async () => {
    const { dir, targets } = fakeSurface();
    const tf = join(dir, 'targets.json');
    writeFileSync(tf, JSON.stringify(targets));
    const base = join(dir, 'confint.json');
    await env({ CW_CONFINT_BASELINE: base, CW_CONFINT_TARGETS: tf }, async () => {
      repin({ who: 'x', why: 'pin' });
      writeFileSync(join(dir, 'config-integrity-journal.jsonl'), '');   // the row removed after the fact
      assert.equal(runLens().journal.state, 'unjournaled');
    })();
  });

  test('a baseline that predates the journal is legacy, not a finding — and the next accept signs it', async () => {
    const { dir, targets } = fakeSurface();
    const tf = join(dir, 'targets.json');
    writeFileSync(tf, JSON.stringify(targets));
    const base = join(dir, 'confint.json');
    await env({ CW_CONFINT_BASELINE: base, CW_CONFINT_TARGETS: tf, USER: 'operator-x' }, async () => {
      writeFileSync(base, JSON.stringify({ at: '2026-08-01T00:00:00.000Z', items: collectConfigSurface().items }));
      const before = runLens();
      assert.equal(before.state, 'ok');
      assert.equal(before.journal.state, 'legacy');
      acceptBaseline();
      const after = runLens();
      assert.equal(after.journal.state, 'journaled');
      assert.equal(after.journal.who, 'operator-x');
      assert.equal(after.journal.why, '--accept');
    })();
  });

  test('a pin with no who or no why is refused and writes nothing', async () => {
    const { dir, targets } = fakeSurface();
    const tf = join(dir, 'targets.json');
    writeFileSync(tf, JSON.stringify(targets));
    const base = join(dir, 'confint.json');
    await env({ CW_CONFINT_BASELINE: base, CW_CONFINT_TARGETS: tf }, async () => {
      assert.throws(() => repin({ who: '', why: 'x' }), /who and why/);
      assert.throws(() => repin({ who: 'x' }), /who and why/);
      assert.equal(readBaseline(), null);
      assert.equal(readJournal(), null);
    })();
  });

  test('an unreadable journal THROWS; only ENOENT is "no journal yet"', async () => {
    const dir = scratch();
    await env({ CW_CONFINT_JOURNAL: join(dir, 'nope', 'j.jsonl') }, async () => { assert.equal(readJournal(), null); })();
    await env({ CW_CONFINT_JOURNAL: dir }, async () => { assert.throws(() => readJournal()); })();
  });
});

describe('discipline', () => {
  test('an unreadable baseline THROWS; only ENOENT is "no baseline yet"', async () => {
    const dir = scratch();
    const b = join(dir, 'confint.json');
    writeFileSync(b, '{corrupt');
    await env({ CW_CONFINT_BASELINE: b }, async () => { assert.throws(() => readBaseline()); })();
    await env({ CW_CONFINT_BASELINE: join(dir, 'absent.json') }, async () => { assert.equal(readBaseline(), null); })();
  });

  test('a fixture target list that is not an array fails closed', async () => {
    const dir = scratch();
    const tf = join(dir, 'targets.json');
    writeFileSync(tf, JSON.stringify({ nope: true }));
    await env({ CW_CONFINT_TARGETS: tf }, async () => { assert.throws(() => collectConfigSurface()); })();
  });
});
