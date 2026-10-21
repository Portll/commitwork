// bin/lib/deps-ledger.mjs — the dependency-update lifecycle, one JSON line per event: an audit
// snapshot, then proposed / superseded / merged / verified / refused. It names the operator's
// repositories, so it is a private record (monitor/store-paths.mjs, CW_DEPS_LEDGER).
//
// Reads fail closed: ENOENT is "nothing recorded yet"; an unreadable file or a malformed line is an
// error naming the line. A final line without its newline is an append that did not complete — it
// is reported as torn and the rows before it are kept.
import { appendFileSync, readFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { depsLedgerPathFor } from '../../monitor/store-paths.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const LEDGER_VERSION = 1;
export const EVENTS = ['audit', 'proposed', 'superseded', 'merged', 'verified', 'refused'];
export const ledgerPath = () => depsLedgerPathFor(ROOT);

export function appendEvent(event) {
  if (!event || !EVENTS.includes(event.event)) throw new Error(`deps ledger: unknown event ${JSON.stringify(event?.event)}`);
  if (typeof event.at !== 'string' || typeof event.repo !== 'string') throw new Error('deps ledger: at and repo are required');
  const path = ledgerPath();
  // An override may name a fresh dir; the default dir is the private-store link, never created here.
  if (process.env.CW_DEPS_LEDGER) mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  else if (!existsSync(dirname(path))) throw new Error(`deps ledger: the private store ${dirname(path)} is absent; set CW_DEPS_LEDGER to record`);
  appendFileSync(path, `${JSON.stringify({ v: LEDGER_VERSION, ...event })}\n`, { mode: 0o600 });
  return path;
}

export function readLedger(path = ledgerPath()) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); } catch (e) {
    if (e.code === 'ENOENT') return { events: [], absent: true, path };
    return { error: `the deps ledger ${path} could not be read (${e.code || e.message})`, path };
  }
  const lines = raw.split('\n');
  const torn = raw.length > 0 && !raw.endsWith('\n');
  const body = lines.slice(0, -1);
  const events = [];
  for (let i = 0; i < body.length; i++) {
    if (!body[i].trim()) continue;
    let row;
    try { row = JSON.parse(body[i]); } catch (e) { return { error: `the deps ledger ${path} line ${i + 1} is not JSON (${e.message})`, path }; }
    if (!EVENTS.includes(row.event)) return { error: `the deps ledger ${path} line ${i + 1} has unknown event ${JSON.stringify(row.event)}`, path };
    events.push(row);
  }
  return { events, torn: torn ? lines[lines.length - 1].length : 0, path };
}

/** An audit report as a ledger row: what each direct dependency was locked at and what was available or held. */
export function snapshotOf(report) {
  const adv = report.advisories;
  return {
    cooldown: report.cooldown,
    deps: report.deps.map((d) => ({ name: d.name, kind: d.kind, locked: d.locked, lockedPublishedAt: d.lockedPublishedAt,
      latest: d.latest, latestPublishedAt: d.latestPublishedAt, skipped: d.skipped,
      updates: d.updates.map(({ type, version, publishedAt }) => ({ type, version, publishedAt })),
      held: d.held.map(({ type, version, publishedAt, reason }) => ({ type, version, publishedAt, reason })) })),
    advisories: adv.error ? { error: adv.error } : { counts: adv.counts, prod: adv.prod,
      rows: adv.rows.map((r) => ({ name: r.name, severity: r.severity, exposure: r.exposure, fix: r.fix.state })) },
  };
}
