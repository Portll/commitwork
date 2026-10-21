// lib/win-path-safety.mjs — the Windows filename hazards, and the two that actually reproduce.
//
// The EFFECT tests at the bottom are the reason this file is trustworthy: they exercise the real
// filesystem, and they are what corrected the module. Three of the four hazards in the received
// wisdom (reserved device names, trailing dots, MAX_PATH) did NOT reproduce through node's fs on
// Windows 11, because node passes \\?\-prefixed paths. Asserting them anyway would have been the
// over-reporting this repo treats as more expensive than a miss.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  nameHazard, classifyFsError, pathHazard, MAX_PATH,
} from '../win-path-safety.mjs';

const BS = String.fromCharCode(92);
const NUL = String.fromCharCode(0);

describe('hazard classification', () => {
  test('POSITIVE — ":" is the SILENT one, and is marked as such', () => {
    const h = nameHazard('report:evil.json');
    assert.equal(h.hazard, 'ads');
    assert.equal(h.silent, true, 'silent means: succeeds, and the data becomes invisible');
    assert.match(h.why, /ALTERNATE DATA STREAM/);
    // The realistic carriers, not contrived ones.
    assert.equal(nameHazard('group:artifact:1.2.3').hazard, 'ads', 'a Maven coordinate');
    assert.equal(nameHazard('2026-09-04T12:00:00Z.json').hazard, 'ads', 'an ISO timestamp');
  });

  test('POSITIVE — the illegal characters are flagged as arriving via ENOENT', () => {
    for (const ch of ['<', '>', '"', '|', '?', '*']) {
      const h = nameHazard(`rule${ch}id.json`);
      assert.equal(h.hazard, 'illegal', `${ch} must be flagged`);
      assert.equal(h.enoent, true,
        'this is the whole point: the failure arrives as ENOENT, which this codebase reads as absent');
      assert.equal(h.silent, false, 'it does fail loudly — just wearing the wrong code');
    }
    const ctl = nameHazard(`a${NUL}b`);
    assert.equal(ctl.hazard, 'control');
    assert.equal(ctl.enoent, true);
  });

  test('MEASURED-NOT-REPRODUCED cases are marked interop-only, never as silent loss', () => {
    // If a later edit re-promotes these to `silent: true`, that is a claim about the machine and
    // it needs a new measurement, not a hunch.
    for (const n of ['NUL', 'nul.json', 'COM1', 'CON.txt']) {
      const h = nameHazard(n);
      assert.equal(h.hazard, 'reserved');
      assert.equal(h.silent, false, `${n}: node reads and writes this correctly — measured`);
      assert.equal(h.interopOnly, true);
    }
    for (const n of ['finding.', 'finding ']) {
      const h = nameHazard(n);
      assert.equal(h.hazard, 'trailing');
      assert.equal(h.silent, false);
      assert.equal(h.interopOnly, true);
    }
  });

  test('NEGATIVE — ordinary report names are not hazards', () => {
    for (const ok of [
      'trufflehog.json', 'semgrep.sarif', 'osv.sarif.exit', 'gitleaks-verify.log',
      'codeql-db', 'report_2026-09-04.json', 'a.b.c.json', '_leading-underscore',
      'CONSOLE.json', 'NULLABLE.txt', 'COMMIT.md',
    ]) {
      assert.equal(nameHazard(ok), null, `must be allowed: ${ok}`);
    }
    // NEGATIVE for the reserved matcher specifically: it must match the DEVICE, not a name that
    // merely begins with those letters. `CONSOLE` and `COMMIT` above are the cases that matter.
    assert.equal(nameHazard('CON2'), null);
    assert.equal(nameHazard('COM10'), null, 'only COM1-COM9 are devices');
  });
});

describe('classifyFsError — keeping "absent" meaning absent', () => {
  const enoent = Object.assign(new Error('x'), { code: 'ENOENT' });

  // The discrimination is win32's, so it is asked for by name and runs on every host.
  const WIN = { platform: 'win32' };

  test('a genuine miss is absent', () => {
    assert.equal(classifyFsError(enoent, 'C:/reports/osv.sarif'), 'absent');
    // The control for the two below: on win32, a clean path's ENOENT still means absent.
    assert.equal(classifyFsError(enoent, 'C:/reports/osv.sarif', WIN), 'absent');
    assert.equal(classifyFsError(enoent, `C:${BS}reports${BS}osv.sarif`, WIN), 'absent');
  });

  test('an ENOENT caused by an ILLEGAL NAME is not absent — this is the false clean', () => {
    assert.equal(classifyFsError(enoent, 'C:/reports/rule<id>.json', WIN), 'invalid-name');
    assert.equal(classifyFsError(enoent, `C:/reports/a${NUL}b.json`, WIN), 'invalid-name');
    assert.equal(classifyFsError(enoent, 'C:/reports/rule<id>.json', { platform: 'linux' }), 'absent',
      'elsewhere those characters are legal in a name, so the ENOENT is a real absence');
  });

  test('an over-long path is its own state', () => {
    assert.equal(classifyFsError(enoent, `C:/${'a'.repeat(MAX_PATH)}/x.json`, WIN), 'too-long');
  });

  test('other codes keep their own meaning', () => {
    assert.equal(classifyFsError(Object.assign(new Error('x'), { code: 'EACCES' })), 'denied');
    assert.equal(classifyFsError(Object.assign(new Error('x'), { code: 'EPERM' })), 'denied');
    assert.equal(classifyFsError(Object.assign(new Error('x'), { code: 'EISDIR' })), 'other');
    assert.equal(classifyFsError(Object.assign(new Error('x'), { code: 'ENAMETOOLONG' })), 'too-long');
    assert.equal(classifyFsError(null), 'other', 'no error is not an absence');
  });
});

test('a drive letter colon is not an ADS', () => {
  assert.equal(pathHazard('C:/reports/osv.sarif', { platform: 'win32' }), null);
  assert.equal(pathHazard(`C:${BS}reports${BS}osv.sarif`, { platform: 'win32' }), null);
  // but a colon in a SEGMENT still is
  assert.equal(pathHazard('C:/reports/a:b.json', { platform: 'win32' }).hazard, 'ads');
});

// ── SECOND WITNESS: the real filesystem ────────────────────────────────────────────────────────
// These are what corrected the module. They assert the machine's behaviour, so if a future Windows
// or node version changes it, this file fails and the documentation gets re-derived rather than
// quietly becoming wrong.

describe('effect on this filesystem', () => {
  const scratch = () => mkdtempSync(join(tmpdir(), 'cw-winpath-'));

  test('EFFECT: ":" writes a stream that READS BACK but is INVISIBLE to enumeration', (t) => {
    if (process.platform !== 'win32') { t.skip('windows only'); return; }
    const d = scratch();
    try {
      writeFileSync(join(d, 'evid:hidden.json'), 'SECRET');
      // It round-trips by exact path — which is exactly why a naive test would pass.
      assert.equal(readFileSync(join(d, 'evid:hidden.json'), 'utf8'), 'SECRET');
      // And it is invisible to everything that ENUMERATES or MEASURES.
      const listed = readdirSync(d);
      assert.ok(!listed.includes('evid:hidden.json'), 'readdir must not list the stream');
      assert.deepEqual(listed, ['evid'], 'only the base name appears');
      assert.equal(statSync(join(d, 'evid')).size, 0,
        'and the base file is 0 bytes — a size check sees nothing was written');

      // And nameHazard names it as the SILENT class, which is the only reason a caller would know.
      const h = nameHazard('evid:hidden.json');
      assert.equal(h.hazard, 'ads');
      assert.equal(h.silent, true, 'silent = succeeds, and the data becomes invisible');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('EFFECT: the illegal characters fail as ENOENT — the code that means "absent" here', (t) => {
    if (process.platform !== 'win32') { t.skip('windows only'); return; }
    const d = scratch();
    try {
      for (const ch of ['<', '>', '|', '?', '*']) {
        let code = null;
        try { writeFileSync(join(d, `rule${ch}id.json`), 'x'); } catch (e) { code = e.code; }
        assert.equal(code, 'ENOENT', `${ch} must still fail as ENOENT — the premise of classifyFsError`);
        // And that ENOENT is correctly NOT read as absence.
        assert.equal(classifyFsError({ code: 'ENOENT' }, join(d, `rule${ch}id.json`)), 'invalid-name');
        // and nameHazard marks it as the ENOENT-wearing class, which is what classifyFsError reads.
        assert.equal(nameHazard(`rule${ch}id.json`).enoent, true);
      }
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('EFFECT: reserved names and trailing dots DO work through node — measured, not assumed', (t) => {
    if (process.platform !== 'win32') { t.skip('windows only'); return; }
    const d = scratch();
    try {
      // This test exists to keep the module HONEST. If it ever fails, node's behaviour changed and
      // the `interopOnly` flags above must be re-promoted to `silent: true` on evidence.
      for (const [name, body] of [['NUL', 'DATA-NUL'], ['CON', 'DATA-CON'], ['COM1', 'DATA-COM1'], ['NUL.json', 'DATA-NJ']]) {
        writeFileSync(join(d, name), body);
        assert.equal(readFileSync(join(d, name), 'utf8'), body,
          `${name} round-tripped when the folklore says it is a device — do not re-add that claim`);
      }
      writeFileSync(join(d, 'tf'), 'PLAIN');
      writeFileSync(join(d, 'tf.'), 'DOTTED');
      assert.equal(readFileSync(join(d, 'tf'), 'utf8'), 'PLAIN');
      assert.equal(readFileSync(join(d, 'tf.'), 'utf8'), 'DOTTED',
        'trailing-dot names stay DISTINCT through node — they do not collapse');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  test('EFFECT: a deep path is not the MAX_PATH failure the folklore promises', (t) => {
    if (process.platform !== 'win32') { t.skip('windows only'); return; }
    const d = scratch();
    try {
      let deep = d;
      while (deep.length < 300) { deep = join(deep, 'a'.repeat(20)); mkdirSync(deep); }
      assert.ok(deep.length > MAX_PATH, `built a ${deep.length}-char path`);
      const f = join(deep, 'report.json');
      writeFileSync(f, 'DEEP');
      assert.equal(readFileSync(f, 'utf8'), 'DEEP', 'node reads and writes past MAX_PATH');
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
