// secret-gate.mjs — routes chunk content through bin/secrets-sweep.mjs's line scanner before it
// can be embedded in a generated artifact. A removed credential, faithfully diffed, would become a
// second durable copy in a portable HTML file with none of git's access control — strictly worse
// than the problem the diff-selector visualises. This must run before embedding, never after.
import { scanLine, VERDICT } from '../../bin/secrets-sweep.mjs';

/**
 * @param src  chunk text about to be embedded
 * @returns {{src: string, redacted: boolean, findings: Array}}
 *   `src` is the original text unless a REAL-SECRET hit was found, in which case it is replaced
 *   wholesale with a labelled placeholder — never partially redacted (a partial redaction can leak
 *   the secret's shape/length) and never embedded silently.
 */
export function gateChunk(src) {
  const lines = String(src).split('\n');
  const findings = [];
  lines.forEach((line, i) => {
    for (const hit of scanLine(line, i + 1, {})) {
      if (hit.verdict === VERDICT.SECRET) findings.push(hit);
    }
  });
  if (!findings.length) return { src, redacted: false, findings: [] };
  const classes = [...new Set(findings.map((f) => f.cls))].join(', ');
  return {
    src: `[REDACTED — secrets-sweep matched ${classes} in this chunk. Rotate the credential, `
      + `remove it from the source document, then regenerate this artifact.]`,
    redacted: true,
    findings,
  };
}
