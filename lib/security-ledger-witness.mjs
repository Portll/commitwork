// Compare a ledger's current head with an independent witness. A shared prefix never proves
// tampering and never witnesses the current head; it only orders the two heads.
import { types } from 'node:util';
import { isoInstant } from './iso-instant.mjs';

export const LEDGER_WITNESS_STATES = Object.freeze([
  'agreement',
  'prefix',
  'contradiction',
  'invalid-chain',
  'missing-witness',
  'non-independent',
]);

export const LEDGER_WITNESS_REASONS = Object.freeze([
  'head-and-sequence-match',
  'witness-head-is-prefix',
  'ledger-head-is-prefix',
  'same-sequence-different-head',
  'ledger-chain-invalid',
  'witness-not-supplied',
  'witness-not-independent',
]);

const SHA256 = /^[0-9a-f]{64}$/;
const WITNESSES_CURRENT_HEAD = Object.freeze({
  agreement: true,
  prefix: false,
  contradiction: false,
  'invalid-chain': null,
  'missing-witness': null,
  'non-independent': null,
});
const EXTENSION_REQUIRED = Object.freeze({
  agreement: false,
  prefix: null,
  contradiction: false,
  'invalid-chain': null,
  'missing-witness': null,
  'non-independent': null,
});

const isRecord = (v) => {
  if (v === null || typeof v !== 'object') return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

// Own enumerable data properties only: an inherited value or a getter is not evidence.
function readRecord(value, name, fields) {
  if (value === null || value === undefined) throw new TypeError(`${name} must be an object`);
  if (types.isProxy(value) || !isRecord(value)) throw new TypeError(`${name} must be an object`);
  const out = {};
  for (const key of fields) {
    let d;
    try { d = Object.getOwnPropertyDescriptor(value, key); } catch { throw new TypeError(`${name}.${key} must be a data property`); }
    if (d === undefined) throw new TypeError(`${name}.${key} is required`);
    if (!Object.hasOwn(d, 'value') || d.enumerable !== true) throw new TypeError(`${name}.${key} must be an enumerable data property`);
    out[key] = d.value;
  }
  return out;
}

function validateLedger(ledger) {
  const r = readRecord(ledger, 'ledger', ['headHash', 'sequence', 'chainValid']);
  if (typeof r.headHash !== 'string' || !SHA256.test(r.headHash)) throw new TypeError('ledger.headHash must be a 64-character lowercase sha256 hex digest');
  if (!Number.isInteger(r.sequence) || r.sequence < 0) throw new TypeError('ledger.sequence must be a non-negative integer');
  if (typeof r.chainValid !== 'boolean') throw new TypeError('ledger.chainValid must be a boolean');
  return { headHash: r.headHash, sequence: r.sequence, chainValid: r.chainValid };
}

function validateWitness(witness) {
  if (witness === null || witness === undefined) return null;
  const r = readRecord(witness, 'witness', ['headHash', 'sequence', 'independent', 'observedAt']);
  if (typeof r.headHash !== 'string' || !SHA256.test(r.headHash)) throw new TypeError('witness.headHash must be a 64-character lowercase sha256 hex digest');
  if (!Number.isInteger(r.sequence) || r.sequence < 0) throw new TypeError('witness.sequence must be a non-negative integer');
  if (typeof r.independent !== 'boolean') throw new TypeError('witness.independent must be a boolean');
  isoInstant(r.observedAt, 'witness.observedAt');
  return { headHash: r.headHash, sequence: r.sequence, independent: r.independent, observedAt: r.observedAt };
}

function result(state, reason, ledger, witness, extensionRequired = null) {
  return Object.freeze({
    state,
    reason,
    ledger: Object.freeze({ ...ledger }),
    witness: witness === null ? null : Object.freeze({ ...witness }),
    witnessesCurrentHead: WITNESSES_CURRENT_HEAD[state],
    extensionRequired: state === 'prefix' ? extensionRequired : EXTENSION_REQUIRED[state],
    tampering: null,
  });
}

export function compareWitness(input = {}) {
  if (input === null || typeof input !== 'object' || types.isProxy(input)) {
    throw new TypeError('input must be an object with ledger and witness');
  }
  const { ledger, witness } = input;
  const l = validateLedger(ledger);
  const w = validateWitness(witness);
  if (!l.chainValid) return result('invalid-chain', 'ledger-chain-invalid', l, w);
  if (w === null) return result('missing-witness', 'witness-not-supplied', l, null);
  if (!w.independent) return result('non-independent', 'witness-not-independent', l, w);
  if (l.sequence === w.sequence) {
    return l.headHash === w.headHash
      ? result('agreement', 'head-and-sequence-match', l, w)
      : result('contradiction', 'same-sequence-different-head', l, w);
  }
  // A prefix is a lower head, not a tampering finding: it cannot vouch for the current head.
  return l.sequence > w.sequence
    ? result('prefix', 'witness-head-is-prefix', l, w, true)
    : result('prefix', 'ledger-head-is-prefix', l, w, false);
}
