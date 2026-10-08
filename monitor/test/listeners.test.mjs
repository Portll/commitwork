// node --test monitor/test/  — LISTENING SOCKETS: the parser, and the refusal to report "nothing
// is listening" when the truth is "I could not look". Fixtures are real lsof captures from this
// box plus one hand-written file for shapes it does not exhibit; every degraded path asserts
// ok:false and that no caller can reach a zero-length success.

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import net from 'node:net';
import {
  listeners, parseLsof, parseAddress, classifyBinding, formatTable, isExternal, BINDING, runLsof,
  EPHEMERAL_MIN, isEphemeral, parseNetstat, runNetstat, defaultRunner, parseSs, runSs,
} from '../listeners.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = join(HERE, '..', '..');
const fixture = (n) => readFileSync(join(HERE, 'fixtures', n), 'utf8');
// captured with default column widths (COMMAND truncated to 9 chars: `com.docke`, `Code\x20H`)
const REAL = fixture('lsof-listen-darwin.txt');
// the same instant captured with `+c 0` (full command names, different column widths)
const REAL_C0 = fixture('lsof-listen-darwin-c0.txt');
const EDGE = fixture('lsof-listen-edge-cases.txt');

const at = (rows, port) => rows.filter((r) => r.port === port);

describe('classifyBinding — loopback vs off-box reachable', () => {
  test('loopback is the whole 127/8 block, ::1, and v4-mapped loopback', () => {
    for (const a of ['127.0.0.1', '127.0.0.53', '127.1.2.3', '::1', '[::1]', 'localhost', '::ffff:127.0.0.1']) {
      assert.equal(classifyBinding(a), BINDING.LOOPBACK, a);
    }
  });
  test('wildcard is every spelling of "all interfaces"', () => {
    for (const a of ['*', '0.0.0.0', '::', '[::]', '']) assert.equal(classifyBinding(a), BINDING.WILDCARD, JSON.stringify(a));
  });
  test('a specific non-loopback address is INTERFACE — narrower than wildcard, still off-box', () => {
    for (const a of ['192.168.1.121', '100.64.0.7', '10.0.0.5', '2001:db8::1']) {
      assert.equal(classifyBinding(a), BINDING.INTERFACE, a);
      assert.equal(isExternal({ binding: classifyBinding(a) }), true, `${a} must count as external`);
    }
  });
  test('isExternal is "not loopback" — an interface bind is not a safer class, only a smaller one', () => {
    assert.equal(isExternal({ binding: BINDING.LOOPBACK }), false);
    assert.equal(isExternal({ binding: BINDING.WILDCARD }), true);
    assert.equal(isExternal({ binding: BINDING.INTERFACE }), true);
  });
});

describe('parseAddress', () => {
  test('parses every address:port shape lsof emits', () => {
    assert.deepEqual(parseAddress('*:8081'), { address: '*', port: 8081, portLabel: '8081' });
    assert.deepEqual(parseAddress('127.0.0.1:8099'), { address: '127.0.0.1', port: 8099, portLabel: '8099' });
    assert.deepEqual(parseAddress('[::1]:3002'), { address: '::1', port: 3002, portLabel: '3002' });
    assert.deepEqual(parseAddress('[::]:3001'), { address: '::', port: 3001, portLabel: '3001' });
    assert.deepEqual(parseAddress('0.0.0.0:3000'), { address: '0.0.0.0', port: 3000, portLabel: '3000' });
  });
  test('a NAMED port keeps its label and reports port:null rather than NaN', () => {
    assert.deepEqual(parseAddress('127.0.0.1:http'), { address: '127.0.0.1', port: null, portLabel: 'http' });
  });
  test('an established connection is not a listener', () => {
    assert.equal(parseAddress('127.0.0.1:5000->127.0.0.1:6000'), null);
    assert.equal(parseAddress(''), null);
    assert.equal(parseAddress(null), null);
  });
});

describe('parseLsof — against REAL captured output from this box', () => {
  const { rows, skipped } = parseLsof(REAL);

  test('the capture parses with nothing left over', () => {
    assert.equal(rows.length, 45, 'the fixture holds 45 LISTEN rows');
    assert.deepEqual(skipped, [], `unparsed lines: ${JSON.stringify(skipped)}`);
  });

  test('*:8081 is deno, WILDCARD — the socket the plan said did not exist', () => {
    const [r] = at(rows, 8081);
    assert.ok(r, 'port 8081 missing from the capture');
    assert.equal(r.command, 'deno');
    assert.equal(r.address, '*');
    assert.equal(r.binding, BINDING.WILDCARD);
    assert.equal(isExternal(r), true);
    assert.equal(r.pid, 5682);
  });

  test('*:7701 is deno, WILDCARD — the second one', () => {
    const [r] = at(rows, 7701);
    assert.ok(r, 'port 7701 missing from the capture');
    assert.equal(r.command, 'deno');
    assert.equal(r.address, '*');
    assert.equal(r.binding, BINDING.WILDCARD);
    assert.equal(isExternal(r), true);
  });

  test('127.0.0.1:8099 — the declared clientD ORIGIN — is loopback, and is classified apart from the two above', () => {
    const [r] = at(rows, 8099);
    assert.ok(r);
    assert.equal(r.address, '127.0.0.1');
    assert.equal(r.binding, BINDING.LOOPBACK);
    assert.equal(isExternal(r), false);
  });

  test('the declared origins 7878 (admin panel) and 8787 (lab landing) are loopback', () => {
    for (const p of [7878, 8787]) {
      const [r] = at(rows, p);
      assert.ok(r, `port ${p} missing`);
      assert.equal(r.binding, BINDING.LOOPBACK, `${p} must be loopback`);
    }
  });

  test('the capture contains BOTH classes — a fixture that were all-loopback would prove nothing', () => {
    assert.ok(rows.some((r) => r.binding === BINDING.LOOPBACK));
    assert.ok(rows.filter(isExternal).length >= 2);
  });

  test('a command name containing an escaped space is unescaped, not split into columns', () => {
    // default-width lsof truncates to 9 chars: `Code\x20H` -> `Code H`
    assert.ok(rows.some((r) => r.command.includes(' ')), 'expected an escaped-space command name');
    assert.ok(rows.every((r) => !r.command.includes('\\x20')), 'a \\x20 escape survived into the output');
  });

  test('IPv4 and IPv6 rows on the same port are BOTH kept — they are two sockets', () => {
    const both = at(rows, 53531);
    assert.equal(both.length, 2);
    assert.deepEqual(both.map((r) => r.family).sort(), ['IPv4', 'IPv6']);
  });

  test('every row carries the five fields a caller is promised', () => {
    for (const r of rows) {
      for (const k of ['address', 'port', 'command', 'pid', 'binding']) assert.ok(k in r, `missing ${k}`);
      assert.equal(typeof r.pid, 'number');
      assert.ok(Object.values(BINDING).includes(r.binding), `unknown binding ${r.binding}`);
    }
  });
});

describe('parseLsof is column-width agnostic', () => {
  test('the `+c 0` capture of the same instant yields the same sockets, with FULL command names', () => {
    const a = parseLsof(REAL).rows;
    const b = parseLsof(REAL_C0).rows;
    assert.deepEqual(b.map((r) => `${r.address}:${r.portLabel}`).sort(), a.map((r) => `${r.address}:${r.portLabel}`).sort());
    assert.deepEqual(parseLsof(REAL_C0).skipped, []);
    // truncation is what `+c 0` fixes: com.docke -> com.docker.backend
    assert.ok(b.some((r) => r.command === 'com.docker.backend'), 'expected an untruncated command name');
    assert.ok(a.some((r) => r.command === 'com.docke'), 'expected the truncated form in the default capture');
  });
});

describe('parseLsof — edge cases, and what it refuses', () => {
  const { rows, skipped } = parseLsof(EDGE);

  test('0.0.0.0 and [::] are wildcard; [::1] and 127.0.0.53 are loopback', () => {
    assert.equal(at(rows, 3000)[0].binding, BINDING.WILDCARD);   // 0.0.0.0
    assert.equal(at(rows, 3001)[0].binding, BINDING.WILDCARD);   // [::]
    assert.equal(at(rows, 3002)[0].binding, BINDING.LOOPBACK);   // [::1]
    assert.equal(at(rows, 3005)[0].binding, BINDING.LOOPBACK);   // 127.0.0.53
  });

  test('a LAN or Tailscale address is INTERFACE and counts as externally bound', () => {
    assert.equal(at(rows, 3003)[0].binding, BINDING.INTERFACE);  // 192.168.1.121
    assert.equal(at(rows, 3004)[0].binding, BINDING.INTERFACE);  // 100.64.0.7
    assert.equal(isExternal(at(rows, 3003)[0]), true);
  });

  test('a multi-word escaped command name survives intact', () => {
    assert.equal(at(rows, 3006)[0].command, 'My App (Helper)');
  });

  test("an ESTABLISHED row is SKIPPED — and the skip is REPORTED, never swallowed", () => {
    assert.ok(!rows.some((r) => r.command === 'established'), 'an established connection was counted as a listener');
    assert.ok(skipped.some((s) => /not a \(LISTEN\) row/.test(s.why)), `skipped: ${JSON.stringify(skipped)}`);
  });

  test("lsof's own stderr chatter is ignored without becoming a skipped row", () => {
    assert.ok(!rows.some((r) => /WARNING|lsof/i.test(r.command)));
  });

  // ── the UDP lane ──────────────────────────────────────────────────────────────────────────
  // verbatim shapes from `lsof +c 0 -nP -iUDP` on a real Mac — UDP carries no (LISTEN) marker at all
  const UDP = [
    'COMMAND                      PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME',
    'node                        1671 portll   27u  IPv4 0x6b79cf0ccd39f7a3      0t0  UDP *:5353',
    'com.docker.backend         49749 portll  152u  IPv4 0xeb95399d0907f829      0t0  UDP 127.0.0.1:8600',
    'identityservicesd            651 portll    7u  IPv4 0x5629e4324a79be69      0t0  UDP *:*',
    'Claude\\x20Helper            1095 portll   29u  IPv4 0x614686d6c68ba93a      0t0  UDP 192.168.1.114:56017->160.79.104.10:443',
    'cloudflared                 1676 portll   10u  IPv4 0xeb456b919a471e80      0t0  UDP *:52291',
    'sshd                         900 root      3u  IPv4 0x1111111111111111      0t0  TCP *:22 (LISTEN)',
  ].join('\n');
  const u = parseLsof(UDP);
  const uAt = (p) => u.rows.filter((r) => r.port === p);

  test('a bound UDP socket is a row — 5353 was invisible before this', () => {
    assert.equal(uAt(5353).length, 1);
    assert.equal(uAt(5353)[0].proto, 'UDP');
    assert.equal(uAt(5353)[0].binding, BINDING.WILDCARD);
    assert.equal(uAt(5353)[0].command, 'node');
  });

  test('a project-owned UDP port below the ephemeral floor is kept — "UDP means host" is not a rule', () => {
    // treating UDP as inherently host-owned would disown a container's own port
    assert.equal(uAt(8600).length, 1);
    assert.equal(uAt(8600)[0].ephemeral, false);
    assert.equal(uAt(8600)[0].binding, BINDING.LOOPBACK);
  });

  test('a CONNECTED UDP socket is excluded — an in-flight client socket is not a bound port', () => {
    assert.equal(uAt(56017).length, 0);
    assert.ok(u.skipped.some((s) => s.kind === 'excluded' && /connected socket/.test(s.why)));
  });

  test('`*:*` — a socket with no port at all — is excluded, and named as excluded not unparsed', () => {
    const e = u.skipped.find((s) => /names no port at all/.test(s.why));
    assert.ok(e, 'the *:* row must be accounted for, not dropped in silence');
    assert.equal(e.kind, 'excluded', 'a line the parser understood must not be reported as a parser failure');
  });

  test('a NAMED port (lsof without -P) is still a listener — the *:* exclusion must not catch it', () => {
    // `*:mdns` and `*:*` both yield a null numeric port; only one of them is "no port bound".
    // Keying the exclusion on `port === null` dropped every named-port listener.
    const named = parseLsof([
      'COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME',
      'mDNSResponder 300 root 5u IPv4 0x1 0t0 UDP *:mdns',
    ].join('\n'));
    assert.equal(named.rows.length, 1);
    assert.equal(named.rows[0].portLabel, 'mdns');
    assert.equal(named.rows[0].port, null);
    assert.equal(named.rows[0].ephemeral, false, 'a null port cannot be judged ephemeral');
  });

  test('an ephemeral-range UDP port is KEPT but flagged — never silently dropped', () => {
    // Dropping it would make the inventory tidier and wrong; crediting it would invent a service.
    assert.equal(uAt(52291).length, 1);
    assert.equal(uAt(52291)[0].ephemeral, true);
  });

  test('TCP still requires (LISTEN) — the UDP lane did not loosen the TCP gate', () => {
    assert.equal(uAt(22).length, 1);
    assert.equal(uAt(22)[0].proto, 'TCP');
    assert.equal(uAt(22)[0].ephemeral, false, 'the ephemeral flag is a UDP concept only');
  });

  test('CW_EPHEMERAL_MIN is read at CALL time, not module load', () => {
    const before = process.env.CW_EPHEMERAL_MIN;
    try {
      assert.equal(EPHEMERAL_MIN(), 32768);
      process.env.CW_EPHEMERAL_MIN = '9000';
      assert.equal(EPHEMERAL_MIN(), 9000, 'a const read at import would defeat this override silently');
      assert.equal(isEphemeral({ proto: 'UDP', port: 9001 }), true);
      assert.equal(isEphemeral({ proto: 'TCP', port: 9001 }), false);
    } finally {
      if (before === undefined) delete process.env.CW_EPHEMERAL_MIN; else process.env.CW_EPHEMERAL_MIN = before;
    }
  });

  test('a named-port row is kept as a real listener with port:null', () => {
    const r = rows.find((x) => x.portLabel === 'http');
    assert.ok(r, 'the named-port row was dropped');
    assert.equal(r.port, null);
    assert.equal(r.binding, BINDING.LOOPBACK);
  });
});

describe('THE HONESTY CONTRACT — an unavailable tool is never an empty success', () => {
  test('lsof missing from PATH -> ok:false, and there is NO rows array to mistake for zero', () => {
    const r = listeners({ run: () => ({ ok: false, reason: 'lsof not found on PATH' }) });
    assert.equal(r.ok, false);
    assert.match(r.reason, /not found/);
    assert.equal(r.rows, undefined, 'a failed observation must not hand back rows at all');
    assert.equal(r.counts, undefined);
  });

  test('the REAL missing-binary path (execFileSync ENOENT) -> ok:false, not an empty list', () => {
    const r = listeners({ bin: 'lsof-definitely-not-installed-xyzzy' });
    assert.equal(r.ok, false);
    assert.match(r.reason, /not found on PATH/);
    assert.match(r.reason, /UNKNOWN, not empty/);
    assert.equal(r.rows, undefined);
  });

  test('lsof exits 0 with EMPTY stdout -> ok:false (a live box always has something listening)', () => {
    const r = listeners({ run: () => ({ ok: true, stdout: '' }) });
    assert.equal(r.ok, false);
    assert.match(r.reason, /ZERO parsed as LISTEN rows|UNKNOWN, not empty/);
    assert.notEqual(r.ok, true);
  });

  test('lsof emits a HEADER and nothing else -> ok:false, never "no listeners"', () => {
    const header = REAL.split('\n')[0] + '\n';
    const r = listeners({ run: () => ({ ok: true, stdout: header }) });
    assert.equal(r.ok, false);
    assert.match(r.reason, /ZERO parsed as LISTEN rows/);
  });

  test('output this parser does not understand -> ok:false WITH the unparsed count, not silence', () => {
    const r = listeners({ run: () => ({ ok: true, stdout: 'total garbage\nmore garbage that is long enough to have nine fields a b c d e f\n' }) });
    assert.equal(r.ok, false);
    assert.match(r.reason, /ZERO parsed as LISTEN rows/);
    assert.ok(Array.isArray(r.skipped) && r.skipped.length, 'the unparsed lines must be handed back');
  });

  test('a runner that returns nothing at all -> ok:false rather than a crash or a green', () => {
    for (const bad of [() => undefined, () => null, () => ({}), () => ({ ok: 'yes' })]) {
      const r = listeners({ run: bad });
      assert.equal(r.ok, false);
      assert.ok(r.reason);
    }
  });

  test('formatTable says UNKNOWN for a failed observation and never prints an empty table', () => {
    const out = formatTable({ ok: false, reason: 'lsof not found' });
    assert.match(out, /UNKNOWN/);
    assert.match(out, /NOT "nothing is listening"/);
    assert.doesNotMatch(out, /0 listening socket/);
  });
});

describe('listeners() — the success shape, driven by the captured fixture', () => {
  const r = listeners({ run: () => ({ ok: true, stdout: REAL, argv: ['lsof', '(fixture)'] }) });

  test('ok:true with rows, counts and a timestamp', () => {
    assert.equal(r.ok, true);
    assert.equal(r.rows.length, 45);
    assert.equal(r.counts.total, 45);
    assert.ok(Date.parse(r.at), 'at must be a parseable timestamp');
  });

  test('counts partition the rows exactly — external === wildcard + interface', () => {
    const c = r.counts;
    assert.equal(c.loopback + c.wildcard + c.interface, c.total);
    assert.equal(c.external, c.wildcard + c.interface);
    assert.equal(c.external, r.rows.filter(isExternal).length);
    assert.ok(c.external >= 2, 'the capture must retain its externally-bound sockets');
  });

  test('rows are ordered by port so a diff between two runs is readable', () => {
    const ports = r.rows.map((x) => x.port ?? 0);
    assert.deepEqual(ports, [...ports].sort((a, b) => a - b));
  });

  test('the rendered table names the externally bound sockets explicitly, including 8081 and 7701', () => {
    const out = formatTable(r);
    assert.match(out, /EXTERNALLY BOUND/);
    assert.match(out, /\*:8081\s+deno/);
    assert.match(out, /\*:7701\s+deno/);
    // and a loopback origin must NOT appear in the externally-bound block
    const tail = out.slice(out.indexOf('EXTERNALLY BOUND'));
    assert.doesNotMatch(tail, /127\.0\.0\.1:8099/);
  });
});

describe('read-only, and runnable as a CLI', () => {
  // fact: a bare container binds nothing; this block binds one loopback socket so the enumerator always has a row to see
  let server;
  before(async () => { server = net.createServer(); await new Promise((r) => server.listen(0, '127.0.0.1', r)); });
  after(() => new Promise((r) => server.close(r)));
  const cli = (args) => spawnSync(process.execPath, [join(CW, 'monitor', 'listeners.mjs'), ...args], { encoding: 'utf8' });

  test('the module never invokes a mutating command — lsof only, with read-only flags', () => {
    const src = readFileSync(join(CW, 'monitor', 'listeners.mjs'), 'utf8');
    for (const bad of [/\bkill\b/, /\bpkill\b/, /SIGKILL|SIGTERM/, /\bexecSync\b/, /\bunlink|rmSync|writeFileSync\b/]) {
      assert.doesNotMatch(src, bad, `listeners.mjs must not reference ${bad}`);
    }
  });

  test('`node monitor/listeners.mjs --json` runs, exits 0, and emits a parseable result', () => {
    const r = cli(['--json']);
    const j = JSON.parse(r.stdout);
    assert.equal(r.status, j.ok ? 0 : 1, 'exit 0 exactly when the enumeration succeeded');
    // if a box lacks lsof, ok:false is the CORRECT answer
    assert.ok(typeof j.ok === 'boolean');
    if (j.ok) {
      assert.ok(j.rows.length > 0, 'ok:true must never carry zero rows');
      assert.equal(j.counts.total, j.rows.length);
    } else {
      assert.ok(j.reason, 'ok:false must carry a reason');
      assert.equal(j.rows, undefined);
    }
  });

  test('`node monitor/listeners.mjs` prints a table', () => {
    const out = cli([]).stdout;
    assert.match(out, /PROTO\s+BINDING\s+ADDRESS\s+PORT|UNKNOWN/);
    // "bound", not "listening" — a UDP socket does not listen
    assert.match(out, /bound socket\(s\)|UNKNOWN/);
  });

  test('runLsof against the real binary returns ok:true with stdout, or ok:false with a reason — never both empty', () => {
    const g = runLsof();
    if (g.ok) { assert.ok(g.stdout.trim().length, 'ok:true with empty stdout is the forbidden shape'); assert.ok(g.argv); }
    else assert.ok(g.reason);
  });
});

// ── the win32 adapter ───────────────────────────────────────────────────────────────────────────
// Parsed from a FIXTURE, so these run on every platform. The point is not that Windows works here;
// it is that the netstat dialect is pinned somewhere a Linux CI run will also check.
describe('parseNetstat — the Windows enumerator', () => {
  // Real `netstat -ano` output, including the banner, the header, IPv6 bracket form, a UDP bound
  // socket, a UDP row WITH a peer (a connected socket, not a listener) and an ESTABLISHED TCP row.
  const SAMPLE = [
    '',
    'Active Connections',
    '',
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1604',
    '  TCP    127.0.0.1:7878         0.0.0.0:0              LISTENING       9001',
    '  TCP    [::]:445               [::]:0                 LISTENING       4',
    '  TCP    192.168.1.119:52344    140.82.113.26:443      ESTABLISHED     3200',
    '  UDP    0.0.0.0:53             *:*                                    7580',
    '  UDP    [::1]:5353             *:*                                    7580',
    '  UDP    192.168.1.119:60000    93.184.216.34:443                      4242',
  ].join('\r\n');   // CRLF, because that is what netstat emits

  const names = new Map([[1604, 'svchost.exe'], [9001, 'node.exe'], [4, 'System'], [7580, 'svchost.exe']]);

  test('every line is accounted for — a row, or an EXPLAINED exclusion, never a silent drop', () => {
    const { rows, skipped } = parseNetstat(SAMPLE, names);
    assert.equal(rows.length, 5, 'three listening TCP + two bound UDP');
    assert.equal(skipped.length, 2, 'the ESTABLISHED TCP row and the connected UDP row');
    assert.deepEqual([...new Set(skipped.map((s) => s.kind))], ['excluded'],
      'a connected socket is UNDERSTOOD and deliberately not a row — never reported as unparsed');
    for (const s of skipped) assert.ok(s.why && s.why.length > 5, 'every exclusion states its reason');
  });

  test('the row shape matches what parseLsof produces, so no consumer sees a dialect', () => {
    const { rows } = parseNetstat(SAMPLE, names);
    const tcp135 = rows.find((r) => r.port === 135);
    assert.equal(tcp135.proto, 'TCP');
    assert.equal(tcp135.binding, BINDING.WILDCARD);
    assert.equal(tcp135.command, 'svchost.exe', 'the pid is resolved to a process name via tasklist');
    assert.equal(tcp135.family, 'IPv4');
    assert.equal(tcp135.portLabel, '135');
    assert.equal(isExternal(tcp135), true);
    for (const k of ['command', 'pid', 'user', 'fd', 'family', 'proto', 'address', 'port', 'portLabel', 'binding', 'ephemeral']) {
      assert.ok(k in tcp135, `row is missing ${k} — a consumer written against lsof rows would break`);
    }
  });

  test('loopback is not reported as externally bound', () => {
    const { rows } = parseNetstat(SAMPLE, names);
    const local = rows.find((r) => r.port === 7878);
    assert.equal(local.binding, BINDING.LOOPBACK);
    assert.equal(isExternal(local), false, 'the panel port is loopback-bound and must not read as reachable');
    assert.equal(rows.find((r) => r.port === 5353).binding, BINDING.LOOPBACK, '[::1] is loopback with its brackets stripped');
  });

  test('IPv6 is recognised by shape, and UDP is included at all', () => {
    const { rows } = parseNetstat(SAMPLE, names);
    assert.equal(rows.find((r) => r.port === 445).family, 'IPv6');
    assert.equal(rows.filter((r) => r.proto === 'UDP').length, 2,
      'UDP is why this does not reuse port-bind.mjs\'s TCP-only parser — dropping it would '
      + 'under-report bound sockets on one platform only');
  });

  test('LOCALE: a translated state column still yields the listening rows', () => {
    // "ABHÖREN" is the German state. The structural fact — a listening socket has no peer — is what
    // the parser turns on, so a localized box must not report zero listeners, which would read as
    // "nothing is bound" rather than as a parse failure.
    const german = SAMPLE.split('\r\n').map((l) => l.replace('LISTENING', 'ABHÖREN ')).join('\r\n');
    const { rows } = parseNetstat(german, names);
    assert.equal(rows.filter((r) => r.proto === 'TCP').length, 3,
      'a translated state column must not empty the result');
  });

  test('an unknown pid keeps command NULL rather than inventing one', () => {
    const { rows } = parseNetstat(SAMPLE, new Map());
    assert.deepEqual([...new Set(rows.map((r) => r.command))], [null],
      'with no tasklist output every command is null — a fabricated process name on a security '
      + 'lens is worse than a blank');
    assert.equal(rows.length, 5, 'and the socket rows still stand on their own');
  });

  test('garbage is UNPARSED, and distinguished from an exclusion', () => {
    const { rows, skipped } = parseNetstat('  TCP    not-an-address    x    LISTENING    abc\n', names);
    assert.equal(rows.length, 0);
    assert.equal(skipped.length, 1);
    assert.equal(skipped[0].kind, 'unparsed', 'a line the parser failed on is not the same as one it excluded');
  });

  test('defaultRunner dispatches on platform — no test depends on which box it runs on', () => {
    // Asserting the CHOICE, not the result: running the real enumerator for the other platform is
    // exactly what this indirection exists to avoid.
    assert.equal(typeof defaultRunner, 'function');
    assert.equal(typeof runNetstat, 'function');
    const posix = defaultRunner({ platform: 'linux', bin: 'definitely-not-a-real-binary-xyz' });
    assert.equal(posix.ok, false, 'the linux path went to ss, then lsof, and refused an absent binary');
    assert.match(posix.reason, /UNKNOWN, not empty/, 'and the refusal keeps the honesty contract');
  });
});

describe('the linux adapter (ss)', () => {
  const SS = [
    'Netid State  Recv-Q Send-Q Local Address:Port Peer Address:Port Process',
    'udp   UNCONN 0      0      127.0.0.53%lo:53        0.0.0.0:*',
    'udp   ESTAB  0      0      10.1.0.4:41234        8.8.8.8:53',
    'tcp   LISTEN 0      4096   127.0.0.53%lo:53        0.0.0.0:*',
    'tcp   LISTEN 0      128          0.0.0.0:22        0.0.0.0:*',
    'tcp   LISTEN 0      4096            [::]:22           [::]:*',
    'tcp   LISTEN 0      511                *:3000            *:*    users:(("node",pid=4242,fd=18))',
    'udp   UNCONN 0      0      [fe80::1%eth0]:546         [::]:*',
    'nonsense row',
  ].join('\n');

  test('listening TCP and bound UDP become rows; the scope id is not part of the address', () => {
    const { rows, skipped } = parseSs(SS);
    assert.deepEqual(rows.map((r) => `${r.proto} ${r.address}:${r.portLabel}`), [
      'UDP 127.0.0.53:53', 'TCP 127.0.0.53:53', 'TCP 0.0.0.0:22', 'TCP :::22', 'TCP *:3000', 'UDP fe80::1:546',
    ]);
    assert.equal(rows.find((r) => r.port === 3000).command, 'node');
    assert.equal(rows.find((r) => r.port === 3000).pid, 4242);
    assert.equal(rows.find((r) => r.port === 22).command, null, 'another user\'s socket has no visible owner, and none is invented');
    assert.equal(rows.find((r) => r.address === '::').family, 'IPv6');
    assert.deepEqual(skipped.map((x) => x.kind), ['excluded', 'unparsed'], 'a connected UDP socket is excluded, not unparsed');
  });

  test('a row with no visible owner renders as unknown rather than breaking the table', () => {
    const r = listeners({ run: () => ({ ok: true, stdout: SS, argv: ['ss', '(fixture)'], parse: parseSs }) });
    assert.equal(r.ok, true);
    assert.match(formatTable(r), /0\.0\.0\.0 +22 +\? +\?/);
  });

  test('an absent ss is reported as missing, so the linux path can fall back to lsof', () => {
    const g = runSs({ bin: 'ss-definitely-not-installed-xyzzy' });
    assert.equal(g.ok, false);
    assert.equal(g.missing, true);
    assert.match(g.reason, /UNKNOWN, not empty/);
  });
});
