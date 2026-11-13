// lib/remediation-candidates-agent.mjs — connect an agent-surface finding to the pure text fixer
// that repairs it, and hand the fixer's diff to candidatesFromDiff. One finding and the current
// text of its file: the caller reads the file and passes it. No I/O, no clock, no environment.

import { candidatesFromDiff } from './remediation-candidates.mjs';
import { unifiedDiff } from './unified-diff.mjs';
import { stripHidden } from '../monitor/agent-instructions-harden.mjs';
import { addCredentialDeny } from '../monitor/agent-config-harden.mjs';

const NO_HIDDEN = 'the file holds no hidden character';

// One entry per whole ruleId: the fixer's text output and, when it declines to change anything,
// the reason a caller reports. Only the two rules with a text fixer appear here.
const FIXERS = new Map([
  ['agentInstructions/hidden-unicode', (text) => ({ text: stripHidden(text).text, reason: NO_HIDDEN })],
  ['agentConfig/permissions-deny-missing', (text) => {
    const out = addCredentialDeny(text);
    return { text: out.text, reason: out.reason };
  }],
]);

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function checkInput(input) {
  if (!isPlainObject(input)) throw new TypeError('agentCandidates: the argument must be an object');
  const { finding, text } = input;
  if (!isPlainObject(finding)) throw new TypeError('agentCandidates: finding must be an object');
  if (typeof finding.identity !== 'string' || finding.identity === '') throw new TypeError('agentCandidates: finding.identity must be a non-empty string');
  if (typeof finding.ruleId !== 'string' || finding.ruleId === '') throw new TypeError('agentCandidates: finding.ruleId must be a non-empty string');
  if (!Number.isInteger(finding.occurrence) || finding.occurrence < 0) throw new TypeError('agentCandidates: finding.occurrence must be a non-negative integer');
  if (finding.file !== null && typeof finding.file !== 'string') throw new TypeError('agentCandidates: finding.file must be a string or null');
  if (typeof text !== 'string') throw new TypeError('agentCandidates: text must be a string');
}

/**
 * `{ candidates, skipped }` for one finding and the current text of its file. A fixer that changes
 * the text becomes the candidate candidatesFromDiff builds for that file; a finding with no fixer,
 * no file, or a text the fixer leaves alone gives `skipped: { reason }` instead. `tool` and
 * `version` pass through to candidatesFromDiff unchanged. Inputs are not mutated.
 */
export function agentCandidates(input) {
  checkInput(input);
  const { finding, text, tool, version } = input;
  if (finding.file === null) return { candidates: [], skipped: { reason: 'the finding names no file' } };
  const fixer = FIXERS.get(finding.ruleId);
  if (!fixer) return { candidates: [], skipped: { reason: `no deterministic fix for ${finding.ruleId}` } };
  const fixed = fixer(text);
  if (fixed.text === text) return { candidates: [], skipped: { reason: fixed.reason } };
  const diff = unifiedDiff(finding.file, text, fixed.text);
  return { candidates: candidatesFromDiff({ findings: [finding], diff, tool, version }).candidates, skipped: null };
}
