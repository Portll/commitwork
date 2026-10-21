#!/usr/bin/env node
// mcp/emission-ledger.mjs — the record of injection-shaped text the MCP job tools saw.
//
// One row per detector signal: { v, at, jobId, tool, source, rule, span }. `source` is `input` (the
// request's arguments) or `output` (the run's result and log). `span` is a short hash of the matched
// text, never the text: that text is attacker-controlled and may carry a secret, and an audit record
// must not become the place it is kept. A signal is descriptive, never a severity; a row records
// that something was seen, not a finding.
//
// Rows are chained by bin/lib/touch-chain.mjs, so an edited or removed row breaks its successor's
// link. The last row and a truncated tail are outside any chain's reach.
//
// usage: node mcp/emission-ledger.mjs --verify [--json]
//        node mcp/emission-ledger.mjs --job <jobId> [--json]
// exit: 0 chain verified, or the job's rows counted · 20 chain broken or a row torn · 21 ledger absent
//       or empty, nothing verified · 22 ledger unreadable · 23 usage
// env, read at call time: CW_MCP_EMISSIONS (the ledger, default monitor/private/mcp-emissions.jsonl),
//       CW_NOW (the row timestamp)

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chainedAppend, verifyLedgerChain } from '../bin/lib/touch-chain.mjs';
import { generations } from '../bin/lib/ledger-rotate.mjs';
import { mcpEmissionsPathFor } from '../monitor/store-paths.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export const ROW_VERSION = 1;
export const EXIT = Object.freeze({ OK: 0, BROKEN: 20, ABSENT: 21, UNREADABLE: 22, USAGE: 23 });

export const emissionsPath = () => mcpEmissionsPathFor(ROOT);

// Domain-separated, so a span hash never equals a line hash or fence tag taken over the same bytes.
export const spanHash = (text) => createHash('sha256').update(`mcp-emission-span\0${String(text ?? '')}`).digest('hex').slice(0, 16);

/**
 * Append one chained row per signal. Never throws: a row that did not land is counted in `failed`
 * with its error, so a job never reports a signal as recorded that is not on disk.
 * @param {{jobId: string, tool: string, source: 'input'|'output', signals?: {id: string, match?: string, span?: string}[], path?: string}} o
 * @returns {{rows: number, chained: number, unlinked: number, failed: number, errors?: string[]}}
 */
export function recordSignals({ jobId, tool, source, signals = [], path }) {
  const out = { rows: 0, chained: 0, unlinked: 0, failed: 0 };
  if (!signals.length) return out;
  let at; let file;
  try {
    at = (process.env.CW_NOW ? new Date(process.env.CW_NOW) : new Date()).toISOString();
    file = path || emissionsPath();
  } catch (e) {
    return { ...out, failed: signals.length, errors: [`not recorded: ${e.message}`] };
  }
  const errors = [];
  for (const s of signals) {
    const w = chainedAppend(file, { v: ROW_VERSION, at, jobId, tool, source, rule: s.id, span: s.span || spanHash(s.match) });
    if (w.ok) { out.rows++; out[w.mode === 'chained' ? 'chained' : 'unlinked']++; } else { out.failed++; errors.push(String(w.error)); }
  }
  return errors.length ? { ...out, errors } : out;
}

/** The chain verdict across every generation. Throws on anything but ENOENT. */
export const verifyEmissions = (path = emissionsPath()) => verifyLedgerChain(path);

/**
 * Rows recorded for one job, across every generation. A torn line is counted, never skipped
 * silently; anything but ENOENT throws.
 * @returns {{state: 'absent'|'present', rows: number, torn: number}}
 */
export function rowsForJob(jobId, path = emissionsPath()) {
  let present = false; let rows = 0; let torn = 0;
  for (const p of generations(path)) {
    let raw;
    try { raw = readFileSync(p, 'utf8'); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    present = true;
    for (const line of raw.split('\n')) {
      if (!line) continue;
      let r;
      try { r = JSON.parse(line); } catch { torn++; continue; }
      if (r?.jobId === jobId) rows++;
    }
  }
  return { state: present ? 'present' : 'absent', rows, torn };
}

export function main(argv = process.argv.slice(2), { stdout = process.stdout, stderr = process.stderr } = {}) {
  const json = argv.includes('--json');
  const at = argv.indexOf('--job');
  const job = at >= 0 ? argv[at + 1] : null;
  const verify = argv.includes('--verify');
  const rest = argv.filter((a, i) => !['--json', '--verify', '--job'].includes(a) && !(at >= 0 && i === at + 1));
  if (rest.length || verify === (at >= 0) || (at >= 0 && (!job || job.startsWith('--')))) {
    stderr.write('usage: node mcp/emission-ledger.mjs --verify [--json] | --job <jobId> [--json]\n');
    return EXIT.USAGE;
  }
  const path = emissionsPath();
  let r;
  try { r = job ? rowsForJob(job, path) : verifyEmissions(path); } catch (e) {
    stderr.write(`emission ledger UNREADABLE (${e.code || e.message}) at ${path} — not verified\n`);
    return EXIT.UNREADABLE;
  }
  if (json) stdout.write(`${JSON.stringify({ path, ...r }, null, 2)}\n`);
  if (job) {
    if (!json) stdout.write(`emission ledger: ${r.state === 'absent' ? 'absent' : `${r.rows} row(s) for ${job}${r.torn ? `, ${r.torn} torn line(s) unread` : ''}`}  (${path})\n`);
    return r.state === 'absent' ? EXIT.ABSENT : r.torn ? EXIT.BROKEN : EXIT.OK;
  }
  const t = r.totals;
  if (!json) {
    stdout.write(`emission ledger chain: ${r.state}  (${path})\n`
      + `  examined ${t.examined} — verified ${t.verified}, unlinked ${t.unlinked}, unchained ${t.unchained}, `
      + `raced ${t.raced}, renumbered ${t.renumbered}, broken ${t.broken}, torn ${t.torn}\n`);
    for (const b of r.breaks) stdout.write(`  BREAK at ${b.path} row ${b.line} — ${b.why}\n`);
  }
  if (r.state === 'chain-broken' || r.state === 'torn') return EXIT.BROKEN;
  return r.state === 'absent' || t.examined === 0 ? EXIT.ABSENT : EXIT.OK;
}

if (isMainModule(import.meta.url)) process.exitCode = main();
