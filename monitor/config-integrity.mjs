// monitor/config-integrity.mjs — item 7, the file-integrity lens.
// runs over the surface git doesn't version and sessions don't routinely edit: 
// the runtime configuration that decides whether the other guards run at all.
//
// git already hashes every tracked file, but this watches the gitignored config layer:
//   hooks      .claude/settings.json + settings.local.json (repo scope), ~/.claude/settings.json
//              (user scope). The touch-ledger hook, the gate hooks, the drift reminders are all
//              REGISTRATIONS in these files. Deleting one line disables an attribution log or a
//              gate without test failure. That is THE self-security hole this lens
//              closes.
//   symlinks   evaluations, .claude/store, .claude/verdicts — the sidecar links. The informative
//              value is the TARGET STRING: a link replaced by a real directory (a checkout does
//              this over an untracked link) or repointed elsewhere means every later durable write
//              lands somewhere nobody reads. Recorded via lstat, so the file-vs-link distinction
//              is the value, not a resolution accident.
//   refs       ~/.commitwork/secrets.json — the credential ref table (pointers only; hashing it
//              stores no secret material).
//
// Same discipline as the sibling lenses: --accept baseline in the sidecar store, added/changed/
// removed findings, ENOENT of a never-pinned path is quiet absence while a VANISHED pinned config
// is a finding, unreadable is unknown and counted, unreadable baseline fails closed.
//
// Env (read at call time): CW_CONFINT_BASELINE, CW_CONFINT_JOURNAL (default: beside the baseline),
// CW_CONFINT_TARGETS (JSON file listing [{path,kind}] — tests run on fixture surfaces),
// CW_CONFINT_HOME, CW_NOW.
//
//   node monitor/config-integrity.mjs [--json]   diff vs baseline; exit 0 ok, 1 findings, 2 grey
//   node monitor/config-integrity.mjs --accept   pin the currently observed surface

import { nowISO } from '../lib/clock.mjs';
import { readFileSync, lstatSync, readlinkSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unknown } from './unknown.mjs';
import { writeAtomic } from './lockfile.mjs';
import { diffPersistence } from './persistence-diff.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const baselinePath = () => process.env.CW_CONFINT_BASELINE || join(REPO, '.claude', 'store', 'config-integrity-baseline.json');
const homeDir = () => process.env.CW_CONFINT_HOME || homedir();
const sha = (s) => createHash('sha256').update(s).digest('hex');

/** The watched surface: config files hashed by content, symlinks recorded by (linkness, target). */
export function surfaceTargets(home = homeDir()) {
  const fixture = process.env.CW_CONFINT_TARGETS;
  if (fixture) {
    const t = JSON.parse(readFileSync(fixture, 'utf8'));
    if (!Array.isArray(t)) throw new Error('CW_CONFINT_TARGETS is not a JSON array');
    return t;
  }
  return [
    { path: join(REPO, '.claude', 'settings.json'), kind: 'config' },
    { path: join(REPO, '.claude', 'settings.local.json'), kind: 'config' },
    { path: join(home, '.claude', 'settings.json'), kind: 'config' },
    { path: join(home, '.commitwork', 'secrets.json'), kind: 'config' },
    { path: join(REPO, 'evaluations'), kind: 'symlink' },
    { path: join(REPO, '.claude', 'store'), kind: 'symlink' },
    { path: join(REPO, '.claude', 'verdicts'), kind: 'symlink' },
  ];
}

export function collectConfigSurface({ home, targets } = {}) {
  const items = [];
  const unknowns = [];
  for (const t of targets || surfaceTargets(home)) {
    if (t.kind === 'symlink') {
      let st;
      try { st = lstatSync(t.path); }
      catch (e) {
        if (e.code === 'ENOENT') continue;               // never present: quiet; pinned-then-gone diffs as removed
        unknowns.push({ id: t.path, kind: t.kind, ...unknown('not-permitted', e.code) });
        continue;
      }
      // The linkness IS the value. A real directory where a link was pinned must hash differently —
      // that is the checkout-restored-over-the-link hazard, and it reads CHANGED, loudly.
      const value = st.isSymbolicLink() ? `link:${readlinkSync(t.path)}` : `not-a-link:${st.isDirectory() ? 'directory' : 'file'}`;
      items.push({ id: t.path, kind: 'symlink', value, sha256: sha(value) });
      continue;
    }
    let raw;
    try { raw = readFileSync(t.path, 'utf8'); }
    catch (e) {
      if (e.code === 'ENOENT') continue;
      unknowns.push({ id: t.path, kind: t.kind, ...unknown('not-permitted', e.code) });
      continue;
    }
    items.push({ id: t.path, kind: 'config', size: Buffer.byteLength(raw), sha256: sha(raw) });
  }
  return { items: items.sort((a, b) => (a.id < b.id ? -1 : 1)), unknowns };
}

/** ENOENT is "no baseline yet"; anything else THROWS. */
export function readBaseline() {
  let raw;
  try { raw = readFileSync(baselinePath(), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  const b = JSON.parse(raw);
  if (!b || !Array.isArray(b.items)) throw new Error('baseline has no items[]');
  return b;
}

// guard: a pin without a journal row is a finding
const journalPath = () => process.env.CW_CONFINT_JOURNAL || join(dirname(baselinePath()), 'config-integrity-journal.jsonl');

/** ENOENT is "no journal yet"; anything else THROWS. */
export function readJournal() {
  let raw;
  try { raw = readFileSync(journalPath(), 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  return raw.split('\n').filter(Boolean).map((line) => ({ sha256: sha(line), row: JSON.parse(line) }));
}

function journalState(baseline) {
  if (!baseline) return { state: 'no-baseline' };
  const journal = readJournal();
  if (!baseline.journal) return journal === null ? { state: 'legacy' } : { state: 'unjournaled', why: 'baseline references no journal row while a journal exists' };
  const hit = (journal || []).find((j) => j.sha256 === baseline.journal.sha256);
  if (!hit) return { state: 'unjournaled', why: `baseline references journal row ${baseline.journal.sha256.slice(0, 12)} which the journal does not contain` };
  return { state: 'journaled', who: hit.row.who, why: hit.row.why, at: hit.row.at };
}

export function runLens(opts = {}) {
  const baseline = readBaseline();
  const observed = collectConfigSurface(opts);
  const diff = diffPersistence(observed, baseline);
  if (baseline) {
    const base = new Map(baseline.items.map((i) => [i.id, i]));
    for (const c of diff.changed) c.was = base.get(c.id) ?? null;
  }
  const journal = journalState(baseline);
  const state = journal.state === 'unjournaled' && diff.state === 'ok' ? 'findings' : diff.state;
  return { at: nowISO(), baselineAt: baseline?.at ?? null, items: observed.items.length, ...diff, state, journal };
}

export function repin({ who, why } = {}, opts = {}) {
  const w = String(who || '').trim(), y = String(why || '').trim();
  if (!w || !y) throw new Error('repin requires who and why — a pin nobody signed is the laundering this journal exists to refuse');
  const observed = collectConfigSurface(opts);
  const at = nowISO();
  const line = JSON.stringify({ at, who: w, why: y, items: observed.items.length, surface: sha(JSON.stringify(observed.items)) });
  appendFileSync(journalPath(), `${line}\n`);
  const doc = { at, items: observed.items, journal: { sha256: sha(line), who: w, why: y } };
  writeAtomic(baselinePath(), `${JSON.stringify(doc, null, 2)}\n`);
  return { path: baselinePath(), journal: journalPath(), pinned: observed.items.length, unknowns: observed.unknowns };
}

export function acceptBaseline(opts = {}) {
  return repin({ who: opts.who || process.env.USER || 'operator', why: opts.why || '--accept' }, opts);
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (isMainModule(import.meta.url)) {
  if (process.argv.includes('--help')) {
    console.log('node monitor/config-integrity.mjs [--json]   diff the hook/settings/symlink surface vs the accepted baseline\n'
      + 'node monitor/config-integrity.mjs --accept   pin the currently observed surface (the human act)\n'
      + 'exit 0 ok, 1 findings (a config changed/vanished, a sidecar link repointed or replaced), 2 grey');
    process.exit(0);
  }
  if (process.argv.includes('--accept')) {
    const a = acceptBaseline();
    console.log(`pinned ${a.pinned} item(s) → ${a.path}`);
    for (const u of a.unknowns) console.log(`  NOT pinned (${u.unknownReason}): ${u.id}`);
    process.exit(0);
  }
  const r = runLens();
  if (process.argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    console.log(`config-integrity: ${r.state}  (${r.items} item(s), baseline ${r.baselineAt ?? 'NONE — run --accept to pin'})`);
    if (r.journal.state === 'journaled') console.log(`  pinned by ${r.journal.who} (${r.journal.why}) at ${r.journal.at}`);
    if (r.journal.state === 'unjournaled') console.log(`  UNJOURNALED PIN  ${r.journal.why}  ⚠ a pin nobody signed is the laundered-change shape`);
    if (r.journal.state === 'legacy') console.log('  baseline predates the journal — the next --accept signs it');
    for (const i of r.added) console.log(`  ADDED    ${i.kind}  ${i.id}`);
    for (const i of r.changed) console.log(`  CHANGED  ${i.kind}  ${i.id}${i.kind === 'symlink' && i.was ? `  (${i.was.value} → ${i.value})` : ''}`);
    for (const i of r.removed) console.log(`  REMOVED  ${i.kind}  ${i.id}  ⚠ a pinned config vanishing is the disabled-guard shape`);
    for (const u of r.unknowns) console.log(`  UNKNOWN  ${u.kind}  ${u.id} (${u.unknownReason})`);
  }
  process.exit(r.state === 'findings' ? 1 : r.state === 'ok' ? 0 : 2);
}
