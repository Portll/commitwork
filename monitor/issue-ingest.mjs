// contract: rollup slice -> issue ledger changes; callers hold the lock
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { remediationForFix } from './fix-range.mjs';
import { identityFor } from './detail-schema.mjs';
import { METRIC_CATEGORIES } from './extractors.mjs';
import { findActiveAnnotation, findActiveScannerAnnotation } from './annotate-lib.mjs';
import { hashLine } from '../lib/anchor-hash.mjs';
import { classifyWorktreePath } from './worktree-paths.mjs';
import { localRuleId } from './sarif-read.mjs';
import { normaliseSeverity, SEV_RANK, AUTHORITY_SCANNER_CATEGORIES, STALE_HOURS, appendIssueEvent, appendRemediationEvent, slaDueAt, migrateLineKeys, mintIssue, mutateIssue, reopenIssue, titleForFinding, titleForGroup, titleForScannerRow, scannerIdentityParts, migrateDegenerateKeys, migrateIdentityKeys, migrateLocalRuleKeys, scannerPlaceKey, scannerGroupKeyFor, GROUPED_CATEGORIES, GROUP_THRESHOLD, titleForScannerGroup, recordAnchor, ruleLabel } from './issue-store.mjs';

// A scanner key describes a worktree copy when one of its place segments is a copy's path. The
// canonical key is the same key with that segment replaced by the path the copy stands for.
export function worktreeCopyOf(key) {
  const segs = String(key || '').split('|');
  for (let i = 1; i < segs.length; i++) {
    const c = classifyWorktreePath(segs[i]);
    if (!c.worktree) continue;
    const canonical = [...segs.slice(0, i), c.canonical, ...segs.slice(i + 1)].join('|');
    return { name: c.name, pattern: c.pattern, canonicalKey: canonical };
  }
  return null;
}

export const depSourceKey = (f) => `f:${f.key}`;

const groupSourceKey = (repo, pkg) => `g:${repo}|${pkg}`;

export const scannerSourceKey = (row, category) => {
  const { parts } = scannerIdentityParts(row, category);
  // Unkeyable rather than a colliding identity.
  if (!parts.length) return null;
  return `sc:${row.repo}|${category}|${parts.join('|')}`;
};

const OPEN_FINDING_STATES = new Set(['born', 'persisting']);

function ledgerEvidenceFor(ledger, rawKey) {
  const entries = Array.isArray(ledger) ? ledger : (ledger?.entries || []);
  // newest resolution wins; tiers: strong > medium > weak
  const forKey = entries.filter((e) => e.key === rawKey);
  if (!forKey.length) return null;
  const rank = { strong: 3, medium: 2, weak: 1 };
  forKey.sort((a, b) => (rank[b.evidence?.tier] || 0) - (rank[a.evidence?.tier] || 0) || String(b.at || '').localeCompare(String(a.at || '')));
  return forKey[0];
}

function readAnchorLine(repoPath, anchor) {
  // No usable file:line is a fact about one row, not an error — report unreadable, suspect lane.
  if (!repoPath || !anchor) return { readable: false };
  if (typeof anchor.file !== 'string' || !anchor.file || !Number.isInteger(anchor.line) || anchor.line < 1) {
    return { readable: false };
  }
  const p = join(repoPath, anchor.file);
  if (!existsSync(p)) return { readable: true, fileGone: true };
  let text;
  try { text = readFileSync(p, 'utf8'); }
  catch { return { readable: false }; }
  const lines = text.split('\n');
  if (anchor.line > lines.length) return { readable: true, lineGone: true };
  return { readable: true, hash: hashLine(lines[anchor.line - 1]) };
}

function appendScanAbsent(iss, sliceId, detail, at) {
  // one scan-absent entry per slice — re-rollups of the same slice must not stack evidence
  const last = iss.evidence[iss.evidence.length - 1];
  if (last && last.tier === 'scan-absent' && last.sliceId === sliceId) return false;
  iss.evidence.push({ at, tier: 'scan-absent', sliceId, detail });
  return true;
}

function applyScannerWaiver(doc, issueId, row, category, { scannerAnnotations, at, dryRun }) {
  if (dryRun || !issueId) return;
  const iss = doc.issues[issueId];
  if (!iss || iss.state === 'closed') return;
  let idf = null;
  try { idf = identityFor(category); } catch { idf = null; }
  // No identity tuple for this category means no way to scope a match — and an unscopable
  // annotation must never become a wildcard suppression. Leave the issue exactly as it is.
  if (!idf) return;
  const candidates = (scannerAnnotations || []).filter(
    (a) => a && a.category === category && (a.scope === 'fleet' || a.repo === row.repo),
  );
  const hit = findActiveScannerAnnotation(candidates, row, at, idf) || null;
  if (hit) {
    const annotationId = `${hit.category}:${hit.rule ?? ''}|${hit.file ?? ''}@${hit.repo ?? hit.scope ?? ''}`;
    const isNew = iss.waiver?.annotationId !== annotationId;
    iss.waiver = {
      annotationId,
      action: hit.action,
      expiresAt: hit.expires ?? null,
      who: hit.who ?? null,
    };
    if (isNew) appendRemediationEvent(doc, 'fix-authored', issueId, {
      at,
      evidence: { note: hit.reason, who: hit.who },
      data: { annotationId, action: hit.action, source: 'scanner-annotation' },
    });
  } else if (iss.waiver && iss.waiver.action) {
    // Only clears waivers THIS path set (they carry `action`); a dependency waiver is left alone.
    // Set to null rather than deleted, matching how the store already initialises the field: a
    // present `null` says "asked, and there is no waiver", where an absent key says "never asked".
    // Those are different claims and this file exists because they get conflated.
    iss.waiver = null;
  }
}

export function ingestArea(doc, {
  areaSlug, rollup, ledger = null, annotations = [], scannerAnnotations = [], repoPaths = {},
  now, minSev = (process.env.CW_ISSUE_MIN_SEV || 'high'), staleHours = STALE_HOURS(), dryRun = false,
  groupCategories = GROUPED_CATEGORIES(), groupThreshold = GROUP_THRESHOLD(),
  baselinePlaceKeys = null,   // R2: place keys to grandfather (never file); empty/null → no baseline
}) {
  const summary = {
    area: areaSlug, status: 'ok', sliceId: rollup?.sliceId ?? null,
    created: [], reopened: [], closed: [], updated: [], suspect: [], carried: 0, skippedCategories: [],
  };
  if (!rollup || typeof rollup !== 'object' || !rollup.generated || !rollup.sliceId) {
    summary.status = 'no-rollup';
    return summary;
  }
  // Grey ≠ green gate 1: stale evidence. Acting on an old rollup manufactures conclusions.
  const ageMs = new Date(now).getTime() - new Date(rollup.generated).getTime();
  if (!(ageMs <= staleHours * 3600_000)) {
    summary.status = 'stale-rollup';
    summary.rollupGenerated = rollup.generated;
    return summary;
  }
  // A1: never ingest a slice at-or-before the last one.
  const last = doc.lastIngest[areaSlug];
  if (last && String(rollup.generated) <= String(last.generated)) {
    summary.status = 'not-newer';
    summary.lastIngest = { ...last };
    return summary;
  }
  if (dryRun) { summary.dryRun = true; }

  const minRank = SEV_RANK[normaliseSeverity(minSev)] ?? SEV_RANK.high;
  const at = now;

  // -- current truth from this slice ----------------------------------------------------------
  const openFindings = new Map();   // raw key -> finding
  for (const rep of rollup.repos || []) {
    for (const f of rep.findings || []) {
      if (OPEN_FINDING_STATES.has(f.state)) openFindings.set(f.key, { ...f, repo: f.repo || rep.name });
    }
  }
  // A5: missing provenance is NOT-ran, and carried is not ran — chained counts are not this-slice
  // evidence. A carried category files nothing and closes nothing.
  const categoryCarried = (category) => !!((rollup.scanners || {})[category] || {}).carried;
  const categoryRan = (category) => {
    const sc = (rollup.scanners || {})[category];
    return !!sc && (sc.ran || 0) > 0 && !sc.carried;
  };
  // 'not-ran' and 'carried' are different facts; the reason rides beside skippedCategories.
  const skipCategory = (category) => {
    summary.skippedCategories.push(category);
    (summary.skippedReasons ||= {})[category] = categoryCarried(category) ? 'carried' : 'not-ran';
  };
  const openRows = new Map();       // scanner sourceKey -> {row, category}
  // Titles carried from an earlier slice are keyed by the rule id as it was read then.
  const titleMaps = new Map();
  const titlesFor = (category) => {
    if (!titleMaps.has(category)) {
      const src = (rollup.scannerRuleTitles || {})[category] || {};
      titleMaps.set(category, Object.fromEntries(Object.entries(src).map(([k, v]) => [localRuleId(k), v])));
    }
    return titleMaps.get(category);
  };
  const ruleTitleOf = (category, rule) => (rule != null && titlesFor(category)[rule]) || null;
  // The model a category's rows were produced under in THIS slice, taken from the rows themselves
  // so it needs no separate registry: a category whose rows do not carry one answers null.
  const modelFor = (category) => {
    for (const [, v] of openRows) if (v.category === category && v.row && v.row.model) return v.row.model;
    return null;
  };
  for (const [category, rows] of Object.entries(rollup.scannerFindings || {})) {
    if (!categoryRan(category)) { skipCategory(category); continue; }
    // D4: a metric lane files nothing at any severity — counted, never lodged.
    if (METRIC_CATEGORIES.has(category)) {
      summary.metricCategories = [...new Set([...(summary.metricCategories || []), category])];
      continue;
    }
    for (const raw of rows || []) {
      // Rows carried from an earlier slice keep the rule id as it was read then.
      const row = raw && typeof raw.rule === 'string' && localRuleId(raw.rule) !== raw.rule ? { ...raw, rule: localRuleId(raw.rule) } : raw;
      // Annotated (suppressed) rows never file, and stay out of openRows for resolution —
      // converting a pre-existing issue needs a disposition, not a vanish.
      if (row.annotation) { summary.annotatedRows = (summary.annotatedRows || 0) + 1; continue; }
      const sk = scannerSourceKey(row, category);
      // Unkeyable rows are counted and skipped — a key that identifies nothing absorbs siblings.
      if (!sk) {
        summary.unkeyableRows = (summary.unkeyableRows || 0) + 1;
        continue;
      }
      // A worktree copy is the same finding as the canonical row beside it, so it never files.
      // Every lane passes through here, including the ones whose extractor does not set copies aside.
      if (worktreeCopyOf(sk)) {
        summary.worktreeRows = (summary.worktreeRows || 0) + 1;
        continue;
      }
      // R2 baseline: grandfathered place keys neither file nor drive resolution.
      if (baselinePlaceKeys && baselinePlaceKeys.has(scannerPlaceKey(sk))) {
        summary.baselinedRows = (summary.baselinedRows || 0) + 1;
        continue;
      }
      openRows.set(sk, { row, category });
    }
  }

  // Migrate before filing, or the legacy record auto-closes as FIXED beside a fresh duplicate.
  const localRuleMigration = migrateLocalRuleKeys(doc, { at, dryRun });
  if (localRuleMigration.migrated.length) summary.localRuleKeysMigrated = localRuleMigration.migrated;
  if (localRuleMigration.refused.length) summary.localRuleKeysRefused = localRuleMigration.refused;
  const keyMigration = migrateDegenerateKeys(doc, [...openRows.keys()], { at, dryRun });
  if (keyMigration.migrated.length) summary.keysMigrated = keyMigration.migrated;
  if (keyMigration.ambiguous.length) summary.keyMigrationAmbiguous = keyMigration.ambiguous;

  // A lane that declares its own identity (identityIsKey) adopts its rule|file records first, or
  // each one closes as FIXED beside the identity-keyed row that replaced it.
  const identityMigration = migrateIdentityKeys(doc, openRows, { at, dryRun });
  if (identityMigration.adopted.length) summary.identityKeysAdopted = identityMigration.adopted;
  if (identityMigration.split.length) summary.identityKeysSplit = identityMigration.split;

  // D12: after the degenerate migration, before filing.
  const lineMigration = migrateLineKeys(doc, [...openRows.keys()], { at, dryRun });
  if (lineMigration.adopted.length) summary.lineKeysAdopted = lineMigration.adopted;
  if (lineMigration.collapsed.length) summary.lineKeysCollapsed = lineMigration.collapsed;
  if (lineMigration.skipped.length) summary.lineKeysSkipped = lineMigration.skipped;

  const fileOrRefresh = (fields) => {
    const key = fields.source.key;
    const existingId = doc.byKey[key];
    if (!existingId) {
      if (dryRun) { summary.created.push(`(dry) ${key}`); return; }
      const { id } = mintIssue(doc, fields, at);
      summary.created.push(id);
      return;
    }
    const iss = doc.issues[existingId];
    // A sighting under another analysis model re-bases the record on it. The auto-close compares an
    // absence against source.model, so a model set only at filing would leave an issue filed before
    // a flow-model change uncloseable. A row that names no model leaves the recorded one alone.
    const rebaseModel = () => {
      const to = fields.source.model;
      const from = iss.source?.model ?? null;
      if (!to || to === from || dryRun) return false;
      mutateIssue(doc, existingId, (i) => { i.source = { ...i.source, model: to }; },
        'issue-updated', { model: { from, to } }, at);
      return true;
    };
    if (iss.state === 'closed') {
      if (dryRun) { summary.reopened.push(`(dry) ${existingId}`); return; }
      reopenIssue(doc, existingId, { at, reason: `source reappeared in ${rollup.sliceId}` });
      rebaseModel();
      summary.reopened.push(existingId);
      return;
    }
    // authorityRequired refreshes in BOTH directions — a ruling must reach existing issues, and
    // removing a category must return its issues to the pool.
    if (fields.authorityRequired !== undefined
      && !!fields.authorityRequired !== !!iss.authorityRequired && !dryRun) {
      const to = !!fields.authorityRequired;
      mutateIssue(doc, existingId, (i) => { i.authorityRequired = to; },
        'issue-updated', { authorityRequired: { from: !!iss.authorityRequired, to } }, at);
      summary.updated.push(existingId);
    }
    // material-diff gate: only a severity move is evidence; churn is not (watch.mjs materialDiff)
    const sev = normaliseSeverity(fields.severity);
    if (sev !== iss.severity && !dryRun) {
      mutateIssue(doc, existingId, (i) => {
        i.severity = sev;
        i.slaDueAt = slaDueAt(i.createdAt, sev);
      }, 'issue-updated', { severity: { from: iss.severity, to: sev } }, at);
      summary.updated.push(existingId);
    }
    // A title move is material: keys carry no version, so titles (and disposition digests) must
    // track upgrades. Structured-only (A4).
    if (fields.title && fields.title !== iss.title && !dryRun) {
      const from = iss.title;
      // The panel composes its row from source, so the rule's own title travels with the title.
      const ruleTitle = fields.source && fields.source.ruleTitle;
      mutateIssue(doc, existingId, (i) => {
        i.title = fields.title;
        if (ruleTitle && i.source && i.source.ruleTitle !== ruleTitle) i.source = { ...i.source, ruleTitle };
      }, 'issue-updated', { title: { from, to: fields.title } }, at);
      if (!summary.updated.includes(existingId)) summary.updated.push(existingId);
    }
    if (rebaseModel() && !summary.updated.includes(existingId)) summary.updated.push(existingId);
    if (iss.suspect && !dryRun) iss.suspect = false; // row is back — not a suspect absence anymore
  };

  // -- file dep findings -----------------------------------------------------------------------
  const groups = new Map();         // repo|pkg -> findings (below individual-filing threshold)
  for (const f of openFindings.values()) {
    const sev = normaliseSeverity(f.severity);
    const waiverAnn = findActiveAnnotation(annotations, f, at) || null;
    if ((SEV_RANK[sev] ?? 0) >= minRank) {
      fileOrRefresh({
        area: areaSlug, repo: f.repo, kind: 'vuln', severity: sev,
        title: titleForFinding(f), body: f.title ?? null, remediation: remediationForFix(f.fixed),
        source: { kind: 'finding', key: depSourceKey(f), tool: f.tool ?? null, rule: null },
      });
      const id = doc.byKey[depSourceKey(f)];
      if (id && waiverAnn && !dryRun) {
        const annotationId = waiverAnn.id ?? waiverAnn.package ?? 'annotation';
        const isNew = doc.issues[id].waiver?.annotationId !== annotationId;
        doc.issues[id].waiver = { annotationId, expiresAt: waiverAnn.expires ?? null };
        if (isNew) appendRemediationEvent(doc, 'fix-authored', id, {
          at,
          evidence: { note: waiverAnn.reason, who: waiverAnn.who },
          data: { annotationId, action: waiverAnn.action, source: 'dependency-annotation' },
        });
      }
    } else {
      const gk = `${f.repo}|${f.package}`;
      if (!groups.has(gk)) groups.set(gk, []);
      groups.get(gk).push(f);
    }
  }
  for (const [gk, members] of groups) {
    const [repo, pkg] = gk.split('|');
    const worst = members.map((m) => normaliseSeverity(m.severity)).sort((a, b) => (SEV_RANK[b] ?? 0) - (SEV_RANK[a] ?? 0))[0];
    fileOrRefresh({
      area: areaSlug, repo, kind: 'vuln', severity: worst,
      title: titleForGroup(repo, pkg, members.length),
      source: { kind: 'finding', key: groupSourceKey(repo, pkg), tool: members[0].tool ?? null, rule: null },
      groupMembers: members.map((m) => depSourceKey(m)).sort(),
    });
    if (!dryRun) {
      const iss = doc.issues[doc.byKey[groupSourceKey(repo, pkg)]];
      if (iss && iss.state !== 'closed') iss.groupMembers = members.map((m) => depSourceKey(m)).sort();
    }
  }

  // -- file scanner rows (crit/high only — line-anchored identities churn too much below that) --
  // Two passes: bucket per (repo, category, rule), then decide grouped (gs:) vs individual (sc:).
  const buckets = new Map();        // gs: key -> {repo, category, rule, sev, members: [[skey, row]]}
  for (const [skey, { row, category }] of openRows) {
    const sev = normaliseSeverity(row.sev);
    if ((SEV_RANK[sev] ?? 0) < SEV_RANK.high) continue;
    // Record rule is null, never undefined (JSON.stringify drops it and the schema then refuses
    // the whole store). The key derives the identity tuple, and bin/issue-rekey-depsretire.mjs
    // shares this derivation.
    const gkey = scannerGroupKeyFor(row, category);
    if (!buckets.has(gkey)) {
      const disc = gkey.split('|').slice(2).join('|');
      buckets.set(gkey, {
        repo: row.repo, category, rule: row.rule ?? null, sev, members: [],
        // display only — the identity label stands in for a rule the scanner never names
        label: row.rule != null ? ruleLabel(row.rule, ruleTitleOf(category, row.rule)) : (disc === 'undefined' ? null : disc),
      });
    }
    const b = buckets.get(gkey);
    if ((SEV_RANK[sev] ?? 0) > (SEV_RANK[b.sev] ?? 0)) b.sev = sev;
    b.members.push([skey, row]);
  }
  // Movement index. A move is only claimed on a 1:1 pairing — exactly one open issue facing
  // exactly one unmatched row; anything else takes the scan-absent/suspect path. A guessed rekey
  // could absorb a genuinely NEW finding into an existing issue.
  const openByPlace = new Map();    // place -> issue[] (open, scanner-row sourced, this area)
  for (const i of Object.values(doc.issues)) {
    if (i.area !== areaSlug || i.state === 'closed') continue;
    if (i.source?.kind !== 'scanner-row' || !i.source.key?.startsWith('sc:')) continue;
    const place = scannerPlaceKey(i.source.key);
    if (!openByPlace.has(place)) openByPlace.set(place, []);
    openByPlace.get(place).push(i);
  }
  const newRowsByPlace = new Map(); // place -> [skey, row][] (rows with no issue of their own yet)
  for (const [skey, { row }] of openRows) {
    if (doc.byKey[skey]) continue;                       // this exact row already has an issue
    const place = scannerPlaceKey(skey);
    if (!newRowsByPlace.has(place)) newRowsByPlace.set(place, []);
    newRowsByPlace.get(place).push([skey, row]);
  }
  const movedRows = new Map();      // place -> [skey, row]   (1:1 pairings only)
  for (const [place, rows] of newRowsByPlace) {
    const held = (openByPlace.get(place) || []).filter((i) => !openRows.has(i.source.key));
    if (held.length === 1 && rows.length === 1) { movedRows.set(place, rows[0]); continue; }
    if (held.length) summary.ambiguousMoves = (summary.ambiguousMoves || 0) + 1;
  }

  const scannerGroups = new Map();  // gs: key -> bucket (the triples that file grouped)
  const individualRows = [];        // [skey, row, category] (the triples that file per row)
  for (const [gkey, b] of buckets) {
    const hasGs = !!doc.byKey[gkey];
    const hasSc = b.members.some(([skey]) => !!doc.byKey[skey]);
    const eligible = groupCategories.has(b.category) || b.members.length >= groupThreshold;
    const grouped = hasGs || (!hasSc && eligible);
    if (grouped) scannerGroups.set(gkey, b);
    else for (const [skey, row] of b.members) individualRows.push([skey, row, b.category]);
  }
  for (const [skey, row, category] of individualRows) {
    // suppressed: an existing open issue owns this finding and is about to be re-pointed here
    if (movedRows.get(scannerPlaceKey(skey))?.[0] === skey) continue;
    const sev = normaliseSeverity(row.sev);
    const repoPath = repoPaths[row.repo] || null;
    let anchor = null;
    if (repoPath) {
      const probe = readAnchorLine(repoPath, { file: row.file, line: row.line });
      if (probe.readable && probe.hash) anchor = { file: row.file, line: row.line, hash: probe.hash };
    }
    fileOrRefresh({
      area: areaSlug, repo: row.repo, kind: 'code', severity: sev,
      title: titleForScannerRow({ ...row, title: ruleTitleOf(category, row.rule) }, category), body: row.message ?? null,
      source: { kind: 'scanner-row', key: skey, tool: category, rule: row.rule ?? null, ...(ruleTitleOf(category, row.rule) ? { ruleTitle: ruleTitleOf(category, row.rule) } : {}), ...(row.model ? { model: row.model } : {}) },
      anchor,
      authorityRequired: AUTHORITY_SCANNER_CATEGORIES.has(category),
    });
    if (anchor && !dryRun) {
      const iss = doc.issues[doc.byKey[skey]];
      // First sighting only — an existing anchor is left alone here; the re-point path owns movement.
      if (iss && !iss.anchor) recordAnchor(iss, anchor, { at, sliceId: rollup.sliceId ?? null, why: 'first sighting' });
    }
    // `scannerAnnotations[]` (what the panel's Mark-FP writes on a scanner row) reaches the store
    // here, as `annotations[]` (dependency waivers) does through `waiverAnn` above. Without it, a
    // row a person dismissed vanishes from the rollup and its issue stays open with no reason.
    //
    // It records a WAIVER, never a close. Same shape as the dependency path and for the same
    // reason: closing on an annotation would let a suppression masquerade as a fix, and the
    // auto-close table is evidence-gated on purpose. The issue stays open and says it is waived.
    applyScannerWaiver(doc, doc.byKey[skey], row, category, { scannerAnnotations, at, dryRun });
  }
  for (const [gkey, g] of scannerGroups) {
    const memberKeys = g.members.map(([skey]) => skey).sort();
    fileOrRefresh({
      area: areaSlug, repo: g.repo, kind: 'code', severity: g.sev,
      title: titleForScannerGroup(g.repo, g.category, g.label, memberKeys.length),
      source: { kind: 'scanner-row', key: gkey, tool: g.category, rule: g.rule },
      groupMembers: memberKeys,
      authorityRequired: AUTHORITY_SCANNER_CATEGORIES.has(g.category),
    });
    if (!dryRun) {
      const iss = doc.issues[doc.byKey[gkey]];
      if (iss && iss.state !== 'closed') {
        if (JSON.stringify(iss.groupMembers) !== JSON.stringify(memberKeys)) {
          iss.groupMembers = memberKeys;
          iss.title = titleForScannerGroup(g.repo, g.category, g.label, memberKeys.length);
          iss.updatedAt = at;
        }
      }
    }
  }

  // -- auto-close table --------------------------------------------------------------------
  for (const iss of Object.values(doc.issues)) {
    if (iss.area !== areaSlug || iss.state === 'closed') continue;
    const src = iss.source || {};
    if (src.kind === 'finding' && src.key?.startsWith('f:')) {
      const raw = src.key.slice(2);
      if (openFindings.has(raw)) continue;                       // still open
      const led = ledgerEvidenceFor(ledger, raw);
      if (led && (led.evidence?.tier === 'strong' || led.evidence?.tier === 'medium')) {
        if (dryRun) { summary.closed.push(`(dry) ${iss.id}`); continue; }
        mutateIssue(doc, iss.id, (i) => {
          i.state = 'closed'; i.closedAs = 'fixed'; i.claim = null; i.suspect = false;
          i.evidence.push({ at, tier: led.evidence.tier, sliceId: rollup.sliceId, detail: led.evidence.detail || `ledger ${led.resolvedSlice}` });
        }, 'issue-closed', { closedAs: 'fixed', tier: led.evidence.tier, auto: true }, at);
        appendRemediationEvent(doc, 'fix-verified', iss.id, {
          at,
          evidence: { note: led.evidence.detail || `ledger ${led.resolvedSlice}`, who: 'scanner' },
          data: { tier: led.evidence.tier, sliceId: rollup.sliceId },
        });
        summary.closed.push(iss.id);
      } else {
        // merely absent (tier weak or no ledger row) — evidence noted, issue STAYS OPEN
        if (!dryRun && appendScanAbsent(iss, rollup.sliceId, 'finding absent from slice; no strong/medium ledger evidence', at)) iss.updatedAt = at;
        summary.carried += 1;
      }
    } else if (src.kind === 'finding' && src.key?.startsWith('g:')) {
      const members = iss.groupMembers || [];
      const stillOpen = members.filter((m) => openFindings.has(m.slice(2)));
      if (stillOpen.length) continue;
      const allProven = members.every((m) => {
        const led = ledgerEvidenceFor(ledger, m.slice(2));
        return led && (led.evidence?.tier === 'strong' || led.evidence?.tier === 'medium');
      });
      if (allProven && members.length) {
        if (dryRun) { summary.closed.push(`(dry) ${iss.id}`); continue; }
        mutateIssue(doc, iss.id, (i) => {
          i.state = 'closed'; i.closedAs = 'fixed'; i.claim = null;
          i.evidence.push({ at, tier: 'strong', sliceId: rollup.sliceId, detail: `all ${members.length} grouped findings resolved with ledger evidence` });
        }, 'issue-closed', { closedAs: 'fixed', auto: true }, at);
        appendRemediationEvent(doc, 'fix-verified', iss.id, {
          at,
          evidence: { note: `all ${members.length} grouped findings resolved with ledger evidence`, who: 'scanner' },
          data: { tier: 'strong', sliceId: rollup.sliceId },
        });
        summary.closed.push(iss.id);
      } else {
        if (!dryRun && appendScanAbsent(iss, rollup.sliceId, 'grouped findings absent; ledger evidence incomplete', at)) iss.updatedAt = at;
        summary.carried += 1;
      }
    } else if (src.kind === 'scanner-row' && src.key?.startsWith('gs:')) {
      if (!categoryRan(src.tool)) { summary.carried += 1; continue; }   // A5: tool didn't run ⇒ untouched
      if ((iss.groupMembers || []).some((m) => openRows.has(m))) continue;  // members still open
      // Grouped rows have no per-row anchor — absence is only ever SUSPECT; never auto-closes.
      if (!dryRun) {
        iss.suspect = true;
        if (appendScanAbsent(iss, rollup.sliceId, 'all grouped rows absent; no per-row anchor evidence', at)) iss.updatedAt = at;
        summary.suspect.push(iss.id);
      } else summary.suspect.push(`(dry) ${iss.id}`);
      summary.carried += 1;
    } else if (src.kind === 'scanner-row') {
      if (!categoryRan(src.tool)) { summary.carried += 1; continue; }   // A5: tool didn't run ⇒ untouched
      if (openRows.has(src.key)) continue;                              // still open
      // A copy under a worktree is a duplicate of the canonical finding, never a fix. Deleting the
      // worktree removes the file, which the anchor probe below reads as FIXED: measured 2026-10-08,
      // 42 such closures, 32 of them from one cleanup that removed five agent worktrees.
      const copy = worktreeCopyOf(src.key);
      if (copy) {
        const canonicalId = doc.byKey[copy.canonicalKey] && doc.byKey[copy.canonicalKey] !== iss.id ? doc.byKey[copy.canonicalKey] : null;
        const detail = `describes a copy of this repository under ${copy.pattern}/${copy.name}${canonicalId ? `; duplicate of ${canonicalId}` : '; no canonical issue holds this place'}`;
        if (dryRun) { summary.worktreeSuperseded = [...(summary.worktreeSuperseded || []), `(dry) ${iss.id}`]; continue; }
        mutateIssue(doc, iss.id, (i) => {
          i.state = 'closed'; i.closedAs = 'superseded'; i.claim = null; i.suspect = false;
          if (canonicalId) i.deps.duplicateOf = canonicalId;
          i.evidence.push({ at, tier: 'worktree-copy', sliceId: rollup.sliceId, detail });
        }, 'issue-closed', { closedAs: 'superseded', ...(canonicalId ? { duplicateOf: canonicalId } : {}), why: 'worktree copy', auto: true }, at);
        summary.worktreeSuperseded = [...(summary.worktreeSuperseded || []), iss.id];
        continue;
      }
      // The ANALYSIS changed, not the code: a row produced under one model and absent under
      // another was never compared. Treated like a tool that did not run, because that is what it
      // is — the reading that found this row has not been performed since.
      const nowModel = modelFor(src.tool);
      if (src.model && nowModel && src.model !== nowModel) {
        if (!dryRun && appendScanAbsent(iss, rollup.sliceId, `absent under ${src.tool} model ${nowModel}; filed under ${src.model} — not comparable`, at)) iss.updatedAt = at;
        summary.carried += 1;
        continue;
      }
      // Moved, not fixed: same rule, same file — re-point and keep open; the duplicate is
      // suppressed in the filing pass above.
      const movedTo = movedRows.get(scannerPlaceKey(src.key));
      if (movedTo) {
        // SC1 at the write: a taken slot means the pairing regressed — refuse the rekey.
        const [nskey, nrow] = movedTo;
        const occupant = doc.byKey[nskey];
        const taken = occupant && occupant !== iss.id && doc.issues[occupant]?.state !== 'closed';
        if (taken) {
          // Refused — deliberately NOT `continue`; fall through so the issue still gets its
          // scan-absent evidence this slice.
          summary.refusedMoves = (summary.refusedMoves || 0) + 1;
        } else {
          if (!dryRun) {
            delete doc.byKey[src.key];
            doc.byKey[nskey] = iss.id;
            iss.source = { ...src, key: nskey };
            const probe2 = readAnchorLine(repoPaths[iss.repo] || null, { file: nrow.file, line: nrow.line });
            // The move site — recordAnchor keeps the old position (D12).
            if (probe2.readable && probe2.hash) {
              recordAnchor(iss, { file: nrow.file, line: nrow.line, hash: probe2.hash },
                { at, sliceId: rollup.sliceId ?? null, why: `re-pointed from ${src.key}` });
            }
            iss.suspect = false;
            iss.updatedAt = at;
            appendIssueEvent(doc, 'issue-updated', iss.id, { moved: { from: src.key, to: nskey } }, at);
          }
          summary.moved = (summary.moved || 0) + 1;
          continue;
        }
      }
      const repoPath = repoPaths[iss.repo] || null;
      const probe = iss.anchor ? readAnchorLine(repoPath, iss.anchor) : { readable: false };
      if (probe.readable && (probe.fileGone || probe.lineGone || (probe.hash && probe.hash !== iss.anchor.hash))) {
        if (dryRun) { summary.closed.push(`(dry) ${iss.id}`); continue; }
        mutateIssue(doc, iss.id, (i) => {
          i.state = 'closed'; i.closedAs = 'fixed'; i.claim = null; i.suspect = false;
          i.evidence.push({ at, tier: 'anchor-drift', sliceId: rollup.sliceId, detail: probe.fileGone ? 'file deleted' : probe.lineGone ? 'line gone' : 'anchored line changed' });
        }, 'issue-closed', { closedAs: 'fixed', tier: 'anchor-drift', auto: true }, at);
        appendRemediationEvent(doc, 'fix-verified', iss.id, {
          at,
          evidence: { note: probe.fileGone ? 'file deleted' : probe.lineGone ? 'line gone' : 'anchored line changed', who: 'scanner' },
          data: { tier: 'anchor-drift', sliceId: rollup.sliceId },
        });
        summary.closed.push(iss.id);
      } else {
        // Row gone but anchor line unchanged/unverifiable — suspect, not fixed.
        if (!dryRun) {
          iss.suspect = true;
          if (appendScanAbsent(iss, rollup.sliceId, 'row absent but anchor line unchanged/unverifiable', at)) iss.updatedAt = at;
          summary.suspect.push(iss.id);
        } else summary.suspect.push(`(dry) ${iss.id}`);
        summary.carried += 1;
      }
    }
    // manual / queue issues are never auto-closed
  }

  if (!dryRun) doc.lastIngest[areaSlug] = { sliceId: rollup.sliceId, generated: rollup.generated };
  return summary;
}
