// lib/remediation-candidates.mjs — turn a hardener's unified diff into remediation.json candidates.
// A pure function over what the hardener returned: a changed file becomes a deterministic candidate
// for each finding that names it, and a file no finding names is reported rather than guessed at.
// The patch is sliced out of the input diff, not re-rendered, so the bytes git would apply are the
// bytes the hardener produced.

import { TIERS, candidateId } from './remediation-contract.mjs';
import { parseUnifiedDiff } from './unified-diff.mjs';

const DETERMINISTIC_TIER = TIERS.find((t) => t === 'deterministic');

const cmpStr = (a, b) => (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
const byIdentityThenOccurrence = (a, b) => cmpStr(a.identity, b.identity)
  || (Number(a.occurrence) || 0) - (Number(b.occurrence) || 0);

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const GIT_RE = /^diff --git a\/(.*) b\/(.*)$/;
const NO_NEWLINE = '\\ No newline at end of file';

// The line each file's diff starts on, mirroring the file-header rules parseUnifiedDiff applies.
// The parser validates the text; this only locates the bytes so each file can be sliced intact.
function fileStartLines(lines) {
  const starts = [];
  let sawHeader = false;
  let hasHunks = false;
  let needOld = 0;
  let needNew = 0;
  let inHunk = false;
  for (let k = 0; k < lines.length; k++) {
    const line = lines[k];
    if (inHunk) {
      if (line === NO_NEWLINE) continue;
      if (line.startsWith(' ')) { needOld--; needNew--; }
      else if (line.startsWith('+')) needNew--;
      else if (line.startsWith('-')) needOld--;
      if (needOld === 0 && needNew === 0) inHunk = false;
      continue;
    }
    const hm = HUNK_RE.exec(line);
    if (hm) {
      needOld = hm[2] === undefined ? 1 : +hm[2];
      needNew = hm[4] === undefined ? 1 : +hm[4];
      hasHunks = true;
      inHunk = needOld > 0 || needNew > 0;
      continue;
    }
    if (GIT_RE.test(line)) {
      starts.push(k);
      sawHeader = false;
      hasHunks = false;
      continue;
    }
    if (line.startsWith('--- ') && lines[k + 1] !== undefined && lines[k + 1].startsWith('+++ ')) {
      if (!(starts.length && !sawHeader && !hasHunks)) starts.push(k);
      sawHeader = true;
      k++;
    }
  }
  return starts;
}

function lineOffsets(lines) {
  const offsets = [];
  let at = 0;
  for (const line of lines) {
    offsets.push(at);
    at += line.length + 1;
  }
  return offsets;
}

function unverified() {
  return {
    status: 'unverified',
    witness: { lanes: [], before: 0, after: null, digest: null },
    newFindings: [],
    tests: { command: null, status: 'notDeclared' },
    reason: null,
  };
}

const isOptionalString = (v) => v === null || typeof v === 'string';

function checkInputs({ findings, diff, tool, version }) {
  if (!Array.isArray(findings)) throw new TypeError('candidatesFromDiff: findings must be an array');
  if (typeof diff !== 'string') throw new TypeError('candidatesFromDiff: diff must be a string');
  if (!isOptionalString(tool)) throw new TypeError('candidatesFromDiff: tool must be a string or null');
  if (!isOptionalString(version)) throw new TypeError('candidatesFromDiff: version must be a string or null');
  for (const [i, f] of findings.entries()) {
    if (!f || typeof f !== 'object' || Array.isArray(f)) throw new TypeError(`candidatesFromDiff: findings[${i}] must be an object`);
    if (typeof f.identity !== 'string' || f.identity === '') throw new TypeError(`candidatesFromDiff: findings[${i}].identity must be a non-empty string`);
    if (!Number.isInteger(f.occurrence) || f.occurrence < 0) throw new TypeError(`candidatesFromDiff: findings[${i}].occurrence must be a non-negative integer`);
    if (!isOptionalString(f.file)) throw new TypeError(`candidatesFromDiff: findings[${i}].file must be a string or null`);
  }
}

/**
 * `{ candidates, unattributed }` for a hardener's diff and the findings it was asked about.
 * `candidates` holds `{ identity, occurrence, candidate }` sorted by identity then occurrence;
 * `unattributed` holds `{ path }` for every changed file no finding names, sorted by path. A finding
 * the diff leaves unchanged contributes nothing. Malformed input throws; an unparseable diff throws.
 */
export function candidatesFromDiff(input = {}) {
  const { findings, diff, tool, version } = input ?? {};
  checkInputs({ findings, diff, tool, version });
  if (DETERMINISTIC_TIER === undefined) throw new Error('remediation-candidates: the contract has no deterministic tier');

  const parsed = parseUnifiedDiff(diff);
  const lines = diff.split('\n');
  const starts = fileStartLines(lines);
  if (parsed.length !== starts.length) throw new Error('remediation-candidates: could not locate every file in the diff');
  const offsets = lineOffsets(lines);

  const changed = new Map();
  for (let i = 0; i < parsed.length; i++) {
    const path = parsed[i].newPath ?? parsed[i].oldPath;
    if (path === null) continue;
    const start = offsets[starts[i]];
    const end = i + 1 < starts.length ? offsets[starts[i + 1]] : diff.length;
    const patch = diff.slice(start, end);
    // The scan above is a second reading of the header rules, so each slice is checked against the parser.
    const again = parseUnifiedDiff(patch);
    if (again.length !== 1 || (again[0].newPath ?? again[0].oldPath) !== path || again[0].hunks.length !== parsed[i].hunks.length) {
      throw new Error(`remediation-candidates: the slice for ${path} does not parse back to that one file`);
    }
    changed.set(path, changed.has(path) ? changed.get(path) + patch : patch);
  }

  const named = new Set(findings.map((f) => f.file).filter((p) => typeof p === 'string'));

  const candidates = [];
  for (const f of findings) {
    if (typeof f.file !== 'string') continue;
    const patch = changed.get(f.file);
    if (patch === undefined) continue;
    candidates.push({
      identity: f.identity,
      occurrence: f.occurrence,
      candidate: {
        id: candidateId({ identity: f.identity, tier: DETERMINISTIC_TIER, patch }),
        tier: DETERMINISTIC_TIER,
        provenance: { tool, model: null, version },
        patch,
        cached: false,
        verification: unverified(),
      },
    });
  }
  candidates.sort(byIdentityThenOccurrence);

  const unattributed = [...changed.keys()]
    .filter((path) => !named.has(path))
    .sort(cmpStr)
    .map((path) => ({ path }));

  return { candidates, unattributed };
}

/**
 * The findings array with each produced candidate appended to the finding sharing its
 * (identity, occurrence). A candidate whose id the finding already holds is skipped. A produced
 * candidate with no matching finding throws: build the findings first. Inputs are not mutated.
 */
export function mergeCandidates(remediationFindings, produced) {
  if (!Array.isArray(remediationFindings)) throw new TypeError('mergeCandidates: remediationFindings must be an array');
  if (!Array.isArray(produced)) throw new TypeError('mergeCandidates: produced must be an array');

  const out = remediationFindings.map((f) => ({ ...f, candidates: [...(f.candidates || [])] }));
  const byKey = new Map();
  for (const f of out) {
    const key = `${f.identity}\u0000${f.occurrence}`;
    if (!byKey.has(key)) byKey.set(key, f);
  }

  for (const p of produced) {
    const finding = byKey.get(`${p.identity}\u0000${p.occurrence}`);
    if (!finding) throw new Error(`mergeCandidates: no finding for ${p.identity} occurrence ${p.occurrence}`);
    const id = p.candidate.id;
    if (!finding.candidates.some((c) => c.id === id)) finding.candidates.push(p.candidate);
  }
  return out;
}
