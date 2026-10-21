#!/usr/bin/env node
// usage: webshell-detect.mjs [rootDir]   (default '.')
// exit: 0 ran · 2 could not run
// env, read at call time: CW_WEBSHELL_MAX_BYTES (whole-file read cap, default 4 MiB; larger files are
//   examined in windows, never skipped), CW_WEBSHELL_SKIP_DIRS (comma list of directory names or
//   a/b paths; default .git,node_modules,.claude/worktrees,fixtures/scan-canary/dirty — every skip is
//   listed in summary.skippedPaths)
// output: {tool, summary:{findings, byRule, filesScanned, ...}, findings[]}
//   rule ids, paths, decode chains and family names only — never file contents or credential values.
//
// Every other lane chooses files by language extension, so a dropper stored as `x.php.b64`, a
// credential dotfile beside it or a php-lock `.htaccess` was opened by none of them: measured on
// 2026-10-08 against a WordPress tree from an exploited server, 82 lanes reported
// nothing about any of the three. This lane decides by content and placement, opens every file under
// the cap, and peels base64/hex/deflate/rot13 layers before it looks.
//
// It deliberately does NOT use the shared build-output exclusion list: `vendor/`, `dist/` and
// `build/` are where an attacker hides a file, and excluding them is a blind spot, not a speed-up.
import { readdirSync, lstatSync, readFileSync, openSync, readSync, closeSync } from 'node:fs';
import { join, relative, resolve, basename, extname } from 'node:path';
import { inflateRawSync, inflateSync, gunzipSync } from 'node:zlib';
import { isMainModule } from '../lib/is-main.mjs';

export const TOOL = 'webshell-detect';

export const RULE_CWE = Object.freeze({
  'encoded-server-payload': 'CWE-506',
  'webshell-eval-decoder': 'CWE-506',
  'webshell-request-exec': 'CWE-94',
  'webshell-banner': 'CWE-506',
  'decoded-code-writer': 'CWE-506',
  'silenced-unbounded': 'CWE-506',
  'server-code-in-upload-dir': 'CWE-434',
  'server-code-in-media-file': 'CWE-434',
  'double-extension': 'CWE-434',
  'dropper-state-file': 'CWE-506',
  'htaccess-php-lock': 'CWE-506',
  'htaccess-exec-handler': 'CWE-434',
  'php-auto-prepend': 'CWE-829',
});

export const RULE_SEV = Object.freeze({
  'encoded-server-payload': 'high',
  'webshell-eval-decoder': 'crit',
  'webshell-request-exec': 'crit',
  'webshell-banner': 'crit',
  'decoded-code-writer': 'high',
  'silenced-unbounded': 'high',
  'server-code-in-upload-dir': 'high',
  'server-code-in-media-file': 'high',
  'double-extension': 'med',
  'dropper-state-file': 'high',
  'htaccess-php-lock': 'high',
  'htaccess-exec-handler': 'high',
  'php-auto-prepend': 'med',
});

const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_SKIP = ['.git', 'node_modules', '.claude/worktrees', 'fixtures/scan-canary/dirty'];
const MAX_DEPTH = 4;
const MAX_CHILDREN = 64;
const STATE_FILE_MAX = 64 * 1024;
const MIN_ENCODED = 24;
const LIST_CAP = 50;

export const maxBytes = () => {
  const n = Number(process.env.CW_WEBSHELL_MAX_BYTES);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_BYTES;
};
export const skipDirs = () => {
  const raw = process.env.CW_WEBSHELL_SKIP_DIRS;
  return raw == null ? DEFAULT_SKIP : raw.split(',').map((s) => s.trim()).filter(Boolean);
};

export const rot13 = (s) => s.replace(/[A-Za-z]/g, (c) => {
  const base = c <= 'Z' ? 65 : 97;
  return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
});

const PHP_EXT = /\.(php[0-9]?|phtml|pht|phar|inc)$/i;
const ASP_EXT = /\.(aspx?|ashx|asmx|asa)$/i;
const JSP_EXT = /\.(jspx?|jspf)$/i;
const CGI_EXT = /\.(cgi|pl)$/i;
const EXEC_EXT = /\.(php[0-9]?|phtml|pht|phar|aspx?|ashx|asmx|jspx?|cgi|pl)$/i;
const MEDIA_EXT = /\.(jpe?g|png|gif|ico|bmp|webp|tiff?|svg|mp[34]|avi|mov|webm|pdf|woff2?|ttf|otf|eot)$/i;
const DOUBLE_EXT = /\.(php[0-9]?|phtml|phar|aspx?|jspx?)\.([A-Za-z0-9_~-]{1,12})$/i;
const DOUBLE_BENIGN = new Set(['dist', 'example', 'sample', 'pubkey', 'sig', 'asc', 'md5', 'sha1', 'sha256', 'sha512', 'twig', 'blade', 'stub', 'tpl', 'tmpl', 'template', 'in', 'snap', 'map', 'gz', 'lock', 'patch', 'diff', 'rej']);
const DOUBLE_DROPPER = new Set(['b64', 'base64', 'txt', 'jpg', 'jpeg', 'png', 'gif', 'ico', 'bmp', 'suspected', 'infected', 'zip']);

const PHP_OPEN = /<\?php|<\?=/i;
// ASP.NET and JSP share `<%@ page`; the attributes after it say which one it is.
const ASP_OPEN = /<%@\s*(Page|WebHandler|WebService)\b[^%]*\bLanguage\s*=|<script[^>]+runat\s*=\s*["']?server/i;
const JSP_OPEN = /<%@\s*page\b[^%]*\b(import|contentType|pageEncoding)\s*=|<jsp:/i;
const MEDIA_TAG = /<\?php\s|<%@\s*(page|webhandler)\b/i;

const SINKS_PHP = /\b(eval|assert|system|exec|shell_exec|passthru|popen|proc_open|pcntl_exec|create_function)\s*\(/i;
const EVAL_DECODER = /\b(eval|assert|create_function)\s*\(\s*@?\s*(base64_decode|gzinflate|gzuncompress|gzdecode|str_rot13|hex2bin|convert_uudecode|strrev)\s*\(/i;
// Per language, because the same words mean different things across them: a case-insensitive
// VBScript `Execute(Request(` also matches PHP's `executeRequest(` and fired on a Google client.
const REQUEST_EXEC = {
  php: [
    /\b(eval|assert|system|exec|shell_exec|passthru|popen|proc_open|pcntl_exec|create_function|call_user_func(?:_array)?|array_map)\s*\(\s*@?\s*(?:\(\s*string\s*\)\s*)?\$_(GET|POST|REQUEST|COOKIE|SERVER)\s*\[/i,
    /@?\$_(GET|POST|REQUEST|COOKIE)\s*\[[^\]]{1,40}\]\s*\(/,
    // a backtick in expression position; doc comments and SQL identifiers put backticks elsewhere
    /(?:=|\becho|\bprint|\breturn|\()\s*`[^`\n]*\$_(GET|POST|REQUEST|COOKIE)\s*\[[^`\n]*`/,
  ],
  asp: [
    /\b(Execute|ExecuteGlobal|Eval)\s*(?:\(\s*|\s+)Request\s*(\.(Form|QueryString|Item))?\s*[([]/i,
    /\bProcess\.Start\s*\([^)]*Request\s*[.[(]/i,
  ],
  jsp: [
    /Runtime\.getRuntime\s*\(\s*\)\s*\.exec\s*\(\s*request\.getParameter\s*\(/,
    /new\s+ProcessBuilder\s*\([^)]*request\.getParameter\s*\(/,
  ],
};
// Family names, matched only beside an execution or write sink: security plugins ship the bare
// names in their own signature lists, and a list of names is not a shell. Stored rot13 so this
// file is not itself a list of names beside sink words — it flagged itself, and antivirus
// engines read source the same way.
const BANNER_NAMES_ROT13 = ['SvyrfZna', 'o374x', 'e57furyy', 'p99furyy', 'VaqbKcybvg', 'Furyy Qrcyblre', 'NYSN_QNGN', 'NabalzbhfSbk'];
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BANNERS = new RegExp([...BANNER_NAMES_ROT13.map((s) => escapeRegExp(rot13(s))), `\\b${rot13('JFB')}\\s?[0-9]`].join('|'));
const BANNER_SINK = /\b(eval|assert|system|exec|shell_exec|passthru|popen|proc_open|move_uploaded_file|file_put_contents|fwrite)\s*\(/i;
const WRITER = /\b(file_put_contents|fwrite|fputs)\s*\(/gi;
const WRITER_DECODE = /\b(base64_decode|gzinflate|gzuncompress|str_rot13|hex2bin)\s*\(/i;
const WRITER_TARGET = /\.(php[0-9]?|phtml|phar)['"]/i;
const SILENCED = /@error_reporting\s*\(\s*0\s*\)/i;
const UNBOUNDED = /@?set_time_limit\s*\(\s*0\s*\)/i;
const DECODE_CALL = /\b(base64_decode|gzinflate|gzuncompress|gzdecode|str_rot13|hex2bin)\s*\(\s*(?:(base64_decode|str_rot13)\s*\(\s*)?(['"])([^'"]{40,})\3/gi;
const LONG_B64_LITERAL = /['"]([A-Za-z0-9+/]{200,}={0,2})['"]/g;
const B64_BODY = /^[A-Za-z0-9+/=\s]+$/;
const HEX_BODY = /^[0-9a-fA-F\s]+$/;
const CREDENTIAL_KEY = /^(pass|passwd|password|pwd|pw|auth|key|token|secret)$/i;
const SERVER_FILE_VALUE = /^[\w./-]{1,120}\.(php[0-9]?|phtml|aspx?|jspx?)$/i;
const AUTO_PREPEND = /^[ \t]*(?:php_value[ \t]+)?auto_(prepend|append)_file(?:[ \t]*=[ \t]*|[ \t]+)["']?([^"'\s;#=]+)/gim;
const EXEC_HANDLER = /^\s*(AddHandler|AddType)\s+\S*(php|cgi-script)\S*\s+([^\n#]+)$/gim;
const FILES_MATCH = /<FilesMatch\s+["']?([^"'>]+)["']?\s*>([\s\S]*?)<\/FilesMatch>/gi;


export function texty(buf) {
  const n = Math.min(buf.length, 4096);
  if (!n) return false;
  let ok = 0;
  for (let i = 0; i < n; i++) { const c = buf[i]; if (c === 9 || c === 10 || c === 13 || (c >= 32 && c < 127) || c >= 160) ok++; }
  return ok / n >= 0.9;
}

function inflateVariants(buf, cap) {
  const out = [];
  for (const [name, fn] of [['gzinflate', inflateRawSync], ['gzuncompress', inflateSync], ['gzdecode', gunzipSync]]) {
    try { out.push({ step: name, buf: fn(buf, { maxOutputLength: cap }) }); } catch { /* not this container */ }
  }
  return out;
}

// Each decoded candidate is kept only if it reads as text, directly or after one inflate. Binary
// noise is what a base64 image decodes to, and judging it would turn every inline icon into a row.
function candidates(buf, step, cap) {
  if (texty(buf)) return [{ chain: [step], buf }];
  return inflateVariants(buf, cap).filter((v) => texty(v.buf)).map((v) => ({ chain: [step, v.step], buf: v.buf }));
}

function decodeBase64(s) {
  const clean = s.replace(/\s+/g, '');
  if (clean.length < MIN_ENCODED || clean.length % 4 === 1) return null;
  const buf = Buffer.from(clean, 'base64');
  return buf.length >= Math.floor((clean.length * 3) / 4) - 2 ? buf : null;
}

export function childLayers(text, isServer, cap) {
  const out = [];
  const body = text.trim();
  // The floor is low on purpose: a one-line shell encodes to under forty characters, and a decoded
  // layer still has to hold server code before any rule fires on it.
  if (body.length >= MIN_ENCODED && B64_BODY.test(body)) {
    const raw = decodeBase64(body);
    if (raw) out.push(...candidates(raw, 'base64', cap));
  } else if (body.length >= MIN_ENCODED && body.length % 2 === 0 && HEX_BODY.test(body)) {
    out.push(...candidates(Buffer.from(body.replace(/\s+/g, ''), 'hex'), 'hex', cap));
  }
  if (!isServer) return out.slice(0, MAX_CHILDREN);
  for (const m of text.matchAll(DECODE_CALL)) {
    if (out.length >= MAX_CHILDREN) break;
    const outer = m[1].toLowerCase();
    const inner = (m[2] || '').toLowerCase();
    let lit = m[4];
    const chain = [];
    if (inner === 'str_rot13' || (!inner && outer === 'str_rot13')) { lit = rot13(lit); chain.push('str_rot13'); }
    let buf;
    if (outer === 'hex2bin') { buf = /^[0-9a-fA-F]+$/.test(lit) ? Buffer.from(lit, 'hex') : null; chain.push('hex2bin'); }
    else if (outer === 'str_rot13' && !inner) buf = Buffer.from(lit, 'latin1');
    else { buf = decodeBase64(lit); chain.push('base64'); }
    if (!buf) continue;
    if (['gzinflate', 'gzuncompress', 'gzdecode'].includes(outer)) {
      const v = inflateVariants(buf, cap).find((x) => x.step === outer);
      if (v && texty(v.buf)) out.push({ chain: [...chain, outer], buf: v.buf });
    } else if (texty(buf)) out.push({ chain, buf });
  }
  for (const m of text.matchAll(LONG_B64_LITERAL)) {
    if (out.length >= MAX_CHILDREN) break;
    const raw = decodeBase64(m[1]);
    if (!raw) continue;
    for (const c of candidates(raw, 'base64-literal', cap)) {
      const t = c.buf.toString('latin1');
      if (PHP_OPEN.test(t) || SINKS_PHP.test(t)) out.push(c);
    }
  }
  return out.slice(0, MAX_CHILDREN);
}

// An opening tag makes a file server code only when its extension does not already name another
// language: PHP never runs a .mjs or a .md, and a test or a doc that QUOTES a shell is not one.
// Polyglots hide in images, .txt, .inc and extensionless files, and those still read by content.
const OTHER_LANGUAGE_EXT = /\.(m?js|cjs|jsx|tsx?|mts|cts|py|rb|go|rs|java|kts?|scala|c|cc|cpp|h|hpp|cs|swift|sh|bash|zsh|ps1|md|markdown|rst|ya?ml|toml|json|xml|html?|css|scss|less|vue|svelte)$/i;
export function languagesOf(text, name = '') {
  const langs = new Set();
  const byContent = !OTHER_LANGUAGE_EXT.test(name);
  if (PHP_EXT.test(name) || (byContent && PHP_OPEN.test(text))) langs.add('php');
  if (ASP_EXT.test(name) || (byContent && ASP_OPEN.test(text))) langs.add('asp');
  if (JSP_EXT.test(name) || (byContent && JSP_OPEN.test(text))) langs.add('jsp');
  if (CGI_EXT.test(name)) langs.add('cgi');
  return langs;
}

// A PHP file whose first statement ends execution is a data file the plugin reads, not code the
// server runs: Sucuri and AIOS store their settings that way under uploads/, and a directory index
// that holds only a comment is WordPress's own "silence is golden" guard.
export function inertPhp(text) {
  const m = /^\s*<\?php\b/i.exec(text);
  if (!m) return false;
  const rest = text.slice(m[0].length).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(\/\/|#)[^\n]*$/gm, '').trim();
  return rest === '' || rest === '?>' || /^(exit|die)\s*(\(\s*\d*\s*\))?\s*;/i.test(rest) || /^__halt_compiler\s*\(\s*\)\s*;/i.test(rest);
}

// A decoded layer with no opening tag is still judged as PHP: droppers strip the tag before
// encoding because eval() takes code without one.
export function contentRules(text, { depth = 0, langs = new Set(['php']) } = {}) {
  const hits = new Map();
  const hit = (rule, why) => { if (!hits.has(rule)) hits.set(rule, why); };
  const php = langs.has('php') || (depth > 0 && !langs.size);
  if (php) {
    const m1 = EVAL_DECODER.exec(text);
    if (m1) hit('webshell-eval-decoder', `${m1[1]}() over ${m1[2]}()`);
  }
  for (const lang of ['php', 'asp', 'jsp']) {
    if (lang === 'php' ? !php : !langs.has(lang)) continue;
    if (REQUEST_EXEC[lang].some((rx) => rx.test(text))) { hit('webshell-request-exec', `${lang}: request input reaches an execution sink directly`); break; }
  }
  const banner = BANNERS.exec(text);
  if (banner && BANNER_SINK.test(text)) hit('webshell-banner', `shell family marker "${banner[0]}" beside an execution or write sink`);
  // Only inside an encoded layer: plugin installers write decoded PHP in plain sight by design,
  // and a writer that was itself hidden behind an encoding is the dropper shape.
  if (depth > 0) {
    for (const w of text.matchAll(WRITER)) {
      const win = text.slice(Math.max(0, w.index - 600), w.index + 600);
      if (WRITER_DECODE.test(win) && WRITER_TARGET.test(win)) { hit('decoded-code-writer', `${w[1]}() writes decoded content to a server-code filename`); break; }
    }
  }
  const s = SILENCED.exec(text);
  if (s) {
    const win = text.slice(Math.max(0, s.index - 400), s.index + 400);
    if (UNBOUNDED.test(win)) hit('silenced-unbounded', 'error reporting silenced and the time limit removed together');
  }
  if (depth > 0 && (PHP_OPEN.test(text) || ASP_OPEN.test(text) || JSP_OPEN.test(text) || SINKS_PHP.test(text))) {
    hit('encoded-server-payload', 'server code inside an encoded layer');
  }
  return hits;
}

export function htaccessLock(text) {
  for (const m of text.matchAll(FILES_MATCH)) {
    if (!/deny\s+from\s+all|require\s+all\s+denied/i.test(m[2])) continue;
    const variants = new Set((m[1].match(/p[h][p][0-9]?/gi) || []));
    if (variants.size >= 6) return variants.size;
  }
  return 0;
}

export function execHandlers(text) {
  const out = [];
  for (const m of text.matchAll(EXEC_HANDLER)) {
    const exts = m[3].trim().split(/\s+/).map((e) => e.replace(/^\./, '').toLowerCase());
    const risky = exts.filter((e) => MEDIA_EXT.test(`.${e}`) || ['txt', 'html', 'htm', 'log'].includes(e));
    if (risky.length) out.push(risky);
  }
  return out;
}

export function autoPrepends(text) {
  return [...text.matchAll(AUTO_PREPEND)].map((m) => ({ kind: m[1].toLowerCase(), target: m[2] }));
}

export function dropperState(text) {
  let j;
  try { j = JSON.parse(text); } catch { return null; }
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  const keys = Object.keys(j);
  const credKeys = keys.filter((k) => CREDENTIAL_KEY.test(k) && typeof j[k] === 'string' && j[k].length >= 6);
  const named = keys.map((k) => j[k]).filter((v) => typeof v === 'string' && SERVER_FILE_VALUE.test(v));
  if (!credKeys.length || !named.length) return null;
  return { credKeys, named: named.map((v) => basename(v).replace(/[^\w.-]/g, '_')) };
}

// A file over the cap is still examined, never skipped: a dropper padded past any fixed limit is
// the cheapest evasion there is. Media is streamed whole in chunks, because a server-code tag can
// sit anywhere in an image; anything else is judged on its first and last half-cap, where an
// appended or prepended payload lives, and the file is listed as windowed in the summary.
const CHUNK = 1024 * 1024;
const OVERLAP = 64;
export function* oversizeWindows(abs, size, cap, media) {
  const fd = openSync(abs, 'r');
  try {
    if (media) {
      for (let pos = 0; pos < size; pos += CHUNK) {
        const start = Math.max(0, pos - OVERLAP);
        const buf = Buffer.alloc(Math.min(CHUNK + (pos - start), size - start));
        readSync(fd, buf, 0, buf.length, start);
        yield buf;
      }
      return;
    }
    const half = Math.max(1, Math.floor(cap / 2));
    const head = Buffer.alloc(half);
    readSync(fd, head, 0, half, 0);
    yield head;
    const tail = Buffer.alloc(half);
    readSync(fd, tail, 0, half, size - half);
    yield tail;
  } finally {
    closeSync(fd);
  }
}

const uploadDir = (rel) => {
  const seg = rel.split('/');
  return seg.slice(0, -1).some((s, i) => s === 'uploads' || s === 'upload' || (s === 'files' && seg[i - 2] === 'sites'))
    || /(^|\/)storage\/app\/public\//.test(rel);
};

export function scanTree(root) {
  const cap = maxBytes();
  const skip = new Set(skipDirs());
  const summary = {
    findings: 0, byRule: {}, filesScanned: 0, bytesRead: 0, layersDecoded: 0, unreadable: 0, windowed: 0,
    surfaces: { serverCode: 0, htaccess: 0, phpIni: 0, mediaChecked: 0, encodedBodies: 0 },
    htaccessLocks: { files: 0, readOnly: 0, sample: [] },
    maxBytes: cap, skipDirs: [...skip],
    skippedPaths: [], unreadableFiles: [], windowedFiles: [],
  };
  const findings = [];
  const lockFiles = [];
  const fileRules = new Set();
  const add = (rule, path, detail, sev = RULE_SEV[rule]) => {
    if (fileRules.has(rule)) return;
    fileRules.add(rule);
    findings.push({ rule, path, sev, cwe: RULE_CWE[rule], detail });
  };
  const listed = (arr, entry) => { if (arr.length < LIST_CAP) arr.push(entry); };
  const unreadable = (rel, why) => { summary.unreadable++; listed(summary.unreadableFiles, { path: rel, why }); };

  const judge = (rel, name, buf, mode, first = true) => {
    const text = buf.toString('latin1');
    if (MEDIA_EXT.test(name)) {
      if (first) summary.surfaces.mediaChecked++;
      // `<?=` is three bytes and turns up at random in compressed font and image data; the long
      // forms do not.
      if (MEDIA_TAG.test(text)) add('server-code-in-media-file', rel, `${extname(name)} file carries a server-code opening tag`);
      return;
    }
    const langs = languagesOf(text, name);
    const server = langs.size > 0;
    if (server && first) summary.surfaces.serverCode++;
    const dbl = DOUBLE_EXT.exec(name);
    if (dbl && !DOUBLE_BENIGN.has(dbl[2].toLowerCase())) {
      const outer = dbl[2].toLowerCase();
      add('double-extension', rel, `.${dbl[1]}.${outer}`, DOUBLE_DROPPER.has(outer) ? 'high' : 'med');
    }
    if (EXEC_EXT.test(name) && uploadDir(rel) && !inertPhp(text)) add('server-code-in-upload-dir', rel, `${extname(name)} file under an upload directory`);

    if (name === '.htaccess') {
      if (first) summary.surfaces.htaccess++;
      if (first && htaccessLock(text)) { lockFiles.push(rel); if (!(mode & 0o222)) summary.htaccessLocks.readOnly++; }
      for (const exts of execHandlers(text)) add('htaccess-exec-handler', rel, `PHP/CGI handler mapped onto .${exts.join(', .')}`);
    }
    if (name === '.htaccess' || name === '.user.ini' || name === 'user.ini' || name === 'php.ini') {
      if (first) summary.surfaces.phpIni++;
      for (const p of autoPrepends(text)) {
        const t = p.target;
        const odd = uploadDir(t.replace(/^\/+/, '')) || /(^|\/)\.[^/]+$/.test(t) || !/\.php[0-9]?$/i.test(t);
        add('php-auto-prepend', rel, `auto_${p.kind}_file → ${basename(t).replace(/[^\w.-]/g, '_')}`, odd ? 'high' : 'med');
      }
    }
    if (!server && buf.length <= STATE_FILE_MAX && /\.(php|aspx?|jsp)/i.test(text)) {
      const st = dropperState(text.trim());
      if (st) add('dropper-state-file', rel, `credential key(s) ${st.credKeys.join(', ')} beside server-code filename(s) ${st.named.join(', ')}`);
    }

    const visit = (layerText, layerLangs, depth, chain) => {
      const isServerLayer = layerLangs.size > 0;
      if (isServerLayer || depth > 0) {
        for (const [rule, why] of contentRules(layerText, { depth, langs: layerLangs })) {
          const where = chain.length ? ` (in layer ${chain.join(' → ')})` : '';
          const sev = rule === 'encoded-server-payload' && (SINKS_PHP.test(layerText) || BANNERS.test(layerText)) ? 'crit' : RULE_SEV[rule];
          add(rule, rel, `${why}${where}`, sev);
        }
      }
      if (depth >= MAX_DEPTH) return;
      for (const c of childLayers(layerText, isServerLayer, cap)) {
        summary.layersDecoded++;
        if (depth === 0 && c.chain[0] !== 'base64-literal' && !isServerLayer) summary.surfaces.encodedBodies++;
        const t = c.buf.toString('latin1');
        visit(t, languagesOf(t), depth + 1, [...chain, ...c.chain]);
      }
    };
    visit(text, langs, 0, []);
  };

  const walk = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { unreadable(relative(root, dir) || '.', `readdir failed: ${e.code || e.message}`); return; }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const abs = join(dir, e.name);
      const rel = relative(root, abs).split('\\').join('/');
      let st;
      try { st = lstatSync(abs); } catch (err) { unreadable(rel, `lstat failed: ${err.code || err.message}`); continue; }
      if (st.isSymbolicLink()) continue;
      if (st.isDirectory()) {
        if (skip.has(e.name) || skip.has(rel)) { listed(summary.skippedPaths, rel); continue; }
        walk(abs);
        continue;
      }
      if (!st.isFile()) continue;
      fileRules.clear();
      summary.filesScanned++;
      try {
        if (st.size <= cap) {
          const buf = readFileSync(abs);
          summary.bytesRead += buf.length;
          judge(rel, e.name, buf, st.mode);
        } else {
          summary.windowed++;
          listed(summary.windowedFiles, { path: rel, bytes: st.size });
          let first = true;
          for (const buf of oversizeWindows(abs, st.size, cap, MEDIA_EXT.test(e.name))) {
            summary.bytesRead += buf.length;
            judge(rel, e.name, buf, st.mode, first);
            first = false;
          }
        }
      } catch (err) { unreadable(rel, `read failed: ${err.code || err.message}`); }
    }
  };
  walk(root);

  // One campaign drops the same lock into every directory it can reach; a row per copy would bury
  // everything else in the report, so the lock is one finding at its shallowest copy with the count.
  if (lockFiles.length) {
    lockFiles.sort((a, b) => a.split('/').length - b.split('/').length || (a < b ? -1 : 1));
    summary.htaccessLocks.files = lockFiles.length;
    summary.htaccessLocks.sample = lockFiles.slice(0, 10);
    const ro = summary.htaccessLocks.readOnly;
    add('htaccess-php-lock', lockFiles[0], `${lockFiles.length} .htaccess file(s) deny every case variant of the PHP extension${ro ? `, ${ro} of them read-only` : ''} — a lock an intruder drops to keep other intruders out`);
  }

  findings.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));
  for (const f of findings) summary.byRule[f.rule] = (summary.byRule[f.rule] || 0) + 1;
  summary.byRule = Object.fromEntries(Object.entries(summary.byRule).sort(([a], [b]) => (a < b ? -1 : 1)));
  summary.findings = findings.length;
  if (summary.unreadable) {
    summary.partial = true;
    summary.partialReasons = [`${summary.unreadable} file(s) unreadable`];
  }
  if (summary.filesScanned === 0) {
    summary.voidReason = 'no file under the read cap in the tree, so nothing was examined; an empty tree is a void, not a clean result';
  }
  return { tool: TOOL, summary, findings };
}

if (isMainModule(import.meta.url)) {
  const root = resolve(process.argv[2] || '.');
  let st;
  try { st = lstatSync(root); } catch (e) { process.stderr.write(`webshell-detect: cannot read ${root}: ${e.code || e.message}\n`); process.exit(2); }
  if (!st.isDirectory()) { process.stderr.write(`webshell-detect: ${root} is not a directory\n`); process.exit(2); }
  let report;
  try { report = scanTree(root); } catch (e) { process.stderr.write(`webshell-detect: could not run: ${e.message}\n`); process.exit(2); }
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}
