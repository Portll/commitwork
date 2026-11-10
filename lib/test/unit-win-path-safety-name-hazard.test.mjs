// Detects Windows filename hazards (lib/win-path-safety.mjs nameHazard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { nameHazard } from '../win-path-safety.mjs';

test('returns empty hazard for empty string', () => {
  assert.deepEqual(nameHazard(''), { hazard: "empty", why: "an empty filename", silent: false });
});

test('returns separator hazard for forward slash', () => {
  assert.deepEqual(nameHazard('a/b'), { hazard: "separator", why: "contains a path separator \u2014 this checks ONE segment, not a path", silent: false });
});

test('returns separator hazard for backslash', () => {
  assert.deepEqual(nameHazard('a\\b'), { hazard: "separator", why: "contains a path separator \u2014 this checks ONE segment, not a path", silent: false });
});

test('returns ads hazard for colon', () => {
  assert.deepEqual(nameHazard('file:stream'), { hazard: "ads", why: "contains \":\" \u2014 on NTFS this writes an ALTERNATE DATA STREAM. Measured: the write succeeds, the same path reads the data back, but readdir does not list it and the base file stats as 0 bytes. Invisible to every enumeration, size check and archive.", silent: true });
});

test('returns illegal hazard for pipe character', () => {
  assert.deepEqual(nameHazard('a|b'), { hazard: "illegal", why: "contains \"|\", which Windows rejects \u2014 and measured, it fails with ENOENT, the one code this codebase reads as \"legitimately absent\". A write that could not happen becomes a lane with nothing to report.", silent: false, enoent: true });
});

test('returns control hazard for control character', () => {
  assert.deepEqual(nameHazard('a\x01b'), { hazard: "control", why: "contains a control character, which Windows rejects (also as ENOENT)", silent: false, enoent: true });
});

test('returns reserved hazard for CON', () => {
  assert.deepEqual(nameHazard('CON'), { hazard: "reserved", why: "\"CON\" is a reserved Win32 device name. Measured: node reads and writes it correctly (it uses \\\\?\\ paths), so this is an INTEROP concern \u2014 cmd.exe, Explorer and archive tools may not be able to open it \u2014 not silent data loss.", silent: false, interopOnly: true });
});

test('returns trailing hazard for trailing dot', () => {
  assert.deepEqual(nameHazard('file.'), { hazard: "trailing", why: "ends with a dot or space. Measured: node keeps such names distinct and reads them back correctly, so this is an INTEROP concern for non-node readers, not a collision.", silent: false, interopOnly: true });
});

test('returns null for valid filename', () => {
  assert.equal(nameHazard('valid.txt'), null);
});
