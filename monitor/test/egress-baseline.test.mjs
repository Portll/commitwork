// node --test monitor/test/ — the egress lens. What is pinned here: identity is the EXECUTABLE
// PATH (never the pid, never the remote address); a loopback pair is not egress; the per-run
// counts are detail and not a change basis; a pid that vanished between the lsof and ps reads is
// an unknown that is counted; and a failed or unreadable observation is grey for the whole lens —
// never "nothing is talking out".
//
// Every fixture below is synthetic: addresses from the documentation ranges (RFC 5737/3849), made-
// up executable paths. No line of this box's real network state belongs in a tracked file.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseEgressLsof, parsePsComm, aggregateEgress, portClass, observeEgress, diffEgress,
  readBaseline, runLens, acceptBaseline, COVERAGE,
} from '../egress-baseline.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'cw-egress-')); dirs.push(d); return d; };

const env = (kv, fn) => async () => {
  const saved = {};
  for (const [k, v] of Object.entries(kv)) { saved[k] = process.env[k]; process.env[k] = v; }
  try { await fn(); } finally {
    for (const k of Object.keys(kv)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
};

const HEADER = 'COMMAND     PID   USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME';
const tcp = (cmd, pid, fd, local, remote) =>
  `${cmd}      ${pid} someone   ${fd}u  IPv4 0x1234567890abcde      0t0  TCP ${local}->${remote} (ESTABLISHED)`;
const udp = (cmd, pid, fd, local, remote) =>
  `${cmd}      ${pid} someone   ${fd}u  IPv4 0x1234567890abcdf      0t0  UDP ${local}->${remote}`;

const LSOF = [
  HEADER,
  tcp('browser', 101, 8, '198.51.100.7:52001', '203.0.113.10:443'),
  tcp('browser', 101, 9, '198.51.100.7:52002', '203.0.113.11:443'),
  tcp('browser', 101, 10, '198.51.100.7:52003', '203.0.113.10:80'),
  tcp('node', 202, 20, '127.0.0.1:7878', '127.0.0.1:52100'),          // loopback pair: not egress
  tcp('node', 202, 21, '198.51.100.7:52004', '203.0.113.30:443'),
  udp('resolver', 303, 5, '198.51.100.7:52005', '203.0.113.53:53'),
  '',
].join('\n');

const PS = [
  '    1 /sbin/launchd',
  '  101 /Applications/Example Browser.app/Contents/MacOS/Example Browser',
  '  202 /opt/example/bin/node',
  '  303 /usr/libexec/exampled',
].join('\n');

const BROWSER = '/Applications/Example Browser.app/Contents/MacOS/Example Browser';
const NODE = '/opt/example/bin/node';
const RESOLVERD = '/usr/libexec/exampled';

const fixtures = (lsof = LSOF, ps = PS) => {
  const dir = scratch();
  const l = join(dir, 'lsof.txt');
  const p = join(dir, 'ps.txt');
  writeFileSync(l, lsof);
  writeFileSync(p, ps);
  return { dir, lsof: l, ps: p, baseline: join(dir, 'egress.json') };
};

describe('parsing', () => {
  test('connected sockets become rows; loopback pairs and listeners are EXCLUDED, not unparsed', () => {
    const { rows, skipped } = parseEgressLsof([
      HEADER,
      tcp('browser', 101, 8, '198.51.100.7:52001', '203.0.113.10:443'),
      tcp('node', 202, 20, '127.0.0.1:7878', '127.0.0.1:52100'),
      'node        202 someone   22u  IPv4 0x1234567890abcd1      0t0  TCP *:7878 (LISTEN)',
      udp('resolver', 303, 5, '198.51.100.7:52005', '203.0.113.53:53'),
    ].join('\n'));
    assert.deepEqual(rows.map((r) => [r.pid, r.proto, r.remote.port]), [[101, 'TCP', 443], [303, 'UDP', 53]]);
    assert.equal(skipped.filter((s) => s.kind === 'excluded').length, 2);
    assert.deepEqual(skipped.filter((s) => s.kind === 'unparsed'), [], 'nothing here is beyond the parser');
  });

  test('an IPv6 pair parses, and a v6 loopback pair is still loopback', () => {
    const { rows, skipped } = parseEgressLsof([
      'app        404 someone   7u  IPv6 0x1234567890abcd2      0t0  TCP [2001:db8::7]:52010->[2001:db8:1::99]:443 (ESTABLISHED)',
      'app        404 someone   8u  IPv6 0x1234567890abcd3      0t0  TCP [::1]:52011->[::1]:9229 (ESTABLISHED)',
    ].join('\n'));
    assert.equal(rows.length, 1);
    assert.equal(rows[0].remote.address, '2001:db8:1::99');
    assert.equal(skipped.filter((s) => s.kind === 'excluded').length, 1);
  });

  test('a TCP socket that is not ESTABLISHED is excluded; a mangled line is UNPARSED and counted', () => {
    const { rows, skipped } = parseEgressLsof([
      'app        404 someone   7u  IPv4 0x1234567890abcd4      0t0  TCP 198.51.100.7:52012->203.0.113.9:443 (CLOSE_WAIT)',
      'this line is not lsof output',
    ].join('\n'));
    assert.deepEqual(rows, []);
    assert.equal(skipped.filter((s) => s.kind === 'excluded').length, 1);
    assert.equal(skipped.filter((s) => s.kind === 'unparsed').length, 1);
  });

  test('ps -o pid=,comm= keeps executable paths with spaces intact', () => {
    const m = parsePsComm(PS);
    assert.equal(m.get(101), BROWSER);
    assert.equal(m.size, 4);
  });

  test('a peer port at or above the ephemeral floor is ONE class, and the floor is read at call time', async () => {
    assert.equal(portClass(443), '443');
    assert.equal(portClass(40000), 'ephemeral');
    assert.equal(portClass(null), 'unnumbered');
    await env({ CW_EPHEMERAL_MIN: '1024' }, async () => { assert.equal(portClass(4444), 'ephemeral'); })();
    assert.equal(portClass(4444), '4444', 'and the override does not outlive the call');
  });
});

describe('identity', () => {
  test('connections aggregate per EXECUTABLE, with counts as detail and addresses as a count only', () => {
    const { rows } = parseEgressLsof(LSOF);
    const { items, unknowns } = aggregateEgress(rows, parsePsComm(PS));
    assert.deepEqual(unknowns, []);
    assert.deepEqual(items.map((i) => i.id), [BROWSER, NODE, RESOLVERD].sort());
    const browser = items.find((i) => i.id === BROWSER);
    assert.equal(browser.connections, 3);
    assert.deepEqual(browser.ports, ['443', '80']);
    assert.deepEqual(browser.portHistogram, { 443: 2, 80: 1 });
    assert.equal(browser.remotes, 2, 'distinct remote addresses are COUNTED');
    assert.ok(!JSON.stringify(items).includes('203.0.113.'), 'and never carried');
  });

  test('a restart is not an event — the same executable on a different pid is the same identity', () => {
    const a = aggregateEgress(parseEgressLsof(LSOF).rows, parsePsComm(PS));
    const movedPs = PS.replace('  202 ', ' 9202 ');
    const movedLsof = LSOF.replace(/ 202 /g, ' 9202 ');
    const b = aggregateEgress(parseEgressLsof(movedLsof).rows, parsePsComm(movedPs));
    assert.deepEqual(a.items.map((i) => i.id), b.items.map((i) => i.id));
    assert.deepEqual(diffEgress(b, { at: 't0', items: a.items }).added, []);
  });

  test('a pid missing from the ps table is unknown(truncated), counted — never dropped', () => {
    const { rows } = parseEgressLsof(LSOF);
    const { items, unknowns } = aggregateEgress(rows, parsePsComm(PS.replace('  303 /usr/libexec/exampled', '')));
    assert.equal(items.length, 2);
    assert.equal(unknowns.length, 1);
    assert.equal(unknowns[0].unknownReason, 'truncated');
    assert.equal(unknowns[0].id, 'pid:303');
  });
});

describe('observation fails closed', () => {
  test('an unreadable fixture path is unknown for the whole lens, never an empty connection set', async () => {
    const { ps } = fixtures();
    await env({ CW_EGRESS_LSOF: '/nope/not/here.txt', CW_EGRESS_PS: ps }, async () => {
      const r = observeEgress();
      assert.equal(r.ok, false);
      assert.equal(r.unknown, true);
      assert.equal(r.unknownReason, 'tool-failed');
    })();
  });

  test('output that parses to nothing is unparseable, not quiet', async () => {
    const { dir, ps } = fixtures();
    const junk = join(dir, 'junk.txt');
    writeFileSync(junk, 'lsof: WARNING: something\nnot a socket line at all\n');
    await env({ CW_EGRESS_LSOF: junk, CW_EGRESS_PS: ps }, async () => {
      assert.equal(observeEgress().unknownReason, 'unparseable');
    })();
  });

  test('an empty lsof is grey, and an empty ps table makes every connection unattributable', async () => {
    const { dir, lsof, ps } = fixtures();
    const empty = join(dir, 'empty.txt');
    writeFileSync(empty, '');
    await env({ CW_EGRESS_LSOF: empty, CW_EGRESS_PS: ps }, async () => {
      assert.equal(observeEgress().unknownReason, 'tool-failed');
    })();
    await env({ CW_EGRESS_LSOF: lsof, CW_EGRESS_PS: empty }, async () => {
      assert.equal(observeEgress().unknownReason, 'unparseable');
    })();
  });

  test('a run where every socket is loopback is a real observation with no egress — not an error', async () => {
    const { dir, ps } = fixtures();
    const loop = join(dir, 'loop.txt');
    writeFileSync(loop, `${HEADER}\n${tcp('node', 202, 20, '127.0.0.1:7878', '127.0.0.1:52100')}\n`);
    await env({ CW_EGRESS_LSOF: loop, CW_EGRESS_PS: ps }, async () => {
      const r = observeEgress();
      assert.equal(r.ok, true);
      assert.deepEqual(r.items, []);
      assert.equal(r.coverage, COVERAGE);
    })();
  });
});

describe('the baseline, end to end', () => {
  test('accept → ok; a NEW executable talking out is THE finding; a new port class is a lead; gone is informational', async () => {
    const { dir, lsof, ps, baseline } = fixtures();
    await env({ CW_EGRESS_BASELINE: baseline, CW_EGRESS_LSOF: lsof, CW_EGRESS_PS: ps, CW_NOW: '2026-09-18T00:00:00.000Z' }, async () => {
      assert.equal(runLens().state, 'no-baseline');
      const a = acceptBaseline();
      assert.equal(a.pinned, 3);
      const ok = runLens();
      assert.equal(ok.state, 'ok');
      assert.equal(ok.coverage, COVERAGE, 'the coverage limit rides on every payload');

      // a new executable dials out
      writeFileSync(lsof, `${LSOF}${tcp('helper', 404, 3, '198.51.100.7:52020', '203.0.113.66:4444')}\n`);
      writeFileSync(ps, `${PS}\n  404 /var/tmp/cache/helper`);
      const found = runLens();
      assert.equal(found.state, 'findings');
      assert.deepEqual(found.added.map((i) => i.id), ['/var/tmp/cache/helper']);
      assert.deepEqual(found.added[0].ports, ['4444']);
      assert.deepEqual(found.newPorts, []);

      // a KNOWN executable reaching a port class it never used before: a lead, listed apart
      writeFileSync(lsof, `${LSOF}${tcp('node', 202, 30, '198.51.100.7:52021', '203.0.113.30:9001')}\n`);
      writeFileSync(ps, PS);
      const lead = runLens();
      assert.deepEqual(lead.added, []);
      assert.deepEqual(lead.newPorts.map((i) => [i.id, i.newPorts]), [[NODE, ['9001']]]);
      assert.equal(lead.state, 'findings');

      // an executable that stopped talking is recorded and is NOT a finding
      writeFileSync(lsof, [HEADER, tcp('browser', 101, 8, '198.51.100.7:52001', '203.0.113.10:443'),
        tcp('browser', 101, 10, '198.51.100.7:52003', '203.0.113.10:80'), ''].join('\n'));
      const quiet = runLens();
      assert.deepEqual(quiet.gone.map((i) => i.id), [NODE, RESOLVERD]);
      assert.deepEqual(quiet.added, []);
      assert.equal(quiet.state, 'ok');
    })();
  });

  test('the baseline holds port CLASSES and no addresses, and churn in the counts is not a change', async () => {
    const { lsof, ps, baseline } = fixtures();
    await env({ CW_EGRESS_BASELINE: baseline, CW_EGRESS_LSOF: lsof, CW_EGRESS_PS: ps, CW_NOW: '2026-09-18T00:00:00.000Z' }, async () => {
      acceptBaseline();
      const written = readBaseline();
      assert.equal(written.coverage, COVERAGE);
      assert.deepEqual(Object.keys(written.items[0]).sort(), ['id', 'kind', 'ports']);
      assert.ok(!JSON.stringify(written).includes('203.0.113.'), 'no remote address reaches the baseline');
      assert.ok(!JSON.stringify(written).includes('"connections"'), 'nor a count that moves every second');

      // same executables, same port classes, entirely different connections and peers
      writeFileSync(lsof, [HEADER,
        tcp('browser', 101, 40, '198.51.100.7:53001', '198.51.100.200:443'),
        tcp('browser', 101, 41, '198.51.100.7:53002', '198.51.100.201:80'),
        tcp('node', 202, 42, '198.51.100.7:53003', '198.51.100.202:443'),
        udp('resolver', 303, 43, '198.51.100.7:53004', '198.51.100.203:53'), ''].join('\n'));
      const r = runLens();
      assert.equal(r.state, 'ok');
      assert.deepEqual([r.added, r.newPorts, r.gone], [[], [], []]);
    })();
  });

  test('accept refuses to pin a failed observation — an empty baseline would make the whole box new', async () => {
    const { dir, ps, baseline } = fixtures();
    const junk = join(dir, 'junk.txt');
    writeFileSync(junk, 'not lsof at all\n');
    await env({ CW_EGRESS_BASELINE: baseline, CW_EGRESS_LSOF: junk, CW_EGRESS_PS: ps }, async () => {
      assert.throws(() => acceptBaseline(), /nothing pinned/);
      assert.equal(readBaseline(), null, 'and nothing was written');
    })();
  });

  test('an unreadable baseline THROWS; only ENOENT is "no baseline yet"', async () => {
    const dir = scratch();
    const b = join(dir, 'egress.json');
    writeFileSync(b, '{corrupt');
    await env({ CW_EGRESS_BASELINE: b }, async () => { assert.throws(() => readBaseline()); })();
    await env({ CW_EGRESS_BASELINE: join(dir, 'absent.json') }, async () => { assert.equal(readBaseline(), null); })();
  });

  test('a failed observation is grey for the lens, and the baseline it cannot compare to is not consulted', async () => {
    const { dir, lsof, ps, baseline } = fixtures();
    await env({ CW_EGRESS_BASELINE: baseline, CW_EGRESS_LSOF: lsof, CW_EGRESS_PS: ps, CW_NOW: '2026-09-18T00:00:00.000Z' }, async () => {
      acceptBaseline();
    })();
    const junk = join(dir, 'junk.txt');
    writeFileSync(junk, 'not lsof at all\n');
    await env({ CW_EGRESS_BASELINE: baseline, CW_EGRESS_LSOF: junk, CW_EGRESS_PS: ps }, async () => {
      const r = runLens();
      assert.equal(r.state, 'unknown');
      assert.equal(r.unknown, true);
      assert.equal(r.added, undefined, 'a lens that could not look reports no diff at all');
    })();
  });

  test('two observations of one fixture are byte-identical — CW_NOW is honoured', async () => {
    const { lsof, ps, baseline } = fixtures();
    await env({ CW_EGRESS_BASELINE: baseline, CW_EGRESS_LSOF: lsof, CW_EGRESS_PS: ps, CW_NOW: '2026-09-18T00:00:00.000Z' }, async () => {
      acceptBaseline();
      assert.equal(JSON.stringify(runLens()), JSON.stringify(runLens()));
      assert.equal(runLens().at, '2026-09-18T00:00:00.000Z');
    })();
  });
});
