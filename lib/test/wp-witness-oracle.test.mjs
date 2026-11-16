// lib/test/wp-witness-oracle.test.mjs — the oracle's classification over synthetic snapshots.
//
// No Playground here on purpose: the DB/file-diff classifier is the part that decides confirmed vs
// exercised-no-effect vs not-exercised, and it must be provable on hand-written before/after pairs.
// The live harness is exercised separately and skips when the runtime is absent.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  diffMaps, diffSnapshots, isEmptyDelta, privilegedChanges, classify, findingKey, VERDICT, subtractControl, snapshotUsable,
} from '../wp-witness-oracle.mjs';

describe('diffMaps', () => {
  test('reports added / removed / changed and nothing else', () => {
    const d = diffMaps({ a: '1', b: '2', c: '3' }, { a: '1', b: 'X', e: '5' });
    assert.deepEqual(d.added, { e: '5' });
    assert.deepEqual(d.removed, { c: '3' });
    assert.deepEqual(d.changed, { b: { from: '2', to: 'X' } });
  });

  test('the ambient control set is subtracted from every bucket', () => {
    const d = diffMaps({ keep: '1' }, { keep: '2', churn: 'x' }, { ignore: new Set(['churn']) });
    assert.deepEqual(d.added, {});
    assert.deepEqual(d.changed, { keep: { from: '1', to: '2' } });
  });

  test('a pattern-volatile key is dropped', () => {
    const d = diffMaps({}, { _transient_timeout_foo: '1', real: 'v' }, { volatile: (k) => k.startsWith('_transient_') });
    assert.deepEqual(d.added, { real: 'v' });
  });
});

describe('diffSnapshots core-volatile filtering', () => {
  test('a core transient option write is not a delta, a plugin option write is', () => {
    const before = { options: { existing: '1' } };
    const after = { options: { existing: '1', _transient_doing_cron: '171', fx_setting: 'pwned' } };
    const delta = diffSnapshots(before, after);
    assert.deepEqual(delta.options.added, { fx_setting: 'pwned' });
  });

  test('a login-churned usermeta key (session_tokens) is ignored', () => {
    const before = { usermeta: {} };
    const after = { usermeta: { '2\tsession_tokens': 'abc', '2\twishlist': 'x' } };
    const delta = diffSnapshots(before, after);
    assert.ok(!('2\tsession_tokens' in delta.usermeta.added));
    assert.deepEqual(delta.usermeta.added, { '2\twishlist': 'x' });
  });
});

describe('authority model', () => {
  const optWrite = { options: { added: { fx_setting: 'v' }, removed: {}, changed: {} } };

  test('anonymous: any persisted change is privileged', () => {
    const delta = diffSnapshots({ options: {} }, { options: { fx_setting: 'v' } });
    assert.deepEqual(privilegedChanges(delta, { role: 'anonymous' }), ['options.added:fx_setting']);
  });

  test('subscriber: an option write is privileged (admin-level state)', () => {
    const delta = diffSnapshots({ options: {} }, { options: { fx_setting: 'v' } });
    assert.deepEqual(privilegedChanges(delta, { role: 'subscriber', selfUid: 2 }), ['options.added:fx_setting']);
  });

  test("subscriber: editing its OWN usermeta is NOT privileged, another user's IS", () => {
    const delta = diffSnapshots(
      { usermeta: {} },
      { usermeta: { '2\tpref': 'mine', '1\tadmin_flag': 'theirs' } },
    );
    assert.deepEqual(privilegedChanges(delta, { role: 'subscriber', selfUid: 2 }), ['usermeta.added:1\tadmin_flag']);
  });
});

describe('classify', () => {
  test('a request never issued is not-exercised', () => {
    const r = classify({ role: 'anonymous', requestIssued: false, delta: diffSnapshots({}, {}) });
    assert.equal(r.verdict, VERDICT.NOT_EXERCISED);
  });

  test('an anonymous option write is confirmed, with the changed place as evidence', () => {
    const delta = diffSnapshots({ options: {} }, { options: { fx_setting: 'cwprobe1' } });
    const r = classify({ role: 'anonymous', requestIssued: true, delta });
    assert.equal(r.verdict, VERDICT.CONFIRMED);
    assert.deepEqual(r.privileged, ['options.added:fx_setting']);
  });

  test('a request that changed nothing is exercised-no-effect, never a pass', () => {
    const r = classify({ role: 'anonymous', requestIssued: true, delta: diffSnapshots({ options: { a: '1' } }, { options: { a: '1' } }) });
    assert.equal(r.verdict, VERDICT.NO_EFFECT);
    assert.ok(isEmptyDelta(diffSnapshots({ options: { a: '1' } }, { options: { a: '1' } })));
  });

  test('FP shape — a read-only endpoint that only churns core transients does not confirm', () => {
    const before = { options: { opt: '1' } };
    const after = { options: { opt: '1', _site_transient_update_plugins: 'x', cron: 'y' } };
    const r = classify({ role: 'anonymous', requestIssued: true, delta: diffSnapshots(before, after) });
    assert.equal(r.verdict, VERDICT.NO_EFFECT);
  });

  test('FP shape — a nonce-gated write a subscriber could not pass changes nothing', () => {
    // the plugin rejected the request, so state is identical before/after
    const snap = { options: { gated: 'orig' } };
    const r = classify({ role: 'subscriber', selfUid: 2, requestIssued: true, delta: diffSnapshots(snap, snap) });
    assert.equal(r.verdict, VERDICT.NO_EFFECT);
  });
});

describe('differential control', () => {
  test('a key that also moves for a request to a nonexistent selector is churn, not a finding', () => {
    const trial = diffSnapshots({ options: { flag: '1' } }, { options: { real: 'cwprobe1' } });
    const control = diffSnapshots({ options: { flag: '1' } }, { options: {} });
    const r = classify({ role: 'anonymous', requestIssued: true, delta: subtractControl(trial, control) });
    assert.equal(r.verdict, VERDICT.CONFIRMED);
    assert.deepEqual(r.privileged, ['options.added:real']);
  });

  test('a trial whose whole delta the control reproduces is exercised-no-effect', () => {
    const d = diffSnapshots({ options: {} }, { options: { bookkeeping: '1' } });
    const r = classify({ role: 'anonymous', requestIssued: true, delta: subtractControl(d, d) });
    assert.equal(r.verdict, VERDICT.NO_EFFECT);
  });

  test('core updater lock options are core-volatile', () => {
    const d = diffSnapshots({ options: {} }, { options: { 'auto_updater.lock': '1', 'core_updater.lock': '2', recovery_keys: 'a:0:{}' } });
    assert.ok(isEmptyDelta(d));
  });
});

describe('attribution and measurement', () => {
  test('a privileged change WITHOUT our input is unattributed-change, not a finding and not a pass', () => {
    const delta = diffSnapshots({ options: { plugin_ready: '1' } }, { options: {} });
    const r = classify({ role: 'anonymous', requestIssued: true, delta });
    assert.equal(r.verdict, VERDICT.UNATTRIBUTED);
    assert.deepEqual(r.privileged, []);
    assert.deepEqual(r.unattributed, ['options.removed:plugin_ready']);
  });

  test('a request-chosen option NAME carrying the sentinel is attributable', () => {
    const delta = diffSnapshots({ options: {} }, { options: { cwprobe_key: 'x' } });
    assert.equal(classify({ role: 'subscriber', selfUid: 2, requestIssued: true, delta }).verdict, VERDICT.CONFIRMED);
  });

  test('a plugin-table UPDATE (row out, row in) carrying our input confirms', () => {
    const before = { tables: { 'wp_x_settings\tH1': 'h1\x01{"id":"1","color":"#fff"}' } };
    const after = { tables: { 'wp_x_settings\tH2': 'h2\x01cwprobe-in-value {"id":"1","color":"cwprobe1"}' } };
    const r = classify({ role: 'anonymous', requestIssued: true, delta: diffSnapshots(before, after) });
    assert.equal(r.verdict, VERDICT.CONFIRMED);
    assert.deepEqual(r.privileged, ['tables.added:wp_x_settings\tH2']);
    assert.deepEqual(r.unattributed, ['tables.removed:wp_x_settings\tH1']);
  });

  test('a failed snapshot is not-measured — never read as everything deleted', () => {
    assert.equal(snapshotUsable({ _raw: '', _status: 500 }), false);
    assert.equal(snapshotUsable({ options: {} }), false);
    assert.equal(snapshotUsable({ options: { siteurl: 'x' } }), true);
    const r = classify({ role: 'anonymous', requestIssued: true, measured: false, delta: diffSnapshots({}, {}) });
    assert.equal(r.verdict, VERDICT.NOT_MEASURED);
  });
});

describe('findingKey', () => {
  test('is keyed on place and caller and excludes any line number', () => {
    const k = findingKey({ plugin: 'fx', entryKind: 'ajax', selector: 'wp_ajax_nopriv_fx_save', role: 'anonymous', line: 16 });
    assert.equal(k, 'fx|ajax|wp_ajax_nopriv_fx_save|anonymous');
    assert.ok(!/16/.test(k));
    // same finding, moved lines, same key
    assert.equal(k, findingKey({ plugin: 'fx', entryKind: 'ajax', selector: 'wp_ajax_nopriv_fx_save', role: 'anonymous', line: 999 }));
  });
});
