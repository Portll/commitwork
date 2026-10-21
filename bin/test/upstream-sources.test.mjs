// The allowlist and its chain, asserted by EFFECT rather than by marker: every test below either
// performs a refusal or breaks a chain and checks it is caught. A guard that has only ever been
// seen to pass has no floor.
//
// No network: fetchOne is not exercised here (that is what bin/upstream-fetch.mjs --fetch does
// against the live releases). What IS exercised is every decision made before and after the
// download — which is where the refusals live.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir, homedir, userInfo } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { eventBody, chainOf, readChain, recordedPath, verifyChain } from '../upstream-fetch.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const MANIFEST = join(REPO, 'manifests', 'upstream-sources.json');
const CHAIN = join(REPO, 'provenance', 'upstream-sources.chain.jsonl');
const CLI = join(REPO, 'bin', 'upstream-fetch.mjs');

const run = (args, env = {}) => {
  try {
    const out = execFileSync('node', [CLI, ...args], { encoding: 'utf8', env: { ...process.env, ...env } });
    return { code: 0, out };
  } catch (e) { return { code: e.status, out: `${e.stdout || ''}${e.stderr || ''}` }; }
};

const manifest = () => JSON.parse(readFileSync(MANIFEST, 'utf8'));

test('the manifest declares sources, and every one is hash-pinned', () => {
  const d = manifest();
  assert.ok(d.sources.length >= 1, 'no sources declared — this file must never pass vacuously');
  for (const s of d.sources) {
    assert.match(s.sha256 || '', /^[0-9a-f]{64}$/, `${s.id} has no sha256 — "no hash" must not be a declarable state`);
    assert.match(s.repo, /^[\w.-]+\/[\w.-]+$/, `${s.id}: repo is not owner/name`);
    assert.equal(typeof s.publisherChecksums, 'boolean',
      `${s.id}: publisherChecksums must be explicit — whether the PUBLISHER attests the bytes is a `
      + 'different claim from whether we recorded them, and the two must not collapse');
    assert.ok(s.firstParty && s.firstParty.org, `${s.id}: no first-party evidence recorded`);
  }
});

test('superseded sources are named, so nobody re-adopts one', () => {
  const d = manifest();
  const sup = d.supersededSources?.repos || [];
  assert.ok(sup.length > 0, 'no superseded sources recorded');
  const declared = new Set(d.sources.map((s) => s.repo));
  for (const r of sup) {
    assert.equal(declared.has(r), false, `${r} is listed as superseded AND declared as a live source`);
  }
});

test('an undeclared source is refused, and the refusal names the human step', () => {
  const r = run(['--fetch', 'no-such-source-id']);
  assert.equal(r.code, 2, 'an undeclared source must exit 2');
  assert.match(r.out, /not a declared source/);
  assert.match(r.out, /no override flag/,
    'the refusal must say there is no override — a refusal that hints at a bypass is not one');
});

test('there is no code path that takes a URL from the caller', () => {
  const raw = readFileSync(CLI, 'utf8');
  // COMMENTS STRIPPED FIRST. The file's own header says "no --url, no override flag", and a
  // check that reads prose would fail on the sentence promising the property it is testing —
  // it did, on the first run. Assert against code.
  const src = raw.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  // The URL is built only from a declared repo/tag/asset. A --url flag would make every other
  // assertion here decorative.
  assert.equal(/'--url'|"--url"/.test(src), false, 'upstream-fetch grew a --url flag');
  const urls = [...src.matchAll(/https:\/\/[^\s`'"]+/g)].map((m) => m[0]);
  for (const u of urls) {
    assert.match(u, /^https:\/\/github\.com\/\$\{s\.repo\}/,
      `a literal URL "${u}" appears in the fetcher — every URL must be derived from the manifest`);
  }
});

test('the shipped chain is intact', () => {
  const { present, events, error, tailTorn } = readChain(CHAIN);
  assert.equal(error, null, `chain unreadable: ${error}`);
  if (!present) return;                     // nothing fetched yet is a legitimate state
  assert.equal(tailTorn, false, 'the chain has a torn tail line');
  const v = verifyChain(events);
  assert.equal(v.ok, true, `chain broken at record ${v.at}: ${v.why}`);
});

// The chain ships. A record that names this machine's home leaks its layout; the older records were
// redacted by hand to a placeholder home for exactly that reason.
const ownHomes = () => [...new Set([homedir(), userInfo().homedir])].map((h) => `${h}/`);
const homePaths = (events) => events.flatMap((e) => ['path', 'ruleManifestPath']
  .filter((k) => typeof e[k] === 'string' && ownHomes().some((h) => e[k].startsWith(h)))
  .map((k) => `${e.id} ${k}`));

test('no shipped chain record names this machine\'s home directory', () => {
  const { events } = readChain(CHAIN);
  assert.deepEqual(homePaths(events), []);
  assert.deepEqual(homePaths([{ id: 'planted', ruleManifestPath: `${userInfo().homedir}/x.rules.json` }]), ['planted ruleManifestPath'],
    'the check must fire on a planted record, or an empty result proves nothing');
});

test('POSITIVE CONTROL: a tampered record breaks the chain and is located', () => {
  const { events } = readChain(CHAIN);
  if (events.length < 2) return;            // needs depth to be meaningful
  const forged = events.map((e) => ({ ...e }));
  forged[1] = { ...forged[1], sha256: 'deadbeef'.repeat(8) };
  const v = verifyChain(forged);
  assert.equal(v.ok, false, 'rewriting a record did NOT break the chain — the binding is decorative');
  assert.equal(v.at, 2, `the break should be located at record 2, got ${v.at}`);
});

test('POSITIVE CONTROL: reordering two records breaks the chain', () => {
  const { events } = readChain(CHAIN);
  if (events.length < 3) return;
  const swapped = events.map((e) => ({ ...e }));
  [swapped[1], swapped[2]] = [swapped[2], swapped[1]];
  assert.equal(verifyChain(swapped).ok, false, 'order is not bound — an append-only log whose order is free proves nothing');
});

test('the hashed body is order-independent and treats absence explicitly', () => {
  const a = { at: 'T', id: 'x', repo: 'o/r', tag: 't', asset: 'a', sha256: 'h', publisherChecksums: true };
  const b = { publisherChecksums: true, sha256: 'h', asset: 'a', tag: 't', repo: 'o/r', id: 'x', at: 'T' };
  assert.equal(eventBody(a), eventBody(b), 'key order changes the hashed body');
  assert.match(eventBody({ ...a, tag: null }), /absent/, 'a missing field must hash as an explicit absence');
  assert.notEqual(chainOf('0'.repeat(64), a), chainOf('1'.repeat(64), a), 'prev is not bound into the hash');
});

test('a mismatching declared hash refuses BEFORE anything is written', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cw-upstream-'));
  const d = manifest();
  const one = { ...d.sources[0], sha256: '0'.repeat(64) };
  const p = join(dir, 'm.json');
  writeFileSync(p, JSON.stringify({ ...d, sources: [one] }));
  const chainFile = join(dir, 'chain.jsonl');
  const r = run(['--fetch', one.id, '--into', dir], { CW_UPSTREAM_MANIFEST: p, CW_UPSTREAM_CHAIN: chainFile });
  assert.equal(r.code, 2, 'a hash mismatch must exit 2');
  assert.match(r.out, /MISMATCH/);
  assert.equal(readChain(chainFile).present, false, 'a refused fetch still wrote a chain record');
});

// An append-only record that ships must not carry the fetching machine's home directory: the six
// records already in the chain had to be redacted by hand for exactly that. Both directions, and
// the hash is asserted unchanged because `path` sits outside eventBody and must stay there.
test('the recorded install path is relative inside the checkout, absolute only when it is outside', () => {
  assert.equal(recordedPath('/x/repo/reports/upstream-cache/tool', '/x/repo'), 'reports/upstream-cache/tool');
  assert.equal(recordedPath('/tmp/elsewhere/tool', '/x/repo'), '/tmp/elsewhere/tool',
    'a path outside the checkout cannot be made relative, and inventing one would misreport where the file is');
  const e = { at: 'T', id: 'i', repo: 'r', tag: 't', asset: 'a', sha256: 's', publisherChecksums: true };
  assert.equal(chainOf('0'.repeat(64), { ...e, path: 'reports/upstream-cache/tool' }),
    chainOf('0'.repeat(64), { ...e, path: '/x/repo/reports/upstream-cache/tool' }),
    'the path form is not bound by the chain hash, so the records already written stay valid');
});
