// Cross-tool SAST corroboration over the fleet-flattened scannerFindings object (monitor/corroborate.mjs markSastPlaceCorroboration).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markSastPlaceCorroboration } from '../corroborate.mjs';

test('returns the input object unchanged when the feature is disabled', () => {
  const input = { sastSemgrep: [{ repo: 'r', file: 'f', rule: 'x' }] };
  const r = markSastPlaceCorroboration(input, { basisMap: { sastSemgrep: 'a', sastGo: 'b' } });
  assert.deepEqual(r, { sastSemgrep: [{ repo: "r", file: "f", rule: "x" }] });
});

test('returns the input object unchanged when it is null', () => {
  const r = markSastPlaceCorroboration(null, { basisMap: { sastSemgrep: 'a', sastGo: 'b' } });
  assert.deepEqual(r, null);
});

test('returns the input object unchanged when it is an empty object', () => {
  const r = markSastPlaceCorroboration({}, { basisMap: { sastSemgrep: 'a', sastGo: 'b' } });
  assert.deepEqual(r, {});
});

test('marks a row with a peer from a different tool on the same file', () => {
  const input = {
    sastSemgrep: [{ repo: 'r', file: 'f', rule: 'x' }],
    sastGo: [{ repo: 'r', file: 'f', rule: 'y' }],
  };
  const r = markSastPlaceCorroboration(input, { basisMap: { sastSemgrep: 'a', sastGo: 'b' } });
  assert.deepEqual(r, { sastSemgrep: [{ repo: "r", file: "f", rule: "x", corroboratedBy: "sastGo:y [same-basis]" }], sastGo: [{ repo: "r", file: "f", rule: "y", corroboratedBy: "sastSemgrep:x [same-basis]" }] });
});

test('does not mark a row when the only peer is from the same tool', () => {
  const input = {
    sastSemgrep: [
      { repo: 'r', file: 'f', rule: 'x' },
      { repo: 'r', file: 'f', rule: 'y' },
    ],
  };
  const r = markSastPlaceCorroboration(input, { basisMap: { sastSemgrep: 'a' } });
  assert.deepEqual(r, { sastSemgrep: [{ repo: "r", file: "f", rule: "x" }, { repo: "r", file: "f", rule: "y" }] });
});

test('marks a peer with a shared CWE and independent bases', () => {
  const input = {
    sastSemgrep: [{ repo: 'r', file: 'f', rule: 'x', cwe: '79' }],
    sastGo: [{ repo: 'r', file: 'f', rule: 'y', cwe: '79' }],
  };
  const r = markSastPlaceCorroboration(input, { basisMap: { sastSemgrep: 'a', sastGo: 'b' } });
  assert.deepEqual(r, { sastSemgrep: [{ repo: "r", file: "f", rule: "x", cwe: "79", corroboratedBy: "sastGo:y [cwe] [same-basis]" }], sastGo: [{ repo: "r", file: "f", rule: "y", cwe: "79", corroboratedBy: "sastSemgrep:x [cwe] [same-basis]" }] });
});

test('marks a peer with a shared CWE and the same basis', () => {
  const input = {
    sastSemgrep: [{ repo: 'r', file: 'f', rule: 'x', cwe: '79' }],
    sastGo: [{ repo: 'r', file: 'f', rule: 'y', cwe: '79' }],
  };
  const r = markSastPlaceCorroboration(input, { basisMap: { sastSemgrep: 'a', sastGo: 'a' } });
  assert.deepEqual(r, { sastSemgrep: [{ repo: "r", file: "f", rule: "x", cwe: "79", corroboratedBy: "sastGo:y [cwe] [same-basis]" }], sastGo: [{ repo: "r", file: "f", rule: "y", cwe: "79", corroboratedBy: "sastSemgrep:x [cwe] [same-basis]" }] });
});

test('marks a peer with no shared CWE and independent bases', () => {
  const input = {
    sastSemgrep: [{ repo: 'r', file: 'f', rule: 'x', cwe: '79' }],
    sastGo: [{ repo: 'r', file: 'f', rule: 'y', cwe: '89' }],
  };
  const r = markSastPlaceCorroboration(input, { basisMap: { sastSemgrep: 'a', sastGo: 'b' } });
  assert.deepEqual(r, { sastSemgrep: [{ repo: "r", file: "f", rule: "x", cwe: "79", corroboratedBy: "sastGo:y [same-basis]" }], sastGo: [{ repo: "r", file: "f", rule: "y", cwe: "89", corroboratedBy: "sastSemgrep:x [same-basis]" }] });
});

test('marks a peer with no shared CWE and the same basis', () => {
  const input = {
    sastSemgrep: [{ repo: 'r', file: 'f', rule: 'x', cwe: '79' }],
    sastGo: [{ repo: 'r', file: 'f', rule: 'y', cwe: '89' }],
  };
  const r = markSastPlaceCorroboration(input, { basisMap: { sastSemgrep: 'a', sastGo: 'a' } });
  assert.deepEqual(r, { sastSemgrep: [{ repo: "r", file: "f", rule: "x", cwe: "79", corroboratedBy: "sastGo:y [same-basis]" }], sastGo: [{ repo: "r", file: "f", rule: "y", cwe: "89", corroboratedBy: "sastSemgrep:x [same-basis]" }] });
});

test('marks a peer with no CWE on either row and independent bases', () => {
  const input = {
    sastSemgrep: [{ repo: 'r', file: 'f', rule: 'x' }],
    sastGo: [{ repo: 'r', file: 'f', rule: 'y' }],
  };
  const r = markSastPlaceCorroboration(input, { basisMap: { sastSemgrep: 'a', sastGo: 'b' } });
  assert.deepEqual(r, { sastSemgrep: [{ repo: "r", file: "f", rule: "x", corroboratedBy: "sastGo:y [same-basis]" }], sastGo: [{ repo: "r", file: "f", rule: "y", corroboratedBy: "sastSemgrep:x [same-basis]" }] });
});
