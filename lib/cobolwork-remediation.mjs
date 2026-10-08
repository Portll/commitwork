// lib/cobolwork-remediation.mjs — the commitwork half of cobolwork's remediation pipeline: a drafter
// proposes line edits to one finding, `cobolwork gate` disposes, and a person applies what passed.
// Specified in docs/COBOLWORK-REMEDIATION.md. The operator's working tree and index are never touched
// until apply: the base is read from git objects and each draft is built through a private index.

import { spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fenceUntrusted } from './untrusted-text.mjs';
import * as defaultBridge from './cobolwork-bridge.mjs';
import { scannedGitArgv, scannedGitEnv } from '../bin/lib/git-env.mjs';

export const OPS = ['insert-before', 'insert-after', 'replace', 'delete'];
export const MAX_EDITS = 12;
export const MAX_NEW_LINES = 60;
const JOB_ID_RE = /^[a-f0-9]{16}$/;
const PRINTABLE = /^[\x20-\x7e]*$/;
const REF_PREFIX = 'refs/cobolwork/remediation/';

export const jobIdFor = (repoName, fingerprint) => createHash('sha256').update(`${repoName}|${fingerprint}`).digest('hex').slice(0, 16);
export const refFor = (jobId) => `${REF_PREFIX}${jobId}`;

// ── git, run without the repository's hooks, fsmonitor, drivers or prompts ───────────────────────
function run(file, args, { input = null, env = {}, baseEnv = process.env, timeoutMs = 600_000 } = {}) {
  return new Promise((done) => {
    const out = [], err = [];
    let p;
    try { p = spawn(file, args, { cwd: tmpdir(), env: { ...baseEnv, ...env }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (e) { return done({ status: null, stdout: Buffer.alloc(0), stderr: e.message }); }
    const t = setTimeout(() => { try { p.kill('SIGKILL'); } catch (e) { err.push(Buffer.from(`\n(kill: ${e.code || e.message})`)); } }, timeoutMs);
    p.stdout.on('data', (d) => out.push(d));
    p.stderr.on('data', (d) => err.push(d));
    p.on('error', (e) => { clearTimeout(t); done({ status: null, stdout: Buffer.alloc(0), stderr: e.message }); });
    p.on('close', (status) => { clearTimeout(t); done({ status, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8').trim() }); });
    p.stdin.on('error', (e) => err.push(Buffer.from(`\n(stdin: ${e.code || e.message})`)));
    p.stdin.end(input);
  });
}
const GIT_ENV = { GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0' };
// The repo is a fleet repo, and apply fast-forwards it on the host: its post-merge and
// reference-transaction hooks, and any smudge filter the checkout would run, stay off. Nothing here
// relies on a hook; a private index is passed in opts.env and survives because it is laid on top.
export const git = async (repo, args, opts = {}) => {
  const prepared = scannedGitEnv(repo);
  if (prepared.error) return { status: null, stdout: Buffer.alloc(0), stderr: `scannedGit refused to run: ${prepared.error}` };
  return run('git', scannedGitArgv(repo, args), { ...opts, baseEnv: {}, env: { ...prepared.env, ...GIT_ENV, ...(opts.env || {}) } });
};
const text = (r) => r.stdout.toString('utf8').trim();
const why = (r) => r.stderr.split('\n')[0] || `exit ${r.status}`;

async function revParse(repo, spec) {
  const r = await git(repo, ['rev-parse', '--verify', '--quiet', '--end-of-options', spec]);
  const sha = text(r);
  return r.status === 0 && /^[0-9a-f]{40}([0-9a-f]{24})?$/.test(sha) ? sha : null;
}

// ── the base on disk, from objects: no checkout, so no hook, filter or working-tree state ────────
function placeIn(dir, path) {
  const parts = path.split('/');
  if (parts.some((p) => !p || p === '.' || p === '..' || /[\\:\0]/.test(p) || p.toLowerCase() === '.git')) return null;
  const to = resolve(dir, ...parts);
  return to.startsWith(dir + sep) ? to : null;
}

export async function materialise(repo, sha) {
  const listed = await git(repo, ['ls-tree', '-r', '-z', '--full-tree', sha]);
  if (listed.status !== 0) throw new Error(`git ls-tree ${sha} failed: ${why(listed)}`);
  const blobs = [];
  for (const entry of listed.stdout.toString('utf8').split('\0')) {
    const m = /^(\d{6}) blob ([0-9a-f]+)\t(.+)$/s.exec(entry);
    if (m && m[1] !== '120000') blobs.push({ oid: m[2], path: m[3] });
  }
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'cw-remediation-')));
  try {
    for (let i = 0; i < blobs.length; i += 500) {
      const batch = blobs.slice(i, i + 500);
      const r = await git(repo, ['cat-file', '--batch'], { input: batch.map((b) => b.oid).join('\n') + '\n' });
      if (r.status !== 0) throw new Error(`git cat-file failed: ${why(r)}`);
      let at = 0;
      for (const b of batch) {
        const nl = r.stdout.indexOf(0x0a, at);
        const head = r.stdout.toString('utf8', at, nl).split(' ');
        if (head[1] !== 'blob') throw new Error(`git cat-file: ${b.oid} is ${head[1] || 'missing'}`);
        const size = Number(head[2]);
        const to = placeIn(dir, b.path);
        if (to) { mkdirSync(dirname(to), { recursive: true }); writeFileSync(to, r.stdout.subarray(nl + 1, nl + 1 + size)); }
        at = nl + 1 + size + 1;
      }
    }
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
  return dir;
}

// ── the edit contract ────────────────────────────────────────────────────────────────────────────
// Lines the packet quotes may be edited; a declaration's line, which it names but does not quote,
// may only have lines put beside it; a line it withheld may not be touched at all. A statement the
// packet quotes past its first line (endLine, rest) gives every one of its lines, each knowing the
// statement's extent.
export function anchorsFrom(packet) {
  const anchors = new Map();
  const put = (a, stmt) => {
    const key = `${a.path}:${Number(a.line)}`;
    const held = anchors.get(key);
    if (held && held.code != null) return;
    anchors.set(key, { path: a.path, line: Number(a.line), code: typeof a.code === 'string' ? a.code : null,
      quoted: typeof a.code === 'string', withheld: !!a.withheld, role: a.role, ...(stmt ? { stmt } : {}) });
  };
  const add = (a) => {
    if (!a || typeof a.path !== 'string' || !(Number(a.line) > 0)) return;
    const start = Number(a.line), end = Number(a.endLine);
    const rest = Array.isArray(a.rest) ? a.rest.filter((r) => r && Number(r.line) > start && Number(r.line) <= end) : [];
    const stmt = end > start && rest.length === end - start ? [start, end] : null;
    put(a, stmt);
    if (stmt) for (const r of rest) put({ ...r, path: a.path, role: `${a.role}, continued from line ${start}` }, stmt);
  };
  for (const h of packet.hops || []) if (!h.elided) add({ ...h, role: `hop ${h.n}${h.via ? ` (${h.via})` : ''}` });
  if (packet.sink) add({ ...packet.sink, role: 'sink' });
  for (const r of packet.related || []) add({ ...r, role: 'source' });
  if (packet.guard && packet.guard.path) add({ ...packet.guard, role: 'check' });
  for (const d of packet.declarations || []) {
    add({ path: d.path, line: d.line, code: null, role: `declaration of ${d.item}, level ${d.level}${d.picture ? ` PIC ${d.picture}` : ''} in ${d.section || 'an unnamed section'}` });
  }
  return anchors;
}

// A replace that writes a quoted line back as it reads changes nothing, and is dropped before the
// edits are counted: a model that echoes every line it was shown is not over the limit for it.
const unchanged = (e, anchors) => {
  const a = e && e.op === 'replace' && Array.isArray(e.code) && e.code.length === 1 && typeof e.code[0] === 'string'
    ? anchors.get(`${e.path}:${e.line}`) : null;
  return !!(a && a.quoted && e.code[0].trimEnd() === a.code);
};

export function validateEdits(draft, anchors) {
  const reasons = [];
  const given = draft && Array.isArray(draft.edits) ? draft.edits : null;
  if (!given || !given.length) return { ok: false, reasons: ['the draft has no edits'] };
  const edits = given.filter((e) => !unchanged(e, anchors));
  if (!edits.length) return { ok: false, reasons: ['the draft changes nothing: every edit writes a line back as it reads'] };
  if (edits.length > MAX_EDITS) return { ok: false, reasons: [`the draft has ${edits.length} edits; at most ${MAX_EDITS}`] };
  let newLines = 0;
  const replaced = new Set();
  const deleted = new Map();
  const clean = [];
  edits.forEach((e, i) => {
    const at = `edit ${i + 1}`;
    if (!e || typeof e.path !== 'string' || !Number.isInteger(e.line) || !OPS.includes(e.op)) { reasons.push(`${at} needs a path, an integer line and an op of ${OPS.join(', ')}`); return; }
    const code = Array.isArray(e.code) ? e.code : [];
    if (code.some((c) => typeof c !== 'string')) { reasons.push(`${at}: every code line is a string`); return; }
    const a = anchors.get(`${e.path}:${e.line}`);
    if (!a) { reasons.push(`${at}: line ${e.line} of that file is not a line the packet quotes or names, so it cannot be edited`); return; }
    if (a.withheld) { reasons.push(`${at}: line ${e.line} was withheld from the packet because the hidden-content rules flagged it, so it cannot be edited`); return; }
    if (!a.quoted && (e.op === 'replace' || e.op === 'delete')) { reasons.push(`${at}: line ${e.line} is a declaration the packet names but does not quote; lines may be put before or after it, not replace or delete it`); return; }
    if (e.op === 'delete' && code.length) { reasons.push(`${at}: a delete carries no code`); return; }
    if (e.op !== 'delete' && !code.length) { reasons.push(`${at}: an ${e.op} carries at least one code line`); return; }
    if (e.op === 'replace' || e.op === 'delete') {
      if (replaced.has(`${e.path}:${e.line}`)) { reasons.push(`${at}: line ${e.line} is already replaced or deleted by another edit`); return; }
      replaced.add(`${e.path}:${e.line}`);
    }
    const bad = code.findIndex((c) => !PRINTABLE.test(c));
    if (bad >= 0) { reasons.push(`${at}: code line ${bad + 1} holds a character outside printable ASCII`); return; }
    newLines += code.length;
    // Lines put beside a statement go beside the whole of it: after its last line, before its first.
    const line = a.stmt && e.op === 'insert-after' ? a.stmt[1] : a.stmt && e.op === 'insert-before' ? a.stmt[0] : e.line;
    if (a.stmt && e.op === 'delete') {
      const k = `${e.path}:${a.stmt[0]}`;
      deleted.set(k, [...(deleted.get(k) || []), e.line]);
    }
    clean.push({ path: e.path, line, op: e.op, code });
  });
  for (const [k, lines] of deleted) {
    const a = anchors.get(k);
    if (lines.length !== a.stmt[1] - a.stmt[0] + 1) reasons.push(`lines ${a.stmt[0]} to ${a.stmt[1]} of ${a.path} are one statement; delete every one of them or none, not lines ${lines.sort((x, y) => x - y).join(', ')}`);
  }
  if (newLines > MAX_NEW_LINES) reasons.push(`the draft writes ${newLines} lines; at most ${MAX_NEW_LINES}`);
  return reasons.length ? { ok: false, reasons } : { ok: true, edits: clean };
}

// Where the packet's code starts in a file's lines, learned from the lines it quotes.
const JCL = /\.(jcl|job|proc|prc|cntl)$/i;
export function columnsFor(path, lines, quoted) {
  const forms = [
    { name: 'fixed', offset: 6, width: 66, cut: (l) => l.slice(6, 72), fits: (l) => l.length <= 80 },
    { name: 'variable', offset: 6, width: 244, cut: (l) => l.slice(6, 250), fits: () => !JCL.test(path) },
    { name: 'jcl', offset: 0, width: 72, cut: (l) => l.slice(0, 72), fits: () => JCL.test(path) },
    { name: 'free', offset: 0, width: 250, cut: (l) => l, fits: () => !JCL.test(path) },
  ];
  if (!quoted.length) return { reason: `no line of ${path} in the packet shows which columns its code occupies` };
  for (const f of forms) {
    if (quoted.every((q) => lines[q.line - 1] !== undefined && f.fits(lines[q.line - 1]) && f.cut(lines[q.line - 1]).trimEnd() === q.code)) return f;
  }
  return { reason: `the lines the packet quotes from ${path} do not match the base revision` };
}

// Base text plus edits, in the file's own columns and line endings.
export function renderEdits(path, baseText, edits, anchors) {
  const parts = baseText.split('\n');
  const trailing = parts.length > 1 && parts[parts.length - 1] === '';
  if (trailing) parts.pop();
  const cr = parts.map((p) => p.endsWith('\r'));
  const lines = parts.map((p, i) => (cr[i] ? p.slice(0, -1) : p));
  const crlf = cr.filter(Boolean).length * 2 > cr.length;
  const quoted = [...anchors.values()].filter((a) => a.path === path && a.quoted);
  const cols = columnsFor(path, lines, quoted);
  if (cols.reason) return { ok: false, reasons: [cols.reason] };
  const reasons = [];
  const render = (code, i) => {
    if (code.length > cols.width) reasons.push(`a line for ${path}:${i} runs past column ${cols.offset + cols.width} (${cols.offset + code.length})`);
    if (cols.offset === 6 && code.length && code[0] !== ' ') reasons.push(`a line for ${path}:${i} puts ${JSON.stringify(code[0])} in the indicator column; new lines are code, not comments or continuations`);
    return ' '.repeat(cols.offset) + code;
  };
  const before = new Map(), after = new Map(), swap = new Map();
  for (const e of edits.filter((x) => x.path === path)) {
    if (e.line > lines.length) { reasons.push(`${path} has ${lines.length} lines; line ${e.line} is past its end`); continue; }
    const rendered = e.code.map((c) => render(c, e.line));
    if (e.op === 'insert-before') before.set(e.line, [...(before.get(e.line) || []), ...rendered]);
    else if (e.op === 'insert-after') after.set(e.line, [...(after.get(e.line) || []), ...rendered]);
    else swap.set(e.line, e.op === 'delete' ? [] : rendered);
  }
  if (reasons.length) return { ok: false, reasons };
  const out = [];
  const eol = crlf ? '\r\n' : '\n';
  lines.forEach((l, i) => {
    const n = i + 1;
    for (const x of before.get(n) || []) out.push(x + eol);
    for (const x of swap.has(n) ? swap.get(n) : [l]) out.push(x + (swap.has(n) ? eol : (cr[i] ? '\r\n' : '\n')));
    for (const x of after.get(n) || []) out.push(x + eol);
  });
  let result = out.join('');
  if (!trailing) result = result.replace(/\r?\n$/, '');
  return { ok: true, text: result, columns: cols.name };
}

// A commit of base plus the given file texts, through a private index; no hook runs.
export async function draftCommit(repo, base, files, message) {
  const index = join(tmpdir(), `cw-remediation-index-${randomBytes(6).toString('hex')}`);
  const env = { GIT_INDEX_FILE: index, GIT_AUTHOR_NAME: 'commitwork remediation', GIT_AUTHOR_EMAIL: 'remediation@commitwork.invalid',
    GIT_COMMITTER_NAME: 'commitwork remediation', GIT_COMMITTER_EMAIL: 'remediation@commitwork.invalid' };
  try {
    const rt = await git(repo, ['read-tree', base], { env });
    if (rt.status !== 0) throw new Error(`git read-tree failed: ${why(rt)}`);
    for (const [path, content] of files) {
      const ls = await git(repo, ['ls-tree', base, '--', path]);
      const mode = (/^(100644|100755) blob /.exec(text(ls)) || [])[1];
      if (!mode) throw new Error(`${path} is not a regular file at the base revision`);
      const blob = await git(repo, ['hash-object', '-w', '--stdin'], { input: content });
      if (blob.status !== 0) throw new Error(`git hash-object failed: ${why(blob)}`);
      const ui = await git(repo, ['update-index', '--cacheinfo', `${mode},${text(blob)},${path}`], { env });
      if (ui.status !== 0) throw new Error(`git update-index failed: ${why(ui)}`);
    }
    const tree = await git(repo, ['write-tree'], { env });
    if (tree.status !== 0) throw new Error(`git write-tree failed: ${why(tree)}`);
    const commit = await git(repo, ['commit-tree', text(tree), '-p', base, '-F', '-'], { env, input: message });
    if (commit.status !== 0) throw new Error(`git commit-tree failed: ${why(commit)}`);
    return text(commit);
  } finally { rmSync(index, { force: true }); }
}

async function readText(repo, sha, path) {
  const r = await git(repo, ['cat-file', 'blob', `${sha}:${path}`]);
  if (r.status !== 0) return { reason: `${path} is not in the base revision` };
  const s = r.stdout.toString('utf8');
  // EBCDIC and other encodings are not edited here: rewriting them as UTF-8 would corrupt them.
  if (s.includes('\0') || !Buffer.from(s, 'utf8').equals(r.stdout)) return { reason: `${path} is not ASCII or UTF-8 text, and is not edited` };
  return { text: s };
}

// ── what the drafter is asked, and what it returns ───────────────────────────────────────────────
export const DRAFT_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['rationale', 'edits'],
  properties: {
    rationale: { type: 'string' },
    edits: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['path', 'line', 'op', 'code'],
      properties: { path: { type: 'string' }, line: { type: 'integer' }, op: { type: 'string', enum: OPS }, code: { type: 'array', items: { type: 'string' } } } } },
  },
};

// What a drafter can do about each gate outcome that did not pass.
const NEXT_STEP = {
  'still-reported': 'the route still reaches the sink. Add a check that stops it before the sink.',
  'statement-removed': 'you deleted the statement the finding names. Keep it as it was, and stop the input before it with a check.',
  'source-removed': 'you deleted the statement the input comes from. Keep it as it was, and stop the input after it with a check.',
  'lowered-by-check': 'your check lowers the finding but does not stop it. Use an allow-list of literals whose WHEN OTHER ends the run, a class test such as IS NUMERIC where digits are needed, or a bound where an index is used.',
  'gone-unexplained': 'the gate cannot see why the finding went. If you replaced the value with literals, or cut the MOVE that carried it, keep the original MOVE and CALL as they were and stop the input with the EVALUATE shape above instead.',
  'program-removed': 'the program is gone. Keep it, and change only the lines around the finding.',
};

export function draftPrompt({ packet, anchors, previous = [] }) {
  const lines = [...anchors.values()].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line)).map((a) =>
    `${a.path}:${a.line} [${a.role}]${a.withheld ? ' WITHHELD - do not edit' : a.quoted ? ` ${JSON.stringify(a.code)}` : ' (named, not quoted: insert before or after only)'}`);
  const f = packet.finding || {};
  const system = 'You draft the smallest fix for one security finding in COBOL, JCL or CICS source. You never see whole files, only the lines a scanner quoted, and you change code only by line edits anchored to those lines. Reply only with the JSON the schema describes.';
  const user = [
    '# The finding and the source it quotes',
    fenceUntrusted(JSON.stringify({ finding: f, hops: packet.hops, sink: packet.sink, related: packet.related, guard: packet.guard, declarations: packet.declarations }, null, 1), 'cobolwork:explain'),
    '',
    '# Lines you may anchor an edit to',
    fenceUntrusted(lines.join('\n'), 'cobolwork:explain'),
    '',
    '# How the fix is judged',
    'A deterministic gate rescans the patched source. It passes a draft only when:',
    '- a check you add STOPS the route before the sink: an EVALUATE that lets through only a fixed list of literals and ends the run on WHEN OTHER (GOBACK, or EXEC CICS RETURN in a CICS program); an IS NUMERIC test before arithmetic; a bound before a subscript. A check that only sets a flag, or leaves room, lowers the finding and a person must still decide;',
    '- the statement the finding names, and the statement its input comes from, stay as they are: a draft that deletes either fails;',
    '- and nothing else changes: no new finding, no new program called, no record layout another program reads moved, no edit to cobolwork.site.json or cobolwork.baseline.json, and no program deleted.',
    'Keep the route and stop it; do not replace the value. The gate recognises a check on the field that still flows to the sink. If you instead move literals into the sink\'s operand, the route is gone, and the gate cannot tell a route that no longer exists from one sent through something it does not follow: that draft is undecided, never passed. The shape that passes, for input reaching a command:',
    '```', '     EVALUATE <input field>', "        WHEN '<allowed value>'", "        WHEN '<allowed value>'", '           CONTINUE', '        WHEN OTHER', '           GOBACK', '     END-EVALUATE', '```',
    'inserted right after the statement that receives the input, with every other line left as it is.',
    'Allow only values the program itself names, in the quoted lines. Where the valid values are known only when the program runs (read from a file, a table or the system), do not invent literals: an allow-list of made-up names passes the gate and breaks the program. Say so in the rationale instead.',
    `The standard fix for this rule: ${f.remedy || 'not stated by the scanner'}.`,
    '',
    '# How to write an edit',
    '- op is insert-before or insert-after (new lines beside the anchor), replace (your lines instead of the anchor line) or delete (remove it; code is []).',
    '- A statement can run over several lines: its later lines are listed as "continued from line N". Lines inserted after any line of a statement go after its last line, and lines inserted before it go before its first. To remove a statement, delete every one of its lines.',
    '- Write each code line exactly as the packet shows code. For fixed-format COBOL the first character is column 7, the indicator, and must be a space; area A starts at the 2nd character (column 8) and area B at the 6th (column 12); a line is at most 66 characters (column 72). Printable ASCII only. No comment lines.',
    '- A new data item goes after a declaration line, as a level 01 or 77 item in WORKING-STORAGE. A multi-line statement ends with its scope terminator (END-IF, END-EVALUATE) or a period, as the code around it does.',
    '- Keep the rationale to three sentences: what is wrong, what the edits change, and what they do not cover.',
    ...(previous.length ? ['', '# Earlier attempts, and why each did not pass', ...previous.map((p, i) => [
      `## Attempt ${i + 1}: ${p.verdict ? `gate ${p.verdict}${p.outcome ? ` (${p.outcome})` : ''}` : 'refused before the gate'}`,
      'Your edits:', '```json', JSON.stringify(p.edits || [], null, 1), '```',
      'Why:', fenceUntrusted((p.reasons || []).join('\n'), p.verdict ? 'cobolwork:gate' : 'commitwork:edit-check'),
      ...(NEXT_STEP[p.outcome] ? [`What to change: ${NEXT_STEP[p.outcome]}`] : []),
      ...((p.reasons || []).some((r) => r.startsWith('the compiler: ')) ? ['The patched program does not compile: the compiler lines above give the line and what it expected there.'] : []),
    ].join('\n')), 'Do not send a draft you have already sent: the same edits get the same verdict.'] : []),
  ].join('\n');
  return { system, user };
}

export function reviewPrompt({ packet, diff, gateDoc }) {
  return [
    'You review a drafted fix for one security finding in COBOL, JCL or CICS source. A deterministic gate has already rescanned it; you look for what a rescan cannot see: behaviour the fix breaks for legitimate input, a check that is wrong for this program, or a route the scanner does not follow.',
    '', '# The finding and the source it quotes', fenceUntrusted(JSON.stringify({ finding: packet.finding, hops: packet.hops, sink: packet.sink }, null, 1), 'cobolwork:explain'),
    '', '# The drafted diff', fenceUntrusted(diff, 'commitwork:draft'),
    '', `# The gate's verdict: ${gateDoc.verdict} (${gateDoc.outcome})`,
    '', 'Respond ONLY with JSON: {"agrees": boolean (the fix is right to apply), "concerns": string (what a person should check; "none" if nothing)}.',
  ].join('\n');
}

// ── the pipeline ─────────────────────────────────────────────────────────────────────────────────
const RANK = { pass: 3, undecided: 2, fail: 1 };

// drafter({ prompt, attempt, signal }) -> { ok, draft, engine, error }; reviewer({ prompt, signal }) -> { ok, review, engine, error }
export async function remediate({ repoPath, fingerprint, jobId, drafter, reviewer = null, bridge = defaultBridge, maxAttempts = 3, signal = null, onEvent = () => {} }) {
  if (!JOB_ID_RE.test(String(jobId))) throw new Error('a job id is 16 lowercase hex characters');
  const at = () => process.env.CW_NOW || new Date().toISOString();
  const base = await revParse(repoPath, 'HEAD^{commit}');
  if (!base) return { state: 'failed', error: 'the repository has no commit at HEAD' };
  onEvent(`base ${base.slice(0, 12)}`);

  let dir = null, got;
  try { dir = await materialise(repoPath, base); got = await bridge.explain(dir, fingerprint, { signal }); }
  catch (e) { got = { ok: false, reason: e.message }; }
  finally { if (dir) rmSync(dir, { recursive: true, force: true }); }
  if (!got.ok) {
    const state = got.stopped ? 'stopped' : got.unavailable ? 'unscanned' : 'refused';
    return { state, baseSha: base, error: state === 'unscanned' ? `not drafted: ${got.reason}` : got.reason, attempts: [] };
  }
  const packet = got.packet;
  const anchors = anchorsFrom(packet);
  onEvent(`packet: ${packet.finding && packet.finding.rule}, ${anchors.size} line(s) it may anchor to`);

  const attempts = [], previous = [], sent = new Map();
  // Each event carries the attempts so far, so a record written on it shows a draft as soon as it is judged.
  const say = (m) => onEvent(m, attempts);
  for (let n = 1; n <= maxAttempts; n++) {
    if (signal && signal.aborted) return { state: 'stopped', baseSha: base, attempts, error: 'stopped by operator' };
    const d = await drafter({ prompt: draftPrompt({ packet, anchors, previous }), attempt: n, signal });
    if (!d.ok) {
      attempts.push({ n, at: at(), error: d.error, engine: d.engine || null });
      say(`attempt ${n}: drafter failed: ${d.error}`);
      if (d.stopped || (signal && signal.aborted)) return { state: 'stopped', baseSha: base, attempts, error: 'stopped by operator' };
      break;
    }
    const rec = { n, at: at(), engine: d.engine || null, rationale: String(d.draft && d.draft.rationale || '').slice(0, 2000), edits: (d.draft && d.draft.edits) || [] };
    const v = validateEdits(d.draft, anchors);
    // The same edits get the same verdict, so a repeated draft ends the run rather than spending a gate.
    // Spacing is not a different draft: the gate would judge the same statements.
    const key = v.ok ? JSON.stringify(v.edits.map((e) => ({ ...e, code: e.code.map((c) => c.trim().replace(/\s+/g, ' ')) }))) : null;
    if (key && sent.has(key)) {
      Object.assign(rec, { repeatOf: sent.get(key) });
      attempts.push(rec); say(`attempt ${n}: the drafter repeated attempt ${sent.get(key)}; stopping`);
      break;
    }
    if (key) sent.set(key, n);
    let reasons = v.ok ? [] : v.reasons;
    const texts = new Map();
    if (v.ok) {
      for (const path of [...new Set(v.edits.map((e) => e.path))].sort()) {
        const b = await readText(repoPath, base, path);
        if (b.reason) { reasons.push(b.reason); continue; }
        const r = renderEdits(path, b.text, v.edits, anchors);
        if (!r.ok) reasons.push(...r.reasons); else texts.set(path, Buffer.from(r.text, 'utf8'));
      }
    }
    if (reasons.length) {
      Object.assign(rec, { rejected: true, reasons });
      attempts.push(rec); previous.push({ edits: rec.edits, reasons });
      say(`attempt ${n}: edits refused before the gate: ${reasons[0]}`);
      continue;
    }
    let draftSha;
    try { draftSha = await draftCommit(repoPath, base, texts, `cobolwork remediation draft ${n} for ${fingerprint}`); }
    catch (e) { Object.assign(rec, { error: e.message }); attempts.push(rec); say(`attempt ${n}: ${e.message}`); break; }
    const diff = await git(repoPath, ['diff', '--no-ext-diff', '--no-textconv', '--no-color', base, draftSha]);
    rec.draftSha = draftSha;
    rec.diff = diff.stdout.toString('utf8');
    say(`attempt ${n}: draft ${draftSha.slice(0, 12)}, gating`);
    const g = await bridge.gate(repoPath, { base, head: draftSha, target: fingerprint }, { signal });
    if (!g.ok) {
      Object.assign(rec, { error: `the gate did not run: ${g.reason}` });
      attempts.push(rec); say(`attempt ${n}: ${rec.error}`);
      if (g.stopped) return { state: 'stopped', baseSha: base, attempts, error: 'stopped by operator' };
      break;
    }
    const doc = g.doc;
    Object.assign(rec, { verdict: doc.verdict, outcome: doc.outcome, checks: doc.checks, compiled: doc.compiled || null, reasons: doc.reasons || [] });
    attempts.push(rec);
    say(`attempt ${n}: gate ${doc.verdict} (${doc.outcome})`);
    if (doc.verdict === 'pass') break;
    previous.push({ edits: rec.edits, verdict: doc.verdict, outcome: doc.outcome, reasons: doc.reasons || [] });
  }

  const gated = attempts.filter((a) => a.verdict);
  const best = gated.reduce((b, a) => (!b || RANK[a.verdict] > RANK[b.verdict] || (RANK[a.verdict] === RANK[b.verdict] && a.n > b.n) ? a : b), null);
  const result = { state: 'lodged', baseSha: base, finding: packet.finding || null, attempts, final: null, review: null };
  if (!best) return { ...result, state: 'failed', error: attempts.length ? (attempts[attempts.length - 1].error || 'no draft reached the gate') : 'no draft was made' };
  const u = await git(repoPath, ['update-ref', refFor(jobId), best.draftSha]);
  if (u.status !== 0) return { ...result, state: 'failed', error: `could not keep the draft as ${refFor(jobId)}: ${why(u)}` };
  const files = text(await git(repoPath, ['diff', '--name-only', '--no-renames', base, best.draftSha])).split('\n').filter(Boolean);
  result.final = { attempt: best.n, verdict: best.verdict, outcome: best.outcome, draftSha: best.draftSha, ref: refFor(jobId), files, diff: best.diff };
  if (best.verdict === 'fail') result.review = { skipped: 'a draft the gate failed is not reviewed' };
  else if (!reviewer) result.review = { skipped: 'no second engine: the source stays on this machine unless the operator allows a remote review' };
  else {
    const r = await reviewer({ prompt: reviewPrompt({ packet, diff: best.diff, gateDoc: { verdict: best.verdict, outcome: best.outcome } }), signal });
    result.review = r.ok ? { engine: r.engine || null, agrees: !!(r.review && r.review.agrees), concerns: String(r.review && r.review.concerns || '').slice(0, 2000) }
      : { engine: r.engine || null, error: r.error };
    say(r.ok ? `review: ${result.review.agrees ? 'agrees' : 'does not agree'}` : `review failed: ${r.error}`);
  }
  return result;
}

// ── apply: a person's act, on the revision the gate judged, and nothing else ────────────────────
const printable = (s, max) => String(s ?? '').replace(/[^\x20-\x7e]/g, '?').slice(0, max);

export function commitMessage(job) {
  const f = job.finding || {};
  const fin = job.final;
  return [
    `fix: ${printable(f.rule, 80)} in ${printable(f.path, 120)}, ${fin.verdict === 'pass' ? 'passed' : 'left undecided'} by the cobolwork gate`,
    '',
    `cobolwork gate: ${fin.verdict} (${fin.outcome}), attempt ${fin.attempt} of ${(job.attempts || []).length}, job ${job.id}.`,
    ...(fin.verdict === 'undecided' ? ['Applied by the operator with the gate undecided.'] : []),
    '',
  ].join('\n');
}

export async function applyLodged({ repoPath, job, acknowledgeUndecided = false }) {
  const fin = job && job.final;
  if (!fin) return { ok: false, error: 'this job lodged no draft' };
  if (fin.verdict === 'fail') return { ok: false, error: 'the gate failed this draft; a failed draft is never applied' };
  if (fin.verdict === 'undecided' && acknowledgeUndecided !== true) return { ok: false, error: `the gate left this draft undecided (${fin.outcome}); applying it is a person's judgement, stated with acknowledgeUndecided` };
  if (fin.verdict !== 'pass' && fin.verdict !== 'undecided') return { ok: false, error: `unknown verdict ${JSON.stringify(fin.verdict)}` };
  if (await revParse(repoPath, fin.ref) !== fin.draftSha) return { ok: false, error: `the lodged draft ${fin.ref} is gone or moved; re-run the remediation` };
  const head = await revParse(repoPath, 'HEAD^{commit}');
  if (head !== job.baseSha) return { ok: false, error: `HEAD is ${head ? head.slice(0, 12) : 'unresolved'}, not ${job.baseSha.slice(0, 12)} the gate judged against; re-run the remediation` };
  const st = await git(repoPath, ['status', '--porcelain=v1', '-z', '--untracked-files=no', '--', ...fin.files]);
  if (st.status !== 0) return { ok: false, error: `git status failed: ${why(st)}` };
  const dirty = st.stdout.toString('utf8').split('\0').filter(Boolean).map((l) => l.slice(3));
  if (dirty.length) return { ok: false, error: `uncommitted changes in ${dirty.join(', ')}; the draft is applied only over a clean copy of the files it changes` };
  const tree = await revParse(repoPath, `${fin.draftSha}^{tree}`);
  const c = await git(repoPath, ['commit-tree', tree, '-p', job.baseSha, '-F', '-'], { input: commitMessage(job) });
  if (c.status !== 0) return { ok: false, error: `git commit-tree failed: ${why(c)}` };
  const commit = text(c);
  // A fast-forward moves HEAD, index and files together, and refuses whatever it would overwrite.
  const m = await git(repoPath, ['merge', '--ff-only', '--no-edit', commit]);
  if (m.status !== 0) return { ok: false, error: `git merge --ff-only refused, and nothing moved: ${why(m)}` };
  return { ok: true, commit, files: fin.files };
}

// ── verify: the target gone at HEAD, for a reason the engine states, with coverage complete ─────
export async function verifyApplied({ repoPath, job, bridge = defaultBridge, signal = null }) {
  const head = await revParse(repoPath, 'HEAD^{commit}');
  if (!head) return { ok: false, error: 'the repository has no commit at HEAD' };
  const g = await bridge.gate(repoPath, { base: job.baseSha, head, target: job.fingerprint, targetOnly: true }, { signal });
  if (!g.ok) return { ok: false, unavailable: !!g.unavailable, error: `the gate did not run: ${g.reason}` };
  const d = g.doc;
  // Only these two are outcomes; a gate that could not decide proves neither.
  const outcome = d.verdict === 'pass' ? 'verified-fixed' : d.outcome === 'still-reported' ? 'refuted-still-present' : null;
  return { ok: true, at: head, verdict: d.verdict, gateOutcome: d.outcome, outcome, reasons: d.reasons || [] };
}
