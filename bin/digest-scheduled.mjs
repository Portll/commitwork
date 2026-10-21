#!/usr/bin/env node
// bin/digest-scheduled.mjs — the scheduled digest: write it, deliver it when a destination is configured, record the run.
// `digest.mjs --write` runs as a child; each run ends with one chained record in the scheduled job
// journal, which the next digest's Failed work section reads.
//
// The window chains: --since is the window end of the newest recorded run that wrote a digest, when
// that is under 7 days old, so a late or skipped run leaves no stretch that no digest covered.
// Otherwise the window is the 24 hours before the run.
//
// Destinations are CW_DIGEST_SLACK_URL, CW_DIGEST_WEBHOOK_URL and CW_DIGEST_EMAIL_TO, with email's
// CW_MAIL_TRANSPORT and CW_MAIL_FROM, from the environment or, when unset there, from a ref declared
// in the secrets table (lib/secrets.mjs): a launchd job inherits no shell, and its plist never
// carries a URL or an address. With none of them, delivery is recorded `not-configured`
// (digest-deliver's exit 21) and the run does not fail on it. A declared ref that does not resolve
// is a failed delivery, never an unconfigured one.
//
// usage: node bin/digest-scheduled.mjs
//        node bin/digest-scheduled.mjs --status [--limit <n>]
// exit: 0 the digest was written and delivered, or no destination is configured, or status shown ·
//       20 the digest wrote no document, or could not record a returned warning · 21 a configured
//       delivery failed, was refused or could not be resolved · 22 the run could not be recorded in
//       the job journal, or (--status) the journal is unreadable · 23 usage
// env, read at call time: CW_REPORTS_ROOT (holds the digest, its delivery ledger and the job journal
//   <reports>/scheduled-job-journal.jsonl), CW_NOW, CW_SECRETS_FILE, CW_DIGEST_TIMEOUT_MS, and the
//   inputs bin/digest.mjs reads

import { spawnSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { nowISO } from '../lib/clock.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { resolveInto, secretsFile } from '../lib/secrets.mjs';
import { reportsRootFor } from '../monitor/store-paths.mjs';
import { appendRecord, readJournalFile } from './lib/verdict-journal-core.mjs';
import { JOB_RECORD_KIND, digestBase, jobJournalPath } from './digest.mjs';
import { DESTINATION_ENV, Refused, configuredDestinations, deliverDigest, exitFor, readDigest } from './digest-deliver.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const JOB = 'digest';
export const EXIT = { OK: 0, DIGEST: 20, DELIVERY: 21, UNRECORDED: 22, USAGE: 23 };
const DAY_MS = 24 * 3600 * 1000;
export const MAX_CHAIN_MS = 7 * DAY_MS;
const DIGEST_TIMEOUT_MS = 15 * 60_000;

const lastLine = (s) => String(s || '').trim().split('\n').pop()?.trim().slice(0, 300) || null;
const shown = (p) => {
  const r = relative(REPO, p);
  return r && !r.startsWith('..') && !r.startsWith(sep) ? r.split(sep).join('/') : p;
};

/** The since for a run ending at `until`: the newest written run's window end, or null for the default. */
export function chainedSince(records, until) {
  for (let i = records.length - 1; i >= 0; i--) {
    const r = records[i];
    if (!r || r.kind !== JOB_RECORD_KIND || r.job !== JOB) continue;
    if (!r.steps?.some?.((s) => s?.step === 'write' && s.written === true)) continue;
    const gap = Date.parse(until) - Date.parse(r.window?.until);
    return gap > 0 && gap <= MAX_CHAIN_MS ? r.window.until : null;
  }
  return null;
}

/** What one `digest.mjs --write` run did. `written` is read from the file, never inferred from the exit. */
export function digestStep(r, written) {
  const exit = Number.isInteger(r.status) ? r.status : null;
  const why = r.error ? (r.error.code === 'ETIMEDOUT' ? `timed out after ${DIGEST_TIMEOUT_MS / 60_000} min` : r.error.message)
    : r.signal ? `killed by ${r.signal}` : lastLine(r.stderr);
  const step = { step: 'write', exit, written };
  // 20 is an honest partial document: the not-measured parts are in the digest itself.
  if (written && (exit === 0 || exit === 20)) return { ...step, outcome: exit === 0 ? 'measured' : 'not-all-measured', failed: false };
  if (written && exit === 21) return { ...step, outcome: 'returns-not-recorded', failed: true, reason: why };
  if (!written && (exit === 0 || exit === 20 || exit === 21)) return { ...step, outcome: 'not-written', failed: true, reason: `exited ${exit} but wrote no digest for the window` };
  return { ...step, outcome: written ? 'unexpected-exit' : 'not-written', failed: true, reason: why };
}

// Refused is digest-deliver's own exit 22; any other throw is recorded as a crash with no exit.
export async function deliverStep({ root, env, file, fetchImpl }) {
  const step = { step: 'deliver' };
  let res;
  try { res = resolveInto(DESTINATION_ENV, { env, file: env.CW_SECRETS_FILE ? resolve(env.CW_SECRETS_FILE) : secretsFile() }); } catch (e) {
    return { ...step, exit: null, outcome: 'unresolved', failed: true, reason: String(e.message || e).split('\n')[0] };
  }
  const unresolved = res.missing.filter((m) => m.reason !== 'undeclared').map((m) => `${m.name} is declared but did not resolve (${m.reason})`);
  const dests = configuredDestinations(res.env);
  if (!dests.length && !unresolved.length) return { ...step, exit: 21, outcome: 'not-configured', failed: false };
  if (!dests.length) return { ...step, exit: null, outcome: 'unresolved', failed: true, reason: unresolved.join('; ') };
  let r;
  try { r = await deliverDigest({ root, file, env: res.env, ...(fetchImpl ? { fetchImpl } : {}) }); } catch (e) {
    const refused = e instanceof Refused;
    return { ...step, exit: refused ? 22 : null, outcome: refused ? 'refused' : 'crashed', failed: true, reason: String(e.message || e).split('\n')[0].slice(0, 300) };
  }
  const results = r.results.map((x) => ({ kind: x.kind, target: x.target, state: x.state, ...(x.reason ? { reason: x.reason } : {}) }));
  const failed = r.outcome !== 'delivered' || unresolved.length > 0;
  return { ...step, exit: exitFor(r), outcome: r.outcome, failed, results, ...(unresolved.length ? { reason: unresolved.join('; ') } : {}) };
}

export async function runScheduled({ root = REPO, env = process.env, fetchImpl, log = (s) => process.stdout.write(s), warn = (s) => process.stderr.write(s) } = {}) {
  const until = nowISO(env);
  const journal = jobJournalPath(root);
  let since = null;
  let chainNote = null;
  try { since = chainedSince(readJournalFile(journal).records, until); } catch (e) {
    chainNote = `job journal unreadable (${e.code || e.message}); window not chained`;
  }
  const chained = since !== null;
  if (!chained) since = new Date(Date.parse(until) - DAY_MS).toISOString();

  const file = `${digestBase(until, reportsRootFor(root))}.json`;
  const child = spawnSync(process.execPath, [join(REPO, 'bin', 'digest.mjs'), '--write', '--since', since], {
    cwd: REPO, env: { ...env, CW_NOW: until }, encoding: 'utf8', stdio: ['ignore', 'ignore', 'pipe'], timeout: DIGEST_TIMEOUT_MS,
  });
  if (child.stderr) warn(child.stderr);
  let written = false;
  try { const { doc } = readDigest(file); written = doc.window?.since === since && doc.window?.until === until; } catch { /* not written */ }
  const digest = digestStep(child, written);
  const deliver = written
    ? await deliverStep({ root, env, file, fetchImpl })
    : { step: 'deliver', exit: null, outcome: 'skipped', failed: false, reason: 'no digest was written this run' };

  const exit = digest.failed ? EXIT.DIGEST : deliver.failed ? EXIT.DELIVERY : EXIT.OK;
  const finishedAt = nowISO(env);
  const record = {
    v: 1, kind: JOB_RECORD_KIND, job: JOB, at: finishedAt, startedAt: until, finishedAt,
    window: { since, until, chained, ...(chainNote ? { note: chainNote } : {}) },
    steps: [digest, deliver], exit,
  };
  const w = appendRecord(journal, record);
  const line = `digest-scheduled: window ${since} → ${until}${chained ? ' (chained)' : ''} · write ${digest.outcome} (exit ${digest.exit ?? 'none'})`
    + ` · delivery ${deliver.outcome}${deliver.exit != null ? ` (exit ${deliver.exit})` : ''}`;
  if (!w.ok) {
    warn(`${line}\ndigest-scheduled: this run was NOT recorded in ${shown(journal)} (${w.error}):\n${JSON.stringify(record)}\n`);
    return { code: EXIT.UNRECORDED, record };
  }
  log(`${line} · recorded in ${shown(journal)}\n`);
  for (const s of [digest, deliver]) if (s.failed) warn(`digest-scheduled: ${s.step} FAILED — ${s.reason || s.outcome}\n`);
  return { code: exit, record };
}

export function status({ root = REPO, limit = 10, log = (s) => process.stdout.write(s), warn = (s) => process.stderr.write(s) } = {}) {
  const journal = jobJournalPath(root);
  let j;
  try { j = readJournalFile(journal); } catch (e) {
    warn(`digest-scheduled: job journal unreadable at ${shown(journal)} (${e.code || e.message})\n`);
    return EXIT.UNRECORDED;
  }
  const runs = j.records.filter((r) => r && r.kind === JOB_RECORD_KIND && r.job === JOB);
  if (!runs.length) { log(`no scheduled digest run recorded in ${shown(journal)}\n`); return EXIT.OK; }
  if (j.chain?.broken) log(`caveat: job journal chain broken ×${j.chain.broken}\n`);
  for (const r of runs.slice(-limit)) {
    const steps = Array.isArray(r.steps) ? r.steps : [];
    const failed = steps.filter((s) => s?.failed);
    log(`${r.at}  exit ${r.exit ?? '?'}  ${steps.map((s) => `${s?.step} ${s?.outcome}`).join(' · ')}`
      + `${failed.length ? `  FAILED: ${failed.map((s) => `${s.step} — ${s.reason || s.outcome}`).join('; ')}` : ''}\n`);
  }
  return EXIT.OK;
}

export async function main(argv, opts = {}) {
  if (!argv.length) {
    try { return (await runScheduled(opts)).code; } catch (e) {
      if (!(e instanceof RangeError)) throw e;
      console.error(`digest-scheduled: ${e.message}`);
      return EXIT.USAGE;
    }
  }
  if (argv[0] !== '--status') { console.error(`digest-scheduled: unknown argument ${argv[0]}`); return EXIT.USAGE; }
  let limit = 10;
  const rest = argv.slice(1);
  if (rest.length) {
    if (rest[0] !== '--limit' || rest.length !== 2 || !/^[1-9]\d*$/.test(rest[1])) { console.error('digest-scheduled: --status takes only --limit <positive integer>'); return EXIT.USAGE; }
    limit = Number(rest[1]);
  }
  return status({ ...opts, limit });
}

if (isMainModule(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
