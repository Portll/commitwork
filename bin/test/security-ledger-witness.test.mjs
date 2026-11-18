// Behavioural tests for compareWitness: agreements, prefixes, contradictions, and every way the
// evidence can be absent or malformed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compareWitness,
  LEDGER_WITNESS_REASONS,
  LEDGER_WITNESS_STATES,
} from '../../lib/security-ledger-witness.mjs';

const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const OBSERVED = '2026-11-10T00:00:00Z';
const ledger = (over = {}) => ({ headHash: HASH_A, sequence: 3, chainValid: true, ...over });
const witness = (over = {}) => ({ headHash: HASH_A, sequence: 3, independent: true, observedAt: OBSERVED, ...over });
const verdict = (input) => {
  const r = compareWitness(input);
  return `${r.state}/${r.reason}`;
};
const deepFreeze = (value) => {
  for (const child of Object.values(value)) {
    if (child !== null && typeof child === 'object') deepFreeze(child);
  }
  return Object.freeze(value);
};

test('matching head and sequence is the one state that witnesses the current head', () => {
  const r = compareWitness({ ledger: ledger(), witness: witness() });
  assert.deepEqual(r, {
    state: 'agreement',
    reason: 'head-and-sequence-match',
    ledger: { headHash: HASH_A, sequence: 3, chainValid: true },
    witness: { headHash: HASH_A, sequence: 3, independent: true, observedAt: OBSERVED },
    witnessesCurrentHead: true,
    extensionRequired: false,
    tampering: null,
  });
});

test('sequence zero is a valid integer sequence', () => {
  const r = compareWitness({ ledger: ledger({ sequence: 0 }), witness: witness({ sequence: 0 }) });
  assert.equal(r.state, 'agreement');
  assert.equal(r.reason, 'head-and-sequence-match');
});

test('a valid ISO instant with an offset is accepted and preserved', () => {
  const observedAt = '2026-11-10T01:00:00+01:00';
  const r = compareWitness({ ledger: ledger(), witness: witness({ observedAt }) });
  assert.equal(r.state, 'agreement');
  assert.equal(r.witness.observedAt, observedAt);
});

test('a witness behind the ledger head is a prefix that needs extension evidence', () => {
  const r = compareWitness({ ledger: ledger({ sequence: 4, headHash: HASH_B }), witness: witness({ sequence: 3 }) });
  assert.equal(r.state, 'prefix');
  assert.equal(r.reason, 'witness-head-is-prefix');
  assert.equal(r.witnessesCurrentHead, false);
  assert.equal(r.extensionRequired, true);
  assert.equal(r.tampering, null);
});

test('a ledger behind the witness is a prefix, not a witnessed head and not tampering', () => {
  const r = compareWitness({ ledger: ledger({ sequence: 2, headHash: HASH_B }), witness: witness({ sequence: 3 }) });
  assert.equal(r.state, 'prefix');
  assert.equal(r.reason, 'ledger-head-is-prefix');
  assert.equal(r.witnessesCurrentHead, false);
  assert.equal(r.extensionRequired, false);
  assert.equal(r.tampering, null);
});

test('equal sequence with different heads is a contradiction', () => {
  const r = compareWitness({ ledger: ledger({ headHash: HASH_A }), witness: witness({ headHash: HASH_B }) });
  assert.equal(r.state, 'contradiction');
  assert.equal(r.reason, 'same-sequence-different-head');
  assert.equal(r.witnessesCurrentHead, false);
  assert.equal(r.extensionRequired, false);
  assert.equal(r.tampering, null);
  assert.equal(r.ledger.headHash, HASH_A);
  assert.equal(r.witness.headHash, HASH_B);
});

test('an invalid chain is reported before a missing or non-independent witness', () => {
  assert.equal(verdict({ ledger: ledger({ chainValid: false }), witness: witness() }), 'invalid-chain/ledger-chain-invalid');
  assert.equal(verdict({ ledger: ledger({ chainValid: false }) }), 'invalid-chain/ledger-chain-invalid');
  assert.equal(verdict({ ledger: ledger({ chainValid: false }), witness: witness({ independent: false }) }), 'invalid-chain/ledger-chain-invalid');
  const r = compareWitness({ ledger: ledger({ chainValid: false }), witness: witness() });
  assert.equal(r.witnessesCurrentHead, null);
  assert.equal(r.extensionRequired, null);
  assert.equal(r.tampering, null);
});

test('a witness that was not supplied is missing, whether null, undefined, or absent', () => {
  for (const input of [
    { ledger: ledger(), witness: null },
    { ledger: ledger(), witness: undefined },
    { ledger: ledger() },
  ]) {
    const r = compareWitness(input);
    assert.equal(r.state, 'missing-witness');
    assert.equal(r.reason, 'witness-not-supplied');
    assert.equal(r.witness, null);
    assert.equal(r.witnessesCurrentHead, null);
    assert.equal(r.extensionRequired, null);
    assert.equal(r.tampering, null);
  }
});

test('a non-independent witness is not evidence even when the head matches', () => {
  const r = compareWitness({ ledger: ledger(), witness: witness({ independent: false }) });
  assert.equal(r.state, 'non-independent');
  assert.equal(r.reason, 'witness-not-independent');
  assert.equal(r.witness.independent, false);
  assert.equal(r.witnessesCurrentHead, null);
  assert.equal(r.extensionRequired, null);
  assert.equal(r.tampering, null);
});

test('every exported state and reason is reachable', () => {
  const results = [
    compareWitness({ ledger: ledger(), witness: witness() }),
    compareWitness({ ledger: ledger(), witness: witness({ sequence: 2, headHash: HASH_B }) }),
    compareWitness({ ledger: ledger({ sequence: 2, headHash: HASH_B }), witness: witness() }),
    compareWitness({ ledger: ledger(), witness: witness({ headHash: HASH_B }) }),
    compareWitness({ ledger: ledger({ chainValid: false }), witness: witness() }),
    compareWitness({ ledger: ledger() }),
    compareWitness({ ledger: ledger(), witness: witness({ independent: false }) }),
  ];
  assert.deepEqual([...new Set(results.map((r) => r.state))].sort(), [...LEDGER_WITNESS_STATES].sort());
  assert.deepEqual([...new Set(results.map((r) => r.reason))].sort(), [...LEDGER_WITNESS_REASONS].sort());
});

test('the state and reason lists are frozen and contain no duplicates', () => {
  assert.equal(Object.isFrozen(LEDGER_WITNESS_STATES), true);
  assert.equal(Object.isFrozen(LEDGER_WITNESS_REASONS), true);
  assert.equal(new Set(LEDGER_WITNESS_STATES).size, LEDGER_WITNESS_STATES.length);
  assert.equal(new Set(LEDGER_WITNESS_REASONS).size, LEDGER_WITNESS_REASONS.length);
});

test('the result and its nested copies are frozen and do not alias the inputs', () => {
  const l = ledger();
  const w = witness();
  const r = compareWitness({ ledger: l, witness: w });
  assert.equal(Object.isFrozen(r), true);
  assert.equal(Object.isFrozen(r.ledger), true);
  assert.equal(Object.isFrozen(r.witness), true);
  l.headHash = HASH_B;
  w.headHash = HASH_B;
  assert.equal(r.ledger.headHash, HASH_A);
  assert.equal(r.witness.headHash, HASH_A);
});

test('deep-frozen inputs are read without mutation', () => {
  const input = deepFreeze({ ledger: ledger(), witness: witness() });
  const before = structuredClone(input);
  const r = compareWitness(input);
  assert.equal(r.state, 'agreement');
  assert.deepEqual(input, before);
});

test('the serialized result is byte-identical regardless of input field order', () => {
  const a = compareWitness({
    ledger: { headHash: HASH_A, sequence: 3, chainValid: true },
    witness: { headHash: HASH_A, sequence: 3, independent: true, observedAt: OBSERVED },
  });
  const b = compareWitness({
    witness: { observedAt: OBSERVED, independent: true, sequence: 3, headHash: HASH_A },
    ledger: { chainValid: true, sequence: 3, headHash: HASH_A },
  });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('unknown fields are ignored and not copied into the result', () => {
  const r = compareWitness({
    ledger: { headHash: HASH_A, sequence: 3, chainValid: true, extra: 'ignored' },
    witness: { headHash: HASH_A, sequence: 3, independent: true, observedAt: OBSERVED, extra: 'ignored' },
  });
  assert.deepEqual(Object.keys(r.ledger), ['headHash', 'sequence', 'chainValid']);
  assert.deepEqual(Object.keys(r.witness), ['headHash', 'sequence', 'independent', 'observedAt']);
});

test('alternative field names are not accepted', () => {
  assert.throws(() => compareWitness({ ledger: { head: HASH_A, sequence: 3, chainValid: true }, witness: witness() }), /ledger\.headHash is required/);
  assert.throws(() => compareWitness({ ledger: ledger(), witness: { hash: HASH_A, sequence: 3, independent: true, observedAt: OBSERVED } }), /witness\.headHash is required/);
});

test('a malformed ledger or witness field throws a TypeError naming that field', () => {
  const badLedgers = [
    [undefined, /ledger must be an object/],
    [null, /ledger must be an object/],
    [[], /ledger must be an object/],
    [new Map(), /ledger must be an object/],
    [Object.create({ headHash: HASH_A }), /ledger must be an object/],
    [new Proxy(ledger(), {}), /ledger must be an object/],
    [{ sequence: 3, chainValid: true }, /ledger\.headHash is required/],
    [ledger({ headHash: HASH_A.toUpperCase() }), /ledger\.headHash must be a 64-character lowercase sha256 hex digest/],
    [ledger({ headHash: HASH_A.slice(1) }), /ledger\.headHash must be a 64-character lowercase sha256 hex digest/],
    [ledger({ headHash: `sha256:${HASH_A}` }), /ledger\.headHash must be a 64-character lowercase sha256 hex digest/],
    [ledger({ headHash: 1 }), /ledger\.headHash must be a 64-character lowercase sha256 hex digest/],
    [{ headHash: HASH_A, chainValid: true }, /ledger\.sequence is required/],
    [ledger({ sequence: -1 }), /ledger\.sequence must be a non-negative integer/],
    [ledger({ sequence: 1.5 }), /ledger\.sequence must be a non-negative integer/],
    [ledger({ sequence: '3' }), /ledger\.sequence must be a non-negative integer/],
    [ledger({ sequence: NaN }), /ledger\.sequence must be a non-negative integer/],
    [{ headHash: HASH_A, sequence: 3 }, /ledger\.chainValid is required/],
    [ledger({ chainValid: 'true' }), /ledger\.chainValid must be a boolean/],
  ];
  for (const [bad, expected] of badLedgers) {
    assert.throws(() => compareWitness({ ledger: bad, witness: witness() }), expected);
  }

  const badWitnesses = [
    ['string', /witness must be an object/],
    [[], /witness must be an object/],
    [new Proxy(witness(), {}), /witness must be an object/],
    [{ sequence: 3, independent: true, observedAt: OBSERVED }, /witness\.headHash is required/],
    [witness({ headHash: HASH_B.toUpperCase() }), /witness\.headHash must be a 64-character lowercase sha256 hex digest/],
    [{ headHash: HASH_A, independent: true, observedAt: OBSERVED }, /witness\.sequence is required/],
    [witness({ sequence: -1 }), /witness\.sequence must be a non-negative integer/],
    [{ headHash: HASH_A, sequence: 3, observedAt: OBSERVED }, /witness\.independent is required/],
    [witness({ independent: 1 }), /witness\.independent must be a boolean/],
    [{ headHash: HASH_A, sequence: 3, independent: true }, /witness\.observedAt is required/],
    [witness({ observedAt: '2026-11-10T00:00:00' }), /witness\.observedAt must be an ISO-8601 instant with a zone/],
    [witness({ observedAt: '2026-02-30T00:00:00Z' }), /witness\.observedAt must be an ISO-8601 instant with a zone/],
    [witness({ observedAt: 0 }), /witness\.observedAt must be an ISO-8601 instant with a zone/],
  ];
  for (const [bad, expected] of badWitnesses) {
    assert.throws(() => compareWitness({ ledger: ledger(), witness: bad }), expected);
  }
});

test('inherited, non-enumerable, and getter fields are not evidence', () => {
  const inherited = Object.create({ headHash: HASH_A });
  Object.assign(inherited, { sequence: 3, chainValid: true });
  assert.throws(() => compareWitness({ ledger: inherited, witness: witness() }), /ledger must be an object/);

  const hidden = { sequence: 3, chainValid: true };
  Object.defineProperty(hidden, 'headHash', { value: HASH_A, enumerable: false });
  assert.throws(() => compareWitness({ ledger: hidden, witness: witness() }), /ledger\.headHash must be an enumerable data property/);

  const getter = { sequence: 3, chainValid: true };
  Object.defineProperty(getter, 'headHash', { get: () => HASH_A, enumerable: true });
  assert.throws(() => compareWitness({ ledger: getter, witness: witness() }), /ledger\.headHash must be an enumerable data property/);

  const witnessHidden = { sequence: 3, independent: true, observedAt: OBSERVED };
  Object.defineProperty(witnessHidden, 'headHash', { value: HASH_A, enumerable: false });
  assert.throws(() => compareWitness({ ledger: ledger(), witness: witnessHidden }), /witness\.headHash must be an enumerable data property/);
});

test('a missing top-level argument or a non-object top-level value is malformed', () => {
  assert.throws(() => compareWitness(), /ledger must be an object/);
  assert.throws(() => compareWitness(null), /input must be an object/);
  assert.throws(() => compareWitness('ledger'), /input must be an object/);
});
