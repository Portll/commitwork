#!/usr/bin/env node
// monitor/resolution-chain.mjs — the resolution CHAIN, perpetuated into a durable log.
//
// WHAT A CHAIN IS AND WHY IT IS THE UNIT. Fetching one Gradle distribution touched three hosts:
//
//     services.gradle.org  ->  github.com  ->  release-assets.githubusercontent.com
//
// No single one of those is "the download". That was found on 2026-08-27 by allowing one hop and
// watching the next get denied, and a host list written from a DESCRIPTION of the download rather
// than from watching it would have been wrong twice. The chain — the ordered set of hosts a
// resolution actually traversed — is a fact about how an artifact reaches this fleet, and it is
// exactly the fact that changes silently when an upstream reorganises its CDN, adds a mirror, or
// is compromised.
//
// A per-run proxy log answers "what happened this time". It cannot answer "has this changed", and
// that second question is the only one a chain is useful for. So the chain is recorded, hashed and
// appended, and a run whose chain differs from what this repo has seen before SAYS SO.
//
// HASH-CHAINED, AND WHAT THAT DOES AND DOES NOT BUY. Each record carries `prev`, the hash of the
// line before it, so an interior edit breaks the chain and is visible. That proves nobody rewrote
// the record. It does NOT prove the record was ever written — an omitted run leaves no gap to find,
// which is why `runs` is counted per repo and a repo whose count stops advancing is its own signal.
// The distinction is borrowed from bin/verdict-journal.mjs, which learned it the same way.
//
// THIS FILE JUDGES NOTHING. A changed chain is reported as changed. Whether a new CDN hostname is
// an upstream's ordinary infrastructure change or something worse is not a question a diff can
// answer, and answering it here would be the unsupported finding defect with a new costume.
//
// usage: node monitor/resolution-chain.mjs record <repo> <access.log> [--out <path>]
//        node monitor/resolution-chain.mjs report [--json] [--out <path>]
//   env: CW_CHAIN_LOG   the ledger (default .claude/store/resolution-chains.jsonl)
//        CW_NOW         pins `at`

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unknown } from './unknown.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const isMain = isMainModule(import.meta.url);

export const chainLogPath = () => process.env.CW_CHAIN_LOG || join(REPO, '.claude', 'store', 'resolution-chains.jsonl');

const lineHash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 32);

/**
 * Parse a squid access log into the chain: which hosts were reached, which refused, in the order
 * first seen. Order matters — it is what makes a redirect chain legible as a chain rather than as
 * an unordered set of hosts that happened to be contacted.
 */
export function parseChain(text) {
  const reached = [];
  const refused = [];
  const seen = new Set();
  let lines = 0;

  for (const raw of String(text).split('\n')) {
    if (!raw.trim()) continue;
    lines += 1;
    const cols = raw.split(/\s+/);
    // squid native: time elapsed client action/status bytes method URL ...
    const action = cols[3] || '';
    const target = (cols[6] || '').replace(/:443$/, '');
    if (!target) continue;
    const key = `${action.includes('DENIED') ? 'deny' : 'allow'}:${target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (action.includes('DENIED')) refused.push(target);
    else if (/TUNNEL|TCP_MISS|TCP_HIT|TCP_REFRESH/.test(action)) reached.push(target);
  }
  return { reached, refused, logLines: lines };
}

/**
 * The chain's identity. Hosts REACHED, in order — refusals are recorded but excluded from the
 * identity, because a denial says what this fleet's policy is today and not what the upstream
 * serves. Fold policy into the identity and every allowlist edit looks like the upstream moved.
 */
export const chainId = (reached) => lineHash(reached.join('>'));

/** Read the ledger. ENOENT is absence; anything else fails closed. */
export function readChains(path = chainLogPath()) {
  let raw;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return { ok: true, records: [], fresh: true };
    return unknown('not-permitted', `${path}: ${e.code || e.message}`);
  }
  const records = [];
  let malformed = 0;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { records.push(JSON.parse(line)); } catch { malformed += 1; }
  }
  // A malformed line is not skipped silently: the ledger is the evidence, and an evidence file
  // that partly failed to parse must not read as a shorter but intact one.
  return { ok: true, records, malformed, fresh: false };
}

/** Chain integrity: each `prev` must equal the hash of the line before it. */
export function verifyChain(records) {
  let prev = 'genesis';
  for (let i = 0; i < records.length; i += 1) {
    if (records[i].prev !== prev) {
      return { intact: false, brokeAt: i, expected: prev, found: records[i].prev ?? null };
    }
    prev = lineHash(JSON.stringify({ ...records[i], hash: undefined }));
  }
  return { intact: true, records: records.length };
}

/**
 * Record one run. Returns the record plus what CHANGED against the last chain seen for this repo —
 * the only reason to keep a ledger rather than a log.
 */
export function recordRun({ repo, reached, refused, distribution = null, pinnedArtifacts = null, path = chainLogPath() }) {
  const existing = readChains(path);
  const records = existing.ok ? existing.records : [];
  const prior = records.filter((r) => r.repo === repo);
  const last = prior.at(-1) || null;

  const id = chainId(reached);
  const changed = last ? last.chainId !== id : false;
  const newHosts = last ? reached.filter((h) => !(last.reached || []).includes(h)) : [];
  const goneHosts = last ? (last.reached || []).filter((h) => !reached.includes(h)) : [];

  const prev = records.length
    ? lineHash(JSON.stringify({ ...records[records.length - 1], hash: undefined }))
    : 'genesis';

  const record = {
    at: process.env.CW_NOW || new Date().toISOString(),
    repo,
    chainId: id,
    reached,
    refused,
    distribution,
    pinnedArtifacts,
    runOrdinal: prior.length + 1,
    // FIRST SIGHTING IS NOT A CHANGE. A repo's first record has nothing to differ from, and
    // reporting it as changed would make every new repo look like an event.
    firstSighting: !last,
    changed,
    newHosts,
    goneHosts,
    prev,
  };
  record.hash = lineHash(JSON.stringify({ ...record, hash: undefined }));

  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(record)}\n`);
  return record;
}

/** Every repo's current chain and how often it has moved. */
export function summarise(records) {
  const byRepo = new Map();
  for (const r of records) {
    if (!byRepo.has(r.repo)) byRepo.set(r.repo, { repo: r.repo, runs: 0, changes: 0, chains: new Set(), last: null });
    const e = byRepo.get(r.repo);
    e.runs += 1;
    if (r.changed) e.changes += 1;
    e.chains.add(r.chainId);
    e.last = r;
  }
  return [...byRepo.values()]
    .map((e) => ({
      repo: e.repo, runs: e.runs, changes: e.changes, distinctChains: e.chains.size,
      reached: e.last.reached, refused: e.last.refused, lastAt: e.last.at,
    }))
    .sort((a, b) => b.changes - a.changes || (a.repo < b.repo ? -1 : 1));
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────

function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];
  const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
  const path = flag('--out') || chainLogPath();

  if (cmd === 'record') {
    const repo = argv[1];
    const logPath = argv[2];
    if (!repo || !logPath) { console.error('usage: resolution-chain.mjs record <repo> <access.log>'); process.exitCode = 2; return; }
    let text = '';
    try { text = readFileSync(logPath, 'utf8'); } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      console.error(`resolution-chain: ${logPath} is absent — recording an EMPTY chain would assert this run reached nothing, which is not the same as not knowing`);
      process.exitCode = 1; return;
    }
    const { reached, refused } = parseChain(text);
    const rec = recordRun({ repo, reached, refused, path });
    console.log(`resolution-chain: ${repo} run ${rec.runOrdinal} — ${reached.length} host(s) reached, ${refused.length} refused`);
    if (rec.firstSighting) console.log(`  first sighting: ${reached.join(' -> ') || '(none)'}`);
    else if (rec.changed) {
      console.log(`  CHAIN CHANGED  ${rec.newHosts.length ? `new: ${rec.newHosts.join(', ')}` : ''}${rec.goneHosts.length ? `  gone: ${rec.goneHosts.join(', ')}` : ''}`);
      console.log('  a changed chain is reported, not judged — an upstream reorganising its CDN and something worse look identical here');
    } else console.log('  unchanged');
    return;
  }

  if (cmd === 'report') {
    const r = readChains(path);
    if (r.unknown) { console.error(`resolution-chain: ${r.unknownDetail}`); process.exitCode = 2; return; }
    const integrity = verifyChain(r.records);
    const rows = summarise(r.records);
    if (argv.includes('--json')) { console.log(JSON.stringify({ integrity, malformed: r.malformed ?? 0, repos: rows }, null, 2)); return; }

    console.log(`resolution-chain: ${r.records.length} record(s) over ${rows.length} repo(s) — ${path}`);
    if (!integrity.intact) {
      console.log(`  CHAIN BROKEN at record ${integrity.brokeAt}: expected prev ${integrity.expected}, found ${integrity.found}.`);
      console.log('  Someone edited the ledger. This proves tampering, and proves nothing about runs that were never recorded.');
    }
    if (r.malformed) console.log(`  ${r.malformed} malformed line(s) — the ledger is partly unreadable, which is not the same as shorter`);
    for (const row of rows) {
      console.log(`  ${row.repo.padEnd(30)} runs ${String(row.runs).padStart(3)}  chains ${row.distinctChains}  changes ${row.changes}`);
      console.log(`      reached: ${row.reached.join(' -> ') || '(none)'}`);
      if (row.refused.length) console.log(`      refused: ${row.refused.join(', ')}`);
    }
    if (!r.records.length) console.log('  no records yet — that is an empty ledger, not a fleet that reached nothing');
    return;
  }

  console.error('usage: resolution-chain.mjs record <repo> <access.log> | report [--json]');
  process.exitCode = 2;
}

if (isMain) main();
