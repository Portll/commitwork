// reasoning-lint.mjs — deterministic contradiction detector for model reasoning vs. verdict.
// The verdict value selects the enum family: issue-llm (real-vulnerability | needs-context |
// false-positive | already-mitigated) or panel triage (real | false-positive | intentional | needs-human).

// Dismissive-evidence patterns: phrase indicating the finding is NOT a real, actionable issue
const DISMISSIVE_PATTERNS = [
  // "not a [real] credential/secret/vulnerability/etc"
  /\bnot\s+a\s+(?:real\s+)?(?:credential|secret|vulnerabilit\w*)/,
  // "false positive" or "false-positive"
  /\bfalse\s*-?\s*positive/,
  // "test fixture"
  /\btest\s+fixture/,
  // "placeholder"
  /\bplaceholder/,
  // "filename constant" or "string constant"
  /\b(?:filename|(?:name|string)\s+constant)/,
  // "is [a] constant"
  /\bis\s+(?:a\s+)?constant\b/,
  /\balready\s+(?:fixed|mitigated|patched)/,
  /\bintegration\s+test(?:ing)?/,
  /\b(?:dummy|example|stub)\s+(?:value|data|credential|secret)/,
  /\bhardcoded\s+(?:for\s+)?test/,
  /\btest\s+data/,
  /\bnon-(?:secret|sensitive|real)/,
  /\bdevs?\s+only/,
  /\bdevelopment\s+(?:only|environment)/,
  /\bsandbox/,
];

// Affirmative-threat patterns: phrases indicating the finding IS a real, active threat
const AFFIRMATIVE_PATTERNS = [
  // "confirmed live/real/etc"
  /\bconfirmed\s+(?:live|real|vulnerability|credential|secret)/,
  // "actively exploitable"
  /\bactively\s+exploitable/,
  // "real credential"
  /\breal\s+credential/,
  /\bcredential\s+(?:in|on)\s+production/,
  /\bsecret\s+(?:found|exposed|leaked)/,
  /\b(?:live|active|exposed)\s+(?:credential|secret|vulnerability)/,
  /\bdangerous\s+(?:in\s+)?production/,
  /\bshould\s+be\s+(?:rotated|changed|revoked)/,
  /\b(?:vulnerability|flaw)\s+(?:in|is\s+in)\s+(?:the\s+)?(?:production|code|codebase)/,
];

/**
 * @param {Object} pair
 * @param {string} pair.reasoning - the model's reasoning text (unbounded)
 * @param {string} pair.verdict - the model's verdict classification
 * @returns {Object} { contradiction: boolean, pattern: string|null }
 */
export function lintPair({ reasoning = '', verdict = null } = {}) {
  // Handle empty or invalid input — no contradiction, no throw
  if (!reasoning || !verdict) {
    return { contradiction: false, pattern: null };
  }

  const reasoningLower = String(reasoning).toLowerCase();
  const verdictLower = String(verdict).toLowerCase().trim();

  // Scan line-by-line for patterns (no nested quantifiers, no multiline backtracking)
  const lines = reasoningLower.split('\n');

  let dismissivePatternFound = null;
  let affirmativePatternFound = null;

  for (const line of lines) {
    if (!line.trim()) continue;

    // Check dismissive patterns
    if (!dismissivePatternFound) {
      for (const pattern of DISMISSIVE_PATTERNS) {
        if (pattern.test(line)) {
          dismissivePatternFound = pattern.source;
          break;
        }
      }
    }

    // Check affirmative patterns
    if (!affirmativePatternFound) {
      for (const pattern of AFFIRMATIVE_PATTERNS) {
        if (pattern.test(line)) {
          affirmativePatternFound = pattern.source;
          break;
        }
      }
    }

    if (dismissivePatternFound && affirmativePatternFound) break;
  }

  // PRIMARY ENUM: real-vulnerability, needs-context, false-positive, already-mitigated
  // Dismissive evidence contradicts verdicts expecting affirmative evidence
  if (dismissivePatternFound && [
    'real-vulnerability',
    'needs-context',
  ].includes(verdictLower)) {
    return { contradiction: true, pattern: dismissivePatternFound };
  }

  // Affirmative evidence contradicts verdicts expecting dismissive reasoning
  if (affirmativePatternFound && [
    'false-positive',
    'already-mitigated',
  ].includes(verdictLower)) {
    return { contradiction: true, pattern: affirmativePatternFound };
  }

  // SECONDARY ENUM: real, false-positive, intentional, needs-human
  // Dismissive evidence contradicts "real" and "needs-human"
  if (dismissivePatternFound && [
    'real',
    'needs-human',
  ].includes(verdictLower)) {
    return { contradiction: true, pattern: dismissivePatternFound };
  }

  // Affirmative evidence contradicts "false-positive" and "intentional"
  if (affirmativePatternFound && [
    'false-positive',
    'intentional',
  ].includes(verdictLower)) {
    return { contradiction: true, pattern: affirmativePatternFound };
  }

  return { contradiction: false, pattern: null };
}
