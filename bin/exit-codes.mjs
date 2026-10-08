#!/usr/bin/env node
// exit-codes — one exit-code table per command, read from each entry point's header comment.
//
// Population: tracked top-level bin/, monitor/ and cra/ .mjs files that carry a shebang, show their
// own invocation in the header, or declare exit codes there; plus the `commitwork` subcommands
// listed in bin/commitwork.mjs's usage(). A subcommand is declared only when its dispatch line sets
// `process.exitCode = fn(...)` and fn's module header declares codes.
//
// Header forms read (the header is the leading comment block, after any shebang):
//   labelled   `exit: 0 a · 1 b`, `Exit codes: 0 = a; 1 = b`, continuation lines included
//   block      a line ending `exit codes…:` followed by `  <code>  meaning` lines
//   leading    a comment line starting `exit <code>` (`Exit 0: …` / `Exit 1: …` lines merge)
//   sentence   `. Exit <code> …` or `; exit <code> …` mid-line, outside an invocation/option line
//   usage      `node <self> [args]   exit <code> …` — only when the invocation names no mode
//   always     `exit code is always <code>`
// A labelled or block declaration outranks the unlabelled forms in the same header. A header that
// states an exit code only on one mode's line, or in another shape, is `prose`; else `undeclared`.
// Nothing is inferred from process.exit calls: the table is what the header declares, unverified.
//
// usage: node bin/exit-codes.mjs [--check]
// exit: 0 written, or current under --check · 20 --check: docs/EXIT-CODES.md is stale or absent ·
//       21 a source could not be read (git ls-files failed, or a read other than ENOENT) · 22 usage
// env, read at call time: CW_EXIT_CODES_ROOT (source root, default this checkout)
// output: <root>/docs/EXIT-CODES.md, written tmp+rename; no timestamp, so re-runs are byte-identical

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_REL = 'docs/EXIT-CODES.md';
const DIRS = ['bin', 'monitor', 'cra'];

export const EXIT = { OK: 0, STALE: 20, UNREADABLE: 21, USAGE: 22 };

const rootDir = () => resolve(process.env.CW_EXIT_CODES_ROOT || join(HERE, '..'));

// Leading comment block as { raw, text, indent } per line; text is what follows the marker.
export function headerLines(src) {
  const lines = String(src).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = lines[0]?.startsWith('#!') ? 1 : 0;
  let inBlock = false;
  for (; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    let body;
    if (inBlock) {
      if (t.includes('*/')) inBlock = false;
      body = t.replace(/\*\/.*$/, '').replace(/^\*(?!\/)/, '');
    } else if (t === '') body = '';
    else if (t.startsWith('//')) body = t.slice(2);
    else if (t.startsWith('/*')) {
      inBlock = !t.includes('*/');
      body = t.replace(/^\/\*+/, '').replace(/\*\/.*$/, '');
    } else break;
    const indent = body.length - body.trimStart().length;
    out.push({ raw, text: body.trim(), indent });
  }
  return out;
}

const CODE = String.raw`(\d{1,3})(?!\d)`;
// A split point: separator, optional `exit`, then a code followed by a meaning.
const SPLIT = new RegExp(String.raw`(?:\s*[·;,]\s*|\s*\n\s*|\s{2,})(?:exit\s+)?(?=${CODE}(?:\s*[:=]\s*|\s+)\S)`, 'gi');
const LABEL_INLINE = /^exit(?:\s+codes?)?\s*:\s*(?=\d)/i;
const LABEL_BLOCK = /^exit(?:\s+codes?)?\b.*:\s*$/i;
const LEADING = /^exit\s+(?=\d{1,3}(?!\d))/i;
const ALWAYS = /(?:^|[.;]\s+)exit\s+code\s+is\s+always\s+(\d{1,3})\b/i;
const MID = /(?:[.;]\s+)(exit\s+)(?=\d{1,3}(?!\d)[\s:=])/i;
// A section label (`env:`, `usage:`, `output:`) ends a continuation.
export const SECTION = /^[A-Za-z][\w ,()/-]{0,30}:(\s|$)/;
export const OPTION_LINE = /^-{1,2}[A-Za-z]/;

export function invocation(text, file) {
  const name = basename(file).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = text.match(new RegExp(String.raw`^(?:usage:\s*(?:node\s+)?|node\s+)(?:\S*/)?${name}(?=\s|$)(.*)$`, 'i'));
  if (!m) return null;
  const rest = m[1];
  const gap = rest.search(/\S\s{2,}\S/);
  const args = gap < 0 ? rest.trim() : rest.slice(0, gap + 1).trim();
  const trailing = gap < 0 ? '' : rest.slice(gap + 1).trim();
  // A bare flag or subcommand word names a mode: whatever follows describes that mode, not the command.
  const mode = args.split(/\s+/).filter(Boolean).some((a) => /^-{1,2}[A-Za-z]/.test(a) || /^[a-z][\w-]*$/.test(a));
  return { args, trailing, mode };
}

const ends = (s) => /[.!?]\)?$/.test(s.trim()) && !/\b(?:e\.g|i\.e|vs)\.$/.test(s.trim());

// Collect a declaration's text: the start line from `from`, plus continuation lines.
function gather(lines, i, from, hanging, file) {
  const parts = [from];
  let prev = from;
  for (let j = i + 1; j < lines.length; j++) {
    const l = lines[j];
    if (!l.text) break;
    const isHanging = l.indent >= hanging + 2;
    if (!isHanging && SECTION.test(l.text) && !/^\d/.test(l.text)) break;
    if (startsDeclaration(l.text) || invocation(l.text, file) || OPTION_LINE.test(l.text)) break;
    if (!isHanging && ends(prev)) break;
    if (isHanging && ends(prev) && /^[A-Z]/.test(l.text) && !/^\d/.test(l.text)) break;
    parts.push(l.text);
    prev = l.text;
  }
  return parts.join('\n');
}

const startsDeclaration = (t) => LABEL_INLINE.test(t) || LEADING.test(t);

export function splitEntries(text) {
  const body = text.replace(/^\s*(?:exit(?:\s+codes?)?\s*:?\s*)/i, '');
  if (!new RegExp(`^${CODE}`).test(body)) return [];
  const spans = [];
  let start = 0;
  for (const m of body.matchAll(SPLIT)) { spans.push([start, m.index]); start = m.index + m[0].length; }
  spans.push([start, body.length]);
  const entries = [];
  for (const [a, b] of spans) {
    let seg = body.slice(a, b);
    const m = seg.match(new RegExp(String.raw`^${CODE}\s*[:=]?\s*`));
    if (!m) continue;
    seg = seg.slice(m[0].length);
    const meaning = seg.replace(/\s+/g, ' ').replace(/\s*[·;,]\s*$/, '').trim();
    entries.push({ code: Number(m[1]), meaning });
  }
  return entries.filter((e) => e.code <= 255);
}

// Parse one header. Returns { status, form, entries }.
export function parseHeader(src, file) {
  const lines = headerLines(src);
  const labelled = [];
  const plain = [];
  for (let i = 0; i < lines.length; i++) {
    const { text, indent } = lines[i];
    if (!text) continue;
    if (LABEL_INLINE.test(text)) {
      labelled.push({ form: 'labelled', entries: splitEntries(gather(lines, i, text, indent, file)) });
      continue;
    }
    if (LABEL_BLOCK.test(text) && !LABEL_INLINE.test(text)) {
      const block = [];
      for (let j = i + 1; j < lines.length && lines[j].text && lines[j].indent > indent; j++) block.push(lines[j].text);
      const entries = splitEntries(block.join('\n'));
      if (entries.length) { labelled.push({ form: 'block', entries }); continue; }
    }
    if (LEADING.test(text)) {
      plain.push({ form: 'leading', entries: splitEntries(gather(lines, i, text, indent, file)) });
      continue;
    }
    const inv = invocation(text, file);
    if (inv) {
      if (inv.mode) continue;
      const m = inv.trailing.match(/(?:^|;\s+|\s{2,})(\(?)(exit\s+\d{1,3}(?!\d).*)$/i);
      if (m) {
        const decl = gather(lines, i, m[2], indent, file);
        // `(exit 0 …, 1 …)` after an invocation: drop the closing paren the opening one implies.
        plain.push({ form: 'usage', entries: splitEntries(m[1] ? decl.replace(/\)\s*$/, '') : decl) });
      }
      continue;
    }
    if (OPTION_LINE.test(text)) continue;
    const a = text.match(ALWAYS);
    if (a) { plain.push({ form: 'always', entries: [{ code: Number(a[1]), meaning: 'always' }] }); continue; }
    const mid = text.match(MID);
    if (mid) {
      const from = text.slice(mid.index + mid[0].length - mid[1].length);
      plain.push({ form: 'sentence', entries: splitEntries(gather(lines, i, from, indent, file)) });
    }
  }
  const pool = labelled.length ? labelled : plain;
  const chosen = pool.filter((d) => d.entries.length);
  const unparsed = pool.length - chosen.length;
  if (chosen.length) {
    return {
      status: 'declared',
      form: [...new Set(chosen.map((d) => d.form))].join('+'),
      entries: chosen.flatMap((d) => d.entries),
      unparsed,
    };
  }
  // Said, but not tabulated: an exit clause on one mode's invocation or option line, or a sentence
  // that opens with `exit` in a shape none of the forms above reads.
  const prose = lines.some((l) => ((invocation(l.text, file) || OPTION_LINE.test(l.text)) && /\bexit\s+\d/i.test(l.text))
    || (!invocation(l.text, file) && !OPTION_LINE.test(l.text) && /(?:^|[.;]\s+)exit\b/i.test(l.text)));
  return { status: prose ? 'prose' : 'undeclared', form: null, entries: [], unparsed };
}

export function read(root, rel) {
  try {
    return readFileSync(join(root, rel), 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw Object.assign(new Error(`cannot read ${rel}: ${e.message}`), { exitCode: EXIT.UNREADABLE });
  }
}

function tracked(root) {
  let out;
  try {
    out = execFileSync('git', ['-C', root, 'ls-files', '-z', '--', ...DIRS], { encoding: 'utf8', maxBuffer: 64 << 20 });
  } catch (e) {
    throw Object.assign(new Error(`git ls-files failed: ${e.message}`), { exitCode: EXIT.UNREADABLE });
  }
  return out.split('\0').filter((p) => /^[^/]+\/[^/]+\.mjs$/.test(p)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function isEntryPoint(src, file, parsed) {
  if (src.startsWith('#!')) return true;
  if (parsed.status === 'declared') return true;
  return headerLines(src).some((l) => invocation(l.text, file));
}

// `commitwork <sub>` lines from usage(), and the module each dispatch delegates its exit code to.
function cliCommands(root, src, headers) {
  const start = src.indexOf('function usage()');
  if (start < 0) return [];
  const body = src.slice(start, src.indexOf('\n}', start));
  const subs = [];
  for (const m of body.matchAll(/^ {2}commitwork ([a-z][\w-]*)/gm)) if (!subs.includes(m[1])) subs.push(m[1]);
  const imports = new Map();
  for (const m of src.matchAll(/^import \{([^}]+)\} from '(\.\/[^']+)';/gm)) {
    for (const name of m[1].split(',').map((s) => s.trim().split(/\s+as\s+/).pop())) imports.set(name, join('bin', m[2]));
  }
  return subs.map((sub) => {
    const line = src.split('\n').find((l) => l.includes(`cmd === '${sub}'`) && /process\.exitCode\s*=\s*\w+\(/.test(l));
    const fn = line?.match(/process\.exitCode\s*=\s*(\w+)\(/)?.[1];
    const mod = fn && imports.get(fn);
    const h = mod && headers.get(mod.replace(/\\/g, '/'));
    if (h && h.status === 'declared') return { name: `commitwork ${sub}`, source: mod, via: fn, ...h };
    return { name: `commitwork ${sub}`, source: 'bin/commitwork.mjs', status: 'undeclared', entries: [] };
  });
}

export function collect(root = rootDir()) {
  const files = tracked(root);
  const headers = new Map();
  const commands = [];
  let cliSrc = null;
  for (const f of files) {
    const src = read(root, f);
    if (src === null) continue;
    const parsed = parseHeader(src, f);
    headers.set(f, parsed);
    if (f === 'bin/commitwork.mjs') { cliSrc = src; continue; }
    if (isEntryPoint(src, f, parsed)) commands.push({ name: f, source: f, ...parsed });
  }
  const cli = cliSrc ? cliCommands(root, cliSrc, headers) : [];
  return { cli, commands };
}

const cell = (s) => String(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

export function render({ cli, commands }) {
  const all = [...cli, ...commands];
  const by = (s) => all.filter((c) => c.status === s);
  const declared = by('declared');
  const high = declared.filter((c) => c.entries.some((e) => e.code >= 20)).length;
  const lowOnly = declared.filter((c) => c.entries.every((e) => e.code <= 13)).length;
  const L = [];
  L.push('# Exit codes');
  L.push('');
  L.push('<!-- Generated by bin/exit-codes.mjs — do not hand-edit; run `node bin/exit-codes.mjs` to refresh. -->');
  L.push('');
  L.push('Each table is what the command\'s header comment declares, read by `bin/exit-codes.mjs`. It is not');
  L.push('verified against the code paths that set the exit status. `undeclared` means the header says');
  L.push('nothing about exit status; `prose` means it does, in a shape the extractor does not tabulate.');
  L.push('Neither is a claim about what the command returns. What may change between releases is in');
  L.push('[STABILITY.md](STABILITY.md).');
  L.push('');
  L.push(`${all.length} commands: ${declared.length} declared, ${by('prose').length} prose, ${by('undeclared').length} undeclared. `
    + `Of the declared, ${lowOnly} use only codes 0–13, the range Node itself exits with (1 on an uncaught `
    + `exception), and ${high} declare a code of 20 or above.`);
  L.push('');
  const table = (c) => {
    L.push(`### \`${c.name}\``);
    L.push('');
    if (c.via) L.push(`Declared in \`${c.source}\` (\`${c.via}\`).`, '');
    L.push('| Exit | Meaning |');
    L.push('|---:|---|');
    for (const e of c.entries) L.push(`| ${e.code} | ${cell(e.meaning) || '—'} |`);
    L.push('');
  };
  L.push('## `commitwork` subcommands');
  L.push('');
  for (const c of cli.filter((x) => x.status === 'declared')) table(c);
  const cliUndeclared = cli.filter((x) => x.status !== 'declared').map((x) => `\`${x.name.split(' ')[1]}\``);
  if (cliUndeclared.length) L.push(`Undeclared: ${cliUndeclared.join(', ')}.`, '');
  for (const dir of DIRS) {
    const group = commands.filter((c) => c.name.startsWith(`${dir}/`));
    if (!group.length) continue;
    L.push(`## ${dir}/`);
    L.push('');
    for (const c of group.filter((x) => x.status === 'declared')) table(c);
    for (const s of ['prose', 'undeclared']) {
      const names = group.filter((x) => x.status === s).map((x) => `\`${basename(x.name)}\``);
      if (names.length) L.push(`${s === 'prose' ? 'Prose only' : 'Undeclared'}: ${names.join(', ')}.`, '');
    }
  }
  return L.join('\n').replace(/\n+$/, '\n');
}

export function main(argv = process.argv.slice(2)) {
  const bad = argv.filter((a) => a !== '--check');
  if (bad.length) {
    console.error(`exit-codes: unknown argument ${bad[0]}\nusage: node bin/exit-codes.mjs [--check]`);
    return EXIT.USAGE;
  }
  const root = rootDir();
  const out = join(root, OUT_REL);
  let text;
  try {
    text = render(collect(root));
  } catch (e) {
    console.error(`exit-codes: ${e.message}`);
    return e.exitCode ?? EXIT.UNREADABLE;
  }
  if (argv.includes('--check')) {
    let cur;
    try { cur = read(root, OUT_REL); } catch (e) { console.error(`exit-codes: ${e.message}`); return EXIT.UNREADABLE; }
    if (cur !== text) {
      console.error(`exit-codes: ${OUT_REL} is ${cur === null ? 'absent' : 'stale'} — run node bin/exit-codes.mjs`);
      return EXIT.STALE;
    }
    console.log(`exit-codes: ${OUT_REL} is current`);
    return EXIT.OK;
  }
  writeAtomic(out, text, { mkdir: true });
  console.log(`exit-codes: wrote ${OUT_REL}`);
  return EXIT.OK;
}

if (isMainModule(import.meta.url)) process.exitCode = main();
