#!/usr/bin/env node
// upstream-fetch.mjs — fetch a vendored third-party binary ONLY from a declared source, verify it
// against a declared hash, and append a hash-chained record of what was taken.
//
// THE POINT IS THE REFUSAL, not the download. A vendored binary is the least-inspected thing in a
// supply chain: it arrives once, by hand, from whatever URL was in somebody's shell history, and
// nothing afterwards can say where it came from. Every path here is closed by default —
//   * a source not in manifests/upstream-sources.json is refused (no --url, no override flag);
//   * a hash that does not match the declaration is refused and NOTHING is written;
//   * a declaration whose sha256 is absent is refused, because "no hash" must not be the easy path.
// Adding a source is therefore an edit to a tracked manifest, reviewed as a commit. That review is
// the only place a human enters the loop, and it is deliberately the only one.
//
// fact: the chain binds the PREVIOUS line's hash, so a record cannot be revised without breaking
//   every record after it / an append-only claim nobody can verify is decoration (expiry: never)
// fact: a release that publishes no checksums yields a FIRST-OBSERVATION pin, not a confirmation
//   against the publisher — recorded as `publisherChecksums:false` and never conflated with a
//   verified one (expiry: never)
//
// usage:
//   node bin/upstream-fetch.mjs --list                 what is declared, and its install state
//   node bin/upstream-fetch.mjs --verify               re-hash what is installed against the chain
//   node bin/upstream-fetch.mjs --fetch <id> [--into <dir>]
//
// env, read at call time: CW_ROOT, CW_UPSTREAM_MANIFEST, CW_UPSTREAM_CHAIN, CW_UPSTREAM_CACHE

import { isMainModule } from '../lib/is-main.mjs';
import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, chmodSync, mkdtempSync, rmSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { join, dirname, basename, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const root = () => process.env.CW_ROOT || join(HERE, '..');
const manifestPath = () => process.env.CW_UPSTREAM_MANIFEST || join(root(), 'manifests', 'upstream-sources.json');
const chainPath = () => process.env.CW_UPSTREAM_CHAIN || join(root(), 'provenance', 'upstream-sources.chain.jsonl');
const cacheDir = () => process.env.CW_UPSTREAM_CACHE || join(root(), 'reports', 'upstream-cache');

// What the chain RECORDS as the install path: relative to the checkout whenever it is inside one.
// An absolute path here would write the fetching machine's home directory into an append-only
// record that ships, and the records already in the chain had to be redacted by hand for that.
// `path` is outside eventBody, so its form is not part of any hash: old records stay as they are.
export function recordedPath(out, base = root()) {
  const rel = relative(base, out);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel : out;
}

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const GENESIS = '0'.repeat(64);

// ── the chain ────────────────────────────────────────────────────────────────────────────────
// Deliberately NOT monitor/history-chain.mjs: that module's hashed body is a fixed slice-shaped
// tuple (op/stamp/sliceId/sliceSha256) and its op set is slice|replace|retro-seal. Bending a
// supply-chain record into those fields would make the chain attest something it does not mean.
// The discipline is shared; the schema is not.

/** Canonical hashed body: FIXED field order, so key order and whitespace cannot change a hash. */
export function eventBody(e) {
  const f = (v) => (v === null || v === undefined || v === '' ? 'absent' : String(v));
  return [f(e.at), f(e.id), f(e.repo), f(e.tag), f(e.asset), f(e.sha256), f(e.publisherChecksums)].join('\n');
}
export const chainOf = (prev, e) => sha256(`${prev}\n${eventBody(e)}`);

export function readChain(p = chainPath()) {
  let raw;
  try { raw = readFileSync(p, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return { present: false, events: [], tailTorn: false, error: null };
    // Fail closed: an unreadable chain is not an empty chain.
    return { present: false, events: [], tailTorn: false, error: `${e.code} reading ${p}` };
  }
  const lines = raw.split('\n').filter((l) => l.length);
  const events = [];
  let tailTorn = false; let error = null;
  for (let i = 0; i < lines.length; i++) {
    try { events.push(JSON.parse(lines[i])); } catch {
      if (i === lines.length - 1) { tailTorn = true; break; }
      error = `line ${i + 1} of ${lines.length} is not JSON — the log is corrupt from there`;
      break;
    }
  }
  return { present: true, events, tailTorn, error };
}

/** Verify every link. Returns the first break rather than a boolean, so a caller can name it. */
export function verifyChain(events) {
  let prev = GENESIS;
  for (const [i, e] of events.entries()) {
    if (e.prev !== prev) return { ok: false, at: i + 1, why: `prev does not bind line ${i}` };
    if (e.chain !== chainOf(prev, e)) return { ok: false, at: i + 1, why: 'chain hash does not match the record body' };
    prev = e.chain;
  }
  return { ok: true, tip: prev, length: events.length };
}

function appendChain(rec) {
  const { events, tailTorn, error } = readChain();
  if (error) throw new Error(`refusing to append to a corrupt chain: ${error}`);
  if (tailTorn) throw new Error('refusing to append after a torn tail line — truncate it first, so the tear stays visible');
  const v = verifyChain(events);
  if (!v.ok) throw new Error(`refusing to append to a broken chain: ${v.why} (record ${v.at})`);
  const prev = events.length ? events[events.length - 1].chain : GENESIS;
  const line = { ...rec, prev, chain: chainOf(prev, rec) };
  mkdirSync(dirname(chainPath()), { recursive: true });
  appendFileSync(chainPath(), JSON.stringify(line) + '\n');
  return line;
}

// ── the allowlist ────────────────────────────────────────────────────────────────────────────
function loadManifest() {
  const p = manifestPath();
  let doc;
  try { doc = JSON.parse(readFileSync(p, 'utf8')); } catch (e) {
    throw new Error(`upstream-sources manifest unreadable at ${p}: ${e.message}`);
  }
  if (!Array.isArray(doc.sources) || !doc.sources.length) throw new Error(`${p} declares no sources`);
  return doc;
}

/** The ONLY way a URL is produced. There is no code path that accepts one from the caller. */
function urlFor(s) {
  if (s.origin !== 'github-release') throw new Error(`${s.id}: unsupported origin "${s.origin}"`);
  if (!/^[\w.-]+\/[\w.-]+$/.test(s.repo)) throw new Error(`${s.id}: repo "${s.repo}" is not owner/name`);
  return `https://github.com/${s.repo}/releases/download/${s.tag}/${s.asset}`;
}

// ── rulepack extraction ─────────────────────────────────────────────────────────────────────
// A `kind: "rulepack"` source is still one hash-pinned archive, fetched and chained exactly like
// a binary. The addition: after the bytes are verified against the declared sha256, walk the
// extracted archive and record WHICH rules it contains, so a ruleset-dependent lane in
// cwe-map.json can eventually cite rule ids instead of shrugging "ruleset-dependent". The rule
// manifest rides as an UNHASHED passenger field on the chain record — same precedent as `bytes`
// and `path` already are — because it is a deterministic re-derivation of the already hash-pinned
// archive, not new provenance: anyone holding the verified archive reproduces the same list.

function walkFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkFiles(p, out);
    else if (/\.ya?ml$/i.test(name)) out.push(p);
  }
  return out;
}

/**
 * Line-based, NOT a YAML parser. Semgrep rule files declare `rules: [{id: ..., ...}, ...]`, and in
 * every ruleset this was checked against `id` is the FIRST key of each list item, so a line
 * matching `- id: <value>` reliably marks one rule. A rule block that declares `id` on a later key
 * is missed — this UNDERCOUNTS rather than fabricates; silence here is a floor on ruleCount, never
 * an invented rule.
 */
export function extractSemgrepRuleIds(dir) {
  const ids = new Set();
  for (const f of walkFiles(dir)) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/^\s*-\s*id:\s*(\S+)\s*$/gm)) ids.add(m[1]);
  }
  return [...ids].sort();
}

const RULE_EXTRACTORS = { 'semgrep-yaml': extractSemgrepRuleIds };

/** Extracts a fetched rulepack archive and writes `<assetPath>.rules.json` beside it. Throws
 *  rather than silently skipping — a rulepack source that cannot be enumerated must fail loud,
 *  not fetch quietly and leave the pack's contents unrecorded. */
export function extractRulepack(assetPath, s) {
  const extract = RULE_EXTRACTORS[s.ruleFormat];
  if (!extract) {
    throw new Error(`${s.id}: kind "rulepack" declares ruleFormat "${s.ruleFormat}", which this `
      + `build cannot extract. Known formats: ${Object.keys(RULE_EXTRACTORS).join(', ')}.`);
  }
  if (!/\.(tar\.gz|tgz)$/i.test(s.asset)) {
    throw new Error(`${s.id}: rulepack extraction only supports .tar.gz/.tgz assets, got "${s.asset}".`);
  }
  const scratch = mkdtempSync(join(tmpdir(), 'cw-rulepack-'));
  try {
    // The -f operand is spelled RELATIVE, with tar run from the asset's own directory.
    //
    // GNU tar parses the archive operand as a possible REMOTE spec — `host:path`, the rsh/rmt
    // syntax — so an absolute Windows path made it try to connect to a host named `C`:
    //   tar (child): Cannot connect to C: resolve failed
    // Rulepack extraction was therefore impossible on any Windows box whose PATH reaches GNU tar,
    // which git-bash puts there by default. `--force-local` would fix GNU tar and is rejected by
    // the bsdtar in Windows' own System32, so it trades one platform for the other. Measured: only
    // the -f operand is parsed this way; -C takes an absolute path unharmed, so it stays as it was.
    execFileSync('tar', ['-xzf', basename(assetPath), '-C', scratch],
      { stdio: 'ignore', cwd: dirname(assetPath) });
    const ruleIds = extract(scratch);
    const manifestPath = `${assetPath}.rules.json`;
    writeFileSync(manifestPath, JSON.stringify({
      extractedAt: new Date().toISOString(), ruleFormat: s.ruleFormat, ruleCount: ruleIds.length, ruleIds,
    }, null, 2));
    return { path: manifestPath, ruleCount: ruleIds.length };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

async function fetchOne(id, into) {
  const doc = loadManifest();
  const s = doc.sources.find((x) => x.id === id);
  if (!s) {
    const known = doc.sources.map((x) => x.id).join(', ');
    throw new Error(`"${id}" is not a declared source. Declared: ${known}\n`
      + `Adding one is an edit to ${manifestPath()} — reviewed as a commit. There is no override flag.`);
  }
  if (!/^[0-9a-f]{64}$/.test(s.sha256 || '')) {
    throw new Error(`${id}: the declaration carries no sha256. Refusing — "no hash" must not be the easy path.`);
  }
  const url = urlFor(s);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${id}: HTTP ${res.status} from ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== s.sha256) {
    // Nothing is written. A mismatch is the one event this tool exists to make loud.
    throw new Error(`${id}: SHA256 MISMATCH — refusing.\n  declared ${s.sha256}\n  received ${got}\n  from     ${url}`);
  }
  const dir = into || cacheDir();
  mkdirSync(dir, { recursive: true });
  const out = join(dir, s.asset);
  writeFileSync(out, buf);
  chmodSync(out, 0o755);

  // Rulepack enumeration runs AFTER the write, over the hash-verified bytes only — never over the
  // network response directly, so a rule count can never be attributed to bytes that failed the
  // sha256 check above.
  let rules = null;
  if (s.kind === 'rulepack') rules = extractRulepack(out, s);

  const rec = appendChain({
    at: new Date().toISOString(), id: s.id, repo: s.repo, tag: s.tag, asset: s.asset,
    sha256: got, publisherChecksums: Boolean(s.publisherChecksums), bytes: buf.length, path: recordedPath(out),
    ...(rules ? { ruleCount: rules.ruleCount, ruleManifestPath: recordedPath(rules.path) } : {}),
  });
  return {
    out, bytes: buf.length, sha256: got, chain: rec.chain, publisherChecksums: Boolean(s.publisherChecksums),
    ...(rules ? { ruleCount: rules.ruleCount, ruleManifestPath: rules.path } : {}),
  };
}

// ── cli ──────────────────────────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const arg = (n) => { const i = argv.indexOf(n); return i > -1 ? argv[i + 1] : null; };

async function main() {
  if (argv.includes('--list')) {
    const doc = loadManifest();
    const { events } = readChain();
    console.log(`${doc.sources.length} declared source(s) in ${manifestPath()}`);
    for (const s of doc.sources) {
      const seen = events.filter((e) => e.id === s.id).length;
      const kind = s.kind === 'rulepack' ? `rulepack(${s.ruleFormat})` : 'binary';
      console.log(`  ${s.id.padEnd(20)} ${s.tag.padEnd(28)} sums=${s.publisherChecksums ? 'yes' : 'NO '} fetches=${seen} kind=${kind}`);
    }
    for (const r of doc.supersededSources?.repos || []) console.log(`  superseded, do not re-adopt: ${r}`);
    return 0;
  }
  if (argv.includes('--verify')) {
    const { events, error, tailTorn, present } = readChain();
    if (error) { console.error(`chain: ${error}`); return 2; }
    if (!present) { console.log('chain: absent — nothing fetched through this tool yet'); return 0; }
    if (tailTorn) { console.error('chain: TORN TAIL — the last append did not complete'); return 2; }
    const v = verifyChain(events);
    if (!v.ok) { console.error(`chain: BROKEN at record ${v.at} — ${v.why}`); return 2; }
    console.log(`chain: intact, ${v.length} record(s), tip ${v.tip.slice(0, 16)}…`);
    return 0;
  }
  const rulesId = arg('--rules');
  if (rulesId) {
    const doc = loadManifest();
    const s = doc.sources.find((x) => x.id === rulesId);
    if (!s) { console.error(`"${rulesId}" is not a declared source.`); return 2; }
    const manifestPath = `${join(cacheDir(), s.asset)}.rules.json`;
    if (!existsSync(manifestPath)) {
      console.error(`no rule manifest at ${manifestPath} — fetch ${rulesId} first (\`--fetch ${rulesId}\`)`);
      return 1;
    }
    const payload = JSON.parse(readFileSync(manifestPath, 'utf8'));
    console.log(`${payload.ruleCount} rule(s), extracted ${payload.extractedAt} (${payload.ruleFormat})`);
    for (const rid of payload.ruleIds) console.log(`  ${rid}`);
    return 0;
  }

  const id = arg('--fetch');
  if (!id) {
    console.error('usage: upstream-fetch.mjs --list | --verify | --fetch <id> [--into <dir>] | --rules <id>');
    return 1;
  }
  const r = await fetchOne(id, arg('--into'));
  console.log(`fetched ${id}: ${r.bytes} bytes -> ${r.out}`);
  console.log(`  sha256 ${r.sha256}`);
  console.log(`  chain  ${r.chain.slice(0, 16)}…`);
  if (r.ruleCount !== undefined) {
    console.log(`  rules  ${r.ruleCount} extracted -> ${r.ruleManifestPath}`);
  }
  if (!r.publisherChecksums) {
    console.log('  NOTE: this release publishes no checksums — the declared hash is a '
      + 'first-observation pin, not a confirmation against the publisher.');
  }
  return 0;
}

if (isMainModule(import.meta.url)) {
  main().then((c) => process.exit(c)).catch((e) => { console.error(`upstream-fetch: ${e.message}`); process.exit(2); });
}
