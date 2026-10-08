// contract: reasoning split from answer; explicit field wins
export function splitThinking(content, explicit) {
  const text = String(content ?? '');
  if (explicit && String(explicit).trim()) return { thinking: String(explicit).trim(), answer: text.trim() };
  const m = text.match(/<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/i);
  if (!m) return { thinking: null, answer: text.trim() };
  return { thinking: m[1].trim(), answer: text.replace(m[0], '').trim() };
}

// contract: verdict fields read anywhere; none is null
export function parseVerdict(answer) {
  const s = String(answer ?? '');
  const field = (name) => {
    const m = s.match(new RegExp(`^\\s*(?:[*_\`#>\\-\\s]*)${name}\\s*:\\s*(.+)$`, 'im')); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- `name` is only ever an in-file literal ('VERDICT'|'CONFIDENCE'|'FIX'), never model output
    return m ? m[1].replace(/[*_`]/g, '').trim() : null;
  };
  const verdict = field('VERDICT');
  const preambleEnd = verdict ? s.search(/^\s*(?:[*_`#>\-\s]*)VERDICT\s*:/im) : -1;
  return {
    verdict: verdict ? verdict.split(/\s|,|\(/)[0].toLowerCase() : null,
    confidence: (field('CONFIDENCE') || '').toLowerCase() || null,
    fix: field('FIX'),
    preamble: preambleEnd > 0 ? s.slice(0, preambleEnd).trim() : null,
    answer: preambleEnd > 0 ? s.slice(preambleEnd).trim() : s.trim(),
  };
}
