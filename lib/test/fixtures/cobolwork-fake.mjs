#!/usr/bin/env node
// A stand-in for cobolwork, for lib/test/cobolwork-remediation.test.mjs. It answers the commands the
// remediation pipeline runs (capabilities, scan, explain, gate) in the shapes cobolwork writes them, and decides
// one rule: argv-or-env-to-os-command, a field ACCEPTed FROM COMMAND-LINE and MOVEd to the field a
// CALL 'SYSTEM' uses, in fixed-format COBOL.
//
// The real engine is a private repository at whatever version a host holds, so a test run against it
// answers for the host: where it predated explain and gate, five pipeline tests failed and a sixth
// passed because "unknown command explain" read as a refusal. CW_COBOLWORK_TEST_BIN runs the same
// tests against a real cobolwork, the second witness to this reading of it.
//
// Exit 0 means it ran and 2 that it could not, with the reason on stderr, as cobolwork does.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

const RULE = 'argv-or-env-to-os-command';
const SEV = { info: 0, low: 1, med: 2, high: 3, crit: 4 };
const PASSING = new Set(['cleared-by-check']);
const UNDECIDED = new Set(['lowered-by-check', 'gone-unexplained']);
const SOURCE_FILE = /\.(cbl|cob)$/i;

const refuse = (msg) => { process.stderr.write(`cobolwork: ${msg}\n`); process.exitCode = 2; };
// Left to drain: process.exit would cut a piped stdout short.
const emit = (doc) => process.stdout.write(JSON.stringify(doc, null, 1) + '\n');

// Fixed format: the indicator and program text, columns 7 to 72, as explain quotes them.
const cut = (l) => l.slice(6, 72).trimEnd();

function find(code, re, from = 1, to = code.length) {
  for (let n = Math.max(1, from); n <= to; n++) { const m = re.exec(code[n - 1]); if (m) return { n, m }; }
  return null;
}

// What one program holds: its source and sink statements, and the route between them when a MOVE
// joins them. A check on the source field before the sink either stops the route (an EVALUATE whose
// WHEN OTHER ends the run) or lowers it (a class test).
function analyse(path, text) {
  const code = text.split(/\r?\n/).map(cut);
  const pid = find(code, /^\s*PROGRAM-ID\.\s*([A-Z0-9-]+)/i);
  const program = pid ? pid.m[1].toUpperCase() : null;
  const source = find(code, /^\s*ACCEPT\s+([A-Z0-9-]+)\s+FROM\s+COMMAND-LINE\b/i);
  const sink = find(code, /^\s*CALL\s+['"]SYSTEM['"]\s+USING\s+([A-Z0-9-]+)/i);
  const held = { path, program, code, source: source ? source.n : null, sink: sink ? sink.n : null, route: null, stopped: false };
  if (!source || !sink || sink.n < source.n) return held;
  const item = source.m[1].toUpperCase(), target = sink.m[1].toUpperCase();
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- item and target are COBOL data names taken from the synthetic held source of this fixture
  const move = find(code, new RegExp(`^\\s*MOVE\\s+${item}\\s+TO\\s+${target}\\b`, 'i'), source.n + 1, sink.n - 1);
  if (!move) return held;
  let guard = null;
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- item and target are COBOL data names taken from the synthetic held source of this fixture
  const ev = find(code, new RegExp(`^\\s*EVALUATE\\s+${item}\\s*$`, 'i'), source.n + 1, sink.n - 1);
  const end = ev && find(code, /^\s*END-EVALUATE\b/i, ev.n + 1, sink.n - 1);
  const other = end && find(code, /^\s*WHEN\s+OTHER\s*$/i, ev.n + 1, end.n - 1);
  if (other && find(code, /^\s*(GOBACK|STOP\s+RUN)\b/i, other.n + 1, end.n - 1)) guard = { line: ev.n, stops: true };
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- item and target are COBOL data names taken from the synthetic held source of this fixture
  const test = !guard && find(code, new RegExp(`^\\s*IF\\s+${item}\\s+IS\\s+NOT\\s+(ALPHABETIC|NUMERIC)\\b`, 'i'), source.n + 1, sink.n - 1);
  if (test) guard = { line: test.n, stops: false };
  held.stopped = !!(guard && guard.stops);
  held.route = {
    rule: RULE, sev: guard ? 'high' : 'crit', ...(guard ? { guardedFrom: 'crit' } : {}), cwe: 'CWE-78', evidence: 'path',
    program, path, line: sink.n, crossProgram: false,
    detail: `${item}, read from the command line, reaches CALL 'SYSTEM' through ${target}`,
    // Over the rule, the place and the flagged line's code, never its line number.
    fingerprint: createHash('sha256').update([RULE, path, program, code[sink.n - 1].trim()].join('\0')).digest('hex').slice(0, 32),
    related: [{ path, line: source.n }],
    trace: [
      { program, item, file: path, via: `ACCEPT at ${path}:${source.n}`, line: source.n },
      { program, item: target, file: path, via: `MOVE at ${path}:${move.n}`, line: move.n },
    ],
    ...(guard ? { guard: { file: path, line: guard.line, program, item, stops: guard.stops } } : {}),
  };
  return held;
}

function scanFiles(files) {
  const programs = new Map(), findings = [], checked = [];
  for (const [path, text] of [...files].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
    const a = analyse(path, text);
    programs.set(path, a);
    if (a.route) (a.stopped ? checked : findings).push(a.route);
  }
  return { programs, findings, checked };
}

function filesIn(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.name === '.git') continue;
      const abs = join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (e.isFile() && SOURCE_FILE.test(e.name)) out.set(relative(root, abs).split(sep).join('/'), readFileSync(abs, 'latin1'));
    }
  };
  walk(root);
  return out;
}

function filesAt(repo, rev) {
  const git = (...args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'latin1', maxBuffer: 64 * 1024 * 1024 });
  const ls = git('ls-tree', '-r', '-z', '--name-only', rev);
  if (ls.status !== 0) throw new Error(`${rev} is not a revision in ${repo}`);
  const out = new Map();
  for (const path of ls.stdout.split('\0').filter((p) => SOURCE_FILE.test(p))) {
    const blob = git('cat-file', 'blob', `${rev}:${path}`);
    if (blob.status !== 0) throw new Error(`${path} could not be read at ${rev}`);
    out.set(path, blob.stdout);
  }
  return out;
}

function declaration(held, item) {
  // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- item and target are COBOL data names taken from the synthetic held source of this fixture
  const d = find(held.code, new RegExp(`^\\s*(\\d{2})\\s+${item}\\s+PIC(?:TURE)?\\s+(\\S+?)\\.?$`, 'i'));
  return d && { program: held.program, item, level: Number(d.m[1]), picture: d.m[2], section: 'WORKING-STORAGE', path: held.path, line: d.n };
}

function explain(root, fingerprint) {
  const scan = scanFiles(filesIn(root));
  const f = scan.findings.find((x) => x.fingerprint === fingerprint);
  if (!f) return refuse(`no finding with fingerprint ${fingerprint} in this report`);
  const held = scan.programs.get(f.path);
  const quote = (line) => ({ code: held.code[line - 1] });
  const items = [...new Set(f.trace.map((h) => h.item))];
  emit({
    tool: 'cobolwork-explain', carriesSource: true,
    note: 'This packet contains source text from the files it names. A cobolwork report never does.',
    fingerprint, shared: 1,
    finding: { rule: f.rule, sev: f.sev, cwe: f.cwe, evidence: f.evidence, claim: null, whoActs: null, impact: null,
      remedy: 'let through only a fixed list of values before the call, and end the run on anything else',
      program: f.program, path: f.path, line: f.line, crossProgram: false, detail: f.detail },
    hops: f.trace.map((h, i) => ({ n: i + 1, program: h.program, item: h.item, file: h.file, via: h.via, path: h.file, line: h.line, ...quote(h.line) })),
    sink: { path: f.path, line: f.line, ...quote(f.line) },
    guard: f.guard ? { ...f.guard, ...quote(f.guard.line) } : null,
    related: f.related.map((r) => ({ ...r, ...quote(r.line) })),
    declarations: items.map((item) => declaration(held, item)).filter(Boolean),
    unread: [],
  });
}

function gate(repo, { base, head, target, targetOnly }) {
  const before = scanFiles(filesAt(repo, base));
  const t = before.findings.find((f) => f.fingerprint === target);
  if (!t) return refuse(`no finding with fingerprint ${target} in the base`);
  const after = scanFiles(head ? filesAt(repo, head) : filesIn(repo));
  // A finding the fingerprint no longer matches is paired by its route: the same rule in the same program.
  const key = (f) => `${f.rule}|${f.path}|${f.program}`;
  const h = after.findings.find((f) => f.fingerprint === t.fingerprint) || after.findings.find((f) => key(f) === key(t));
  const pairedBy = h ? (h.fingerprint === t.fingerprint ? 'fingerprint' : 'route') : null;
  const held = after.programs.get(t.path);
  let outcome;
  if (h) outcome = SEV[h.sev] < SEV[t.sev] && h.guard ? 'lowered-by-check' : 'still-reported';
  else if (!held || held.program !== t.program) outcome = 'program-removed';
  else if (after.checked.some((c) => key(c) === key(t))) outcome = 'cleared-by-check';
  else if (!held.sink) outcome = 'statement-removed';
  else if (!held.source) outcome = 'source-removed';
  else outcome = 'gone-unexplained';

  const at = `${t.rule} at ${t.path}:${t.line}`;
  const reasons = [];
  if (outcome === 'still-reported') reasons.push(`the target, ${at}, is still reported at ${h.sev}${pairedBy === 'fingerprint' ? '' : ' after its line was edited or moved'}`);
  if (outcome === 'lowered-by-check') reasons.push(`the target is still reported, lowered from ${t.sev} to ${h.sev} by a check this patch added at ${t.path}:${h.guard.line}; a check that lowers rather than stops may not turn away everything it should, so a person decides`);
  if (outcome === 'program-removed') reasons.push(`the patch removes ${t.path} or its program ${t.program}, which held the target; removing the program is not a fix the gate accepts`);
  if (outcome === 'statement-removed') reasons.push(`the patch deletes the target's statement at ${t.path}:${t.line}; a fix keeps the statement and stops the route to it, so deleting it is not a fix the gate accepts`);
  if (outcome === 'source-removed') reasons.push("the patch deletes the statement the target's input comes from; a fix keeps it and stops the route from it, so deleting it is not a fix the gate accepts");
  if (outcome === 'gone-unexplained') reasons.push(`the target, ${at}, is gone, but the patch neither removed its statement or its source nor added a check that stops its route; a person decides`);

  const checks = { target: PASSING.has(outcome) ? true : UNDECIDED.has(outcome) ? null : false };
  let compiled = null;
  if (!targetOnly) {
    const added = after.findings.filter((f) => f !== h && !before.findings.some((b) => key(b) === key(f)));
    checks.added = added.length === 0;
    for (const f of added) reasons.push(`the patch adds ${f.rule} (${f.sev}) at ${f.path}:${f.line}`);
    checks.compile = null;
    compiled = 'not compiled: this stand-in has no compiler';
  }
  checks.coverage = true;
  const values = Object.entries(checks);
  const verdict = values.some(([, v]) => v === false) ? 'fail' : values.some(([k, v]) => v === null && k !== 'compile') ? 'undecided' : 'pass';
  emit({
    tool: 'cobolwork-gate', schemaVersion: 3, verdict,
    target: { fingerprint: t.fingerprint, rule: t.rule, sev: t.sev, evidence: t.evidence, path: t.path, line: t.line, program: t.program },
    outcome, ...(pairedBy ? { pairedBy } : {}), checks, ...(compiled ? { compiled } : {}), reasons,
    repositoryText: ['target.path', 'target.program', 'reasons'],
    summary: { mode: targetOnly ? 'target-only' : 'gate', toolVersion: 'stand-in', coverageIncomplete: false, base, head: head || 'working tree' },
  });
}

// What `capabilities --json` states: the contract lib/cobolwork-resolve.mjs holds a cobolwork to.
const CAPABILITIES = {
  tool: 'cobolwork-capabilities', schemaVersion: 1, toolVersion: 'stand-in', toolRevision: null,
  commands: {
    scan: { args: ['<path>'], options: ['--only'], documents: ['cobolwork'] },
    explain: { args: ['<path>', '<fingerprint>'], options: [], documents: ['cobolwork-explain'] },
    gate: { args: ['<repo>'], options: ['--base', '--head', '--target', '--target-only'], documents: ['cobolwork-gate'] },
    capabilities: { args: [], options: ['--json'], documents: ['cobolwork-capabilities'] },
  },
  documents: { cobolwork: 3, 'cobolwork-gate': 3, 'cobolwork-capabilities': 1, 'cobolwork-explain': null },
  identity: { version: 'cobolwork/v1' },
};

const opts = { _: [] };
const argv = process.argv.slice(2);
const takesValue = { '--only': 'only', '--base': 'base', '--head': 'head', '--target': 'target' };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (takesValue[a]) opts[takesValue[a]] = argv[++i];
  else if (a === '--target-only') opts.targetOnly = true;
  else if (a === '--json') opts.json = true;
  else if (a.startsWith('-')) { opts.unknown = a; break; }
  else opts._.push(a);
}
const [command, where] = opts._;
const root = resolve(where || '.');
try {
  if (opts.unknown) refuse(`unknown option ${opts.unknown}`);
  else if (command === 'capabilities') emit(CAPABILITIES);
  else if (command === 'scan') {
    if (opts.only && opts.only !== 'flow') refuse(`--only takes flow in this stand-in; got ${opts.only}`);
    else {
      const files = filesIn(root);
      const scan = scanFiles(files);
      emit({ tool: 'cobolwork', schemaVersion: 3,
        summary: { toolVersion: 'stand-in', filesScanned: files.size, nosrc: files.size === 0, coverageIncomplete: false, identity: { version: 'cobolwork/v1', shared: 0 } },
        findings: scan.findings });
    }
  } else if (command === 'explain') {
    if (!opts._[2]) refuse('explain needs <path> <fingerprint>');
    else explain(root, opts._[2]);
  } else if (command === 'gate') {
    if (!opts.base || !opts.target) refuse('gate needs --base <ref> and --target <fingerprint>');
    else gate(root, opts);
  } else refuse(`unknown command ${command}`);
} catch (e) {
  refuse(e.message);
}
