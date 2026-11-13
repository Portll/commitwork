// lib/remediation-candidates-workflow.mjs — connect a GitHub Actions finding to the pure text fixer
// that repairs it. The caller reads the workflow and supplies the SHA resolver; the fixer rewrites
// the file, and the diff, tier, id and verification come from the shared candidate builder.

import { candidatesFromDiff } from './remediation-candidates.mjs';
import { unifiedDiff } from './unified-diff.mjs';
import { pinUses, addPersistCredentials } from '../monitor/workflow-harden.mjs';

const UNPINNED_USES = 'actionsPosture/zizmor/unpinned-uses';
const ARTIPACKED = 'actionsPosture/zizmor/artipacked';

// Each fixer rewrites the whole file: a finding's identity excludes the line number, so a verified
// fix must clear every occurrence at once. `unpinned` is pinUses's skipped list, in file order.
// `fixed` is the fixer's own count: both rejoin a mixed-ending file with CRLF, so the text can
// differ when nothing was fixed.
const FIXERS = new Map([
  [UNPINNED_USES, (text, resolveSha) => {
    const { text: fixedText, pinned, skipped } = pinUses(text, resolveSha);
    return { fixedText, fixed: pinned.length, unpinned: skipped };
  }],
  [ARTIPACKED, (text) => {
    const { text: fixedText, changed } = addPersistCredentials(text);
    return { fixedText, fixed: changed, unpinned: [] };
  }],
]);

const SKIP_REASONS = new Map([
  [UNPINNED_USES, (unpinned) => (unpinned.length > 0
    ? 'no action in the file could be pinned'
    : 'the file has no action left to pin')],
  [ARTIPACKED, () => 'no actions/checkout step lacks persist-credentials'],
]);

const isPlainObject = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v !== '';

function checkInput(input) {
  if (!isPlainObject(input)) throw new TypeError('workflowCandidates: input must be a plain object');
  const { finding, text, resolveSha } = input;
  if (!isPlainObject(finding)) throw new TypeError('workflowCandidates: finding must be a plain object');
  if (!isNonEmptyString(finding.identity)) throw new TypeError('workflowCandidates: finding.identity must be a non-empty string');
  if (!isNonEmptyString(finding.ruleId)) throw new TypeError('workflowCandidates: finding.ruleId must be a non-empty string');
  if (!Number.isInteger(finding.occurrence) || finding.occurrence < 0) throw new TypeError('workflowCandidates: finding.occurrence must be a non-negative integer');
  if (!(typeof finding.file === 'string' || finding.file === null)) throw new TypeError('workflowCandidates: finding.file must be a string or null');
  if (typeof text !== 'string') throw new TypeError('workflowCandidates: text must be a string');
  if (finding.ruleId === UNPINNED_USES && typeof resolveSha !== 'function') throw new TypeError('workflowCandidates: resolveSha must be a function');
}

/**
 * `{ candidates, skipped, unpinned }` for one finding and the current text of its file. `candidates`
 * is what `candidatesFromDiff` returns; `skipped` is null when a candidate was produced and
 * `{ reason }` otherwise; `unpinned` is pinUses's skipped list (`{ action, ref, reason }`) or `[]`.
 * Pure: no file, environment, clock or child process is touched. Malformed input throws.
 */
export function workflowCandidates(input) {
  checkInput(input);
  const { finding, text, resolveSha, tool, version } = input;

  if (finding.file === null) {
    return { candidates: [], skipped: { reason: 'the finding names no file' }, unpinned: [] };
  }

  const fix = FIXERS.get(finding.ruleId);
  if (fix === undefined) {
    return { candidates: [], skipped: { reason: `no deterministic fix for ${finding.ruleId}` }, unpinned: [] };
  }

  const { fixedText, fixed, unpinned } = fix(text, resolveSha);
  if (fixed === 0) {
    return { candidates: [], skipped: { reason: SKIP_REASONS.get(finding.ruleId)(unpinned) }, unpinned };
  }

  const diff = unifiedDiff(finding.file, text, fixedText);
  const { candidates } = candidatesFromDiff({ findings: [finding], diff, tool, version });
  return { candidates, skipped: null, unpinned };
}
