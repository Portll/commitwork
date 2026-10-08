#!/usr/bin/env node
// reference — docs/REFERENCE.md: every command, CW_* environment variable and lane manifest key,
// read from the tree rather than written by hand.
//
// Commands are bin/exit-codes.mjs's population and exit tables; usage and option lines come from
// each header, and the `commitwork` subcommands and options from usage() in bin/commitwork.mjs.
// Environment variables are the CW_* names a tracked non-test source reads by name (a property
// access or a quoted key on an env object, or `$CW_<NAME>` in a shell script), plus names quoted in a
// file that reads env by a computed key, marked indirect. A description is what a header's `env`
// section says beside the name. Manifest keys are the keys of each check in a manifests/*.json whose
// $schema is manifest.schema.json, counted per check and described from that schema.
// Nothing is given a description it does not carry: it is counted and listed as undocumented.
//
// usage: node bin/reference.mjs [--check]
// exit: 0 written, or current under --check · 20 --check: docs/REFERENCE.md is stale or absent ·
//       21 a source could not be read (git ls-files failed, a read other than ENOENT, or a
//       manifest or schema that does not parse) · 22 usage
// env, read at call time: CW_REFERENCE_ROOT (source root, default this checkout)
// output: <root>/docs/REFERENCE.md via writeAtomic; no timestamp, so re-runs are byte-identical

import { execFileSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { escText } from '../lib/html-escape.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { EXIT, OPTION_LINE, SECTION, collect, headerLines, invocation, read } from './exit-codes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_REL = 'docs/REFERENCE.md';
const SCHEMA_REL = 'schema/manifest.schema.json';
const MAX_READERS = 6;

export { EXIT };

const rootDir = () => resolve(process.env.CW_REFERENCE_ROOT || join(HERE, '..'));
const byStr = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
const unreadable = (msg) => Object.assign(new Error(msg), { exitCode: EXIT.UNREADABLE });

// The reference describes what ships, and `git archive` drops export-ignore paths from the published
// snapshot, so a name read only there would be a row the public repository cannot regenerate.
function trackedAll(root) {
  try {
    const opts = { encoding: 'utf8', maxBuffer: 64 << 20 };
    const files = execFileSync('git', ['-C', root, 'ls-files', '-z'], opts).split('\0').filter(Boolean);
    const attrs = execFileSync('git', ['-C', root, 'check-attr', '-z', '--stdin', 'export-ignore'], { ...opts, input: files.join('\0') }).split('\0');
    const ignored = new Set();
    for (let i = 0; i + 2 < attrs.length; i += 3) if (attrs[i + 2] === 'set') ignored.add(attrs[i]);
    return files.filter((p) => !ignored.has(p)).sort(byStr);
  } catch (e) {
    throw unreadable(`git ls-files failed: ${e.message}`);
  }
}

const isTest = (p) => /(^|\/)(test|tests|__tests__|fixtures?)\//.test(p) || /\.test\.[cm]?js$/.test(p);
const isJs = (p) => /\.[cm]?js$/.test(p);
const isShell = (p) => /\.(sh|bash)$/.test(p);

function firstSentence(s, max = 220) {
  const t = s.replace(/\s+/g, ' ').trim();
  const m = t.match(/^.*?[^.](?:\.|!|\?)(?=\s|$)/);
  let out = m && !/\b(?:e\.g|i\.e|vs)\.$/.test(m[0]) ? m[0] : t;
  if (out.length > max) out = `${out.slice(0, max - 1).trimEnd()}…`;
  return out;
}

// ── env ─────────────────────────────────────────────────────────────────────────────────────────

const ENV_LABEL = /^env\b[^:]{0,40}:\s*/i;
const CALL_TIME = /^read (?:at|per) call(?: time)?$/i;

function describeAfter(seg) {
  let s = seg.replace(/^=\S*/, '');
  const gap = /^\s{2,}\S/.test(s);
  s = s.trimStart();
  for (;;) {
    if (s.startsWith('(')) {
      let depth = 0;
      let end = -1;
      for (let k = 0; k < s.length; k++) {
        if (s[k] === '(') depth++;
        else if (s[k] === ')' && --depth === 0) { end = k; break; }
      }
      if (end < 0) return '';
      const inner = s.slice(1, end).trim();
      // `(read at call time)` restates the house rule, not what the variable is.
      if (CALL_TIME.test(inner)) { s = s.slice(end + 1).trimStart(); continue; }
      return inner;
    }
    if (/^[—–:-]\s/.test(s)) return s.replace(/^[—–:-]\s*/, '');
    return gap ? s : '';
  }
}

/** Descriptions an `env` header section gives, as Map<name, text>. */
export function envDescriptions(src) {
  const lines = headerLines(src);
  const out = new Map();
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].text.match(ENV_LABEL);
    if (!m) continue;
    const parts = [lines[i].text.slice(m[0].length)];
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j];
      if (!l.text) break;
      if (!/^CW_/.test(l.text) && l.indent <= lines[i].indent && SECTION.test(l.text)) break;
      parts.push(l.text);
    }
    const text = parts.join('  ');
    const hits = [];
    let depth = 0;
    for (let k = 0; k < text.length; k++) {
      const c = text[k];
      if (c === '(') depth++;
      else if (c === ')') depth = Math.max(0, depth - 1);
      else if (depth === 0 && text.startsWith('CW_', k) && !/[\w$.]/.test(text[k - 1] || '')) {
        const n = text.slice(k).match(/^CW_[A-Z0-9_]*[A-Z0-9]/);
        if (n) { hits.push([k, n[0]]); k += n[0].length - 1; }
      }
    }
    hits.forEach(([k, name], idx) => {
      const seg = text.slice(k + name.length, idx + 1 < hits.length ? hits[idx + 1][0] : text.length);
      const d = firstSentence(describeAfter(seg).replace(/[\s,;·]+$/, ''));
      if (d && !out.has(name)) out.set(name, d);
    });
  }
  return out;
}

const DIRECT_JS = /\benv(?:\.|\[\s*['"`])(CW_[A-Z0-9_]*[A-Z0-9])\b/g;
const DIRECT_SH = /\$\{?(CW_[A-Z0-9_]*[A-Z0-9])\b/g;
const COMPUTED = /\benv\[\s*[A-Za-z_$][\w$.]*\s*\]/;
const QUOTED = /['"`](CW_[A-Z0-9_]*[A-Z0-9])['"`]/g;

export function collectEnv(root, files) {
  const direct = new Map();
  const indirect = new Map();
  const described = new Map();
  const add = (m, name, f) => { if (!m.has(name)) m.set(name, new Set()); m.get(name).add(f); };
  for (const f of files) {
    if (isTest(f) || !(isJs(f) || isShell(f))) continue;
    const src = read(root, f);
    if (src === null) continue;
    if (isShell(f)) {
      for (const m of src.matchAll(DIRECT_SH)) add(direct, m[1], f);
      continue;
    }
    for (const m of src.matchAll(DIRECT_JS)) add(direct, m[1], f);
    if (COMPUTED.test(src)) for (const m of src.matchAll(QUOTED)) add(indirect, m[1], f);
    for (const [name, d] of envDescriptions(src)) {
      if (!described.has(name)) described.set(name, new Map());
      described.get(name).set(f, d);
    }
  }
  const names = [...new Set([...direct.keys(), ...indirect.keys()])].sort(byStr);
  return names.map((name) => {
    const how = direct.has(name) ? 'direct' : 'indirect';
    const readers = [...(direct.get(name) || indirect.get(name))].sort(byStr);
    const ds = described.get(name);
    let description = null;
    if (ds) {
      const own = readers.find((r) => ds.has(r));
      const from = own || [...ds.keys()].sort(byStr)[0];
      description = { text: ds.get(from), from };
    }
    return { name, how, readers, description };
  });
}

// ── commands ────────────────────────────────────────────────────────────────────────────────────

function summary(lines, file) {
  const parts = [];
  for (const l of lines) {
    if (!l.text) { if (parts.length) break; continue; }
    if (invocation(l.text, file) || OPTION_LINE.test(l.text) || (SECTION.test(l.text) && !parts.length)) {
      if (parts.length) break;
      continue;
    }
    parts.push(l.text);
  }
  return parts.length ? firstSentence(parts.join(' ')) : null;
}

export function commandDoc(src, file) {
  const lines = headerLines(src);
  const usage = [];
  const options = [];
  for (const l of lines) {
    if (!l.text) continue;
    if (invocation(l.text, file)) usage.push(l.text.replace(/^usage:\s*/i, ''));
    else if (/^usage:\s*\S/i.test(l.text)) usage.push(l.text.replace(/^usage:\s*/i, ''));
    else if (OPTION_LINE.test(l.text)) options.push(l.text);
  }
  return { summary: summary(lines, file), usage, options };
}

// usage() in bin/commitwork.mjs is a template literal; interpolations are resolved from source.
export function cliDoc(src) {
  const start = src.indexOf('function usage()');
  if (start < 0) return null;
  const body = src.slice(start, src.indexOf('\n}', start));
  const tick = body.indexOf('`');
  let text = body.slice(tick + 1, body.lastIndexOf('`'));
  text = text.replace(/\$\{helpInPlace\('([\w-]+)'\)\}/g, (_, cmd) => {
    const m = src.match(new RegExp(String.raw`'${cmd}':\s*\[((?:\s*'(?:[^'\\]|\\.)*'\s*,?)*)\s*\]`));
    return m ? [...m[1].matchAll(/'((?:[^'\\]|\\.)*)'/g)].map((x) => x[1]).join('\n') + '\n' : '';
  });
  text = text.replace(/\$\{(?:bold|dim)\('([^']*)'\)\}/g, '$1').replace(/\$\{[^}]*\}/g, '');
  const sections = new Map();
  let cur = null;
  for (const line of text.split('\n')) {
    if (/^[a-z][\w ()-]*$/.test(line)) { cur = line.trim(); sections.set(cur, []); continue; }
    if (cur && line.trim()) sections.get(cur).push(line);
    else if (cur && !line.trim()) cur = null;
  }
  const entries = (lines, startRe) => {
    const out = [];
    const indentOf = (l) => l.length - l.trimStart().length;
    // The description column is where continuation lines start; a start line can run into it with
    // one space, so split there before falling back to the first wide gap.
    const col = Math.min(...lines.filter((l) => !startRe.test(l)).map(indentOf).filter((n) => n > 2), Infinity);
    for (const line of lines) {
      if (startRe.test(line) && indentOf(line) <= 2) {
        const atCol = col < line.length && line[col - 1] === ' ' && /[^\s[<.-]/.test(line[col]);
        const split = atCol ? col : line.search(/\S\s{2,}\S/) + 1;
        out.push(split > 0
          ? { usage: line.slice(0, split).trim(), desc: line.slice(split).trim() }
          : { usage: line.trim(), desc: '' });
      } else if (out.length) {
        const last = out[out.length - 1];
        last.desc = `${last.desc} ${line.trim()}`.trim();
      }
    }
    return out;
  };
  return {
    commands: entries(sections.get('usage') || [], /^ {2}commitwork /),
    options: entries(sections.get('options') || [], /^ {2}-/),
    env: (sections.get('env') || []).map((l) => l.trim()),
  };
}

// ── manifest keys ───────────────────────────────────────────────────────────────────────────────

function parseJson(root, rel) {
  const src = read(root, rel);
  if (src === null) return null;
  try { return JSON.parse(src); } catch (e) { throw unreadable(`${rel} does not parse: ${e.message}`); }
}

function deref(schema, node) {
  const ref = node?.$ref;
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return node;
  return ref.slice(2).split('/').reduce((n, k) => n?.[k], schema) || node;
}

export function collectManifestKeys(root, files) {
  const schema = parseJson(root, SCHEMA_REL);
  const lanes = [];
  for (const f of files.filter((p) => /^manifests\/[^/]+\.json$/.test(p))) {
    const j = parseJson(root, f);
    if (j && typeof j.$schema === 'string' && basename(j.$schema) === basename(SCHEMA_REL) && Array.isArray(j.checks)) lanes.push({ file: f, json: j });
  }
  const topProps = schema?.properties || {};
  const checkProps = deref(schema, deref(schema, topProps.checks)?.items)?.properties || {};
  const describe = (props, path) => {
    const [k, k2] = path.split('.');
    const node = deref(schema, props[k]);
    const leaf = k2 === undefined ? node : deref(schema, node?.properties?.[k2]);
    return typeof leaf?.description === 'string' ? firstSentence(leaf.description) : null;
  };
  const count = (rows, props) => {
    const n = new Map();
    for (const row of rows) {
      const seen = new Set();
      for (const [k, v] of Object.entries(row)) {
        seen.add(k);
        if (v && typeof v === 'object' && !Array.isArray(v)) for (const k2 of Object.keys(v)) seen.add(`${k}.${k2}`);
      }
      for (const k of seen) n.set(k, (n.get(k) || 0) + 1);
    }
    for (const [k, node] of Object.entries(props)) {
      if (!n.has(k)) n.set(k, 0);
      for (const k2 of Object.keys(deref(schema, node)?.properties || {})) if (!n.has(`${k}.${k2}`)) n.set(`${k}.${k2}`, 0);
    }
    return [...n].sort(([a], [b]) => byStr(a, b)).map(([key, uses]) => ({ key, uses, description: describe(props, key) }));
  };
  const checks = lanes.flatMap((l) => l.json.checks);
  return {
    schemaFound: schema !== null,
    lanes: lanes.map((l) => ({ file: l.file, checks: l.json.checks.length })),
    checkCount: checks.length,
    checkKeys: count(checks, checkProps),
    topKeys: count(lanes.map((l) => l.json), topProps),
  };
}

// ── render ──────────────────────────────────────────────────────────────────────────────────────

export function collectAll(root = rootDir()) {
  const files = trackedAll(root);
  const { cli, commands } = collect(root);
  const docs = commands.map((c) => {
    const src = read(root, c.source);
    return { ...c, ...(src === null ? { summary: null, usage: [], options: [] } : commandDoc(src, c.source)) };
  });
  const cliSrc = read(root, 'bin/commitwork.mjs');
  return {
    cli: { exits: cli, doc: cliSrc === null ? null : cliDoc(cliSrc) },
    commands: docs,
    env: collectEnv(root, files),
    manifest: collectManifestKeys(root, files),
  };
}

const prose = (s) => escText(String(s).replace(/\s+/g, ' ').trim());
const cell = (s) => prose(s).replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
const code = (s) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.includes('`') ? `\`\` ${t} \`\`` : `\`${t}\``;
};
// Backslash escapes are not processed inside a code span, so only the table's pipe is escaped here.
const codeCell = (s) => code(s).replace(/\|/g, '\\|');
const exitLine = (c) => {
  if (c.status === 'declared') return c.entries.map((e) => `${e.code} ${e.meaning}`).join(' · ');
  return c.status === 'prose' ? 'stated in the header in a form not tabulated (prose)' : 'undeclared';
};

export function render({ cli, commands, env, manifest }) {
  const withUsage = commands.filter((c) => c.usage.length);
  const exitDeclared = [...cli.exits, ...commands].filter((c) => c.status === 'declared').length;
  const exitAll = cli.exits.length + commands.length;
  const envDesc = env.filter((e) => e.description).length;
  const envIndirect = env.filter((e) => e.how === 'indirect').length;
  const used = manifest.checkKeys.filter((k) => k.uses > 0);
  const keyDesc = used.filter((k) => k.description).length;
  const L = [];
  L.push('# Reference');
  L.push('');
  L.push('<!-- Generated by bin/reference.mjs — do not hand-edit; run `node bin/reference.mjs` to refresh. -->');
  L.push('');
  L.push('Every command, `CW_*` environment variable and lane manifest key, read from the source tree by');
  L.push('`bin/reference.mjs`. Descriptions are copied from header comments and the manifest schema; where');
  L.push('none exists the entry says `undocumented` and is counted below, rather than being described here.');
  L.push('Exit codes are what each header declares (full tables in [EXIT-CODES.md](EXIT-CODES.md)), not');
  L.push('verified against the code. Check definitions are indexed in [MANIFEST-MAP.md](MANIFEST-MAP.md).');
  L.push('');
  L.push('| Surface | Total | Documented | Undocumented |');
  L.push('|---|---:|---:|---:|');
  L.push(`| Commands (a usage line in the header) | ${commands.length} | ${withUsage.length} | ${commands.length - withUsage.length} |`);
  L.push(`| Exit codes (declared in the header) | ${exitAll} | ${exitDeclared} | ${exitAll - exitDeclared} |`);
  L.push(`| \`CW_*\` environment variables (described in an \`env\` header) | ${env.length} | ${envDesc} | ${env.length - envDesc} |`);
  L.push(`| Lane manifest check keys in use (described in the schema) | ${used.length} | ${keyDesc} | ${used.length - keyDesc} |`);
  L.push('');
  L.push(`Commands are the population of \`bin/exit-codes.mjs\`: top-level \`bin/\`, \`monitor/\` and \`cra/\``);
  L.push('entry points, plus the `commitwork` subcommands.');
  L.push('');

  L.push('## `commitwork`');
  L.push('');
  if (!cli.doc) L.push('`bin/commitwork.mjs` has no `usage()`; its subcommands are undocumented.', '');
  else {
    L.push('From `usage()` in `bin/commitwork.mjs`.');
    L.push('');
    L.push('| Usage | Description |');
    L.push('|---|---|');
    for (const c of cli.doc.commands) L.push(`| ${codeCell(c.usage)} | ${c.desc ? cell(c.desc) : 'undocumented'} |`);
    L.push('');
    L.push('| Option | Description |');
    L.push('|---|---|');
    for (const o of cli.doc.options) L.push(`| ${codeCell(o.usage)} | ${o.desc ? cell(o.desc) : 'undocumented'} |`);
    L.push('');
    if (cli.doc.env.length) {
      L.push(`Environment: ${cli.doc.env.map(prose).join(' · ')}`);
      L.push('');
    }
  }
  L.push('Exit codes:');
  L.push('');
  for (const c of cli.exits) L.push(`- ${code(c.name)}: ${prose(exitLine(c))}${c.via ? ` (declared in ${code(c.source)})` : ''}`);
  L.push('');

  for (const dir of ['bin', 'monitor', 'cra']) {
    const group = commands.filter((c) => c.name.startsWith(`${dir}/`));
    if (!group.length) continue;
    L.push(`## ${dir}/`);
    L.push('');
    for (const c of group) {
      L.push(`### ${code(c.name)}`);
      L.push('');
      if (c.summary) L.push(prose(c.summary), '');
      if (c.usage.length) for (const u of c.usage) L.push(`- Usage: ${code(u)}`);
      else L.push('- Usage: undocumented');
      for (const o of c.options) L.push(`- Option: ${code(o)}`);
      L.push(`- Exit: ${prose(exitLine(c))}`);
      L.push('');
    }
  }

  L.push('## Environment variables');
  L.push('');
  L.push(`${env.length} \`CW_*\` names read by tracked non-test sources: ${env.length - envIndirect} by name, and`);
  L.push(`${envIndirect} indirect (quoted in a file that reads the environment by a computed key, so the read`);
  L.push(`is likely but not shown). At most ${MAX_READERS} readers are listed per name. A description is taken from`);
  L.push('a reader\'s `env` header section when one has it, otherwise from another file\'s, which is named.');
  L.push('');
  L.push('| Variable | Read | Read by | Description |');
  L.push('|---|---|---|---|');
  for (const e of env) {
    const shown = e.readers.slice(0, MAX_READERS).map(codeCell).join(', ');
    const more = e.readers.length > MAX_READERS ? ` and ${e.readers.length - MAX_READERS} more` : '';
    let d = 'undocumented';
    if (e.description) d = cell(e.description.text) + (e.readers.includes(e.description.from) ? '' : ` (${codeCell(e.description.from)})`);
    L.push(`| ${code(e.name)} | ${e.how} | ${shown}${more} | ${d} |`);
  }
  L.push('');

  L.push('## Manifest keys');
  L.push('');
  if (!manifest.schemaFound) L.push(`\`${SCHEMA_REL}\` is absent, so no key has a description.`, '');
  L.push(`Lane manifests (\`$schema\` is \`${basename(SCHEMA_REL)}\`): `
    + `${manifest.lanes.map((l) => `${code(l.file)} (${l.checks})`).join(', ') || 'none'}; ${manifest.checkCount} checks in all.`);
  L.push('A nested key is written `parent.child`. A key the schema declares and no check uses is listed with 0.');
  L.push('');
  L.push('### Check keys');
  L.push('');
  L.push('| Key | Checks | Description |');
  L.push('|---|---:|---|');
  for (const k of manifest.checkKeys) L.push(`| ${code(k.key)} | ${k.uses} | ${k.description ? cell(k.description) : 'undocumented'} |`);
  L.push('');
  L.push('### Manifest-level keys');
  L.push('');
  L.push('| Key | Manifests | Description |');
  L.push('|---|---:|---|');
  for (const k of manifest.topKeys) L.push(`| ${code(k.key)} | ${k.uses} | ${k.description ? cell(k.description) : 'undocumented'} |`);
  return L.join('\n').replace(/\n+$/, '\n');
}

export function main(argv = process.argv.slice(2)) {
  const bad = argv.filter((a) => a !== '--check');
  if (bad.length) {
    console.error(`reference: unknown argument ${bad[0]}\nusage: node bin/reference.mjs [--check]`);
    return EXIT.USAGE;
  }
  const root = rootDir();
  let text;
  try {
    text = render(collectAll(root));
  } catch (e) {
    console.error(`reference: ${e.message}`);
    return e.exitCode ?? EXIT.UNREADABLE;
  }
  if (argv.includes('--check')) {
    let cur;
    try { cur = read(root, OUT_REL); } catch (e) { console.error(`reference: ${e.message}`); return EXIT.UNREADABLE; }
    if (cur !== text) {
      console.error(`reference: ${OUT_REL} is ${cur === null ? 'absent' : 'stale'} — run node bin/reference.mjs`);
      return EXIT.STALE;
    }
    console.log(`reference: ${OUT_REL} is current`);
    return EXIT.OK;
  }
  writeAtomic(join(root, OUT_REL), text, { mkdir: true });
  console.log(`reference: wrote ${OUT_REL}`);
  return EXIT.OK;
}

if (isMainModule(import.meta.url)) process.exitCode = main();
