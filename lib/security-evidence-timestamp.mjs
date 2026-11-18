// lib/security-evidence-timestamp.mjs — is a digest's time only this machine's clock, or backed by a
// receipt an external verifier accepted? This never checks a signature: a receipt or authority is not proof.

import { isoInstant } from './iso-instant.mjs';

export const TIMESTAMP_EVIDENCE_STATES = Object.freeze(['local-only', 'verified', 'invalid', 'unmeasured']);

export const TIMESTAMP_EVIDENCE_REASONS = Object.freeze([
  'no-receipt',
  'receipt-verified',
  'digest-mismatch',
  'verification-failed',
  'verification-missing',
]);

const SHA256_DIGEST = /^sha256:[0-9a-f]{64}$/;

function sha256Digest(value, name) {
  if (typeof value !== 'string' || !SHA256_DIGEST.test(value)) {
    throw new TypeError(`${name} must be a sha256:<64 lowercase hex> digest`);
  }
  return value;
}

function text(value, name) {
  if (typeof value !== 'string' || value === '') throw new TypeError(`${name} must be a non-empty string`);
  return value;
}

function readReceipt(receipt) {
  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) {
    throw new TypeError('receipt must be an object');
  }
  const digest = sha256Digest(receipt.digest, 'receipt.digest');
  const timestamp = receipt.timestamp;
  isoInstant(timestamp, 'receipt.timestamp');
  return { digest, timestamp, authority: text(receipt.authority, 'receipt.authority') };
}

const evidence = (state, reason, fields) => ({ state, reason, ...fields });

export function timestampEvidence({ digest, localTime, receipt = null, verified = null } = {}) {
  const digestValue = sha256Digest(digest, 'digest');
  isoInstant(localTime, 'localTime');
  if (verified !== null && typeof verified !== 'boolean') throw new TypeError('verified must be a boolean or null');

  if (receipt === null) {
    // A verification result with no receipt verifies nothing, so it is not echoed as evidence.
    return evidence('local-only', 'no-receipt', {
      digest: digestValue, localTime, timestamp: null, authority: null, verified: null,
    });
  }

  const r = readReceipt(receipt);
  const fields = { digest: digestValue, localTime, timestamp: r.timestamp, authority: r.authority, verified };
  if (r.digest !== digestValue) return evidence('invalid', 'digest-mismatch', fields);
  if (verified === false) return evidence('invalid', 'verification-failed', fields);
  if (verified === null) return evidence('unmeasured', 'verification-missing', fields);
  return evidence('verified', 'receipt-verified', fields);
}
