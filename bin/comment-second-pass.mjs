// Second pass over a first-pass draft: remove history, dash asides and first person, drop claims
// that cannot stand alone, then tighten the rest.
// fact: it reads only the first-pass lines, never the source block / a pass that re-read the block could restore a sentence the first pass judged empty (expiry: never, prev: not built)
// fact: every rule here was measured on a seeded sample of real comments plus a held-out one / rules fitted to a single example changed meaning on every real firing (expiry: never, prev: wrong)
import { FACT_RE } from './comment-schema.mjs';

const PLACEHOLDER = /^(todo|fixme|tbd|xxx)$/i;
const PATH = /(?:^|\s)((?:[\w.-]+\/)+[\w.-]+\.\w+)/;
const PRONOUN = /^(It|Its|This|That|These|Those|Here|There|Such|They|Their)\b/;
const SELF = /^This (module|file|script|test|helper|function|reader|writer|route|page|view|lens|gate|tool|parser|extractor|lane|renderer|harness|suite|guard|check)\b/;
const CAUSE = /\b(because|so that|otherwise|unless)\b/;
const ACRONYMS = new Set(('JSON HEAD KEV HTML URL URI SARIF CVE CWE CPE CVSS EPSS SBOM OSS OSV API CLI SVG ISO README HTTP HTTPS '
  + 'DB SQL POSIX WSL QR GNU CRA PMD SGR ESC CSRF SLA CAS SSE DOM ASCII MB KB GB PDF RNG YAML XML CRLF LF CR TOTP OTP RP ID '
  + 'IP CSS LLM LM PID STDOUT STDERR DP OSCAL NIST GRC RFC ESM CDN RCE MAL TODO VM TSO LOGON EXEC CONNECT CICS SIGNON PR '
  + 'PATH FETCH GET POST PUT DELETE UTF WCAG CI CSP SSO JWT TLS SSH DNS UI UX AST SAST DAST SCA NPM UTC CPU OS JS TS MCP '
  + 'EOF NUL SHA MD FFFD MED II III IV UUID GUID CAA AAAA MX TXT CNAME NS SOA').split(' '));

// fact: history is a dated or session-scoped marker, a story opener, or past tense with no present-tense verb / a lexical test, so "being used to" and a trailing "which is exactly what the operator saw" are handled before it runs
const PAST_MARK = /\b20\d\d-\d\d-\d\d\b|\bthis session\b|\bin one day\b|\b(?:the first cut|previously|originally|(?<!\b(?:being|is|are|be|was|were|get|gets|got)\s)used to|at the time|back then)\b|^(?:Caught|Found|Measured|Observed|Noticed|Seen|Discovered)\b|^Nothing failed\b|\bthe operator (?:saw|asked|ruled|reported)\b/i;
const PAST_VERB = /\b(was|were|had|became|reported|cost|sat|carried|mapped|shipped|landed|broke|failed|went|discovered|caught|noticed|wrote|introduced|surfaced|returned|recorded|described|emitted|ran|showed|polled|disclaimed|leaked|arrived)\b/i;
const PRESENT_VERB = /\b(is|are|has|have|do|does|must|cannot|can|should|will|may|might|holds|reads|keeps|means|needs|makes|stays|expires|decides|carries|returns|refuses|writes|takes|owns|counts|overstates|splits|produces|restores|lands|falls|survives|passes|treats|matches|runs|fails|names|lives|says|shows|drops|reports|becomes|become|collapses|renders|exceeds)\b/i;
const STORY_START = /^(?:because\s+)?(?:the|a|an|this|that|it|they)\s+(?:\w+\s+)?\w+ed\b(?!\s+(?:by|as|to|in|from|with)\b)/i;
// fact: tense is read from the main clause only / "split by whether the gap was measured" is a present rule with a past participle inside a subordinate clause (expiry: never, prev: broken)
const SUBORDINATE = /\b(?:whether|if|when|once|unless|until|after|before|because|since|while)\b/i;
const mainClause = (c) => c.replace(new RegExp(`^\\s*${SUBORDINATE.source}\\s*`, 'i'), '').split(SUBORDINATE)[0];
export const isHistory = (c) => PAST_MARK.test(c) || (PAST_VERB.test(mainClause(c)) && !PRESENT_VERB.test(c));
const FIRST_PERSON = /\b(I|we|me|us)\b(?![/\-.]\w)/;
// fact: a finite verb makes a dash segment a clause, and a clause is content / deleting every dash segment removed the reason from about half the sampled lines ("— this codebase never unlinks a file") (expiry: never, prev: broken)
const FINITE = /\b(is|are|was|were|be|been|has|have|had|can|cannot|could|must|will|would|should|may|might|does|do|did)\b|\b(it|this|that|they|which|who|nothing|each|every)\s+(?:\w+ly\s+)?\w+s\b|\b\w+(?:s|ed)\s+(?:the|a|an|to|in|on|at|its|their|every|through|off|from|beside|without|with)\b|\bso\b|\bnever\s+\w+s\b/;
const hasVerb = (s) => FINITE.test(s) || PRESENT_VERB.test(s) || PAST_VERB.test(s);
const isAside = (seg) => !CAUSE.test(seg) && !hasVerb(seg) && !/^\w+ing\b/.test(seg);

// nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- w is an [A-Z]{2,} token captured by the caller regex; no metacharacter can occur
const declared = (w, src) => !!src && new RegExp(`\\b(?:const|let|var|function|class)\\s+${w}\\b|^\\s*${w}\\s*:`, 'm').test(src);
const lowerCaps = (c, ctx = {}) => c.replace(/(`[^`]*`|(?<!\w)'[^']*'(?!\w)|"[^"]*")|(?<![\w\-./+$%])([A-Z][A-Z]+)(?![\w\-/+%]|\.\w|\()/g,
  (m, quoted, w) => (quoted || ACRONYMS.has(w) || /^E[A-Z]{3,}$/.test(w) || declared(w, ctx.src) ? m : w.toLowerCase()));
const upperFirst = (s) => (s && !/^[a-z]+[A-Z0-9_]/.test(s) ? s[0].toUpperCase() + s.slice(1) : s);
const quoted = (s) => s.replace(/`[^`]*`|(?<!\w)'[^']*'(?!\w)|"[^"]*"/g, '');

/**
 * Split at sentence, colon and clause boundaries, keep the pieces the predicate spares, and rejoin
 * them with their own separators. A dependent piece (because, which, so, and, but) goes with the piece it hangs
 * from. Null when none survive.
 */
const SENTENCES = /((?<=[.;:])\s+(?=\S)|,\s+(?=because\s)|\s+[—–]\s+)/;
const CLAUSES = /((?<=[.;:])\s+(?=\S)|,\s+(?=(?:and|but|which|so|because)\s)|\s+[—–]\s+)/;
function keepPieces(c, remove, sep = SENTENCES) {
  const parens = [];
  const masked = c.replace(/\([^()]*\)/g, (m) => { parens.push(m); return `\u0000${parens.length - 1}\u0000`; });
  const unmask = (s) => s.replace(/\u0000(\d+)\u0000/g, (_, n) => parens[Number(n)]);
  const parts = masked.split(sep).map(unmask);
  const pieces = parts.filter((_, i) => i % 2 === 0), seps = parts.filter((_, i) => i % 2 === 1);
  const gone = pieces.map((p) => remove(p));
  for (let i = 1; i < pieces.length; i++) if (gone[i - 1] && /^(because|which|so|and|but)\b/i.test(pieces[i])) gone[i] = true;
  if (!gone.some(Boolean)) return c;
  if (gone.every(Boolean)) return null;
  let out = '';
  pieces.forEach((p, i) => { if (!gone[i]) out += (out ? (seps[i - 1] || ' ') : '') + p; });
  return upperFirst(out.replace(/[;,:]\s*$/, ''));
}

/** Ordered. `drop` removes the whole claim; `rewrite` returns the new claim, or null to remove it. */
export const RULES = [
  { id: 'verdict-only', why: 'ends ", therefore <verdict>": a conclusion restated, with the reasoning left in another claim',
    drop: (c) => /,\s*(therefore|hence|thus)\s+\S+$/i.test(c) },
  { id: 'meta-aside', why: 'remarks about the comment itself carry no claim',
    rewrite: (c) => c
      .replace(/,?\s*(?:and )?(?:that|this) is (?:recorded|stated|noted) here(?: rather than [^,.;:]+)?/g, '')
      .replace(/\s*—\s*stated as one rather than asserted/g, '')
      .replace(/\s*—\s*the (?:shape|thing|pattern) this (?:file|module) exists to (?:refuse|prevent)$/g, '')
      .replace(/^So\s+(\w)/, (_, a) => a.toUpperCase())
      .replace(/^Worth [^,]{0,40}, because\s+(\w)/, (_, a) => a.toUpperCase()) },
  { id: 'history-aside', why: 'dates, tracker ids, banner rules and "which is exactly what the operator saw" are provenance, which belongs in prev',
    rewrite: (c) => c
      .replace(/[─━═]{2,}/g, ' ')
      .replace(/\s*\((?:[^()]*\b(?:20\d\d-\d\d-\d\d|operator ruling|ruling D\d+|defect \d+|remediation #\d+|WP\d+)\b)[^()]*\)/g, '')
      .replace(/\s+on 20\d\d-\d\d-\d\d\b/g, '')
      .replace(/^(?:Measured|Observed|Found) 20\d\d-\d\d-\d\d,?\s*/i, '')
      .replace(/,\s*which is (?:exactly )?what (?:the operator|we|I|a user) (?:saw|hit|found|reported)$/, '')
      .replace(/\s{2,}/g, ' ').trim() },
  { id: 'keep-the-moral', why: 'a story before a colon or "because" earns its line only through the present-tense rule after it',
    rewrite: (c) => {
      const m = /^(.+?)(?::\s+|,\s+because\s+)(.+)$/.exec(c);
      if (!m) return c;
      return isHistory(m[1]) && !isHistory(m[2]) && !STORY_START.test(m[2]) && PRESENT_VERB.test(m[2]) ? upperFirst(m[2]) : c;
    } },
  { id: 'history', why: 'how the code came to be, or how a defect was found, is provenance and not a property of the code',
    rewrite: (c) => keepPieces(c, isHistory) },
  { id: 'first-person', why: 'a comment speaks for the code, not for whoever wrote it',
    rewrite: (c) => {
      const kept = keepPieces(c, (p) => FIRST_PERSON.test(quoted(p)), CLAUSES);
      return kept && kept.replace(/\b(my|our)\b/gi, 'the');
    } },
  { id: 'emphasis-caps', why: 'capitals outside the acronym list, errno codes, $VARS and names the file declares are emphasis',
    rewrite: (c, ctx) => { const x = lowerCaps(c, ctx); return x !== c && /^[A-Z]/.test(c) ? upperFirst(x) : x; } },
  { id: 'anaphoric-lead-in', why: 'a lead-in pointing back at an earlier claim ("the same rule decides it:") carries nothing',
    rewrite: (c) => {
      const m = /^(`[^`]+`|(?:[\w.-]+\/)+[\w.-]+)\s+([^:]+?):\s+(.+)$/.exec(c);
      if (!m || /\.\s|\(expiry|\bfact:/.test(m[2])) return c;
      return /\b(same|above|again|likewise)\b/i.test(m[2]) ? `${m[1]} - ${m[3]}` : c;
    } },
  { id: 'elaboration-to-cause', why: 'after a dash, an attribution to a file is reduced to the cause and the file',
    rewrite: (c) => {
      const m = /^(.+?\b(?:is|are|was|were)\b.+?)\s+[—–]\s+(.+)$/.exec(c);
      const cause = m && /^(.*?)\bbecause\s+(.+?)(?=,|;|\s+and\s+|$)/.exec(m[2]);
      const path = cause && PATH.exec(cause[1]);
      if (!path) return c;
      const simple = /^(a|an|the)\s+(\w+)\s+(?:is|was|are|were)\s+(\w+)$/.exec(cause[2]);
      return `${m[1]}${simple ? ` caused by ${simple[1]} ${simple[3]} ${simple[2]}` : ` because ${cause[2]}`} in ${path[1]}`;
    } },
  // fact: a verbless dash aside is deleted and a dash that joins a clause becomes punctuation / the em dash is how this codebase attaches a consequence, so the content stays and only the dash goes (expiry: never, prev: broken)
  { id: 'dash-aside', why: 'a dash-delimited aside restates or decorates the claim; a dash joining a clause is style, not content',
    rewrite: (c) => {
      const parens = [];
      const masked = c.replace(/\([^()]*\)/g, (m) => { parens.push(m); return `\u0000${parens.length - 1}\u0000`; });
      const out = masked
        .replace(/\s+[—–]\s+([^—–]+?)\s+[—–]\s+/g, (m, x) => (isAside(x) ? ' ' : `, ${x}, `))
        .replace(/\s+[—–]\s+([^—–]+)$/, (m, x) => (isAside(x) ? '' : `${/^(\w+ing|which|where|so|and|because|never)\b/.test(x) ? ',' : ';'} ${x}`))
        .replace(/\s+[—–]\s+/g, '; ')
        .replace(/\s{2,}/g, ' ').replace(/,\s*,/g, ',').trim();
      return out.replace(/\u0000(\d+)\u0000/g, (_, n) => parens[Number(n)]);
    } },
  { id: 'read-failure-classes', why: '"could not be read" hides which failure it was; no read, a bad read and a failed read are separate',
    rewrite: (c) => c.replace(/\bcould not be read\b/g, 'bad read/no read/failed read') },
  { id: 'predicate-alternatives', why: 'alternatives after a copula read as one slash-joined state',
    rewrite: (c) => c.replace(/\b(is|was|are|were)\s+(\w+)\s+or\s+/g, '$1 $2/') },
  { id: 'relative-to-condition', why: '"a run whose disk" is a condition on the run, stated as one',
    rewrite: (c) => c.replace(/\b(a|an)\s+(\w+)\s+whose\b/g, "when $1 $2's") },
];

/**
 * Apply RULES to each `// fact:` line. ctx.file names a self-reference, ctx.used[k] is line k's
 * sentence index in the source, ctx.src guards declared names from the caps rule. Returns the new
 * lines, each input line's fate ('kept' | 'reworded' | 'dropped') and the rules that fired.
 */
export function secondPass(lines, ctx = {}) {
  const out = [];
  const fate = [];
  const fired = new Set();
  let prev = null;
  lines.forEach((line, k) => {
    const m = /^(\s*)\/\/\s*(fact:.*)$/.exec(line);
    const f = m && FACT_RE.exec(m[2]);
    if (!f) { out.push(line); fate.push('kept'); prev = null; return; }
    const claim = f.groups.claim.trim();
    const expiry = (f.groups.expiry ?? '').trim();
    // fact: a line with a real trailer was written as a fact on purpose and is left whole / every lexical rule here misread at least one of them
    if ((expiry && !PLACEHOLDER.test(expiry)) || (!expiry && /\(expiry:/.test(claim))) { out.push(line); fate.push('kept'); prev = { at: out.length - 1, k }; return; }
    const dropper = RULES.find((r) => r.drop && r.drop(claim));
    if (dropper) { fired.add(dropper.id); fate.push('dropped'); return; }
    let next = claim;
    if (ctx.file && SELF.test(next)) { next = next.replace(SELF, `\`${ctx.file.split('/').pop()}\``); fired.add('self-reference'); }
    for (const r of RULES.filter((x) => x.rewrite)) {
      if (next === null) break;
      const was = next;
      next = r.rewrite(next, ctx);
      if (next !== was) fired.add(r.id);
    }
    if (next !== null) next = next.replace(/[\s,;:]+$/, '').trim();
    if (!next || next.split(/\s+/).length < 3) { fate.push('dropped'); return; }
    // fact: a shortened line left with no verb and nothing quoted is the subject of a removed predicate / "First, the alert type" was all that survived "… — was never emitted at all" (expiry: never, prev: broken)
    if (next.length < claim.length && !hasVerb(next) && (!/[`'"]/.test(next) || next.split(/\s+/).length >= 8)) {
      fired.add('fragment-left'); fate.push('dropped'); return;
    }
    // fact: a pronoun-led claim joins its antecedent when the first pass kept that sentence too, and is dropped otherwise / it means nothing apart from the sentence it points at
    if (PRONOUN.test(next)) {
      if (prev && ctx.used && ctx.used[k] - 1 === ctx.used[prev.k]) {
        out[prev.at] = `${out[prev.at]}; ${next[0].toLowerCase()}${next.slice(1)}`;
        fired.add('merge-into-antecedent');
        fate.push('reworded');
        prev = { at: prev.at, k };
        return;
      }
      fired.add('leans-on-a-neighbour');
      fate.push('dropped');
      return;
    }
    out.push(`${m[1]}// fact: ${next}`);
    fate.push(next === claim ? 'kept' : 'reworded');
    prev = { at: out.length - 1, k };
  });
  return { lines: out, fate, fired: [...RULES.map((r) => r.id), 'self-reference', 'fragment-left', 'merge-into-antecedent', 'leans-on-a-neighbour'].filter((id) => fired.has(id)) };
}
