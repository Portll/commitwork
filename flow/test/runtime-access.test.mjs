// C2 records how each file was OPENED — read, write, append, both — because that is what gives a
// direction to a `touches` edge C1 could not orient. Metadata calls carry no access.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { observe, summarise, networkWitness } from '../runtime.mjs';

function fixtureRepo() {
  const d = mkdtempSync(join(tmpdir(), 'flow-acc-'));
  mkdirSync(join(d, 'bin'), { recursive: true });
  mkdirSync(join(d, 'data'), { recursive: true });
  writeFileSync(join(d, 'data', 'in.txt'), 'x\n');
  return d;
}

test('every open form records its access, named imports included', async () => {
  // Arrange
  const d = fixtureRepo();
  try {
    writeFileSync(join(d, 'bin', 'io.mjs'), [
      'import { openSync, closeSync, readFileSync, writeFileSync, appendFileSync, copyFileSync, existsSync, createWriteStream, createReadStream, readFile } from "node:fs";',
      'import { open, writeFile } from "node:fs/promises";',
      'closeSync(openSync("data/in.txt", "r"));',
      'closeSync(openSync("data/rw.txt", "w+"));',
      'readFileSync("data/both.txt", { flag: "a+" });',
      'writeFileSync("data/both.txt", "1");',
      'readFileSync("data/both.txt");',
      'appendFileSync("data/log.txt", "1");',
      'copyFileSync("data/in.txt", "data/copy.txt");',
      'existsSync("data/meta.txt");',
      'const fd = openSync("data/in.txt", "r"); readFileSync(fd); closeSync(fd);',
      'await (await open("data/p.txt", "a")).close();',
      'await writeFile("data/pw.txt", "1");',
      'await new Promise((ok) => createWriteStream("data/ws.txt").end("x", ok));',
      'await new Promise((ok) => createReadStream("data/in.txt").on("close", ok).resume());',
      'await new Promise((ok) => readFile("data/in.txt", ok));',
    ].join('\n'));
    // Act
    const r = observe(['bin/io.mjs'], { root: d });
    // Assert
    assert.equal(r.status, 0, r.stderr);
    const acc = (to) => r.observations.filter((o) => o.from === 'bin/io.mjs' && o.to === to && o.access).flatMap((o) => o.access).sort();
    assert.deepEqual(acc('data/in.txt'), ['read']);
    assert.deepEqual(acc('data/rw.txt'), ['readwrite']);
    assert.deepEqual(acc('data/both.txt'), ['read', 'readwrite', 'write'], 'access accumulates over the run');
    assert.deepEqual(acc('data/log.txt'), ['append']);
    assert.deepEqual(acc('data/copy.txt'), ['write'], 'copyFile opens its destination for write');
    assert.deepEqual(acc('data/p.txt'), ['append']);
    assert.deepEqual(acc('data/pw.txt'), ['write']);
    assert.deepEqual(acc('data/ws.txt'), ['write']);
    assert.deepEqual(acc('data/meta.txt'), [], 'existsSync is metadata, not an open');
    assert.ok(r.observations.some((o) => o.to === 'data/meta.txt' && o.kind === 'reads'), 'but it is still observed');
    assert.ok(!r.observations.some((o) => /\/\d+$|^\d+$/.test(o.to)), 'an fd is not a path');
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('summarise refuses network rows from a process without a network witness, per pid', () => {
  // Arrange
  const rows = [
    { t: 'installed', pid: 1, selfWitness: true, netWitness: true },
    { t: 'installed', pid: 2, selfWitness: true, netWitness: false, netReason: 'probe not observed: listen' },
    { t: 'connect', key: 'tcp://a:1', actor: 'bin/a.mjs', via: 'net.connect', pid: 1 },
    { t: 'connect', key: 'tcp://b:1', actor: 'bin/b.mjs', via: 'net.connect', pid: 2 },
    { t: 'connect', key: null, actor: 'bin/a.mjs', via: 'fetch', pid: 1 },
    { t: 'listen', key: 'listen:1', actor: 'bin/a.mjs', via: 'listen', pid: 1, probe: true },
  ];
  // Act
  const s = summarise({ state: 'usable', rows, network: networkWitness(rows) });
  // Assert
  assert.equal(s.network.state, 'usable');
  assert.equal(s.network.refused, 1);
  assert.equal(s.network.observed, 1);
  assert.equal(s.unattributed, 1, 'an unkeyed connect is unattributed, not an edge');
  assert.deepEqual(s.observations, [{ from: 'bin/a.mjs', to: 'tcp://a:1', kind: 'connects', via: 'net.connect' }]);
  assert.ok(!s.coverage.includes('bin/b.mjs'), 'a refused row is not evidence either');
});

test('networkWitness says why when no process proved itself', () => {
  // Arrange / Act
  const none = networkWitness([]);
  const failed = networkWitness([{ t: 'installed', pid: 3, netWitness: false, netReason: 'not patched: fetch' }]);
  // Assert
  assert.equal(none.state, 'unusable');
  assert.match(none.reason, /no installed row/);
  assert.match(failed.reason, /not patched: fetch/);
  assert.deepEqual(failed.pids, []);
});

test('summarise derives the network witness itself when readTrace did not supply one', () => {
  // Arrange
  const rows = [{ t: 'installed', pid: 9, netWitness: true }, { t: 'listen', key: 'listen:5', actor: 'bin/s.mjs', via: 'listen', pid: 9, ephemeral: true }];
  // Act
  const s = summarise({ state: 'usable', rows });
  // Assert
  assert.equal(s.network.state, 'usable');
  assert.deepEqual(s.observations, [{ from: 'bin/s.mjs', to: 'listen:5', kind: 'listens', via: 'listen', ephemeral: true }]);
});

test('an unusable trace summarises with an unusable network, not an empty one', () => {
  // Arrange / Act
  const s = summarise({ state: 'absent', rows: [], reason: 'no trace file' });
  // Assert
  assert.deepEqual(s.network, { state: 'unusable', reason: 'no trace file', observed: 0, refused: 0 });
});
