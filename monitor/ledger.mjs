// commitwork monitor — verified-remediation ledger (what was CLEANED, not just cleanable).
// A finding that vanished between two v1 slices only counts as cleaned with evidence:
//   strong = the package version provably changed (lockfile diff between the slices' git anchors)
//   medium = finding gone + its tool ran ok + a fix version was known at the time
//   weak   = merely absent -> ledgered as 'unconfirmed', NEVER counted as cleaned
// Entries upsert on (key, resolvedSlice) so re-rollups are idempotent.
import { readFileSync, writeFileSync } from 'node:fs';
import { scannedGit } from '../bin/lib/git-env.mjs';

const PKG_RE = /^[@\w./:-]+$/; // package names come from external CVE feeds — validate before any subprocess arg

const git = (cwd, args) => {
  if (!cwd) return null;
  // a fleet repo: `log -S` diffs through its textconv under a plain git
  const r = scannedGit(cwd, args, { maxBuffer: 64 * 1024 * 1024 });
  return !r.error && r.status === 0 ? r.stdout : null;
};

function lockfileVersion(repoPath, sha, lockPath, pkg) {
  if (!repoPath || !sha || !lockPath || !PKG_RE.test(pkg)) return null;
  const txt = git(repoPath, ['show', `${sha}:${lockPath}`]);
  if (!txt) return null;
  try {
    const d = JSON.parse(txt);
    return (d.packages && d.packages[`node_modules/${pkg}`] && d.packages[`node_modules/${pkg}`].version)
        || (d.dependencies && d.dependencies[pkg] && d.dependencies[pkg].version) || null;
  } catch { return null; }
}

export function updateLedger({ ledgerPath, sliceId, prevSliceId, candidates, anchors, prevAnchors, generated }) {
  let ledger = { note: 'verified remediation ledger — append-only, upsert on (key, resolvedSlice); weak tier is unconfirmed, not cleaned', entries: [] };
  try { const j = JSON.parse(readFileSync(ledgerPath, 'utf8')); if (j && Array.isArray(j.entries)) ledger = j; } catch {}
  const byNk = new Map(ledger.entries.map((e) => [`${e.key}|${e.resolvedSlice}`, e]));
  const results = [];
  for (const p of candidates) {
    const key = p.key || `${p.repo}|${p.tool}|${p.id}|${p.package}|${p.path || ''}`;
    let tier = 'weak', detail = 'finding absent; tool ran; no fix version known';
    let fromVersion = p.version || '', toVersion = '', fixCommit = null;
    const curA = anchors[p.repo], prevA = prevAnchors[p.repo];
    // strong evidence: npm lockfile diff between the two slices' anchors (JVM stays medium-max
    // until a lockfile probe exists — never infer strong from absence)
    if (p.tool === 'npm' && p.path && curA && curA.sha && prevA && prevA.sha) {
      const from = lockfileVersion(curA.path, prevA.sha, p.path, p.package);
      const to = lockfileVersion(curA.path, curA.sha, p.path, p.package);
      if (from && to && from !== to) { tier = 'strong'; detail = `${p.path}: ${p.package} ${from} -> ${to}`; fromVersion = from; toVersion = to; }
      else if (from && to === null) { tier = 'strong'; detail = `${p.path}: ${p.package}@${from} removed`; fromVersion = from; }
      if (tier === 'strong' && PKG_RE.test(p.package)) {
        const log = git(curA.path, ['log', '--format=%H', `${prevA.sha}..${curA.sha}`, '-S', p.package, '--', p.path]);
        if (log) fixCommit = log.split('\n').filter(Boolean).pop() || null; // earliest touching commit
      }
    }
    if (tier === 'weak' && p.fixed) { tier = 'medium'; detail = `finding gone; tool ran ok; fix ${p.fixed} was known`; }
    const nk = `${key}|${sliceId}`;
    const existing = byNk.get(nk);
    const entry = { key, legacyKey: p.legacyKey || `${p.repo}|${p.id}|${p.package}`, vulnId: p.id, repo: p.repo, tool: p.tool,
      package: p.package, path: p.path || '', severity: p.severity, fromVersion, toVersion, fixCommit,
      bornSlice: p.bornSlice || null, resolvedSlice: sliceId, prevSlice: prevSliceId || null,
      at: existing ? existing.at : generated, // first-observed resolution time survives re-rollups
      evidence: { tier, detail } };
    byNk.set(nk, entry);
    results.push(entry);
  }
  ledger.entries = [...byNk.values()];
  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
  return { entries: results,
    cleaned: results.filter((e) => e.evidence.tier !== 'weak'),
    unconfirmed: results.filter((e) => e.evidence.tier === 'weak') };
}
