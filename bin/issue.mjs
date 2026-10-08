#!/usr/bin/env node
// bin/issue.mjs — issue tracker CLI fronting monitor/issue-store.mjs.
// Auto-close is evidence-gated: a scan going quiet never closes an issue, and an unscanned area
// is never touched (explicit uncertainty).
//
// usage:
//   node bin/issue.mjs new --area A --title T --sev crit|high|med|low [--repo R] [--kind K]
//                          [--body B] [--remediation R] [--authority-required]
//   node bin/issue.mjs list [--area A] [--state S] [--suspect] [--json]
//   node bin/issue.mjs ready [--area A] [--limit N] [--json]
//   node bin/issue.mjs show <id> [--json]
//   node bin/issue.mjs claim <id> --by NAME [--session SID]
//   node bin/issue.mjs release <id>
//   node bin/issue.mjs close <id> --as fixed|accepted|refuted|superseded --evidence "…"
//                          [--session SID] [--force]
//   node bin/issue.mjs link <id> (--blocks <id2> | --duplicate-of <id2> | --supersedes <id2>)
//   node bin/issue.mjs ingest (--area A | --all) [--queue <queue.json>] [--dry-run] [--no-anchors] [--json]
//   node bin/issue.mjs unsatisfiable [--write] [--json]          (reader: lists, --write assigns)
//   node bin/issue.mjs unsatisfiable <id> --reason "…" [--by NAME] (manual)
//   node bin/issue.mjs verify
//   node bin/issue.mjs gc
//
// exit: 0 ok · 2 usage / unknown id · 3 store verify failed · 4 stale or unscanned evidence
//       · 5 claim conflict
//
// env: CW_ISSUES (store path) · CW_ISSUE_SCHEMA · CW_NOW (deterministic clock) ·
//      CW_ISSUE_MIN_SEV · CW_ISSUE_STALE_HOURS · CW_ISSUE_CLAIM_TTL_HOURS

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  loadIssues, saveIssues, withIssuesLock as lockStore, issuesPath, nowISO,
  mintIssue, claimIssue, releaseIssue, closeIssue, reopenIssue, linkIssues, gcIssues,
  markUnsatisfiable, findUnsatisfiable,
  readyIssues, verifyChain, ingestQueue, identityProblems, reindexByKey,
  normaliseSeverity, SEV_RANK, ISSUE_STATES, CLOSED_AS, ISS_RE,
} from '../monitor/issue-store.mjs';
import { ingestArea } from '../monitor/issue-ingest.mjs';
import { CLASS } from '../monitor/issue-key.mjs';
import { loadRegistry, allAreas, ownArea, registryPath, isExampleRegistry } from '../monitor/registry.mjs';
import { resolvePaths, loadJSON } from '../cra/lib.mjs';
import { isMainModule } from '../lib/is-main.mjs';

// fact: ~5s — a CLI waits out a re-key rather than refusing; blocking its own process costs nobody else
const withIssuesLock = (fn) => lockStore(fn, { attempts: 250 });

const args = process.argv.slice(2);
const cmd = args[0];
const flag = (n, def) => { const i = args.indexOf(n); return i === -1 ? def : args[i + 1]; };
const has = (k) => args.includes(k);
// flag-value-aware positional extraction: `claim ISS-000001 --by loop` → positional 0 = ISS-000001
const VALUE_FLAGS = new Set(['--area', '--title', '--sev', '--repo', '--kind', '--body', '--remediation',
  '--state', '--limit', '--by', '--session', '--as', '--evidence', '--blocks', '--duplicate-of',
  '--supersedes', '--queue', '--reason']);
function isFlagValue(i) { return i > 0 && VALUE_FLAGS.has(args[i - 1]); }
function positionals() {
  const out = [];
  for (let i = 1; i < args.length; i++) {
    if (args[i].startsWith('--')) continue;
    if (isFlagValue(i)) continue;
    out.push(args[i]);
  }
  return out;
}

const die = (msg, code = 2) => { process.stderr.write(msg + '\n'); process.exitCode = code; };
const emit = (obj) => process.stdout.write(JSON.stringify(obj, null, 2) + '\n');

function requireId() {
  const id = positionals()[0];
  if (!id || !ISS_RE.test(id)) { die(`expected an issue id (ISS-XXXXXX), got '${id ?? ''}'`); return null; }
  return id;
}

async function repoPathMap(reg) {
  // Resolution failure degrades to "no anchors", never a crash.
  try {
    const { resolveRepos } = await import('../monitor/discover.mjs');
    const out = {};
    for (const r of resolveRepos(reg, {}).repos) if (r.path) out[r.name] = r.path;
    return out;
  } catch { return {}; }
}

const sevGlyph = { crit: '🟥', high: '🟧', med: '🟨', low: '🟩', unknown: '⬜' };
function printRow(i) {
  const claim = i.claim ? ` ⛏ ${i.claim.by}` : '';
  const sus = i.suspect ? ' ⚠︎suspect' : '';
  const auth = i.authorityRequired ? ' 🔒authority' : '';
  const unsat = i.state === 'unsatisfiable' && i.unsatisfiable ? ` — ${i.unsatisfiable.code}: ${i.unsatisfiable.reason}` : '';
  process.stdout.write(`${sevGlyph[i.severity] || '⬜'} ${i.id}  ${i.state.padEnd(7)} ${i.severity.padEnd(7)} ${i.area.padEnd(18)} ${i.title}${claim}${sus}${auth}${unsat}\n`);
}

async function main() {
  const now = nowISO();

  if (cmd === 'new') {
    const area = flag('--area'), title = flag('--title'), sev = flag('--sev');
    if (!area || !title || !sev) return die('new requires --area, --title, --sev');
    if (!ownArea(area)) return die(`'${area}' is not a valid area slug`);
    // A manual issue has no scanner to infer a class from — the filer must state it.
    const cls = String(flag('--class', '') || '').toUpperCase();
    if (!cls) {
      return die('new requires --class: S security · F functionality · U user experience · D data · C customer-raised');
    }
    if (!Object.hasOwn(CLASS, cls)) return die(`--class '${cls}' is not one of ${Object.keys(CLASS).join('/')}`);
    withIssuesLock(() => {
      const doc = loadIssues();
      const { id } = mintIssue(doc, {
        area, title, severity: normaliseSeverity(sev), class: cls,
        repo: flag('--repo', null), kind: flag('--kind', 'task'),
        body: flag('--body', null), remediation: flag('--remediation', null),
        authorityRequired: has('--authority-required'),
        source: { kind: 'manual', key: null, tool: null, rule: null },
      }, now);
      saveIssues(doc);
      process.stdout.write(id + '\n');
    });
    return;
  }

  if (cmd === 'list' || cmd === 'ready') {
    const doc = loadIssues();
    const area = flag('--area', null);
    let rows;
    if (cmd === 'ready') {
      rows = readyIssues(doc, { area, now, limit: +(flag('--limit', 'Infinity')) || Infinity });
    } else {
      rows = Object.values(doc.issues).filter((i) =>
        (!area || i.area === area)
        && (!flag('--state') || i.state === flag('--state'))
        && (!has('--suspect') || i.suspect));
      rows.sort((a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0) || a.id.localeCompare(b.id));
    }
    // explicit uncertainty: an empty list for a never-ingested area must read as never-ingested, not clean.
    const areaStatus = {};
    for (const a of area ? [area] : [...new Set(rows.map((r) => r.area))]) {
      areaStatus[a] = doc.lastIngest[a] ? { ...doc.lastIngest[a] } : 'never-ingested';
    }
    if (has('--json')) return emit({ generated: now, areaStatus, count: rows.length, issues: rows });
    for (const [a, st] of Object.entries(areaStatus)) {
      process.stdout.write(`area ${a}: ${st === 'never-ingested' ? 'NEVER INGESTED (explicit uncertainty)' : `last ingest ${st.sliceId}`}\n`);
    }
    rows.forEach(printRow);
    if (!rows.length) process.stdout.write('(no matching issues — check areaStatus above before reading this as clean)\n');
    return;
  }

  if (cmd === 'show') {
    const id = requireId(); if (!id) return;
    const doc = loadIssues();
    const iss = doc.issues[id];
    if (!iss) return die(`unknown issue ${id}`);
    const events = doc.events.filter((e) => e.issueId === id);
    if (has('--json')) return emit({ issue: iss, events });
    emit({ issue: iss, events });
    return;
  }

  if (cmd === 'claim') {
    const id = requireId(); if (!id) return;
    const by = flag('--by');
    if (!by) return die('claim requires --by NAME');
    try {
      withIssuesLock(() => {
        const doc = loadIssues();
        claimIssue(doc, id, { by, sessionId: flag('--session', `cli-${by}`), at: now });
        saveIssues(doc);
        process.stdout.write(`${id} claimed by ${by}\n`);
      });
    } catch (e) { return die(e.message, e.code === 'CLAIM_CONFLICT' ? 5 : 2); }
    return;
  }

  if (cmd === 'reopen') {
    // Exit from `blocked` or `unsatisfiable` (or manual exit from `closed`): back to open, blockedReason cleared, SLA re-cut.
    const id = requireId(); if (!id) return;
    withIssuesLock(() => {
      const doc = loadIssues();
      if (!doc.issues[id]) return die(`unknown issue ${id}`);
      reopenIssue(doc, id, { at: now, reason: flag('--reason', 'manual reopen') });
      saveIssues(doc);
      process.stdout.write(`${id} reopened\n`);
    });
    return;
  }

  if (cmd === 'release') {
    const id = requireId(); if (!id) return;
    withIssuesLock(() => {
      const doc = loadIssues();
      if (!doc.issues[id]) return die(`unknown issue ${id}`);
      releaseIssue(doc, id, { at: now });
      saveIssues(doc);
      process.stdout.write(`${id} released\n`);
    });
    return;
  }

  if (cmd === 'close') {
    const id = requireId(); if (!id) return;
    const as = flag('--as'), evidence = flag('--evidence');
    if (!as || !CLOSED_AS.includes(as)) return die(`close requires --as ${CLOSED_AS.join('|')}`);
    if (!evidence) return die('close requires --evidence "…" — a close without evidence is an assertion, not a closure');
    try {
      withIssuesLock(() => {
        const doc = loadIssues();
        closeIssue(doc, id, { as, evidence, sessionId: flag('--session', null), force: has('--force'), at: now });
        saveIssues(doc);
        process.stdout.write(`${id} closed (${as})\n`);
      });
    } catch (e) { return die(e.message, e.code === 'CLAIM_CONFLICT' ? 5 : 2); }
    return;
  }

  if (cmd === 'link') {
    const id = requireId(); if (!id) return;
    const blocks = flag('--blocks', null), duplicateOf = flag('--duplicate-of', null), supersedes = flag('--supersedes', null);
    if (!blocks && !duplicateOf && !supersedes) return die('link requires --blocks, --duplicate-of or --supersedes');
    try {
      withIssuesLock(() => {
        const doc = loadIssues();
        linkIssues(doc, id, { blocks, duplicateOf, supersedes, at: now });
        saveIssues(doc);
        process.stdout.write(`${id} linked\n`);
      });
    } catch (e) { return die(e.message); }
    return;
  }

  if (cmd === 'ingest') {
    const one = flag('--area', null), all = has('--all'), queuePath = flag('--queue', null);
    if (!one && !all && !queuePath) return die('ingest requires --area <slug>, --all, or --queue <path>');
    const dryRun = has('--dry-run');
    const summaries = [];
    // Repo-path discovery walks the filesystem — keep it outside the lock (load→mutate→save only).
    const reg = (one || all) ? loadRegistry({ quiet: true }) : null;
    const repoPaths = (reg && !has('--no-anchors')) ? await repoPathMap(reg) : {};
    withIssuesLock(() => {
      const doc = loadIssues();
      if (one || all) {
        const slugs = all ? allAreas(reg) : [one];
        for (const slug of slugs) {
          const paths = resolvePaths({ area: slug });
          const rollup = loadJSON(paths.rollup, null);
          const ledger = loadJSON(paths.ledger, null);
          const annotations = loadJSON(paths.annotations, []);
          summaries.push(ingestArea(doc, {
            areaSlug: slug, rollup, ledger,
            annotations: Array.isArray(annotations) ? annotations : (annotations?.annotations || []),
            repoPaths, now, dryRun,
          }));
        }
      }
      if (queuePath) {
        const queue = JSON.parse(readFileSync(resolve(queuePath), 'utf8'));
        summaries.push({ area: '(queue)', ...ingestQueue(doc, { queue, area: one, now, dryRun }) });
      }
      if (!dryRun) saveIssues(doc);
    });
    if (has('--json')) emit({ generated: now, dryRun, summaries });
    else for (const s of summaries) {
      process.stdout.write(`${(s.area || '?').padEnd(20)} ${s.status.padEnd(13)} +${s.created?.length ?? 0} new · ${s.reopened?.length ?? 0} reopened · ${s.closed?.length ?? 0} auto-closed · ${s.suspect?.length ?? 0} suspect · ${s.carried ?? 0} carried\n`);
      for (const u of s.unkeyable || []) process.stdout.write(`  unkeyable — no q-<sha8> id, not filed: ${u}\n`);
      for (const u of s.unclassified || []) process.stdout.write(`  unclassified — not filed: ${u}\n`);
    }
    // stale/unscanned evidence is exit 4 — the void is a state, not a pass
    if (summaries.some((s) => s.status && s.status !== 'ok')) process.exitCode = 4;
    return;
  }

  if (cmd === 'unsatisfiable') {
    const id = positionals()[0];
    if (id) {
      if (!ISS_RE.test(id)) return die(`expected an issue id (ISS-XXXXXX), got '${id}'`);
      const reason = flag('--reason');
      if (!reason) return die('unsatisfiable <id> requires --reason "…" — an item leaves the queue with its reason');
      try {
        withIssuesLock(() => {
          const doc = loadIssues();
          markUnsatisfiable(doc, id, { code: 'manual', reason, by: flag('--by', null), at: now });
          saveIssues(doc);
          process.stdout.write(`${id} unsatisfiable\n`);
        });
      } catch (e) { return die(e.message, e.code === 'CLAIM_CONFLICT' ? 5 : 2); }
      return;
    }
    const { SCANNER_SPECS } = await import('../monitor/extractors.mjs');
    const categories = new Set(SCANNER_SPECS.map(([k]) => k));
    // The shipped example registry names demonstration areas; judging the store against it would
    // retire every real area, so it measures nothing. A registry that fails to load throws.
    const areas = isExampleRegistry(registryPath()) ? null : new Set(allAreas(loadRegistry({ quiet: true })));
    const write = has('--write');
    let out;
    withIssuesLock(() => {
      const doc = loadIssues();
      out = findUnsatisfiable(doc, { categories, areas });
      if (!write || !out.assign.length) return;
      for (const a of out.assign) markUnsatisfiable(doc, a.id, { code: a.code, reason: a.reason, by: 'issue-unsatisfiable', at: now });
      saveIssues(doc);
    });
    if (has('--json')) emit({ generated: now, write, ...out });
    else {
      for (const a of out.assign) process.stdout.write(`${write ? '' : '(dry) '}${a.id}  ${a.code}: ${a.reason}\n`);
      for (const u of out.unmeasured) process.stdout.write(`not checked — ${u}\n`);
      if (out.skippedClaimed.length) process.stdout.write(`${out.skippedClaimed.length} claimed issue(s) not judged — a live claim is someone's work\n`);
      process.stdout.write(`${out.assign.length} unsatisfiable${write ? ' assigned' : ' found (dry run; --write assigns)'}\n`);
    }
    // An unrun check is not a clean result.
    if (out.unmeasured.length) process.exitCode = 4;
    return;
  }

  if (cmd === 'verify') {
    let doc;
    try { doc = loadIssues(); }
    catch (e) { return die(`store failed to load: ${e.message}`, 3); }
    const problems = verifyChain(doc);
    if (problems.length) { problems.forEach((p) => process.stderr.write(p + '\n')); return die(`${problems.length} chain problem(s)`, 3); }
    process.stdout.write(`ok — ${doc.events.length} events, ${Object.keys(doc.issues).length} issues, chain verified\n`);
    return;
  }

  // reindex — the sanctioned repair for a drifted byKey index; `verify` only reports.
  if (cmd === 'reindex') {
    const dryRun = has('--dry-run');
    let out;
    withIssuesLock(() => {
      const doc = loadIssues();
      out = { problemsBefore: identityProblems(doc).length };
      // Measure 'after' on a mutated copy, or the dry run understates its own effect.
      const target = dryRun ? JSON.parse(JSON.stringify(doc)) : doc;
      // nosemgrep: javascript.lang.security.insecure-object-assign.insecure-object-assign -- merges reindexByKey()'s fixed-shape in-repo result onto a fresh local object; no request-derived keys exist in this CLI
      Object.assign(out, reindexByKey(target));
      out.problemsAfter = identityProblems(target).length;
      if (!dryRun && (out.rebound.length || out.dropped.length)) saveIssues(doc);
    });
    if (has('--json')) emit({ generated: now, dryRun, ...out });
    else {
      for (const r of out.rebound) process.stdout.write(`rebind ${r.key}\n         ${r.from ?? '(unindexed)'} -> ${r.to}\n`);
      for (const d of out.dropped) process.stdout.write(`drop   ${d.key} (was ${d.was}; no issue claims it)\n`);
      process.stdout.write(`${dryRun ? '(dry) ' : ''}${out.rebound.length} rebound, ${out.dropped.length} dropped, ${out.unchanged} unchanged; identity problems ${out.problemsBefore} -> ${out.problemsAfter}\n`);
    }
    if (out.problemsAfter) process.exitCode = 3;
    return;
  }

  if (cmd === 'gc') {
    withIssuesLock(() => {
      const doc = loadIssues();
      const { expiredClaims, expiredWaivers } = gcIssues(doc, { at: now });
      saveIssues(doc);
      process.stdout.write(`gc: ${expiredClaims.length} expired claim(s) released, ${expiredWaivers.length} expired waiver(s) cleared\n`);
    });
    return;
  }

  die(`unknown command '${cmd ?? ''}' — see the usage block at the top of bin/issue.mjs`);
}

const isMain = isMainModule(import.meta.url);
if (isMain) await main();
