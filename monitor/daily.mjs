// monitor/daily.mjs — the /daily digest (schema/daily-digest.schema.json): an area's newest complete
// sweep compared with the complete sweep before it. Code findings become items with the lines around
// them; findings under the area's declared data paths are counted per rule. Pure functions over parsed
// inputs, and readers that take every path as an argument.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { scannedGitOut } from '../bin/lib/git-env.mjs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { checkForScanner } from './scanner-checks.mjs';

export const DIGEST_SCHEMA = 'commitwork.daily-digest/1';
export const SECRET_CATEGORIES = new Set(['secrets', 'secretsHistory', 'mainframeSecrets']);
const HYGIENE_CATEGORIES = new Set(['cobolCoverage', 'commitProvenance', 'minifiedCode', 'accessibility', 'shellLint', 'actionsLint', 'agentConfig']);
const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
const ROW_SEVERITY = {
  crit: 'critical', critical: 'critical', high: 'high', error: 'high',
  med: 'medium', medium: 'medium', moderate: 'medium', warning: 'medium',
  low: 'low', note: 'low', info: 'info',
};
const OPEN_DEPENDENCY_STATES = new Set(['born', 'persisting']);
const BATCH_DIR = /^sweep-(\d{14})-(.+)$/;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const itemId = (repo, category, rule, file) => sha256(`${repo}|${category}|${rule}|${file}`).slice(0, 16);
export const kindOf = (category) => (HYGIENE_CATEGORIES.has(category) || /^(lint|format)[A-Z]/.test(category) ? 'hygiene' : 'security');
const normalisePath = (file) => String(file ?? '').replace(/^\.\//, '');

export function severityOf(row, category) {
  const fromRow = ROW_SEVERITY[String(row.sev ?? row.severity ?? '').toLowerCase()];
  if (fromRow) return { severity: fromRow, severitySource: 'row' };
  return { severity: SECRET_CATEGORIES.has(category) ? 'high' : 'low', severitySource: 'category-default' };
}

export function pathClassOf(file, dataPaths) {
  const f = normalisePath(file);
  return dataPaths.some((p) => f.startsWith(p)) ? 'data' : 'code';
}

const laneOf = (category) => (category === 'dependencies' ? 'deps' : checkForScanner(category) ?? category);

/** Every open finding of `repo` in a rollup, grouped by identity: { id -> group }. Lines merge; identity never includes one. */
export function groupFindings(rollup, repo) {
  const groups = new Map();
  const add = (category, rule, file, line, row) => {
    const id = itemId(repo, category, rule, normalisePath(file));
    let g = groups.get(id);
    if (!g) groups.set(id, (g = { id, category, rule, file: normalisePath(file), lines: [], rows: [] }));
    if (Number.isInteger(line) && line > 0 && !g.lines.includes(line)) g.lines.push(line);
    g.rows.push(row);
  };
  for (const [category, rows] of Object.entries(rollup.scannerFindings ?? {})) {
    for (const row of rows ?? []) if (row?.repo === repo) add(category, String(row.rule ?? ''), row.file, row.line, row);
  }
  for (const row of rollup.findings ?? []) {
    if (row?.repo === repo && OPEN_DEPENDENCY_STATES.has(row.state)) add('dependencies', String(row.id ?? ''), row.path ?? row.package ?? '', null, row);
  }
  for (const g of groups.values()) g.lines.sort((a, b) => a - b);
  return groups;
}

/**
 * A batch the digest may read: a full-lane sweep (group "all"; the weekly deep group runs a handful of
 * lanes, so comparing across groups would read every lane it skipped as unmeasured) that reached its
 * end, published its rollup, scanned every repo, and covers the members.
 */
export function batchIsComplete({ manifest, verdict }, members, group = 'all') {
  if (!manifest || !verdict) return false;
  if (manifest.only || manifest.group !== group) return false;
  if (verdict.rollup !== 'published') return false;
  const repos = verdict.repos ?? {};
  if (!(repos.resolved > 0) || repos.scanned !== repos.resolved) return false;
  if (!(repos.scans ?? []).every((s) => s.ran)) return false;
  const scoped = new Set((manifest.scope?.repos ?? []).map((r) => r.name));
  return members.every((m) => scoped.has(m));
}

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));
const readJsonIfPresent = (path) => {
  try { return readJson(path); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
};

/** The newest complete batch of `area` and the complete one before it: { current, previous } (either may be null). */
export function selectBatches(reportsRoot, area, members, { inflight = null } = {}) {
  const dirs = readdirSync(reportsRoot).map((d) => d.match(BATCH_DIR)).filter((m) => m && m[2] === area)
    .map((m) => ({ dir: join(reportsRoot, m[0]), sliceId: `sweep-${m[1]}`, stamp: m[1] }))
    .sort((a, b) => b.stamp.localeCompare(a.stamp));
  const complete = [];
  for (const b of dirs) {
    if (inflight && inflight === b.sliceId) continue;
    const verdict = readJsonIfPresent(join(b.dir, 'batch-verdict.json'));
    if (!verdict) continue;
    const manifest = readJson(join(b.dir, 'batch-manifest.json'));
    if (batchIsComplete({ manifest, verdict }, members)) complete.push({ ...b, manifest, verdict });
    if (complete.length === 2) break;
  }
  return { current: complete[0] ?? null, previous: complete[1] ?? null };
}

const STATUS_STATE = { pass: 'ran', fail: 'failed', noscan: 'void', skip: 'skipped', timeout: 'timed-out', 'timed-out': 'timed-out' };

/** Per check: { state, toolVersion } from a repo's directory in a batch. */
export function laneStates(repoDir) {
  const out = new Map();
  const status = readJsonIfPresent(join(repoDir, 'checks-status.json')) ?? [];
  for (const s of status) {
    let toolVersion = null;
    const tv = readJsonIfPresent(join(repoDir, `tool-version-${s.check}.json`));
    if (tv?.tools) {
      toolVersion = Object.entries(tv.tools).map(([n, t]) => `${n}@${t.version ?? '?'}${t.commit ? `+${String(t.commit).slice(0, 7)}` : ''}`).sort().join(',') || null;
    }
    out.set(s.check, { state: STATUS_STATE[s.status] ?? 'void', toolVersion, note: s.coverageReason ? String(s.coverageReason).slice(0, 300) : null });
  }
  return out;
}

const expandHome = (p) => (p?.startsWith('~/') ? join(homedir(), p.slice(2)) : p);
const git = (dir, args) => scannedGitOut(dir, args, { maxBuffer: 64 * 1024 * 1024 }); // dir is a fleet repo

/** Files renamed between two commits: { newPath -> oldPath }. Empty when either commit is missing. */
export function renamesBetween(repoPath, from, to) {
  const map = new Map();
  if (!from || !to || from === to) return map;
  try {
    for (const line of git(repoPath, ['diff', '--name-status', '-M', from, to]).split('\n')) {
      const [status, oldPath, newPath] = line.split('\t');
      if (status?.startsWith('R') && oldPath && newPath) map.set(newPath, oldPath);
    }
  } catch { /* an unreachable commit leaves renames unknown, never invented */ }
  return map;
}

export function commitsBetween(repoPath, from, to, limit = 50) {
  if (!from || !to || from === to) return { commits: [], truncated: false };
  let out;
  try { out = git(repoPath, ['log', `--max-count=${limit + 1}`, '--format=%x1e%H%x1f%s', '--name-only', `${from}..${to}`]); } catch {
    return { commits: [], truncated: true };
  }
  const commits = out.split('\x1e').filter(Boolean).map((block) => {
    const [head, ...files] = block.split('\n');
    const [sha, subject] = head.split('\x1f');
    return { sha, subject: (subject ?? '').slice(0, 200), files: files.filter(Boolean).slice(0, 40) };
  });
  return { commits: commits.slice(0, limit), truncated: commits.length > limit };
}

/** The lines around `line` of `file` at `sha`, or null when the file cannot be read as text. */
export function contextAt(repoPath, sha, file, line, n, cache = new Map()) {
  const key = `${sha}:${file}`;
  if (!cache.has(key)) {
    let text = null;
    try { text = git(repoPath, ['show', `${sha}:${file}`]); } catch { text = null; }
    cache.set(key, text !== null && !text.includes('\0') ? text.split('\n') : null);
  }
  const lines = cache.get(key);
  if (!lines || !(line >= 1) || line > lines.length) return null;
  const start = Math.max(1, line - n);
  return { startLine: start, text: lines.slice(start - 1, Math.min(lines.length, line + n)).join('\n').slice(0, 2000) };
}

const ITEM_ORDER = (a, b) => (a.state === b.state ? 0 : a.state === 'new' ? -1 : 1)
  || SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]
  || (a.kind === b.kind ? 0 : a.kind === 'security' ? -1 : 1)
  || (a.pathClass === b.pathClass ? 0 : a.pathClass === 'code' ? -1 : 1)
  || a.id.localeCompare(b.id);

const DETAIL_KEYS = ['remedy', 'reach', 'effect', 'program', 'evidence', 'package', 'version', 'fixed', 'advisory'];
const detailOf = (row) => Object.fromEntries(DETAIL_KEYS.filter((k) => typeof row[k] === 'string' && row[k]).map((k) => [k, row[k].slice(0, 400)]));
const redacted = (category, rows) => SECRET_CATEGORIES.has(category) || rows.some((r) => r.redacted === true);

/**
 * One repo's part of the digest. `cur`/`prev` are groupFindings() results; `lanes`/`prevLanes` are
 * laneStates(); `baseline` is null or the reason nothing here can be called new.
 */
export function repoDigest({ repo, cur, prev, lanes, prevLanes, baseline, dataPaths, renames, currentBatch, firstSeenOf = () => null, maxItems, contextLines, readContext }) {
  const laneOk = (category) => {
    const lane = laneOf(category);
    const now = lanes.get(lane);
    const before = prevLanes.get(lane);
    if (category === 'dependencies') return { ran: true, toolChanged: false };
    return { ran: now?.state === 'ran' && before?.state === 'ran', toolChanged: !!(now?.toolVersion && before?.toolVersion && now.toolVersion !== before.toolVersion) };
  };
  const prevById = new Map(prev);
  const renamedFrom = new Map();
  for (const g of cur.values()) {
    if (prevById.has(g.id)) continue;
    const old = renames.get(g.file);
    if (!old) continue;
    const oldId = itemId(repo, g.category, g.rule, old);
    if (prevById.has(oldId)) { renamedFrom.set(g.id, { file: old, prevGroup: prevById.get(oldId) }); prevById.delete(oldId); }
  }

  const items = [];
  const aggregates = new Map();
  const bump = (g, field) => {
    const key = `${g.category}|${g.rule}`;
    let a = aggregates.get(key);
    if (!a) aggregates.set(key, (a = { category: g.category, rule: g.rule, count: 0, new: 0, fixed: 0, paths: [] }));
    a[field] += 1;
    const prefix = dataPaths.find((p) => g.file.startsWith(p));
    if (prefix && !a.paths.includes(prefix) && a.paths.length < 10) a.paths.push(prefix);
  };

  for (const g of cur.values()) {
    const before = prevById.get(g.id) ?? renamedFrom.get(g.id)?.prevGroup ?? null;
    const beforeId = prevById.has(g.id) ? g.id : renamedFrom.has(g.id) ? itemId(repo, g.category, g.rule, renamedFrom.get(g.id).file) : null;
    const state = baseline || !before ? 'new' : 'persisting';
    const pathClass = pathClassOf(g.file, dataPaths);
    if (pathClass === 'data') {
      bump(g, 'count');
      if (state === 'new') bump(g, 'new');
      if (baseline || state !== 'new') continue;
    }
    const row = g.rows[0];
    const { severity, severitySource } = severityOf(row, g.category);
    const item = {
      id: g.id, category: g.category, lane: laneOf(g.category), kind: kindOf(g.category), rule: g.rule,
      severity, severitySource, file: g.file, pathClass, lines: g.lines.slice(0, 50),
      occurrences: Math.max(1, g.rows.length), previousOccurrences: before ? before.rows.length : 0,
      message: String(row.message ?? row.title ?? '').slice(0, 600),
      state, firstSeenBatch: baseline ? null : before ? firstSeenOf(beforeId) : currentBatch, context: null,
    };
    if (renamedFrom.has(g.id)) item.renamedFrom = renamedFrom.get(g.id).file;
    if (row.cwe) item.cwe = String(row.cwe);
    const detail = detailOf(row);
    if (Object.keys(detail).length) item.detail = detail;
    if (!redacted(g.category, g.rows) && g.lines.length && contextLines > 0) item.context = readContext(g.file, g.lines[0], contextLines);
    items.push(item);
  }

  const fixed = [];
  const carried = [];
  for (const [id, g] of prevById) {
    if (cur.has(id)) continue;
    const { ran, toolChanged } = laneOk(g.category);
    if (pathClassOf(g.file, dataPaths) === 'data') { if (ran && !toolChanged) bump(g, 'fixed'); continue; }
    if (ran && !toolChanged) fixed.push({ id, rule: g.rule, file: g.file });
    else carried.push(id);
  }

  items.sort(ITEM_ORDER);
  const shown = items.slice(0, maxItems);
  const omittedIds = items.slice(maxItems).map((i) => i.id);
  // A skipped lane does not apply to this repo (its language or files are absent); listing it would read as a gap.
  const laneList = [...lanes].filter(([, s]) => s.state !== 'skipped').map(([lane, s]) => {
    const before = prevLanes.get(lane);
    const toolChanged = !!(s.toolVersion && before?.toolVersion && s.toolVersion !== before.toolVersion);
    const findings = s.state === 'ran' ? [...cur.values()].filter((g) => laneOf(g.category) === lane).length : null;
    return { lane, state: s.state, findings, toolVersion: s.toolVersion, previousToolVersion: before?.toolVersion ?? null, toolChanged, ...(s.note ? { note: s.note } : {}) };
  }).sort((a, b) => a.lane.localeCompare(b.lane));
  return {
    items: shown, omittedIds, fixed: fixed.sort((a, b) => a.id.localeCompare(b.id)), carried: carried.sort(),
    aggregates: [...aggregates.values()].filter((a) => a.count || a.fixed).sort((a, b) => b.count - a.count || a.rule.localeCompare(b.rule)),
    lanes: laneList,
  };
}

export const digestIdOf = (doc) => sha256(JSON.stringify({ ...doc, digestId: '' }));

/** Shrink to `maxBytes`: drop context from the lowest-ranked items first, then move them to omittedIds. */
export function fitDigest(doc, maxBytes) {
  const size = () => Buffer.byteLength(JSON.stringify(doc));
  const ranked = () => doc.repos.flatMap((r) => r.items.map((item) => ({ r, item }))).sort((a, b) => ITEM_ORDER(b.item, a.item));
  for (const { item } of ranked()) { if (size() <= maxBytes) break; item.context = null; }
  for (const { r, item } of ranked()) {
    if (size() <= maxBytes) break;
    r.items = r.items.filter((i) => i !== item);
    r.omittedIds.push(item.id);
  }
  return doc;
}

/**
 * Builds the digest for `area` from the reports root. `config` is the area's entry in the daily
 * config; `previousConfigSha` is the config hash the last digest used (null when unknown).
 */
export function buildDigest({ reportsRoot, areaOut, area, members, config, configSha256, previousConfigSha = null, now = new Date(), inflight = null, guidanceFor = () => null, firstSeenOf = () => null }) {
  const { current, previous } = selectBatches(reportsRoot, area, members, { inflight });
  if (!current) return { digest: null, reason: `no complete ${area} batch under ${reportsRoot}` };
  const rollup = readJson(join(areaOut, `rollup-${current.sliceId}.json`));
  const prevRollup = previous ? readJsonIfPresent(join(areaOut, `rollup-${previous.sliceId}.json`)) : null;
  const maxItems = config.maxItemsPerRepo ?? 60;
  const contextLines = config.contextLines ?? 3;
  const maxDigestBytes = config.maxDigestBytes ?? 400_000;
  const configChanged = previousConfigSha !== null && previousConfigSha !== configSha256;

  const repos = [];
  for (const name of [...members].sort()) {
    const anchor = current.manifest.anchors?.[name];
    if (!anchor?.sha) throw new Error(`daily: batch ${current.sliceId} has no anchor for ${name}`);
    const repoPath = expandHome(anchor.path);
    try { git(repoPath, ['cat-file', '-e', `${anchor.sha}^{commit}`]); } catch {
      throw new Error(`daily: ${name}'s anchor ${anchor.sha} is not a commit in ${repoPath}; the batch is not trusted`);
    }
    const prevAnchor = previous?.manifest.anchors?.[name] ?? null;
    const inPrevious = !!(prevRollup && prevAnchor && (previous.manifest.scope?.repos ?? []).some((r) => r.name === name));
    const baseline = !previous ? 'first-sweep' : !prevRollup ? 'previous-missing' : !inPrevious ? 'repo-added' : configChanged ? 'config-changed' : null;
    const dataPaths = config.repos?.[name]?.dataPaths ?? [];
    const cur = groupFindings(rollup, name);
    const prev = inPrevious ? groupFindings(prevRollup, name) : new Map();
    const lanes = laneStates(join(current.dir, name));
    const prevLanes = inPrevious ? laneStates(join(previous.dir, name)) : new Map();
    const cache = new Map();
    const part = repoDigest({
      repo: name, cur, prev, lanes, prevLanes, baseline, dataPaths, currentBatch: current.sliceId, firstSeenOf, maxItems, contextLines,
      renames: inPrevious ? renamesBetween(repoPath, prevAnchor.sha, anchor.sha) : new Map(),
      readContext: (file, line, n) => contextAt(repoPath, anchor.sha, file, line, n, cache),
    });
    const { commits, truncated } = inPrevious ? commitsBetween(repoPath, prevAnchor.sha, anchor.sha) : { commits: [], truncated: false };
    repos.push({
      name, head: anchor.sha, headDirty: !!anchor.dirty, previousHead: inPrevious ? prevAnchor.sha : null, baseline, dataPaths,
      commitsSince: commits, commitsTruncated: truncated, lanes: part.lanes,
      items: part.items, omittedIds: part.omittedIds, fixed: part.fixed, carried: part.carried, aggregates: part.aggregates,
    });
  }

  const stampMs = (sliceId) => Date.parse(sliceId.replace(/^sweep-(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3T$4:$5:$6Z'));
  // Guidance only for lanes with an item to act on: the rest was 40% of a measured digest and none of its use.
  const guidance = {};
  for (const lane of [...new Set(repos.flatMap((r) => r.items.map((i) => i.lane)))].sort()) { const g = guidanceFor(lane); if (g) guidance[lane] = String(g).slice(0, 3000); }
  const scans = current.verdict.repos?.scans ?? [];
  const doc = {
    schema: DIGEST_SCHEMA, digestId: '', area, batch: current.sliceId, previousBatch: previous?.sliceId ?? null,
    gapDays: previous ? Math.round(((stampMs(current.sliceId) - stampMs(previous.sliceId)) / 86_400_000) * 10) / 10 : null,
    generatedAt: now.toISOString(), config: { sha256: configSha256 },
    batchHealth: {
      rollup: current.verdict.rollup, reposResolved: current.verdict.repos?.resolved ?? 0, reposScanned: current.verdict.repos?.scanned ?? 0,
      scansRan: scans.filter((s) => s.ran).length, scansTotal: scans.length,
    },
    repos, guidance, limits: { maxItemsPerRepo: maxItems, contextLines, maxDigestBytes },
  };
  fitDigest(doc, maxDigestBytes);
  doc.digestId = digestIdOf(doc);
  return { digest: doc, reason: null };
}
