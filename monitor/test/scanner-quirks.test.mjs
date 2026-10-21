import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadQuirks, classifyNotification, summariseNotifications, resetQuirkCache, enabled } from '../scanner-quirks.mjs';

afterEach(() => { delete process.env.CW_SCANNER_QUIRKS; delete process.env.CW_SCANNER_QUIRKS_OFF; resetQuirkCache(); });

const CRASH = { descriptor: { id: 'Internal matching error' }, message: { text: 'Internal matching error when running javascript.crypto-js.cryptojs-weak-algorithm.cryptojs-weak-algorithm on x.js: An error occurred while invoking the Semgrep engine. Please help us fix this' } };
const TIMEOUT = { descriptor: { id: 'Timeout' }, message: { text: 'Timeout when running cpp.lang.security.strings.narrow-to-wide.narrow-to-wide on a.cpp' } };
const SYNTAX = { descriptor: { id: 'Syntax error' }, message: { text: 'Syntax error at line b.js:1' } };

describe('scanner-quirks — a crashed rule is a coverage bound, not a clean result', () => {
  test('the shipped registry parses and every quirk declares what it matches and what it costs', () => {
    const d = loadQuirks();
    assert.equal(d.state, 'present');
    assert.ok(d.quirks.length >= 3);
    for (const q of d.quirks) {
      assert.ok(q.id && q.tool && q.status, `${q.id}: id, tool and status are required`);
      assert.ok(q.match && (q.match.notificationId || q.match.notificationIdAnyOf), `${q.id}: no match rule`);
      assert.ok(q.impact && q.impact.length > 20, `${q.id}: must say what the bound COSTS, or it is a label`);
      assert.ok(q.measured && q.measured.on, `${q.id}: a quirk with no measurement is an assertion`);
    }
  });

  test('a quirk with a rule list matches only those rules — a NEW rule crashing stays unexplained', () => {
    assert.equal(classifyNotification(CRASH), 'semgrep-oss-internal-matching-error');
    const novel = { descriptor: { id: 'Internal matching error' }, message: { text: 'Internal matching error when running javascript.brand.new.rule on x.js: An error occurred while invoking the Semgrep engine' } };
    assert.equal(classifyNotification(novel), null,
      'a rule not on the list was absorbed into the known count, which is how a widening defect goes invisible');
  });

  test('the three parse states are ONE coverage class, not three findings', () => {
    for (const id of ['Syntax error', 'Other syntax error', 'Lexical error']) {
      assert.equal(classifyNotification({ descriptor: { id }, message: { text: `${id} at x` } }), 'semgrep-parse-failure');
    }
  });

  test('timeouts classify in both engines — it is a property of the rules, not of one engine', () => {
    assert.equal(classifyNotification(TIMEOUT), 'semgrep-rule-timeout');
  });

  test('the summary separates known from unexplained and NEVER folds one into the other', () => {
    const s = summariseNotifications([CRASH, CRASH, TIMEOUT, SYNTAX, { descriptor: { id: 'Something new' }, message: { text: 'nobody has seen this' } }]);
    assert.equal(s.total, 5);
    assert.equal(s.knownTotal, 4);
    assert.equal(s.unexplained, 1, 'an unrecognised notification must stay unexplained — that is the interesting state');
    assert.equal(s.known['semgrep-oss-internal-matching-error'], 2);
  });

  test('the note states the bound as a bound, not as a scan result', () => {
    const s = summariseNotifications([CRASH]);
    assert.match(s.note, /did not run|coverage bound/i);
  });

  test('no notifications produces a silent summary rather than a claim', () => {
    const s = summariseNotifications([]);
    assert.equal(s.total, 0);
    assert.equal(s.note, '');
  });

  test('an ABSENT registry classifies nothing and says so — it never guesses a quirk', () => {
    process.env.CW_SCANNER_QUIRKS = '/nonexistent/quirks.json';
    resetQuirkCache();
    const d = loadQuirks();
    assert.equal(d.state, 'absent');
    const s = summariseNotifications([CRASH], { doc: d });
    assert.equal(s.unexplained, 1, 'with no registry every error must read as unexplained, never as known');
  });

  test('an UNREADABLE registry is unreadable, not empty — the safe direction', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cw-quirk-'));
    const p = join(dir, 'q.json');
    writeFileSync(p, '{ not json');
    process.env.CW_SCANNER_QUIRKS = p;
    resetQuirkCache();
    assert.equal(loadQuirks().state, 'unreadable');
  });

  test('CW_SCANNER_QUIRKS_OFF=1 classifies nothing, read at CALL time', () => {
    assert.equal(classifyNotification(CRASH), 'semgrep-oss-internal-matching-error');
    process.env.CW_SCANNER_QUIRKS_OFF = '1';
    assert.equal(enabled(), false);
    assert.equal(classifyNotification(CRASH), null,
      'the override was captured at module load, so every test that sets it afterwards proves nothing');
  });

  test('a malformed notification classifies as unexplained rather than throwing', () => {
    for (const bad of [null, undefined, {}, { message: null }, 'string', 0]) {
      assert.doesNotThrow(() => classifyNotification(bad));
    }
  });
});
