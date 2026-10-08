#!/usr/bin/env node
// Carry the open issues of the retired `cobolSecurity` category onto `sastCobol`.
//
// Operator decision 2026-09-26: two lanes ran `cobolwork scan` over the same trees — sast-cobol
// (category cobolSecurity) and sast-cobol-cobolwork (category sastCobol) — so every finding was
// counted and filed twice. sast-cobol-cobolwork was kept and sast-cobol retired. With cobolSecurity
// gone from SCANNER_SPECS, ingestArea never sees it run again: its open issues are carried untouched
// for ever while sastCobol files the same findings a second time. Nothing closes them as fixed, and
// nothing should — the defect was not fixed, the lane was retired.
//
// Both readers copied `rule` and `path` off the same report unchanged, so rule|file names the same
// finding in either. Each open record moves to sastCobol's rule|file key, which is the key
// monitor/issue-store.mjs migrateIdentityKeys adopts onto the fingerprint identity the first time a
// sastCobol row with that rule and file is ingested. Id, history, SLA clock, severity and
// source.model travel with it.
//
//   sc:<repo>|cobolSecurity|<rule>|<file>  ->  sc:<repo>|sastCobol|<rule>|<file>
//   gs:<repo>|cobolSecurity|<rule>         ->  gs:<repo>|sastCobol|<rule>, members mapped the same way
//   target held by an OPEN issue, or adopted by one (its priorKeys name the target)
//                                          ->  closed `superseded`, duplicateOf that issue
//   target held by a CLOSED issue, a live claim on a duplicate, or a key this tool cannot parse
//                                          ->  refused and listed, never guessed
// Closed cobolSecurity records are skipped: a closed record's key is historical.
//
// A carried record whose file sastCobol classifies as a test fixture is LISTED: that lane sets
// fixture findings aside instead of filing them, so the issue will go suspect rather than being
// refreshed (a group member simply drops out of the group). Whether a planted fixture is a defect
// is a person's call, not this tool's.
//
// usage: node bin/issue-retire-cobolsecurity.mjs [--write]
// Dry-run by default. --write applies under withIssuesLock through the store's own mutation funnel;
// verifyChain and identityProblems gate the save. Idempotent: a second run plans nothing.
import { verifyChain, identityProblems, loadIssues, saveIssues, withIssuesLock, nowISO, issuesPath,
  mutateIssue, claimExpired, titleForScannerRow, titleForScannerGroup } from '../monitor/issue-store.mjs';
import { SCANNER_SPECS } from '../monitor/extractors.mjs';
import { classifyPath } from '../monitor/fixture-paths.mjs';

const FROM = 'cobolSecurity';
const TO = 'sastCobol';
const WHY = `${FROM} retired 2026-09-26 as a duplicate of ${TO}: both read the same cobolwork report, and rule|file names the same finding in either`;

// Env read at call time via the store's own seam (CW_ISSUES).
const STORE = () => issuesPath();
const write = process.argv.slice(2).includes('--write');

// Moving the records while the old lane is still registered would have the next ingest mint a fresh
// cobolSecurity issue for every one of them.
function laneRefusal() {
  const cats = new Set(SCANNER_SPECS.map(([k]) => k));
  if (cats.has(FROM)) return `${FROM} is still a registered category in SCANNER_SPECS — retire the lane before moving its issues`;
  if (!cats.has(TO)) return `${TO} is not a registered category — there is nothing to carry these issues to`;
  return null;
}

// `sc:<repo>|<category>|<rest…>` with the category segment swapped, or null when it is not FROM's.
function retarget(key, prefix) {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- prefix and FROM are module constants
  const m = new RegExp(`^${prefix}:([^|]+)\\|${FROM}\\|(.+)$`).exec(String(key || ''));
  return m ? { repo: m[1], rest: m[2], to: `${prefix}:${m[1]}|${TO}|${m[2]}` } : null;
}

/** Plan against a loaded doc. Pure — no writes. */
function plan(doc, at) {
  const carry = [], duplicates = [], refusals = [], fixtures = [];
  let skippedClosed = 0;
  // Open TO issues that took a rule|file key over via migrateIdentityKeys, by that prior key.
  const adoptedBy = new Map();
  for (const id of Object.keys(doc.issues).sort()) {
    const i = doc.issues[id];
    if (i.state === 'closed' || i.source?.tool !== TO) continue;
    for (const k of i.priorKeys || []) if (!adoptedBy.has(k)) adoptedBy.set(k, id);
  }
  const fixtureOf = (file) => {
    const c = classifyPath(file);
    return c.fixture ? c.pattern : null;
  };

  for (const id of Object.keys(doc.issues).sort()) {
    const iss = doc.issues[id];
    const src = iss.source || {};
    if (src.tool !== FROM) continue;
    if (iss.state === 'closed') { skippedClosed++; continue; }
    const grouped = String(src.key || '').startsWith('gs:');
    const t = src.kind === 'scanner-row' ? retarget(src.key, grouped ? 'gs' : 'sc') : null;
    if (!t) { refusals.push({ id, key: src.key, why: 'unparseable: not a scanner-row key of the form sc:|gs:<repo>|cobolSecurity|…' }); continue; }

    let members = null;
    if (grouped) {
      const mapped = (iss.groupMembers || []).map((m) => retarget(m, 'sc'));
      if (mapped.some((x) => !x)) { refusals.push({ id, key: src.key, why: 'unparseable group member' }); continue; }
      members = mapped.map((x) => x.to).sort();
    }

    const holderId = doc.byKey[t.to];
    const holder = holderId && holderId !== id ? doc.issues[holderId] : null;
    if (holder && holder.state === 'closed') {
      refusals.push({ id, key: src.key, why: `slot-taken: '${t.to}' is held by closed ${holderId} — reopening or not is a disposition, not a re-key` });
      continue;
    }
    const of = holder ? holderId : (adoptedBy.get(t.to) || null);
    if (of) {
      if (iss.claim && !claimExpired(iss.claim, at)) {
        refusals.push({ id, key: src.key, why: `duplicate of ${of}, but claimed by ${iss.claim.by} until ${iss.claim.expiresAt} — release it first` });
        continue;
      }
      duplicates.push({ id, from: src.key, to: t.to, of });
      continue;
    }

    const title = grouped
      ? titleForScannerGroup(iss.repo, TO, src.rule ?? null, members.length)
      : titleForScannerRow({ rule: src.rule, repo: iss.repo }, TO);
    carry.push({ id, from: src.key, to: t.to, title, members });
    const files = grouped ? members.map((m) => m.split('|').slice(3).join('|')) : [t.rest.split('|').slice(1).join('|')];
    for (const f of files) {
      const pattern = fixtureOf(f);
      if (pattern) fixtures.push({ id, file: f, pattern, grouped });
    }
  }
  return { carry, duplicates, refusals, fixtures, skippedClosed };
}

/** Read, plan, print, and (with --write) apply. Returns an exit code — never process.exit. */
function migrate() {
  const store = STORE();
  const lane = laneRefusal();
  if (lane) { console.error(lane); return 2; }
  let doc;
  try { doc = loadIssues({ path: store }); } // fail-closed load + schema validation
  catch (e) { console.error(e.message); return 1; }

  const pre = verifyChain(doc);
  if (pre.length) {
    console.error(`the chain does not verify BEFORE migrating (${pre.length} problem(s)) — refusing:`);
    for (const p of pre.slice(0, 5)) console.error(`  ${p}`);
    return 3;
  }
  const idBefore = new Set(identityProblems(doc));

  const at = nowISO();
  const { carry, duplicates, refusals, fixtures, skippedClosed } = plan(doc, at);
  const open = carry.length + duplicates.length + refusals.length;
  console.log(`store       ${store}`);
  console.log(`category    ${FROM} -> ${TO}`);
  console.log(`open        ${open} record(s) under ${FROM}`);
  console.log(`carry       ${carry.length} (${carry.filter((c) => c.members).length} grouped)`);
  console.log(`duplicate   ${duplicates.length}`);
  console.log(`refused     ${refusals.length}`);
  console.log(`closed      ${skippedClosed} (skipped — a closed record's key is historical)`);
  console.log(`fixtures    ${new Set(fixtures.map((f) => f.id)).size} carried record(s) name a file ${TO} sets aside as a test fixture`);
  console.log('');
  for (const c of carry) console.log(`  CARRY ${c.id}  ${c.from}  ->  ${c.to}${c.members ? `  [${c.members.length} member(s)]` : ''}`);
  for (const d of duplicates) console.log(`  DUPLICATE ${d.id}  ${d.from}  (same finding as ${d.of}) -> closed superseded`);
  for (const r of refusals) console.log(`  REFUSED ${r.id} (${r.key}): ${r.why}`);
  for (const f of fixtures) {
    console.log(`  FIXTURE ${f.id}  ${f.file}  (${f.pattern}) — ${f.grouped
      ? `drops out of the group's members under ${TO}`
      : `will go suspect under ${TO}, not refreshed`}`);
  }

  if (!carry.length && !duplicates.length) { console.log('\nnothing to carry.'); return 0; }
  if (!write) { console.log('\nDRY RUN — nothing written. Re-run with --write to apply.'); return 0; }

  // ---- apply, append-only, through the mutation funnel ------------------------------------------
  for (const { id, from, to, title, members } of carry) {
    const before = doc.issues[id].title;
    mutateIssue(doc, id, (i) => {
      i.priorKeys = [...new Set([...(i.priorKeys || []), from])];
      i.source = { ...i.source, key: to, tool: TO };
      i.title = title;
      if (members) i.groupMembers = members;
    }, 'issue-key-migrated', {
      from, to, fromCategory: FROM, toCategory: TO, why: WHY,
      ...(before !== title ? { title: { from: before, to: title } } : {}),
    }, at);
    if (doc.byKey[from] === id) delete doc.byKey[from];
    doc.byKey[to] = id;
  }
  for (const { id, of } of duplicates) {
    mutateIssue(doc, id, (i) => {
      i.deps = { ...i.deps, duplicateOf: of };
      i.state = 'closed';
      i.closedAs = 'superseded';
      i.claim = null;
      i.suspect = false;
      i.evidence.push({ at, tier: 'manual', detail: `${FROM} retired 2026-09-26; the same finding is filed under ${TO} as ${of}` });
    }, 'issue-closed', { closedAs: 'superseded', duplicateOf: of, why: WHY }, at);
  }

  const idp = identityProblems(doc).filter((p) => !idBefore.has(p));
  const post = verifyChain(doc);
  if (idp.length || post.length) {
    console.error(`\nthe store does not verify AFTER migrating (${idp.length + post.length} problem(s)) — NOT writing:`);
    for (const p of [...idp, ...post].slice(0, 5)) console.error(`  ${p}`);
    return 3;
  }
  saveIssues(doc, { path: store });
  console.log(`\nwrote ${store} — ${carry.length} carried to ${TO}, ${duplicates.length} closed superseded, ${refusals.length} refused, chain verifies.`);
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
// exitCode, not exit(): exit() can drop piped stdout that has not drained yet.
process.exitCode = code;
