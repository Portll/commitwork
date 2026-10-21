// Which artifact parse-runtime actually READS: the reader once named nuclei.json while every
// sweep wrote nuclei.jsonl, so the DAST half of the runtime report never had a candidate batch.
// These pin BOTH spellings and BOTH shapes, and pin `ran` to agree with the reader.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parseRuntime, nucleiArtifact, NUCLEI_ARTIFACTS } from '../parse-runtime.mjs';

const dir = () => mkdtempSync(join(tmpdir(), 'cw-rt-artifact-'));
const rec = (id, sev = 'info') => ({
  'template-id': id, info: { name: id, severity: sev, tags: ['network'] },
  type: 'javascript', 'matched-at': '127.0.0.1:5353', response: 'x',
});

test('nuclei.jsonl — the name every sweep actually writes — is read', () => {
  const d = dir();
  writeFileSync(join(d, 'nuclei.jsonl'), [JSON.stringify(rec('mDNS-enum', 'low')), JSON.stringify(rec('zeroconf-detect'))].join('\n'));
  const r = parseRuntime(d);
  assert.equal(r.ran, true, 'a dir holding only nuclei.jsonl has RUN — reporting ran:false here is "never scanned" for a real scan');
  assert.equal(r.findings.length, 2);
  assert.deepEqual(r.findings.map((f) => f.id).sort(), ['mDNS-enum', 'zeroconf-detect']);
});

test('nuclei.json written by -je is a JSON ARRAY, not JSONL, and is still read', () => {
  const d = dir();
  // `-je` emits an array — a filename-only fix would still read zero findings here
  writeFileSync(join(d, 'nuclei.json'), JSON.stringify([rec('dameng-detect'), rec('snmpv3-detect')], null, 2));
  const r = parseRuntime(d);
  assert.equal(r.ran, true);
  assert.equal(r.findings.length, 2, 'the array form parses — shape is decided by content, not by filename');
});

test('nuclei.jsonl wins when both exist, and the loser is not double-counted', () => {
  const d = dir();
  writeFileSync(join(d, 'nuclei.jsonl'), JSON.stringify(rec('from-jsonl')));
  writeFileSync(join(d, 'nuclei.json'), JSON.stringify([rec('from-json')]));
  assert.equal(nucleiArtifact(d), join(d, 'nuclei.jsonl'), 'preference order is declared, not incidental');
  const r = parseRuntime(d);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].id, 'from-jsonl');
});

test('an absent artifact is ran:false — absence stays absence, and is never a finding', () => {
  const d = dir();
  assert.equal(nucleiArtifact(d), null);
  const r = parseRuntime(d);
  assert.equal(r.ran, false);
  assert.deepEqual(r.findings, []);
});

test('an unreadable/garbage artifact yields no findings but still reports ran — a parse failure is not a clean scan', () => {
  const d = dir();
  writeFileSync(join(d, 'nuclei.jsonl'), 'not json\nstill not json\n');
  const r = parseRuntime(d);
  assert.equal(r.ran, true, 'the scanner ran and wrote something; "0 findings" here would claim a clean target');
  assert.deepEqual(r.findings, []);
});

test('a directory that does not exist is ran:false, not a crash', () => {
  const r = parseRuntime(join(tmpdir(), 'cw-rt-does-not-exist-' + Date.now()));
  assert.equal(r.ran, false);
  assert.deepEqual(r.findings, []);
});

test('the artifact list is frozen and jsonl-first — the reader and the manifests must not drift again', () => {
  assert.deepEqual([...NUCLEI_ARTIFACTS], ['nuclei.jsonl', 'nuclei.json']);
  assert.ok(Object.isFrozen(NUCLEI_ARTIFACTS));
});

test('monitor/runtime-report.mjs gates on the SAME artifact list it parses', async () => {
  // The gate and the parser naming different files is precisely what dead-lettered this lane.
  // Pinned by reading the source rather than by re-implementing the gate.
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../../monitor/runtime-report.mjs', import.meta.url), 'utf8');
  assert.match(src, /const hasRuntime = \(d\) => !!nucleiArtifact\(d\)/,
    'hasRuntime must call nucleiArtifact, not re-spell a filename');
  assert.ok(!/existsSync\(join\(d, 'nuclei\.json'\)\)/.test(src),
    'the hand-spelled nuclei.json gate must be gone');
});

test('a real fleet artifact parses — the fixture cannot drift from the field alone', () => {
  // Guards against fixtures that agree with the parser while the real shape has moved on.
  const d = mkdtempSync(join(tmpdir(), 'cw-rt-real-'));
  mkdirSync(d, { recursive: true });
  const real = '{"template":"javascript/udp/misconfiguration/mdns-enum.yaml","template-id":"mDNS-enum",' +
    '"info":{"name":"mDNS Enumeration","severity":"low","tags":["dns","udp","mdns","enum","js"]},' +
    '"type":"javascript","host":"127.0.0.1","port":"5353","url":"127.0.0.1:5353",' +
    '"matched-at":"127.0.0.1:5353","extracted-results":["airplay"],"ip":"127.0.0.1","matcher-status":true}';
  writeFileSync(join(d, 'nuclei.jsonl'), real);
  const r = parseRuntime(d);
  assert.equal(r.findings.length, 1);
  assert.equal(r.findings[0].id, 'mDNS-enum');
  assert.equal(r.findings[0].severity, 'low');
  assert.equal(r.findings[0].location, '127.0.0.1:5353', 'host:port survives into the runtime lane (the rollup extractor drops it)');
  assert.equal(r.findings[0].category, 'services');
});
