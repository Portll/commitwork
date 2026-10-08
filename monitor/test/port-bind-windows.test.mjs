// The win32 half of the port/bind lens. collectListeners() had NO win32 branch —
// `if (platform === 'linux') ss … else lsof …` sent Windows down the lsof path, and lsof is not
// installed there. The host-wide listening-port lens was therefore unavailable on Windows while
// both of its sibling host lenses had real win32 adapters (monitor/disk-encryption.mjs reads
// BitLocker via manage-bde; monitor/persistence-diff.mjs reads the registry Run keys and sc query).
// monitor/listening-ports.mjs, monitor/app-vuln.mjs and engine-identity.mjs all read through it.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  ifaceClass, collectListeners,
  parseNetstatListeners, parseTasklistCsv, parseWin32ProcessJson,
} from '../port-bind.mjs';

// Real output, captured from `netstat -ano` on Windows 11 (2026-09-04). CRLF on purpose: that is
// what the command actually emits, and a parser that only handled LF would drop every row.
const NETSTAT = [
  '',
  'Active Connections',
  '',
  '  Proto  Local Address          Foreign Address        State           PID',
  '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1604',
  '  TCP    127.0.0.1:7878         0.0.0.0:0              LISTENING       9001',
  '  TCP    [::]:445               [::]:0                 LISTENING       4',
  '  TCP    [::1]:7980             [::]:0                 LISTENING       9002',
  '  TCP    192.168.1.20:3389      0.0.0.0:0              LISTENING       4476',
  '  TCP    127.0.0.1:51234        127.0.0.1:7878         ESTABLISHED     7777',
  '  UDP    0.0.0.0:500            *:*                                    1234',
  '',
].join('\r\n');

const ENOENT = () => { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); };

describe('windows listener collection', () => {
  test('parses listening TCP rows, and ONLY those', () => {
    const rows = parseNetstatListeners(NETSTAT);
    assert.deepEqual(rows.map((r) => [r.addr, r.port, r.pid]), [
      ['0.0.0.0', 135, 1604],
      ['127.0.0.1', 7878, 9001],
      ['[::]', 445, 4],
      ['[::1]', 7980, 9002],
      ['192.168.1.20', 3389, 4476],
    ]);
    // NEGATIVE — these would corrupt the lens rather than merely add noise.
    assert.ok(!rows.some((r) => r.port === 51234), 'an ESTABLISHED connection is not a listener');
    assert.ok(!rows.some((r) => r.port === 500), 'a UDP socket is not in scope for this lens');
    assert.ok(!rows.some((r) => r.port === 0), 'header and blank lines produce no rows');
    assert.deepEqual(parseNetstatListeners(''), [], 'empty input is an empty parse');
    assert.deepEqual(parseNetstatListeners(null), []);
  });

  test('the bracket form feeds ifaceClass unchanged — one dialect, not two', () => {
    const by = (p) => parseNetstatListeners(NETSTAT).find((r) => r.port === p);
    assert.equal(ifaceClass(by(445).addr), 'any', '[::] is the any-interface bind');
    assert.equal(ifaceClass(by(7980).addr), 'loopback', '[::1] is loopback');
    assert.equal(ifaceClass(by(7878).addr), 'loopback');
    assert.equal(ifaceClass(by(135).addr), 'any');
    assert.equal(ifaceClass(by(3389).addr), 'addressed');
  });

  test('LOCALE — a translated state column still yields listeners, because the peer is the signal', () => {
    // netstat's state column is TRANSLATED on a localized Windows. Matching the literal word
    // "LISTENING" would return ZERO listeners on a German or French box — an empty result that
    // reads as "nothing is listening" instead of as a parse failure, which is exactly what the
    // fail-closed rule forbids. The locale-independent fact is structural: a listening socket has
    // no peer, which netstat prints as a foreign address of :0.
    const de = [
      '  Proto  Lokale Adresse         Remoteadresse          Status          PID',
      '  TCP    0.0.0.0:135            0.0.0.0:0              ABHÖREN         1604',
      '  TCP    127.0.0.1:7878         0.0.0.0:0              ABHÖREN         9001',
      '  TCP    127.0.0.1:51234        127.0.0.1:7878         HERGESTELLT     7777',
    ].join('\r\n');
    const rows = parseNetstatListeners(de);
    assert.deepEqual(rows.map((r) => r.port), [135, 7878], 'localized listening rows are still found');
    assert.ok(!rows.some((r) => r.port === 51234), 'and a localized ESTABLISHED row is still excluded');
  });

  test('LF-only output parses identically to CRLF — the line ending is not evidence', () => {
    assert.deepEqual(parseNetstatListeners(NETSTAT.replace(/\r\n/g, '\n')), parseNetstatListeners(NETSTAT));
  });

  test('tasklist CSV -> pid names, including an image name containing a comma', () => {
    const csv = [
      '"svchost.exe","1604","Services","0","12,345 K"',
      '"node.exe","9001","Console","1","98,765 K"',
      '"weird,name.exe","4242","Console","1","1 K"',
    ].join('\r\n');
    const m = parseTasklistCsv(csv);
    assert.equal(m.get(1604), 'svchost.exe');
    assert.equal(m.get(9001), 'node.exe');
    assert.equal(m.get(4242), 'weird,name.exe', 'taken by shape — a split(",") would truncate this');
    assert.equal(m.get(999), undefined, 'an unknown pid is absent, never a fabricated name');
    assert.equal(parseTasklistCsv('').size, 0);
  });

  test('CIM json -> pid command lines, and an absent CommandLine stays ABSENT', () => {
    const json = JSON.stringify([
      { ProcessId: 9001, CommandLine: 'node  admin/serve.mjs' },
      { ProcessId: 4, CommandLine: null },       // protected/system process: normal, not an error
      { ProcessId: 1604, CommandLine: '   ' },   // whitespace is not a command line
      { ProcessId: 'nope', CommandLine: 'x' },
    ]);
    const m = parseWin32ProcessJson(json);
    assert.equal(m.get(9001), 'node  admin/serve.mjs');
    assert.equal(m.get(4), undefined, 'absence is never invented — the process axis reads undetermined');
    assert.equal(m.get(1604), undefined);
    assert.equal(m.size, 1);
    // ConvertTo-Json emits a bare object, not a 1-element array, for a single result.
    assert.equal(parseWin32ProcessJson(JSON.stringify({ ProcessId: 5, CommandLine: 'solo' })).get(5), 'solo');
    assert.equal(parseWin32ProcessJson('not json').size, 0, 'unparseable is empty, not a throw');
    assert.equal(parseWin32ProcessJson('').size, 0);
  });

  test('collectListeners uses netstat on win32 and layers identity on top', () => {
    const called = [];
    const exec = (cmd) => {
      called.push(cmd);
      if (/netstat/i.test(cmd)) return NETSTAT;
      if (/tasklist/i.test(cmd)) return '"node.exe","9001","Console","1","1 K"';
      if (/powershell/i.test(cmd)) return JSON.stringify([{ ProcessId: 9001, CommandLine: 'node admin/serve.mjs' }]);
      throw new Error(`unexpected ${cmd}`);
    };
    const r = collectListeners({ platform: 'win32', exec });
    assert.equal(r.method, 'netstat');
    assert.ok(!called.some((c) => /lsof|^ss$|^ps$/.test(c)), 'no POSIX tool is reached for on Windows');
    const admin = r.listeners.find((l) => l.port === 7878);
    assert.equal(admin.command, 'node.exe');
    assert.equal(admin.args, 'node admin/serve.mjs', 'the command LINE is what the process axis needs');
    const sys = r.listeners.find((l) => l.port === 445);
    assert.equal(sys.command, null, 'a pid tasklist did not name stays null');
    assert.equal(sys.args, null, 'and so do its args');
  });

  test('FAIL CLOSED — the identity tools may fail; the socket table may NOT', () => {
    // tasklist and PowerShell are best-effort: their absence degrades identity to null, which the
    // lens already renders as undetermined. netstat is load-bearing, and its failure must THROW —
    // an empty listener list on a serving box would be read as "nothing is listening".
    const r = collectListeners({
      platform: 'win32',
      exec: (cmd) => (/netstat/i.test(cmd) ? NETSTAT : ENOENT()),
    });
    assert.equal(r.listeners.length, 5, 'the socket table survives losing BOTH identity tools');
    assert.ok(r.listeners.every((l) => l.command === null && l.args === null));

    assert.throws(() => collectListeners({
      platform: 'win32',
      exec: (cmd) => (/netstat/i.test(cmd) ? ENOENT() : ''),
    }), 'enumeration failure is unknown(tool-failed) upstream, never an empty box');
  });

  test('REGRESSION — the POSIX branches are untouched', () => {
    const lin = collectListeners({
      platform: 'linux',
      exec: (cmd) => {
        if (cmd === 'ss') return 'LISTEN 0 511 127.0.0.1:7878 0.0.0.0:* users:(("node",pid=9001,fd=20))';
        if (cmd === 'ps') return '  9001 node admin/serve.mjs';
        throw new Error(`unexpected ${cmd}`);
      },
    });
    assert.equal(lin.method, 'ss');
    assert.equal(lin.listeners[0].port, 7878);
    assert.equal(lin.listeners[0].args, 'node admin/serve.mjs');

    const mac = collectListeners({
      platform: 'darwin',
      exec: (cmd) => {
        if (cmd === 'lsof') return 'p9001\ncnode\nn127.0.0.1:7878\n';
        if (cmd === 'ps') return '  9001 node admin/serve.mjs';
        throw new Error(`unexpected ${cmd}`);
      },
    });
    assert.equal(mac.method, 'lsof');
    assert.equal(mac.listeners[0].port, 7878);
  });

  // ── SECOND WITNESS: the real box ─────────────────────────────────────────────────────────────
  // Everything above runs on captured text and can only prove the parser agrees with itself. This
  // runs the real command and cross-checks it against a DIFFERENT enumeration — PowerShell's
  // Get-NetTCPConnection, which is structured and locale-independent, and shares no code with
  // netstat parsing.
  test('EFFECT: the real netstat parse agrees with Get-NetTCPConnection on this box', (t) => {
    if (process.platform !== 'win32') { t.skip('windows only'); return; }
    let ps;
    try {
      ps = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
        '@(Get-NetTCPConnection -State Listen | Select-Object LocalPort) | ConvertTo-Json -Compress'],
      { encoding: 'utf8', timeout: 60000, windowsHide: true }));
    } catch { t.skip('Get-NetTCPConnection unavailable on this box'); return; }
    const psPorts = new Set((Array.isArray(ps) ? ps : [ps]).map((r) => Number(r.LocalPort)));
    const mine = new Set(collectListeners().listeners.map((l) => l.port));
    assert.ok(mine.size > 0, 'the real box is listening on something');
    // Both directions, asserted SEPARATELY — only one of them is the direction that lies to you.
    assert.deepEqual([...mine].filter((p) => !psPorts.has(p)), [],
      'FALSE POSITIVES — ports we report that Get-NetTCPConnection does not');
    assert.deepEqual([...psPorts].filter((p) => !mine.has(p)), [],
      'FALSE NEGATIVES — listening ports we did not see');
  });

  test('EFFECT: the real collection is well-formed and never fabricates identity', (t) => {
    if (process.platform !== 'win32') { t.skip('windows only'); return; }
    const r = collectListeners();
    assert.equal(r.method, 'netstat');
    for (const l of r.listeners) {
      assert.ok(Number.isInteger(l.pid) && l.pid >= 0, `pid must be an integer: ${JSON.stringify(l)}`);
      assert.ok(Number.isInteger(l.port) && l.port > 0 && l.port < 65536, `port out of range: ${JSON.stringify(l)}`);
      assert.ok(['loopback', 'any', 'addressed'].includes(ifaceClass(l.addr)), `unclassifiable addr: ${l.addr}`);
      assert.ok(l.args === null || typeof l.args === 'string');
      assert.ok(l.command === null || typeof l.command === 'string');
    }
    // Determinism of SHAPE: two collections a moment apart may legitimately differ in membership
    // (the box is live), so what is asserted is that repeated collection is stable in form and
    // overwhelmingly stable in content — not that a live machine is frozen.
    const again = collectListeners();
    assert.equal(again.method, r.method);
    const a = new Set(r.listeners.map((l) => `${l.addr}:${l.port}`));
    const b = new Set(again.listeners.map((l) => `${l.addr}:${l.port}`));
    const churn = [...a].filter((x) => !b.has(x)).length + [...b].filter((x) => !a.has(x)).length;
    assert.ok(churn <= Math.max(4, a.size * 0.1), `listener set churned by ${churn} between two immediate reads`);
  });
});
