// usage: import { tells, SURFACES } from './prose-tells.mjs'; tells(text, 'commit') -> [{ id, match, why, line }]
// fact: pure, no io, no env / callers decide refuse or ratchet

const SESSION = /\b(?:commitwork-[0-9a-f]{2}|cw-?[0-9a-f]{2})\b/;

// fact: each tell is one regex and one plain reason
const COMMON = [
  { id: 'em-dash', re: /—|(?:^|\s)--(?:\s|$)|\s-\s/m, why: 'splice; write two sentences' },
  { id: 'so-glue', re: /,\s*so\b(?!\s+(?:that|far|much|many|long|it\s+(?:is|was))\b)/i, why: 'consequence glue; give the consequence its own sentence or drop it' },
  { id: 'just', re: /\bjust\b/i, why: 'minimiser; delete, or write "only"' },
  { id: 'mental-state', re: /\b(?:deliberately|intentionally|carefully|thoughtfully)\b/i, why: 'adverb about the author; the choice is already recorded' },
  { id: 'hedge', re: /\b(?:potentially|possibly|in some cases|may or may not)\b|\b(?:may|might|could)\s+(?:help|potentially|possibly)\b/i, why: 'hedge; state it or drop it' },
  { id: 'shout', re: /\b[A-Z][A-Z'-]+(?:\s+[A-Z][A-Z'-]+){2,}\b/, why: 'three or more capitalised words; state the fact in lower case' },
  { id: 'session-name', re: SESSION, why: 'session names do not survive; cite a sha, a file or a test' },
  { id: 'banned-word', re: /\b(?:leverage[sd]?|leveraging|utili[sz]e[sd]?|robust|seamless(?:ly)?|holistic|tapestry|myriad|plethora|delve|a testament to)\b/i, why: 'inflated word; use the plain one' },
  { id: 'land', re: /\bland(?:s|ed|ing)?\b(?!\s+pages?\b)/i, why: 'nothing lands; say committed, merged, added, written' },
  { id: 'shape', re: /\b(?:the\s+)?shapes?\s+of\s+(?:the\s+)?(?:data|api|process|change|code|json|row|payload)\b|\bshaped\s+(?:by|our|the)\b|\bsame\s+shape\b/i, why: 'shape as loose jargon; say structure, or say what happened' },
  { id: 'meta', re: /\b(?:worth\s+(?:noting|naming|saying)|it\s+is\s+important\s+to\s+note|here'?s\s+the\s+thing|the\s+(?:key|important|interesting)\s+(?:point|thing|part)\s+is|which\s+is\s+why|the\s+reason\s+is)\b/i, why: 'text about the text; deliver the fact' },
  { id: 'not-x-but-y', re: /\b(?:is|was|are)n'?t\s+(?:just|only|merely)\b[^.]*\bbut\b|\bnot\s+(?:just|only|merely)\s+\w+[^.]*,\s*but\b/i, why: 'not-X-but-Y; state the positive' },
];

// fact: comments also refuse history, the reader has git for that
const COMMENT_ONLY = [
  { id: 'date', re: /\b20\d\d-\d\d(?:-\d\d)?\b/, why: 'a date is history; it belongs in the commit message' },
  { id: 'history', re: /\b(?:found|measured|reported|ruled)\s+(?:by|on|at)\b|\boperator\s+(?:ruling|instruction|decision)\b|\bused\s+to\b|\bpreviously\b|\bno\s+longer\b/i, why: 'history; it belongs in the commit message' },
  { id: 'because', re: /\bbecause\b/i, why: 'one clause; the claim stands without its argument' },
  { id: 'explain-colon', re: /:\s+[^:]*:\s+\S/, why: 'a second colon splices an explanation; one clause' },
  { id: 'trailer', re: /\(expiry:[^)]*\)/, why: 'the (expiry:, prev:) trailer is the old grammar; drop it' },
];

// fact: the trailer is one finding, not a colon and a date
const TRAILER = /\(expiry:[^)]*\)/;

export const SURFACES = Object.freeze(['comment', 'commit']);

const SETS = { comment: [...COMMON, ...COMMENT_ONLY], commit: COMMON };

// fact: footer lines and fenced code are skipped in a commit message
const FOOTER = /^(?:BREAKING CHANGE|BREAKING-CHANGE|[A-Za-z][A-Za-z0-9-]*)(?:: | #)/;

export function tells(text, surface) {
  if (!SETS[surface]) throw new Error(`prose-tells: unknown surface "${surface}"`);
  const out = [];
  let fenced = false;
  String(text ?? '').split('\n').forEach((line, i) => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return; }
    if (fenced) return;
    if (surface === 'commit' && i > 0 && FOOTER.test(line)) return;
    const body = surface === 'comment' ? line.replace(TRAILER, '') : line;
    for (const t of SETS[surface]) {
      const m = t.re.exec(t.id === 'trailer' ? line : body);
      if (m) out.push({ id: t.id, match: m[0].trim(), why: t.why, line: i + 1 });
    }
  });
  return out;
}

export function formatTells(found) {
  return found.map((f) => `  · line ${f.line} [${f.id}] "${f.match}" — ${f.why}`).join('\n');
}
