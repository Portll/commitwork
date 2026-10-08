#!/usr/bin/env node
// usage: minify-detect.mjs [rootDir]
// env: CW_MINIFY_MAX_BYTES, CW_MINIFY_SEMGREP_CEILING, CW_MINIFY_ENTROPY_RULE, CW_MINIFY_XFILE, CW_MINIFY_DEPS, CW_MINIFY_ALLOWLIST, CW_MINIFY_ALLOWLIST_SCHEMA, CW_NOW
// writes: JSON to stdout {tool, summary:{findings, byRule, filesScanned, filesSkipped, config}, findings[]}
//
// unreadability is the signal, never a skip
// vendor-scan names the library, this lane never does
// writes: counts and metrics only, never scanned bytes
import { readFileSync, readdirSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { join, relative, dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

import { validateAgainstSchema } from '../monitor/registry.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { excludeDirs, dirExcluder } from './scan-exclusions.mjs';

const ROOT = resolve(process.argv[2] || '.');
const __dirname = dirname(fileURLToPath(import.meta.url));

// guard: a NaN cap compares false, disabling the cap
// pins: baselines compare findings within one ruleset version
export const RULESET_VERSION = 4;

const invalidEnv = [];
function numEnv(name, def) {
  const raw = process.env[name];
  if (raw === undefined) return def;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) { if (!invalidEnv.includes(name)) invalidEnv.push(name); return def; }
  return n;
}
// env: read once per process, one scan each
const CFG = {
  allowlistPath: process.env.CW_MINIFY_ALLOWLIST || join(__dirname, '..', 'monitor', 'minify-allowlist.json'),
  maxBytes: numEnv('CW_MINIFY_MAX_BYTES', 5_000_000),          // head-read cap (Overloop I1)
  semgrepCeiling: numEnv('CW_MINIFY_SEMGREP_CEILING', 1_000_000), // semgrep's own default (Bifocal F5)
  entropyRule: process.env.CW_MINIFY_ENTROPY_RULE === '1',      // default-off (Overloop I3)
  xfileRule: process.env.CW_MINIFY_XFILE === '1',               // default-off cross-file assembler (M1)
  depsRule: process.env.CW_MINIFY_DEPS === '1',                 // default-off: scan node_modules (M5c)
  now: process.env.CW_NOW && Number.isFinite(Date.parse(process.env.CW_NOW)) ? Date.parse(process.env.CW_NOW) : null,
};
const HEAD_BYTES = 262_144; // 256 KB bounded read for capped files

// dist and vendor stay scanned, unlike sibling walkers
// guard: the selftest canary never reaches a live rollup
// env: CW_MINIFY_DEPS=1 scans installed package bytes
// pins: dependency findings are path-keyed, never version-keyed
const SKIP_DIRS = new Set([...(CFG.depsRule ? [] : ['node_modules']), '.git', 'reports', 'reference', 'coverage', '__minify_selftest__']);
// only the shared list's PATH entries (a nested worktree): its name entries are the ones this lane keeps scanning
let skipPath = () => false;
const SCAN_EXT = /\.(mjs|cjs|js|jsx|ts|tsx|mts|cts)$/i;
// markup false-positives low-alphabet and bidi
const HTML_EXT = /\.html?$/i;
// the import section is the capability manifest
const WASM_EXT = /\.wasm$/i;
// proc_exit and fd_write are ordinary, excluded
const WASM_DANGEROUS = /eval|Function|sock_|proc_exec|path_open|child_process|\bexec\b|\bspawn\b|fetch|XMLHttpRequest/i;
const VENDOR_HINT = /(^|\/)(vendors?|third[-_]?party|externals?|assets\/lib)(\/|$)/i;
const MINIFIED_NAME = /\.min\.(js|css)$|-min\.js$/i;         // CodeQL extractor-baseline drop set
// guard: prose files get the hidden-character rule only
export const TEXT_FILE = /\.(md|mdx|markdown|mdc|txt)$|^\.(cursorrules|windsurfrules|aider[\w.-]*)$/i;
// fact: ZWNJ, ZWJ and BOM are legitimate in prose (expiry: never, prev: unknown)
// exported: bin/agent-instructions.mjs shares this one definition of a hidden character
export const HIDDEN_TEXT = /[\u202A-\u202E\u2066-\u2069\u200B]|[\u{e0000}-\u{e007f}]/u;

// ---- metrics ----
// guard: byte metrics survive a cap splitting a codepoint
function shannon(buf) {
  if (!buf.length) return 0;
  const h = new Array(256).fill(0);
  for (const b of buf) h[b]++;
  let e = 0;
  for (const c of h) { if (!c) continue; const p = c / buf.length; e -= p * Math.log2(p); }
  return e; // 0..8 bits/byte
}
function metricsFor(buf) {
  let lines = 1, cur = 0, maxLine = 0, ws = 0;
  const alphabet = new Set();
  for (const b of buf) {
    if (b === 0x0a) { if (cur > maxLine) maxLine = cur; lines++; cur = 0; continue; }
    cur++;
    if (b === 0x20 || b === 0x09 || b === 0x0d || b === 0x0c) ws++;
    else if (b > 0x20 && b < 0x7f) alphabet.add(b);
  }
  if (cur > maxLine) maxLine = cur;
  const nonNl = buf.length - (lines - 1);
  return {
    bytes: buf.length,
    lines,
    bytesPerLineMax: maxLine,
    wsRatio: round3(nonNl ? ws / nonNl : 0),
    entropy: round3(shannon(buf)),
    alphabet: alphabet.size,
  };
}
const round3 = (n) => Math.round(n * 1000) / 1000; // fixed precision → deterministic sort (Sauron S3)

// ---- construct scan ----
// guard: per-line literal scans, no multiline regex
const BIDI = /[\u202a-\u202e\u2066-\u2069\u200b-\u200d\ufeff]/;
// one identifier mixing scripts is the homoglyph attack
const IDENT = /[A-Za-z\u0370-\u03ff\u0400-\u04ff_$][A-Za-z0-9\u0370-\u03ff\u0400-\u04ff_$]*/g;
function mixedScriptCount(line) {
  const ids = line.match(IDENT);
  if (!ids) return 0;
  let n = 0;
  for (const id of ids) {
    let latin = false, greek = false, cyr = false;
    for (const ch of id) {
      const cp = ch.codePointAt(0);
      if ((cp >= 0x41 && cp <= 0x5a) || (cp >= 0x61 && cp <= 0x7a)) latin = true;
      else if (cp >= 0x370 && cp <= 0x3ff) greek = true;
      else if (cp >= 0x400 && cp <= 0x4ff) cyr = true;
    }
    if ((latin ? 1 : 0) + (greek ? 1 : 0) + (cyr ? 1 : 0) >= 2) n++;
  }
  return n;
}
const DEAN_EDWARDS = /eval\(function\(p,a,c,k,e,[dr]\)/;
const DANGEROUS = '(?:eval|Function|require|import)';
const EXEC_OPEN = /\b(?:eval|Function)\s*\(/;
const DECODE = /\b(?:atob|decodeURIComponent|fromCharCode)\s*\(|Buffer\.from\s*\([^)]*base64/;
// eval(/Function( / new Function( whose first non-space arg is NOT a string quote → non-literal.
const DYN_EXEC_NONLIT = /\b(?:eval|new\s+Function|Function)\s*\(\s*(?!['"`\s])/;
// computed member assembled from concatenated string literals: x['ev'+'al']
const COMPUTED_CONCAT = /\[\s*['"][^'"]{0,8}['"]\s*\+\s*['"][^'"]{0,8}['"]/;
function scanConstructs(text) {
  const c = {
    execOpen: 0, decode: 0, execDecodePair: 0, dynExecNonlit: 0,
    computedDanger: 0, bidi: 0, mixedScript: 0, escapes: 0, deanEdwards: 0, joiner: 0,
  };
  if (DEAN_EDWARDS.test(text)) c.deanEdwards = 1;
  const lines = text.split('\n');
  for (const line of lines) {
    // A whole-line `//` comment executes nothing; only `//` is trusted, since a leading `*` or `/*`
    // can still precede code on the same line.
    const code = !/^\s*\/\//.test(line);
    if (code && EXEC_OPEN.test(line)) {
      c.execOpen++;
      // decode-then-execute on one line: eval(atob(...)) / Function(decodeURIComponent(...))
      if (/\b(?:eval|Function)\s*\(\s*(?:atob|decodeURIComponent|Buffer\.from|String\.fromCharCode|[\w$.]*fromCharCode)\s*\(/.test(line)) c.execDecodePair++;
    }
    if (code && DECODE.test(line)) c.decode++;
    if (code && DYN_EXEC_NONLIT.test(line)) c.dynExecNonlit++;
    if (code && COMPUTED_CONCAT.test(line) && new RegExp(`\\[[^\\]]*['"][^'"]*['"]\\s*\\+`).test(line)) {
      // only count when it plausibly assembles a dangerous name (short concatenated fragments)
      c.computedDanger++;
    }
    if (BIDI.test(line)) c.bidi++;
    if (/\.join\s*\(/.test(line)) c.joiner++;   // the assembler's concatenation stage (M1)
    c.mixedScript += mixedScriptCount(line);
    const esc = line.match(/\\x[0-9a-f]{2}|\\u[0-9a-f]{4}/gi);
    if (esc) c.escapes += esc.length;
  }
  return c;
}

// guard: indexOf scan avoids regex backtracking
function extractInlineScripts(html) {
  const lower = html.toLowerCase();
  const parts = [];
  let i = 0;
  for (;;) {
    const open = lower.indexOf('<script', i);
    if (open < 0) break;
    const gt = lower.indexOf('>', open);
    if (gt < 0) break;
    const close = lower.indexOf('</script', gt);
    if (close < 0) break;
    const body = html.slice(gt + 1, close);
    if (body.trim()) parts.push(body);
    i = close + 8;
  }
  return parts.join('\n');
}

// ---- allowlist ----
// guard: an unreadable allowlist suppresses nothing
const SELF_ROOT = resolve(__dirname, '..');
const SCANNED_REPO = basename(ROOT);
const IS_SELF_SCAN = ROOT === SELF_ROOT;
// fix: an unparseable expiry never expires, schema rejects it
const allowlistSchemaPath = () => process.env.CW_MINIFY_ALLOWLIST_SCHEMA || join(__dirname, '..', 'schema', 'minify-allowlist.schema.json');
function loadAllowlist() {
  const p = CFG.allowlistPath;
  try {
    const j = JSON.parse(readFileSync(p, 'utf8'));
    const v = validateAgainstSchema(j, { path: allowlistSchemaPath() });
    if (v.errors.length) {
      process.stderr.write(`minify-detect: allowlist ${p} does not satisfy schema/minify-allowlist.schema.json — suppressing NOTHING:\n  - ${v.errors.join('\n  - ')}\n`);
      return { entries: [], unreadable: true };
    }
    return { entries: Array.isArray(j.allow) ? j.allow : [] };
  } catch (e) {
    if (e.code === 'ENOENT') return { entries: [] };
    process.stderr.write(`minify-detect: allowlist unreadable ${p}: ${e.code || 'error'}\n`); // no content
    return { entries: [], unreadable: true };
  }
}
const al = loadAllowlist();
// fix: clock falls through to Date.now, never a literal
const NOW = CFG.now ?? (Number.isFinite(Date.parse(process.env.CW_NOW || '')) ? Date.parse(process.env.CW_NOW) : Date.now());
let allowlistExpired = 0;
const ALLOW = al.unreadable ? [] : al.entries.filter((a) => {
  const applies = a.repo ? (a.repo === SCANNED_REPO || (a.repo === 'commitwork' && IS_SELF_SCAN)) : IS_SELF_SCAN;
  if (!applies) return false;
  if (!a.expires) return false;                              // no expiry ⇒ not honoured (strict)
  if (Number.isFinite(Date.parse(a.expires)) && Date.parse(a.expires) < NOW) { allowlistExpired++; return false; }
  return a.rule && a.file;                                   // strict: every identity field required
});
function isAllowed(rel, rule) {
  return ALLOW.some((a) => a.rule === rule && a.file === rel);
}

// ---- walk ----------------------------------------------------------------------------------
const findings = [];
const filesSkipped = [];
let filesScanned = 0;
// a split payload trips no per-file rule
const xfile = { builders: [], sinks: [] };   // builders:{file,base}; sinks:{file,specs:[importedBasenames]}
const baseNoExt = (p) => p.replace(/.*\//, '').replace(/\.[^.]+$/, '');
// co-occurrence alone is true of every repo
function importSpecs(text) {
  const specs = [];
  const re = /(?:from|require\s*\(|import\s*\()\s*['"]([^'"]+)['"]/g;
  let m;
  while ((m = re.exec(text))) specs.push(baseNoExt(m[1]));
  return specs;
}

function readCapped(p, size) {
  const max = CFG.maxBytes;
  if (size <= max) { try { return { buf: readFileSync(p), capped: false }; } catch { return null; } }
  const fd = openSync(p, 'r'); const b = Buffer.alloc(HEAD_BYTES);
  try { const n = readSync(fd, b, 0, HEAD_BYTES, 0); return { buf: b.subarray(0, n), capped: true }; }
  catch { return null; } finally { closeSync(fd); }
}

// writes: map kind and source count, never paths
// a head-read cap misses an inline map
function sourcemapInfo(absPath, text) {
  const m = /\/\/[#@]\s*sourceMappingURL=([^\s'"]+)/.exec(text);
  if (m) {
    const dm = /^data:application\/json[^,]*;base64,(.+)$/.exec(m[1]);
    if (dm) {
      try { const j = JSON.parse(Buffer.from(dm[1], 'base64').toString('utf8')); return { kind: 'inline', sources: Array.isArray(j.sources) ? j.sources.length : 0 }; }
      catch { return { kind: 'inline-unparsed', sources: 0 }; }
    }
    return { kind: 'inline-ref', sources: 0 };   // names an external .map
  }
  try { const j = JSON.parse(readFileSync(`${absPath}.map`, 'utf8')); return { kind: 'adjacent', sources: Array.isArray(j.sources) ? j.sources.length : 0 }; }
  catch (e) { if (e.code !== 'ENOENT') return { kind: 'adjacent-unreadable', sources: 0 }; }
  return null;
}

// walks section headers only, never disassembles
function parseWasm(buf) {
  if (buf.length < 8 || buf[0] !== 0x00 || buf[1] !== 0x61 || buf[2] !== 0x73 || buf[3] !== 0x6d) return { ok: false, reason: 'bad-magic' };
  let p = 8;
  const uleb = () => { let r = 0, s = 0, b; do { b = buf[p++]; r += (b & 0x7f) * 2 ** s; s += 7; } while (b & 0x80); return r; };
  const nm = () => { const n = uleb(); const s = buf.toString('utf8', p, p + n); p += n; return s; };
  const limits = () => { const f = buf[p++]; uleb(); if (f & 1) uleb(); };
  const out = { ok: true, imports: [], exports: [], customNames: [], dataBytes: 0, hasNameSection: false };
  try {
    while (p < buf.length) {
      const id = buf[p++];
      const size = uleb();
      const end = p + size;
      if (id === 2) {
        const count = uleb();
        for (let i = 0; i < count; i++) {
          const mod = nm(); const fld = nm(); const kind = buf[p++];
          out.imports.push(`${mod}.${fld}`);
          if (kind === 0) uleb();               // func: typeidx
          else if (kind === 1) { p++; limits(); } // table: reftype + limits
          else if (kind === 2) limits();          // mem: limits
          else if (kind === 3) { p++; p++; }      // global: valtype + mut
        }
      } else if (id === 7) {
        const count = uleb();
        for (let i = 0; i < count; i++) { out.exports.push(nm()); p++; uleb(); }
      } else if (id === 0) {
        const cn = nm(); out.customNames.push(cn); if (cn === 'name') out.hasNameSection = true;
      } else if (id === 11) {
        out.dataBytes += size;
      }
      if (end < p || end > buf.length) return { ok: false, reason: 'truncated' }; // section desync ⇒ fail closed
      p = end;
    }
  } catch { return { ok: false, reason: 'truncated' }; }
  return out;
}

// import names are declared interface, not content
function classifyWasm(relPath, buf, capped) {
  const w = parseWasm(buf);
  if (!w.ok) { push('wasm-unparseable', relPath, 'high', capped, { entropy: 0, wsRatio: 0, bytesPerLineMax: 0 }, `not parseable wasm (${w.reason})`); return; }
  const danger = [...new Set(w.imports.filter((i) => WASM_DANGEROUS.test(i)))].sort();
  const m = { entropy: 0, wsRatio: 0, bytesPerLineMax: 0, imports: w.imports.length, exports: w.exports.length, dataBytes: w.dataBytes };
  if (danger.length) push('wasm-dangerous-import', relPath, 'high', capped, m, `imports: ${danger.slice(0, 6).join(' ')}`);
  if (w.dataBytes >= 524_288) push('wasm-oversize-data', relPath, 'med', capped, m, `data=${Math.round(w.dataBytes / 1024)}KB`);
  push('wasm-present', relPath, 'low', capped, m, `imports=${w.imports.length} exports=${w.exports.length} data=${Math.round(w.dataBytes / 1024)}KB names=${w.hasNameSection ? 'yes' : 'stripped'}`);
}

// fix: own comments and fixtures carry the pattern literals / marked, never skipped
const SELF_PATTERN_FILES = new Set(['bin/minify-detect.mjs', 'bin/test/minify-detect.test.mjs']);
// a smuggled bidi hides best in the detector
const SELF_PATTERN_RULES = new Set(['exec-redirection', 'dynamic-exec-nonliteral', 'exec-decode-pair',
  'computed-dangerous-member']);
const SELF_REF_WHY = 'the detector\'s own pattern vocabulary: these literals ARE the rules, matched in the comments and fixtures that define them';

function push(rule, rel, sev, capped, m, detail) {
  if (isAllowed(rel, rule)) return;
  const selfRef = IS_SELF_SCAN && SELF_PATTERN_FILES.has(rel) && SELF_PATTERN_RULES.has(rule);
  findings.push({ rule, path: rel, sev, capped, metrics: m, detail, // detail = counts/labels only
    ...(selfRef ? { selfReference: SELF_REF_WHY } : {}) });
}

function walk(dir) {
  let entries; try { entries = readdirSync(dir); } catch (e) { filesSkipped.push({ path: rel(dir), reason: e.code || 'readdir-error' }); return; }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const p = join(dir, name);
    let st; try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) { if (!skipPath(rel(p))) walk(p); continue; }
    if (!SCAN_EXT.test(name) && !HTML_EXT.test(name) && !WASM_EXT.test(name) && !TEXT_FILE.test(name)) continue;
    const r = readCapped(p, st.size);
    if (!r) { filesSkipped.push({ path: rel(p), reason: 'unreadable', bytes: st.size }); continue; }
    filesScanned++;
    classify(rel(p), r.buf, r.capped, st.size, p);
  }
}
const rel = (p) => relative(ROOT, p).split('\\').join('/');

function classifyText(relPath, buf, capped) {
  const lines = buf.toString('utf8').replace(/^\uFEFF/, '').split('\n');
  const hidden = lines.filter((l) => HIDDEN_TEXT.test(l)).length;
  if (hidden > 0) push('bidi-homoglyph', relPath, 'high', capped, { bytes: buf.length, lines: lines.length, hiddenLines: hidden }, `hiddenLines=${hidden} (prose: bidi/isolate controls, zero-width space, tag characters)`);
}

function classify(relPath, buf, capped, trueSize, absPath) {
  if (WASM_EXT.test(relPath)) { classifyWasm(relPath, buf, capped); return; }  // M3: binary, not text
  if (TEXT_FILE.test(basename(relPath))) { classifyText(relPath, buf, capped); return; }
  const isHtml = HTML_EXT.test(relPath);
  let abuf = buf;                                  // the buffer actually analysed
  if (isHtml) {
    const script = extractInlineScripts(buf.toString('utf8'));
    if (!script.trim()) return;                    // scanned, no inline JS — a real "nothing here", not a void
    abuf = Buffer.from(script, 'utf8');
  }
  const m = metricsFor(abuf);
  const text = abuf.toString('utf8');
  const c = scanConstructs(text);
  const cf = CFG;
  const vendorHinted = VENDOR_HINT.test(relPath);
  const minified = m.wsRatio < 0.07 || m.bytesPerLineMax > 1000;
  const highEntropy = m.entropy >= 5.2;
  const mDet = { ...m, ...c };

  // file-level rules mirror semgrep and CodeQL drops, never HTML
  if (minified && !vendorHinted) {
    const sm = isHtml ? null : sourcemapInfo(absPath, text);   // M2: de-minify affordance for the panel
    const smNote = sm ? ` sourcemap=${sm.kind}(${sm.sources}src)` : '';
    push('minified-source', relPath, 'med', capped, mDet,
      (isHtml ? 'inline script minified' : `wsRatio=${m.wsRatio} maxLine=${m.bytesPerLineMax}`) + smNote);
  }
  if (!isHtml && trueSize >= cf.semgrepCeiling) push('minified-oversize', relPath, 'high', capped, mDet, `bytes=${trueSize} ceiling=${cf.semgrepCeiling}`);
  if (!isHtml && MINIFIED_NAME.test(relPath) && trueSize >= cf.semgrepCeiling) push('unscannable-void', relPath, 'high', capped, mDet, 'codeql-excluded AND over semgrep ceiling');

  // execution-redirection: count in minified/high-entropy OR high absolute count anywhere (Bifocal F3)
  // At least one exec: decoding alone redirects nothing. Measured 2026-10-07, 488 of 764 fleet hits
  // were decode-only (base64 for WebAuthn, bundled vendor code); exec-decode-pair keeps eval(atob(…)).
  const execCount = c.execOpen + c.decode;
  if (c.execOpen > 0 && (((minified || highEntropy) && execCount >= 2) || execCount >= 8))
    push('exec-redirection', relPath, 'high', capped, mDet, `execOpen=${c.execOpen} decode=${c.decode}`);

  // efficacy rules — readability-independent (Efficacy EF1/EF2/EF3)
  if (c.dynExecNonlit > 0) push('dynamic-exec-nonliteral', relPath, 'low', capped, mDet, `count=${c.dynExecNonlit}`);
  if (c.execDecodePair > 0) push('exec-decode-pair', relPath, 'high', capped, mDet, `count=${c.execDecodePair}`);
  if (c.computedDanger > 0) push('computed-dangerous-member', relPath, 'high', capped, mDet, `count=${c.computedDanger}`);

  // prior-art rules (PA4/PA2/PA1/PA3)
  if (c.bidi > 0 || c.mixedScript > 0) push('bidi-homoglyph', relPath, 'high', capped, mDet, `bidi=${c.bidi} mixedScript=${c.mixedScript}`);
  if (m.alphabet > 0 && m.alphabet <= 8 && m.bytes >= 256) push('low-alphabet', relPath, 'med', capped, mDet, `alphabet=${m.alphabet}`);
  if (c.deanEdwards || (c.escapes >= 200 && minified)) push('packer-signature', relPath, 'med', capped, mDet, c.deanEdwards ? 'dean-edwards' : `escapes=${c.escapes}`);

  // entropy-blob: default-off (Overloop I3); computed above but only EMITTED behind the flag
  if (cf.entropyRule && highEntropy && m.bytes >= 512 && !vendorHinted)
    push('entropy-blob', relPath, 'med', capped, mDet, `entropy=${m.entropy}`);

  if (c.escapes >= 100) xfile.builders.push({ file: relPath, base: baseNoExt(relPath) });
  if (c.dynExecNonlit > 0 || c.execDecodePair > 0) xfile.sinks.push({ file: relPath, specs: importSpecs(text) });
}

// guarded: importing HIDDEN_TEXT must not walk the importer's cwd
function main() {
  skipPath = dirExcluder(excludeDirs().filter((d) => d.includes('/')));
  walk(ROOT);

  // pins: identity anchors on the sink, the execution locus
  if (CFG.xfileRule && xfile.builders.length && xfile.sinks.length) {
    const builderBase = new Map();                       // builder basename → its file
    for (const b of xfile.builders) builderBase.set(b.base, b.file);
    const linked = [];
    for (const s of xfile.sinks) {
      if (s.specs.some((spec) => builderBase.has(spec) && builderBase.get(spec) !== s.file)) linked.push(s.file);
    }
    const sinkFiles = [...new Set(linked)].sort();
    if (sinkFiles.length) {
      push('distributed-assembler', sinkFiles[0], 'high', false,
        { entropy: 0, wsRatio: 0, bytesPerLineMax: 0 },
        `linkedSinks=${sinkFiles.length} builders=${xfile.builders.length}`);
    }
  }

  // ---- emit --------------------------------------------------------------------------------
  findings.sort((a, b) => a.path.localeCompare(b.path) || a.rule.localeCompare(b.rule) || a.detail.localeCompare(b.detail));
  const byRule = {};
  for (const f of findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  const cf = CFG;
  const summary = {
    findings: findings.length,
    byRule,
    filesScanned,
    filesSkipped,
    config: {                                       // effective config as evidence — STPA UCA7 / R2b
      rulesetVersion: RULESET_VERSION,
      maxBytes: cf.maxBytes, semgrepCeiling: cf.semgrepCeiling, entropyRule: cf.entropyRule, xfileRule: cf.xfileRule, depsRule: cf.depsRule,
      ...(invalidEnv.length ? { invalidEnvFallback: invalidEnv } : {}),
    },
  };
  if (al.unreadable) summary.allowlistUnreadable = true;
  if (allowlistExpired) summary.allowlistExpired = allowlistExpired;
  process.stdout.write(`${JSON.stringify({ tool: 'minify-detect', summary, findings }, null, 2)}\n`);
}

if (isMainModule(import.meta.url)) main();
