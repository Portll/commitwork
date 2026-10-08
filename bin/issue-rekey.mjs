#!/usr/bin/env node
// Re-key the issue store from flat ISS-000000 ids to org- and class-scoped
// ISS-<ORG>-<CLASS>-<SUFFIX>, and declare the tenant those ids belong to.
//
// usage:
//   node bin/issue-rekey.mjs --org PORTLL            # dry run — prints the mapping, writes nothing
//   node bin/issue-rekey.mjs --org PORTLL --write    # apply
//
// Append-only: past events are hash-chained on their issueId, so history is never rewritten —
// re-keys append events, record priorIds, and alias old ids to new.
// Writes run under withIssuesLock and fail closed on contention; nothing inside the locked
// region may call process.exit (that skips the lock release).
import { readFileSync } from 'node:fs';
import { verifyChain, appendIssueEvent, nowISO, issuesPath, saveIssues, withIssuesLock } from '../monitor/issue-store.mjs';
import { formatIssueId, classForIssue, isLegacyId, ORG_RE, DEFAULT_ORG } from '../monitor/issue-key.mjs';

// Read env at call time via the store's own seam — a const at import defeats test overrides.
const STORE = () => issuesPath();

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const has = (n) => argv.includes(n);

// --org optional; blank means PERSONAL, the same default the store mints under.
const org = String(flag('--org') || DEFAULT_ORG).toUpperCase();
const write = has('--write');
if (!ORG_RE.test(org)) {
  console.error(`--org '${org}' is not a valid slug (${ORG_RE}): 2-12 chars, A-Z and 0-9.`);
  process.exit(2);
}

/**
 * Read, plan, and (when --write) apply. Returns an exit code — never calls process.exit, which
 * would skip the lock release. The read must happen under the same lock as the write.
 */
function rekey() {
  const store = STORE();
  let doc;
  try {
    doc = JSON.parse(readFileSync(store, 'utf8'));
  } catch (e) {
    // Fail closed: an unreadable store is an error, never an empty one we happily rewrite.
    console.error(`cannot read ${store}: ${e.message}`);
    return 1;
  }

  // Refuse to append onto a chain that does not already verify.
  const pre = verifyChain(doc);
  if (pre.length) {
    console.error(`the chain does not verify BEFORE migrating (${pre.length} problem(s)) — refusing:`);
    for (const p of pre.slice(0, 5)) console.error(`  ${p}`);
    return 3;
  }

  if (doc.organisation && doc.organisation !== org) {
    console.error(`this store already belongs to '${doc.organisation}'; refusing to re-tenant it to '${org}'.`);
    console.error('Moving issues between tenants is not a re-key — the ids are not the hard part, the ownership is.');
    return 3;
  }

  const at = nowISO();
  const legacy = Object.keys(doc.issues || {}).filter(isLegacyId);
  const mapping = [];
  const unclassifiable = [];

  for (const oldId of legacy) {
    const issue = doc.issues[oldId];
    let cls;
    try {
      cls = classForIssue(issue);
    } catch (e) {
      unclassifiable.push({ id: oldId, why: e.message });
      continue;
    }
    // Carry the suffix verbatim — ordinalToSuffix is not invertible, so re-deriving renumbers issues.
    const suffix = oldId.slice(4);
    mapping.push({ oldId, newId: formatIssueId({ org, cls, suffix }), cls, suffix });
  }

  if (unclassifiable.length) {
    console.error(`\n${unclassifiable.length} issue(s) cannot be classified, so the migration is INCOMPLETE and is refused:`);
    for (const u of unclassifiable) console.error(`  ${u.id}: ${u.why}`);
    console.error('\nA partial re-key would leave two id schemes live with no rule for which applies. Fix the classes first.');
    return 3;
  }

  console.log(`store       ${store}`);
  console.log(`tenant      ${org}${doc.organisation ? ' (already declared)' : ' (new declaration)'}`);
  console.log(`issues      ${Object.keys(doc.issues || {}).length} total, ${legacy.length} legacy-keyed`);
  console.log(`events      ${(doc.events || []).length} (unchanged — history is not rewritten)`);
  console.log('');
  for (const m of mapping) console.log(`  ${m.oldId}  ->  ${m.newId}`);

  if (!mapping.length) {
    console.log('\nnothing to re-key.');
    return 0;
  }
  if (!write) {
    console.log(`\nDRY RUN — nothing written. Re-run with --write to apply.`);
    return 0;
  }

  // ---- apply, append-only --------------------------------------------------------------------
  doc.organisation = org;
  doc.aliases = doc.aliases || {};

  for (const { oldId, newId, cls } of mapping) {
    const issue = doc.issues[oldId];
    issue.id = newId;
    issue.class = cls;
    issue.priorIds = [...(issue.priorIds || []), oldId];
    doc.issues[newId] = issue;
    delete doc.issues[oldId];
    doc.aliases[oldId] = newId;

    for (const [k, v] of Object.entries(doc.byKey || {})) if (v === oldId) doc.byKey[k] = newId;

    // Event under the new id, naming the old one — the rename is a recorded act in the chain.
    appendIssueEvent(doc, 'issue-updated', newId, { rekeyedFrom: oldId, organisation: org, class: cls }, at);
  }

  const post = verifyChain(doc);
  if (post.length) {
    console.error(`\nthe chain does not verify AFTER migrating (${post.length} problem(s)) — NOT writing:`);
    for (const p of post.slice(0, 5)) console.error(`  ${p}`);
    return 3;
  }

  // saveIssues, not bare writeJSONAtomic: the store's save path refuses to write without the lock.
  saveIssues(doc, { path: store });
  console.log(`\nwrote ${store} — ${mapping.length} re-keyed, chain verifies, ${(doc.events || []).length} events.`);
  return 0;
}

// A dry run takes no lock — only the writing path serialises.
let code;
if (write) {
  try {
    code = withIssuesLock(rekey, { path: STORE() });
  } catch (e) {
    // Contention: "busy, nothing written" must never read as "ran and failed".
    console.error(`${e.message}\nnothing was written; the store is unchanged. Re-run when the other writer finishes.`);
    code = 4;
  }
} else {
  code = rekey();
}
process.exit(code);
