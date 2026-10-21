#!/usr/bin/env node
// Migrate `gs:<repo>|<category>|undefined` source keys onto identity-bearing keys derived from
// the repo's latest scan rows — the keys monitor/issue-store.mjs's fixed mint now writes
// (scannerGroupKeyFor is shared, so mint and migration cannot disagree).
//
// usage:
//   node bin/issue-rekey-depsretire.mjs [--category depsRetire] [--reports <root>] \
//        [--rows <repo>=<dir> ...] [--split] [--write]
//
// Named for the lane it was built for (depsRetire); --category extends it to the sibling
// rule-less lanes (cspm, supplyChainPosture, accessibility). Rows dirs resolve to the newest
// reports/sweep-*/<repo>/<artifact>; --rows overrides per repo. Rows are read through the
// production extractor (SCANNER_SPECS), never a re-implementation.
//
// Per open legacy record, from its repo's current crit/high rows:
//   exactly 1 identity            -> re-key in place (append-only: priorKeys + chain event)
//   2+ identities, with --split   -> operator-ruled split: one child per identity, each
//                                    inheriting the original's createdAt (SLA reads "known since
//                                    then") with its OWN severity from the rows; the original
//                                    closes as superseded, linked to every child
//   2+ identities, no --split     -> refused
//   no rows source / unreadable scan / zero tuples / occupied target slot -> refused, listed,
//                                    counted — never guessed. With ambiguity "moved" and "newly
//                                    appeared" are indistinguishable, and absorbing a new row
//                                    into an old issue hides a fresh vulnerability forever.
//
// Everything mutates through the store's own APIs (mintIssue/mutateIssue/linkIssues/
// appendIssueEvent); reindexByKey + identityProblems + verifyChain gate the save, all under
// withIssuesLock; nothing inside the locked region calls process.exit. Idempotent: migrated keys
// stop matching and split originals are closed, so a second run plans 0. Dry-run by default.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { verifyChain, identityProblems, reindexByKey, appendIssueEvent, loadIssues, saveIssues,
  withIssuesLock, nowISO, issuesPath, mintIssue, mutateIssue, linkIssues, slaDueAt,
  titleForScannerGroup, scannerGroupKeyFor, scannerIdentityParts, normaliseSeverity, SEV_RANK,
  AUTHORITY_SCANNER_CATEGORIES } from '../monitor/issue-store.mjs';
import { SCANNER_SPECS } from '../monitor/extractors.mjs';
import { identityFor } from '../monitor/detail-schema.mjs';

// Presence marker per category (the file its SCANNER_SPECS extractor reads).
const ARTIFACTS = {
  depsRetire: 'retire.json',
  cspm: 'cspm-github.json',
  supplyChainPosture: 'scorecard.json',
  accessibility: 'a11y.json',
};

// Env read at call time via the store's own seam (CW_ISSUES) — a const at import defeats overrides.
const STORE = () => issuesPath();

const argv = process.argv.slice(2);
const write = argv.includes('--write');
const split = argv.includes('--split');
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const category = flag('--category') || 'depsRetire';
const reportsRoot = flag('--reports') || 'reports';
const rowsDirs = new Map(); // repo -> dir (overrides the resolver)
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== '--rows') continue;
  const v = String(argv[i + 1] || '');
  const eq = v.indexOf('=');
  if (eq < 1) { console.error(`--rows wants <repo>=<dir>, got '${v}'`); process.exit(2); }
  rowsDirs.set(v.slice(0, eq), v.slice(eq + 1));
}

const spec = SCANNER_SPECS.find((s) => s[0] === category);
if (!spec || !identityFor(category) || !ARTIFACTS[category]) {
  console.error(`--category '${category}' is not a supported rule-less lane (${Object.keys(ARTIFACTS).join('|')})`);
  process.exit(2);
}
// Built from the registry's own name for the lane, not the argument that selected it.
const LEGACY_RE = new RegExp(`^gs:([^|]+)\\|${spec[0].replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\|undefined$`);

/** Newest sweep dir holding this repo's artifact; --rows wins. Sorted, never mtime — determinism. */
function rowsDirFor(repo) {
  if (rowsDirs.has(repo)) return rowsDirs.get(repo);
  let sweeps = [];
  try { sweeps = readdirSync(reportsRoot).filter((d) => d.startsWith('sweep-')).sort().reverse(); }
  catch { return null; }
  for (const s of sweeps) {
    const d = join(reportsRoot, s, repo);
    if (existsSync(join(d, ARTIFACTS[category]))) return d;
  }
  return null;
}

/** Bucket a repo's current crit/high rows by target group key, or return a refusal reason. */
function bucketsFor(repo) {
  const dir = rowsDirFor(repo);
  if (!dir) return { why: `no-rows-source: no ${ARTIFACTS[category]} for '${repo}' under ${reportsRoot} and no --rows override` };
  const out = spec[2](dir);
  // Fail closed: an absent/unreadable artifact is not an empty scan.
  if (!out || !out.ran) return { why: `rows-unreadable: no parseable ${ARTIFACTS[category]} under ${dir}` };
  const legacyKey = `gs:${repo}|${category}|undefined`;
  const buckets = new Map(); // target gs: key -> {sev, members: [sc: keys], n}
  for (const f of out.findings || []) {
    const row = { ...f, repo };
    const sev = normaliseSeverity(row.sev);
    if ((SEV_RANK[sev] ?? 0) < SEV_RANK.high) continue;    // the ingest's own filing threshold
    const target = scannerGroupKeyFor(row, category);      // the SAME derivation the mint uses
    if (target === legacyKey) return { why: 'identity-incomplete: a crit/high row lacks the identity tuple, so the fixed mint itself would still write |undefined' };
    if (!buckets.has(target)) buckets.set(target, { sev, members: new Set(), n: 0 });
    const b = buckets.get(target);
    if ((SEV_RANK[sev] ?? 0) > (SEV_RANK[b.sev] ?? 0)) b.sev = sev;
    b.members.add(`sc:${repo}|${category}|${scannerIdentityParts(row, category).parts.join('|')}`);
    b.n += 1;
  }
  return { buckets };
}

/** Plan against a loaded doc. Pure — no writes. */
function plan(doc) {
  const rekeys = [], splits = [], refusals = [];
  let skippedClosed = 0;
  for (const id of Object.keys(doc.issues).sort()) {
    const iss = doc.issues[id];
    const m = LEGACY_RE.exec(iss.source?.key || '');
    if (!m) continue;
    if (iss.state === 'closed') { skippedClosed++; continue; } // historical record; its key stays
    const repo = m[1];
    const b = bucketsFor(repo);
    if (b.why) { refusals.push({ id, key: iss.source.key, why: b.why }); continue; }
    const targets = [...b.buckets.keys()].sort();
    if (targets.length === 0) {
      refusals.push({ id, key: iss.source.key, why: 'no-identity-derivable: zero crit/high rows — cannot tell fixed from unscanned' });
      continue;
    }
    const taken = targets.filter((t) => doc.byKey[t] && doc.byKey[t] !== id && doc.issues[doc.byKey[t]]?.state !== 'closed');
    if (taken.length) {
      refusals.push({ id, key: iss.source.key, why: `slot-taken: ${taken.map((t) => `'${t}' -> ${doc.byKey[t]}`).join(', ')}` });
      continue;
    }
    if (targets.length === 1) { rekeys.push({ id, from: iss.source.key, to: targets[0] }); continue; }
    if (!split) {
      refusals.push({ id, key: iss.source.key, why: `spans-${targets.length}-identities — re-run with --split to apply the ruled split policy` });
      continue;
    }
    splits.push({ id, from: iss.source.key, repo, children: targets.map((t) => ({ to: t, ...b.buckets.get(t), members: [...b.buckets.get(t).members].sort() })) });
  }
  return { rekeys, splits, refusals, skippedClosed };
}

/** Read, plan, print, and (when --write) apply. Returns an exit code — never process.exit. */
function migrate() {
  const store = STORE();
  let doc;
  try { doc = loadIssues({ path: store }); } // fail-closed load + schema validation
  catch (e) { console.error(e.message); return 1; }

  const pre = verifyChain(doc);
  if (pre.length) {
    console.error(`the chain does not verify BEFORE migrating (${pre.length} problem(s)) — refusing:`);
    for (const p of pre.slice(0, 5)) console.error(`  ${p}`);
    return 3;
  }

  const { rekeys, splits, refusals, skippedClosed } = plan(doc);
  const legacy = rekeys.length + splits.length + refusals.length + skippedClosed;

  console.log(`store       ${store}`);
  console.log(`category    ${category}`);
  console.log(`legacy      ${legacy} record(s) keyed gs:<repo>|${category}|undefined`);
  console.log(`rekey 1:1   ${rekeys.length}`);
  console.log(`split       ${splits.length} record(s) -> ${splits.reduce((n, s) => n + s.children.length, 0)} children${split ? '' : ' (would need --split)'}`);
  console.log(`refused     ${refusals.length}`);
  console.log(`closed      ${skippedClosed} (skipped — a closed record's key is historical)`);
  console.log('');
  for (const r of rekeys) console.log(`  REKEY ${r.id}  ${r.from}  ->  ${r.to}`);
  for (const s of splits) {
    console.log(`  SPLIT ${s.id}  ${s.from}  ->`);
    for (const c of s.children) console.log(`        ${c.to}  [${c.sev}] ${c.members.length} member(s)`);
  }
  for (const r of refusals) console.log(`  REFUSED ${r.id} (${r.key}): ${r.why}`);

  if (!rekeys.length && !splits.length) { console.log('\nnothing to migrate.'); return 0; }
  if (!write) { console.log('\nDRY RUN — nothing written. Re-run with --write to apply.'); return 0; }

  // ---- apply, append-only ----------------------------------------------------------------------
  const at = nowISO();
  for (const { id, from, to } of rekeys) {
    const iss = doc.issues[id];
    iss.priorKeys = [...new Set([...(iss.priorKeys || []), from])];
    iss.source = { ...iss.source, key: to };
    if (doc.byKey[from] === id) delete doc.byKey[from];
    doc.byKey[to] = id;
    iss.updatedAt = at;
    appendIssueEvent(doc, 'issue-key-migrated', id,
      { from, to, why: 'grouped mint wrote rule undefined; identity re-derived 1:1 from the category tuple' }, at);
  }

  for (const s of splits) {
    const orig = doc.issues[s.id];
    const childIds = [];
    for (const c of s.children) {
      const label = c.to.split('|').slice(2).join('|');
      const { id: childId, existed } = mintIssue(doc, {
        area: orig.area, repo: s.repo, kind: 'code', severity: c.sev,
        title: titleForScannerGroup(s.repo, category, label, c.members.length),
        source: { kind: 'scanner-row', key: c.to, tool: category, rule: null },
        groupMembers: c.members,
        authorityRequired: AUTHORITY_SCANNER_CATEGORIES.has(category),
      }, at);
      if (existed) { console.error(`  unexpected: ${c.to} already indexed to ${childId} mid-apply`); return 3; }
      // Operator-ruled inheritance: the SLA clock reads "known since then"; severity stays the row's own.
      mutateIssue(doc, childId, (i) => {
        i.createdAt = orig.createdAt;
        i.slaDueAt = slaDueAt(orig.createdAt, i.severity);
      }, 'issue-updated', { inheritedCreatedAtFrom: s.id, why: 'split of a legacy |undefined group' }, at);
      childIds.push(childId);
    }
    // First link closes the original as superseded; the rest are recorded so no successor is lost.
    linkIssues(doc, childIds[0], { supersedes: s.id, at });
    for (const extra of childIds.slice(1)) {
      mutateIssue(doc, s.id, (i) => {
        i.evidence.push({ at, tier: 'manual', detail: `split: also superseded by ${extra}` });
      }, 'issue-updated', { alsoSupersededBy: extra, why: 'split of a legacy |undefined group' }, at);
    }
  }

  reindexByKey(doc);
  const idp = identityProblems(doc);
  const post = verifyChain(doc);
  if (idp.length || post.length) {
    console.error(`\nthe store does not verify AFTER migrating (${idp.length + post.length} problem(s)) — NOT writing:`);
    for (const p of [...idp, ...post].slice(0, 5)) console.error(`  ${p}`);
    return 3;
  }

  saveIssues(doc, { path: store });
  const kids = splits.reduce((n, s) => n + s.children.length, 0);
  console.log(`\nwrote ${store} — ${rekeys.length} re-keyed, ${splits.length} split into ${kids}, ${refusals.length} refused, chain verifies.`);
  return 0;
}

let code;
if (write) {
  try {
    code = withIssuesLock(migrate, { path: STORE() });
  } catch (e) {
    // Contention: "busy, nothing written" must never read as "ran and failed".
    console.error(`${e.message}\nnothing was written; the store is unchanged.`);
    code = 4;
  }
} else {
  code = migrate(); // a dry run takes no lock — only the writing path serialises
}
process.exit(code);
