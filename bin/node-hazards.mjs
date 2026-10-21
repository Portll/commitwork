#!/usr/bin/env node
// Node/JS constructs that are defects BY PRESENCE, not by reachability.
//
// WHY THIS EXISTS AS A SEPARATE LANE. Semgrep's taint engine answers one question well: does
// untrusted input reach a dangerous sink? That is the reachability question, and dataflow is
// essential to it. But a whole class of Node defects needs no dataflow at all, because the
// construct itself is the decision:
//
//   NODE_TLS_REJECT_UNAUTHORIZED='0'  disables certificate verification process-wide, whatever
//                                     the input is.
//   crypto.createCipher(...)          derives key and IV from a password with no salt, always.
//   {{{ x }}} in a Handlebars file    bypasses auto-escaping, which is the whole defence.
//
// For those, taint analysis is not merely unnecessary — it is the wrong instrument, because an
// engine that finds no path reports nothing while the defect sits there. That is the structural
// reason a dataflow-free scanner found four things Semgrep missed on the same tree, and it is the
// only reason this lane earns its place next to sastSemgrep rather than duplicating it.
//
// PROVENANCE, AND WHY THE PATTERNS ARE RE-DERIVED RATHER THAN PORTED. The idea list came from
// diffing nodejsscan 3.7 (the legacy PyPI package; core/rules.xml, 44 rules) against this fleet's
// coverage. Its rules were NOT copied, because measuring them found them uneven in a way that
// matters:
//
//   · Its Pug rule signature is `#{...}` — but in Pug `#{}` is the ESCAPED interpolation and `!{}`
//     is the unescaped one. It flags the safe construct, so it fires on almost every Pug template
//     and reports the defence as the defect. Inverted here, deliberately.
//   · Its "missing httpOnly" rule matches the substring `httpOnly` anywhere, so `httpOnly: false`
//     counts as present — a proven false NEGATIVE on the exact case it exists for. Matched on the
//     VALUE here.
//
// A rule that fires on ~100% of its subjects measures the ecosystem, not the application: GuardDog
// published 602 of 675 rows for "this package can open a socket". Every rule below therefore ships
// with a negative control in bin/test/node-hazards.test.mjs, and the load-bearing assertion is that
// a clean, idiomatic Node app yields ZERO findings.
//
// WHAT IS DELIBERATELY NOT HERE, each because something else owns it:
//   · eval / new Function / vm         — reachable case is sastSemgrep's; presence alone is common.
//   · Math.random                      — the weakRandom lane owns credential randomness.
//   · hardcoded secrets                — gitleaks and trufflehog, with entropy this cannot match.
//   · missing security headers         — a deployment checklist, not a code defect.
//   · child_process shell:true         — dangerous only with untrusted input, so it is a taint
//                                        question and belongs to Semgrep.
//   · bare yaml.load                   — safe by default in js-yaml v4; flagging it would measure
//                                        the ecosystem's version spread.
//
// usage: node bin/node-hazards.mjs [root] [--sarif|--json]   (default: SARIF on stdout)

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, extname, sep, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { excludeDirs } from './scan-exclusions.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const CODE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.vue']);
const TPL_EXT = new Set(['.ejs', '.hbs', '.handlebars', '.mustache', '.pug', '.jade', '.dust', '.ect']);

// This file's own rule definitions match its own rules. Any repository holding security rules or
// fixtures reproduces that, so the tool excludes ITSELF by identity rather than by a name pattern —
// a pattern would also swallow a real finding in a file that happened to be called *-hazards.mjs.
const SELF = resolve(fileURLToPath(import.meta.url));

/**
 * A finding is SUPPRESSED when the finding line, or the line above it, carries an adjudication.
 *
 * Three markers are honoured and they are not equivalent. `cw-hazards-ignore` is this tool's own.
 * `nosemgrep` and `codeql[...]` belong to other tools, and are accepted as evidence that a human
 * already ruled on THIS CONSTRUCT AT THIS PLACE — monitor/deploy-state.mjs carries exactly that for
 * a scoped rejectUnauthorized:false probe, with a paragraph saying why. Re-reporting it as new would
 * be the auto-close defect running backwards: work that was adjudicated returning as if it were not.
 *
 * Deliberately positional, and deliberately NOT stored: an inline comment moves with the code it
 * annotates, so it cannot un-suppress itself when an unrelated edit above shifts the line — which is
 * exactly the failure a line-keyed stored annotation has here.
 */
// The negative lookahead keeps the two mechanisms genuinely separate: without it the line marker
// matches INSIDE `cw-hazards-ignore-file`, so a file marker declared too late to count as one would
// quietly take effect as a line marker on whatever happened to follow it.
const SUPPRESS_RE = /\b(cw-hazards-ignore(?!-file)|nosemgrep|codeql\[[^\]]*\])/;
const COMMENT_LINE = /^\s*(\/\/|\*|\/\*)/;
/**
 * The window is the finding's own line PLUS the contiguous comment block directly above it — not a
 * fixed one-line lookback. Measured against the real case this had to handle: the codeql[] marker in
 * monitor/deploy-state.mjs opens a five-line justification block and the construct is the line after
 * it. A one-line window found nothing, which would have re-reported an adjudicated finding as new.
 * The block ends at the first non-comment line, so a marker cannot reach across unrelated code.
 */
export function suppressionFor(lines, idx) {
  if (typeof lines[idx] !== 'string') return null;
  const hit = (l, own) => {
    const m = l.match(SUPPRESS_RE);
    if (!m) return null;
    const why = l.slice(l.indexOf(m[1]) + m[1].length).replace(/^[\s:\-—]+/, '').trim();
    return { marker: m[1], justification: why || '(no reason given)', ownLine: own };
  };
  const own = hit(lines[idx], true);
  if (own) return own;
  for (let i = idx - 1; i >= 0 && COMMENT_LINE.test(lines[i] ?? ''); i--) {
    const m = hit(lines[i], false);
    if (m) return m;
  }
  return null;
}

/**
 * Every rule states the construct, not a taint path. `where` narrows the file population so a
 * template rule never fires on .js and vice versa — the cheapest way to keep precision honest.
 */
const RULES = [
  {
    id: 'node/tls-verification-disabled',
    level: 'error',
    where: (e) => CODE_EXT.has(e),
    // The assignment is the defect: it turns off certificate verification for the whole process.
    re: /NODE_TLS_REJECT_UNAUTHORIZED\s*(?:=|:|\]\s*=)\s*['"`]?0['"`]?/,
    msg: 'NODE_TLS_REJECT_UNAUTHORIZED is set to 0, disabling TLS certificate verification process-wide',
  },
  {
    id: 'node/reject-unauthorized-false',
    level: 'error',
    where: (e) => CODE_EXT.has(e),
    re: /(?:rejectUnauthorized|strictSSL)\s*:\s*false\b/,
    msg: 'TLS peer verification disabled (rejectUnauthorized/strictSSL false) — the connection is unauthenticated',
  },
  {
    id: 'node/deprecated-cipher-no-iv',
    level: 'error',
    where: (e) => CODE_EXT.has(e),
    // createCipher (no -iv) derives key and IV from a password with no salt. createCipheriv is fine.
    re: /\bcrypto\s*\.\s*create(?:De)?Cipher\s*\(/,
    msg: 'crypto.createCipher/createDecipher derives key and IV from a password with no salt — use createCipheriv',
  },
  {
    id: 'node/yaml-unsafe-schema',
    level: 'error',
    where: (e) => CODE_EXT.has(e),
    // Only the EXPLICIT unsafe schema, never bare load(): js-yaml v4 load is safe by default.
    re: /DEFAULT_FULL_SCHEMA|\bunsafeLoad\s*\(|schema\s*:\s*[\w.]*FULL_SCHEMA/,
    msg: 'YAML parsed with an unsafe schema — arbitrary type construction is remote code execution',
  },
  {
    id: 'node/cors-wildcard-with-credentials',
    level: 'error',
    where: (e) => CODE_EXT.has(e),
    // Either alone is defensible; together they are the combination browsers forbid for a reason.
    both: [/origin\s*:\s*['"`]\*['"`]/, /credentials\s*:\s*true\b/],
    msg: 'CORS allows any origin WITH credentials — any site can make authenticated requests on the user\'s behalf',
  },
  {
    id: 'node/cookie-flag-downgrade',
    level: 'warning',
    where: (e) => CODE_EXT.has(e),
    // Matched on the VALUE. nodejsscan's equivalent matched the substring `httpOnly` anywhere, so
    // `httpOnly: false` read as present — a false negative on the only case that matters.
    re: /(?:httpOnly|secure)\s*:\s*false\b|sameSite\s*:\s*['"`]none['"`]/i,
    msg: 'Cookie security flag explicitly downgraded (httpOnly/secure false, or sameSite none)',
  },
  {
    id: 'node/weak-hash',
    // NOTE, not error: md5/sha1 are legitimate for etags, cache keys and dedup. This is a pointer
    // to review the PURPOSE, not an assertion that a vulnerability exists.
    level: 'note',
    where: (e) => CODE_EXT.has(e),
    re: /createHash\s*\(\s*['"`](?:md5|sha1)['"`]\s*\)/i,
    msg: 'Weak hash (md5/sha1) — fine for a checksum, not for signatures, passwords or tokens; confirm the purpose',
  },
  {
    id: 'node/xss-protection-disabled',
    level: 'note',
    where: (e) => CODE_EXT.has(e),
    re: /lusca\s*\.\s*xssProtection\s*\(\s*false\s*\)|['"`]X-XSS-Protection['"`]\s*[,:]\s*['"`]?0/i,
    msg: 'X-XSS-Protection explicitly disabled (note: the header is deprecated and ignored by current browsers)',
  },
  // ── the template cluster ──────────────────────────────────────────────────────────────────────
  // Split per engine rather than one combined pattern, because the escaped/unescaped pair differs
  // per engine and a combined regex cannot carry a per-engine negative control. These live in
  // .ejs/.hbs/.pug files, a file population Semgrep's JS rules do not parse at all — which is why
  // this cluster is structurally non-overlapping rather than merely uncovered.
  {
    id: 'template/ejs-unescaped',
    level: 'warning',
    where: (e) => e === '.ejs',
    re: /<%-\s*[^%]*%>/,                       // <%= is the escaped form
    msg: 'EJS emits an unescaped variable with <%- ... %> — use <%= ... %> unless the value is trusted HTML',
  },
  {
    id: 'template/ect-unescaped',
    level: 'warning',
    where: (e) => e === '.ect',
    re: /<%-\s*@[^%]*%>/,
    msg: 'ECT emits an unescaped variable with <%- @... %> (XSS)',
  },
  {
    id: 'template/handlebars-unescaped',
    level: 'warning',
    where: (e) => ['.hbs', '.handlebars', '.mustache'].includes(e),
    re: /\{\{\{[^}]*\}\}\}|\{\{&\s*[^}]*\}\}/,  // {{ }} is the escaped form
    msg: 'Handlebars/Mustache emits an unescaped variable ({{{ }}} or {{& }}) — bypasses auto-escaping (XSS)',
  },
  {
    id: 'template/pug-unescaped',
    level: 'warning',
    where: (e) => ['.pug', '.jade'].includes(e),
    // !{ } interpolation and != buffered-unescaped. NOT #{ } and NOT =, which are the ESCAPED
    // forms — nodejsscan's rule flags #{ } and therefore reports the defence as the defect.
    re: /![{][^}]*\}|^\s*[\w.#|-]*\s*!=\s*\S/,
    msg: 'Pug emits an unescaped variable (!{ } or !=) — #{ } and = are the escaped forms (XSS)',
  },
  {
    id: 'template/dust-unescaped',
    level: 'warning',
    where: (e) => e === '.dust',
    re: /\{[\w.$]+\|s[|}]/,                     // the |s filter disables escaping
    msg: 'Dust.js disables escaping with the |s filter (XSS)',
  },
  // ── framework sinks: same class, but they live in CODE files, not templates ───────────────────
  {
    id: 'node/react-dangerously-set-inner-html',
    level: 'warning',
    where: (e) => CODE_EXT.has(e),
    re: /dangerouslySetInnerHTML/,
    msg: 'React dangerouslySetInnerHTML bypasses JSX escaping — sanitise the value or render it as text',
  },
  {
    id: 'node/vue-v-html',
    level: 'warning',
    where: (e) => CODE_EXT.has(e) || e === '.vue',
    re: /\bv-html\s*=/,
    msg: 'Vue v-html renders raw HTML, bypassing template escaping (XSS)',
  },
  {
    id: 'node/angular-bypass-security-trust',
    level: 'warning',
    where: (e) => CODE_EXT.has(e),
    re: /bypassSecurityTrust(?:Html|Script|Style|Url|ResourceUrl)\s*\(/,
    msg: 'Angular bypassSecurityTrust* disables the built-in sanitiser for this value (XSS)',
  },
];

/** Walk for files the rules can apply to. Templates and code both, nothing else read. */
function collect(root, out = [], depth = 0, skip = null) {
  if (depth > 12) return out;
  // Read at CALL time, never at module load, so a test's CW_SCAN_EXCLUDE_DIRS override is honoured.
  const skipDirs = skip || new Set(excludeDirs());
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return out; }
  for (const d of entries) {
    const p = join(root, d.name);
    if (d.isDirectory()) {
      if (skipDirs.has(d.name) || d.name.startsWith('.')) continue;
      collect(p, out, depth + 1, skipDirs);
    } else if (d.isFile()) {
      if (resolve(p) === SELF) continue;   // the tool's own rule definitions are not findings

      const e = extname(d.name).toLowerCase();
      if (CODE_EXT.has(e) || TPL_EXT.has(e)) {
        try { if (statSync(p).size <= 2_000_000) out.push(p); } catch { /* unreadable: skip */ }
      }
    }
  }
  return out;
}

/** A line is a comment if it opens with one. Crude on purpose — it only suppresses, never adds. */
const isComment = (line) => /^\s*(\/\/|\*|<!--|#(?!\{))/.test(line);

/**
 * Findings for one file. Suppressed items are returned SEPARATELY rather than dropped: the caller
 * keeps them out of SARIF `results` (this fleet's parseReport iterates results and does not read
 * SARIF's own `suppressions`, so leaving them in would publish adjudicated work as live findings)
 * while still being able to say how many there were. Silently discarding them would make an
 * adjudication indistinguishable from a rule that never fired.
 */
/**
 * A FILE-level marker in the head of the file. Distinct from the line marker on purpose: "this whole
 * file is fixtures" is a different and much broader claim than "this line was adjudicated", so it
 * gets its own spelling rather than letting a line marker leak down the file. Bounded to the head so
 * it has to be declared where a reader will see it.
 */
const FILE_IGNORE_RE = /cw-hazards-ignore-file\b[:\s-]*(.*)$/m;
export function fileSuppression(text) {
  const head = text.split('\n', 40).join('\n');
  const m = head.match(FILE_IGNORE_RE);
  return m ? { marker: 'cw-hazards-ignore-file', justification: m[1].trim() || '(no reason given)', ownLine: false } : null;
}

export function scanFile(path, text, ext) {
  const findings = [];
  const suppressed = [];
  const lines = text.split('\n');
  const whole = fileSuppression(text);
  const emit = (rule, i) => {
    const s = whole || suppressionFor(lines, i);
    const row = { ruleId: rule.id, level: rule.level, line: i + 1, message: rule.msg, path };
    if (s) suppressed.push({ ...row, suppression: s }); else findings.push(row);
  };
  for (const rule of RULES) {
    if (!rule.where(ext)) continue;
    if (rule.both) {
      // A pair rule needs both present in the same file, and reports the first one's line.
      if (!rule.both.every((r) => r.test(text))) continue;
      const i = lines.findIndex((l) => rule.both[0].test(l) && !isComment(l));
      if (i === -1) continue;
      emit(rule, i);
      continue;
    }
    lines.forEach((line, i) => {
      if (isComment(line) || !rule.re.test(line)) return;
      emit(rule, i);
    });
  }
  findings.suppressed = suppressed;   // non-enumerable-ish sidecar; scan() reads it, tests may too
  return findings;
}

export function scan(root) {
  const findings = [];
  const suppressed = [];
  let scanned = 0;
  for (const p of collect(root)) {
    let text; try { text = readFileSync(p, 'utf8'); } catch { continue; }
    scanned++;
    const got = scanFile(relative(root, p).split(sep).join('/'), text, extname(p).toLowerCase());
    findings.push(...got);
    suppressed.push(...(got.suppressed || []));
  }
  return { findings, suppressed, scanned };
}

export function toSarif({ findings, suppressed = [] }) {
  const ids = [...new Set(findings.map((f) => f.ruleId))];
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [{
      // Suppressed items are counted here but NOT placed in results — see scanFile's header. The
      // number is the honest half: a reader can tell "nothing fired" from "three were adjudicated".
      properties: { suppressedCount: suppressed.length },
      tool: { driver: { name: 'commitwork-node-hazards', informationUri: 'https://commitwork.portll.net', rules: ids.map((id) => ({ id })) } },
      results: findings.map((f) => ({
        ruleId: f.ruleId,
        level: f.level,
        message: { text: f.message },
        locations: [{ physicalLocation: { artifactLocation: { uri: f.path }, region: { startLine: f.line } } }],
      })),
    }],
  };
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const root = args.find((a) => !a.startsWith('--')) || '.';
  const res = scan(root);
  if (res.scanned === 0) {
    // No JS or template source at all. Writing an empty SARIF here would publish a clean scan of
    // nothing; the caller's guard removes an artifact that is not a SARIF document, so absence
    // reads as not-scanned. Same contract mobile-manifest uses.
    process.stderr.write('node-hazards: no JS/TS or template sources found — writing NO sarif, which classifies as not-scanned rather than a clean zero\n');
    process.exit(0);
  }
  process.stdout.write(`${JSON.stringify(args.includes('--json') ? res : toSarif(res), null, 2)}\n`);
}
