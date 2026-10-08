// commitwork sitemap — shared harvest engine (S2). One implementation feeds both the S0 fixture and
// the full-fleet generator so demo and live data never drift. Extraction is universal-ctags; every
// file carries provenance {ast|heuristic|inventory|void}; caps are visible via manifest.truncation.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// ── language inventory map (top-50+ languages; inventory tier is free for all of them) ────────
const EXT_LANG = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript',
  ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'typescript',
  java: 'java', py: 'python', rb: 'ruby', go: 'go', rs: 'rust',
  c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', cxx: 'cpp', hpp: 'cpp',
  cs: 'csharp', php: 'php', swift: 'swift', kt: 'kotlin', kts: 'kotlin',
  scala: 'scala', groovy: 'groovy', sql: 'sql', ddl: 'sql',
  sh: 'shell', bash: 'shell', zsh: 'shell', ps1: 'powershell', bat: 'batch', cmd: 'batch',
  pl: 'perl', pm: 'perl', lua: 'lua', r: 'r', dart: 'dart',
  m: 'objective-c', mm: 'objective-c', hs: 'haskell', ex: 'elixir', exs: 'elixir',
  erl: 'erlang', clj: 'clojure', cljs: 'clojure', fs: 'fsharp', fsx: 'fsharp',
  jl: 'julia', nim: 'nim', zig: 'zig', vb: 'visualbasic', s: 'assembly', asm: 'assembly',
  html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less', vue: 'vue', svelte: 'svelte',
  xml: 'xml', yaml: 'yaml', yml: 'yaml', json: 'json', toml: 'toml',
  ini: 'config', properties: 'config', conf: 'config', env: 'config',
  md: 'markdown', rst: 'markdown', tex: 'tex', gradle: 'gradle', tf: 'terraform',
  proto: 'protobuf', graphql: 'graphql', gql: 'graphql', sol: 'solidity',
  svg: 'svg', png: 'binary', jpg: 'binary', gif: 'binary', ico: 'binary', woff: 'binary',
  woff2: 'binary', ttf: 'binary', jar: 'binary', bin: 'binary', lock: 'lockfile', pdf: 'binary',
};
const NAME_LANG = { dockerfile: 'dockerfile', makefile: 'make', gemfile: 'ruby', rakefile: 'ruby', 'cmakelists.txt': 'cmake' };
// languages universal-ctags parses with a real parser (mapped to our ids). A file in one of these
// counts as tier 'ast' even with zero symbols — the parser ran. Anything else caps at 'inventory'.
const CTAGS_LANGS = new Set(['java', 'javascript', 'typescript', 'python', 'ruby', 'go', 'rust', 'c', 'cpp',
  'csharp', 'php', 'perl', 'lua', 'r', 'sql', 'shell', 'powershell', 'kotlin', 'elixir', 'erlang',
  'html', 'css', 'scss', 'objective-c', 'protobuf', 'yaml', 'markdown', 'make', 'tex', 'vue', 'dockerfile']);
const KIND_MAP = {
  function: 'function', method: 'function', procedure: 'function', func: 'function', subroutine: 'function', generator: 'function',
  class: 'class', interface: 'class', struct: 'class', enum: 'class', trait: 'class', protocol: 'class',
  table: 'model', view: 'model', schema: 'model', database: 'model',
  module: 'module', namespace: 'module', package: 'module',
};
const SKIP_DIRS = new Set(['node_modules', '.git', 'build', 'target', 'dist', '.gradle', '.idea', 'coverage', '.next', 'out']);
const isBak = (n) => /\.pre-[a-z0-9-]+(-bak)?$|-bak$|\.bak$/i.test(n);
export const MAX_SYMBOLS_PER_FILE = 200;
export const MAX_LINKS = 400;
const MAX_LINKSCAN_BYTES = 2 * 1024 * 1024;
const PAGE_SEGS = new Set(['pages', 'routes', 'views']);
// ── v2 city-layer caps (all surfaced in manifest.truncation — no silent caps) ────────────────
export const MAX_WIRING_PER_SERVICE = 800;     // function-call edges (roads)
export const MAX_FILEWIRING_PER_SERVICE = 800; // import edges (wiring between files)
const MAX_LOGGING_PER_FILE = 999;              // logging call sightings per file (sewer taps)
const WIRING_BODY_CAP_BYTES = 200 * 1024;      // don't rescan a huge file's body for call ids
// logging/reporting call-site shapes (the "sewer"): slf4j (log./logger./LoggerFactory), console.*,
// java System.out|err. Capture group 1=slf4j, 2=console, 3=stdio so we can name the dominant sink.
const LOG_CALL_RE = /\b(?:(log|logger|LOG|LOGGER)\s*\.\s*(?:trace|debug|info|warn|error|fatal|log)|(console)\s*\.\s*(?:log|info|warn|error|debug|trace)|(System)\s*\.\s*(?:out|err)\s*\.\s*(?:print|println|printf)|LoggerFactory\s*\.\s*getLogger)\s*\(/g;
// audit-category signal: a logging line that looks like a security/audit event (drives audit sewer)
const LOG_AUDIT_RE = /\b(?:audit|security|authoriz|authentic|login|logout|access[-_ ]?denied|permission|forbidden|unauthori[sz]ed|token|credential)/i;
// a symbol name safe to use as a call probe (skip short names + keywords that false-match everywhere)
const CALL_STOPWORDS = new Set(['if', 'for', 'new', 'get', 'set', 'run', 'main', 'test', 'to', 'of', 'is', 'do', 'on', 'add', 'map']);
const identSafe = (n) => n.length >= 3 && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(n) && !CALL_STOPWORDS.has(n);

// ── JSON structural extraction (heuristic tier) ──────────────────────────────────────────────
// JSON is deliberately NOT in CTAGS_LANGS: ctags emits one tag per leaf — pure noise at map
// altitude. This walker extracts the schema SPINE (container keys only; arrays and maps-of-records
// collapse to one representative), stamped provenance:'heuristic' never 'ast'; overflow is counted.
const JSON_MAX_DEPTH = 3;
const JSON_MAX_NODES = 150;             // < MAX_SYMBOLS_PER_FILE=200; JSON never dominates a file's budget
const JSON_MAP_REPRESENTATIVE = 6;      // >= this many object-valued siblings ⇒ collapse to one `key{}` rep
const isPlainObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// locate the source line of each structural key — single forward pass, indentation-anchored;
// best-effort (0 = unplaced, schema-valid).
function jsonKeyLiner(lines) {
  let cursor = 0;
  return (key) => {
    const esc = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^\\s*"${esc}"\\s*:`); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- key pinned to a literal by the escape on the line above
    for (let i = cursor; i < lines.length; i++) if (re.test(lines[i])) { cursor = i + 1; return i + 1; }
    // wrap once from the top (key may sit before the cursor after an array-rep skip) — still deterministic
    for (let i = 0; i < cursor; i++) if (re.test(lines[i])) return i + 1;
    return 0;
  };
}
// extract structural symbols from parsed JSON. Returns {symbols, dropped}; every node is type
// 'model' (a data-shape node — see KIND_MAP).
function jsonSymbols(text) {
  let root; try { root = JSON.parse(text); } catch { return { symbols: [], dropped: 0 }; }
  if (!isPlainObj(root) && !Array.isArray(root)) return { symbols: [], dropped: 0 }; // scalar/empty top => no structure
  const lines = text.split('\n'); const lineOf = jsonKeyLiner(lines);
  const symbols = []; let dropped = 0;
  // push under the cap, otherwise TALLY as dropped — `dropped` is the true remainder, not a floor
  const emit = (name, line) => {
    if (symbols.length >= JSON_MAX_NODES) { dropped++; return; }
    symbols.push({ name, type: 'model', line, provenance: 'heuristic' });
  };
  const descend = (val, depth) => {
    if (depth > JSON_MAX_DEPTH) return;
    if (Array.isArray(val)) { const first = val.find((e) => e !== null && typeof e === 'object'); if (first) descend(first, depth); return; }
    if (!isPlainObj(val)) return;
    const keys = Object.keys(val);
    const objKids = keys.filter((k) => isPlainObj(val[k]));
    // map-of-records: many object-valued siblings of the same nature ⇒ one representative, not one-each
    const asMap = objKids.length >= JSON_MAP_REPRESENTATIVE && objKids.length === keys.length;
    const atCap = () => symbols.length >= JSON_MAX_NODES; // past cap we only tally — skip line lookup
    if (asMap) {
      const rep = keys[0];
      emit(`${rep}{}`, atCap() ? 0 : lineOf(rep));
      descend(val[rep], depth + 1); // shape of the representative record only
      return;
    }
    for (const k of keys) {
      const v = val[k];
      if (isPlainObj(v)) { emit(k, atCap() ? 0 : lineOf(k)); descend(v, depth + 1); }
      else if (Array.isArray(v) && v.length) { emit(`${k}[]`, atCap() ? 0 : lineOf(k)); descend(v, depth + 1); }
      // scalars & empty arrays are data/leaves — skipped by design
    }
  };
  // top-level: an array root is itself a shape; an object root spreads its keys
  if (Array.isArray(root)) { const first = root.find((e) => e !== null && typeof e === 'object'); if (first) { emit('[]', 1); descend(first, 1); } }
  else descend(root, 1);
  symbols.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
  return { symbols, dropped };
}

const langOf = (name) => NAME_LANG[name.toLowerCase()]
  || (name.toLowerCase().startsWith('dockerfile') ? 'dockerfile' : EXT_LANG[(name.toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1]])
  || 'unknown';

// Keep the first candidate that IS universal, not the first that exists — macOS /usr/bin/ctags is
// BSD ctags, and picking it silently yields a fleet with no ast symbolling.
const CTAGS_CANDIDATES = [process.env.CW_CTAGS, 'ctags', 'uctags',
  '/opt/homebrew/bin/ctags', '/usr/local/bin/ctags'].filter(Boolean);
let _ctagsVersion; // undefined = not probed; null = absent/non-universal
let _ctagsBin = null; // the binary that answered universal — used for the run itself
export function ctagsVersion() {
  if (_ctagsVersion !== undefined) return _ctagsVersion;
  _ctagsVersion = null;
  for (const bin of CTAGS_CANDIDATES) {
    let v;
    try { v = execFileSync(bin, ['--version'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\n')[0].trim(); }
    catch { continue; } // absent, or BSD ctags rejecting --version outright
    if (!/universal/i.test(v)) continue; // BSD ctags is not a parser fleet
    _ctagsBin = bin; _ctagsVersion = v; break;
  }
  return _ctagsVersion;
}
export function ctagsBin() { ctagsVersion(); return _ctagsBin; }

// `exclude`: caller-supplied repo-relative paths (gitignored trees) passed to ctags so it never
// parses them; walk() stays the authority on what enters the manifest.
function ctagsRun(dir, exclude = null) {
  if (!ctagsVersion()) return null;
  const args = ['--output-format=json', '--fields=+nKl', '--extras=-', '-R', '-f', '-',
    '--langmap=TypeScript:+.tsx', '--langmap=JavaScript:+.mjs', '--langmap=JavaScript:+.cjs',
    ...[...SKIP_DIRS].map((d) => `--exclude=${d}`), '--exclude=*.pre-*', '--exclude=*-bak',
    ...(exclude ? [...exclude].map((d) => `--exclude=${d}`) : []), '.'];
  let out;
  try { out = execFileSync(_ctagsBin, args, { cwd: dir, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }); }
  catch (e) { out = e.stdout || ''; } // ctags exits non-zero on parse warnings; keep what it emitted
  const byFile = new Map();
  for (const line of out.split('\n')) {
    if (!line.startsWith('{')) continue;
    let t; try { t = JSON.parse(line); } catch { continue; }
    if (t._type !== 'tag' || !t.path || !t.name) continue;
    const type = KIND_MAP[String(t.kind || '').toLowerCase()];
    if (!type) continue; // whitelist: variables/fields/locals are noise at map altitude
    const rel = t.path.replace(/^\.\//, '');
    if (!byFile.has(rel)) byFile.set(rel, []);
    byFile.get(rel).push({ name: t.name, type, line: t.line || 0, provenance: 'ast' });
  }
  for (const syms of byFile.values()) syms.sort((a, b) => a.line - b.line || a.name.localeCompare(b.name));
  return byFile;
}

// create a per-project harvest: accumulates links + provenance rollup across its services.
// One instance per project — link/coverage data never blends across the project picker boundary.
export function createHarvest({ buildoutDir = null } = {}) {
  const linkSeen = new Map(); // url -> {url, host, source, service, count}
  let droppedSymbols = 0;
  // `excluded` counts BOUNDARY entries (a skipped dir is 1) — visible in the manifest, never silence
  const rollup = { files: { scanned: 0, symbolled: 0, inventoryOnly: 0, void: 0, excluded: 0 }, byLanguage: {} };
  // ── v2 per-service scratch, reset per service() call so state never blends across the picker boundary
  let curSvc = null;      // { imports:Map<file,Set<toPath>>, bodies:[{file,text}] } for the service under harvest
  let droppedWiring = 0, droppedFileWiring = 0, droppedLogging = 0;

  function containerOf(svcDir, svcName) {
    const df = join(svcDir, 'Dockerfile');
    let dockerfile = null, baseImage = null;
    if (existsSync(df)) {
      dockerfile = 'Dockerfile';
      const m = readFileSync(df, 'utf8').match(/^FROM\s+([^\s]+)/m);
      if (m) baseImage = m[1];
    }
    let composeService = null; const ports = [];
    if (buildoutDir && existsSync(buildoutDir)) {
      for (const f of readdirSync(buildoutDir).sort()) {
        if (!f.endsWith('.yml') || f.includes('.pre-') || !f.startsWith('docker-compose')) continue;
        const txt = readFileSync(join(buildoutDir, f), 'utf8');
        // svcName reaches here from argv — escaped so a crafted arg can't build a catastrophic pattern
        // Any indentation, not exactly two spaces: compose files indented by four or by tabs are valid.
        const key = new RegExp(`^([ \\t]+)${svcName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:\\s*$`, 'm').exec(txt); // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- svcName pinned to a literal by the inline escape; see comment above
        if (!key) continue;
        const indent = key[1].length;
        composeService = `${f}#${svcName}`;
        for (const ln of txt.slice(key.index).split('\n').slice(1)) {
          // The block ends at the next key indented no deeper than this one: the next service.
          const lead = ln.match(/^[ \t]*/)[0].length;
          if (ln.trim() && lead <= indent) break;
          const pm = ln.match(/^\s+-\s+["']?(\d+:\d+)["']?/);
          if (pm) ports.push(pm[1]);
        }
        break;
      }
    }
    if (!dockerfile && !composeService) return null; // honest void, not an error
    return { ...(dockerfile && { dockerfile }), ...(baseImage && { baseImage }), ...(composeService && { composeService }), ...(ports.length && { ports }) };
  }

  // ── I/O apertures (monolith facet) — where the service opens to the outside world. All heuristic
  // tier by design, shown with their source file so a claim is always checkable.
  const ioBy = new Map(); // svcName -> Map<key, {kind, detail, method?, count, source}>
  let droppedIO = 0;
  const IO_CAP_PER_SERVICE = 200;
  function scanIO(txt, rel, svcName, lang) {
    const add = (kind, detail, method = null) => {
      const per = ioBy.get(svcName) || ioBy.set(svcName, new Map()).get(svcName);
      const key = `${kind}|${method || ''}|${detail}`;
      const e = per.get(key);
      if (e) { e.count++; return; }
      if (per.size >= IO_CAP_PER_SERVICE) { droppedIO++; return; }
      per.set(key, { kind, detail: String(detail).slice(0, 120), ...(method && { method }), count: 1, source: rel });
    };
    if (lang === 'java') {
      for (const m of txt.matchAll(/@(Get|Post|Put|Delete|Patch)Mapping\s*(?:\(\s*(?:value\s*=\s*|path\s*=\s*)?"([^"]*)")?/g)) add('http', m[2] || '/', m[1].toUpperCase());
      for (const m of txt.matchAll(/@RequestMapping\s*(?:\(\s*(?:value\s*=\s*|path\s*=\s*)?"([^"]*)")?/g)) add('http', m[1] || '/', 'ANY');
      if (/@RabbitListener/.test(txt)) add('amqp', 'listener');
      if (/\bRabbitTemplate\b/.test(txt)) add('amqp', 'publisher');
      if (/@KafkaListener/.test(txt)) add('kafka', 'listener');
      for (const m of txt.matchAll(/@FeignClient\s*\(\s*(?:name\s*=\s*|value\s*=\s*)?"([^"]+)"/g)) add('client', m[1]);
      if (/@ServerEndpoint|TextWebSocketHandler|WebSocketHandler\b/.test(txt)) add('ws', 'websocket');
    } else if (lang === 'javascript' || lang === 'typescript') {
      for (const m of txt.matchAll(/\b(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)/g)) add('http', m[2], m[1].toUpperCase());
      if (/new\s+WebSocket\b|socket\.io/.test(txt)) add('ws', 'websocket');
    } else if (lang === 'yaml' || lang === 'config') {
      // LINEAR line scan — the obvious multiline regex backtracks catastrophically on large yaml;
      // never reintroduce it.
      { let inServer = false, serverIndent = 0;
        // split(/\r?\n/): `^([ \t]*)(\S.*)$` below cannot match a line ending `\r` — `.` does not
        // match `\r` and `$` without `m` is end-of-string — so on a CRLF checkout this nested
        // `server:` -> `port:` walk found NOTHING and silently reported no socket. The
        // `server.port` flat-form fallback below still fired, which is what kept it invisible:
        // the lane looked like it worked, and only the nested YAML form went missing.
        for (const line of txt.split(/\r?\n/)) {
          const s0 = line.match(/^([ \t]*)server:\s*$/);
          if (s0) { inServer = true; serverIndent = s0[1].length; continue; }
          if (!inServer) continue;
          const mi = line.match(/^([ \t]*)(\S.*)$/);
          if (!mi) continue;
          if (mi[1].length <= serverIndent) { inServer = false; continue; }
          const mp = mi[2].match(/^port:\s*['"]?(\d+)/);
          if (mp) { add('socket', ':' + mp[1]); inServer = false; }
        } }
      for (const m of txt.matchAll(/server\.port\s*[=:]\s*(\d+)/g)) add('socket', ':' + m[1]);
      for (const m of txt.matchAll(/jdbc:(\w+):\/\/([^\s"';]+)/g)) add('jdbc', m[1] + '://' + m[2].split('?')[0]);
      if (/spring\.rabbitmq|^\s*rabbitmq:/m.test(txt)) add('amqp', 'broker config');
      if (/spring\.redis|^\s*redis:/m.test(txt)) add('redis', 'cache config');
      if (/spring\.kafka|^\s*kafka:/m.test(txt)) add('kafka', 'broker config');
      if (/consul/i.test(txt)) add('consul', 'discovery/config');
      if (/issuer-uri|oauth2|keycloak/i.test(txt)) add('oauth', 'idp config');
    } else if (lang === 'dockerfile') {
      for (const m of txt.matchAll(/^EXPOSE\s+(.+)$/gm)) for (const p of m[1].trim().split(/\s+/)) add('socket', 'EXPOSE ' + p);
    } else if (lang === 'protobuf') {
      for (const m of txt.matchAll(/^service\s+(\w+)/gm)) add('grpc', m[1]);
    }
  }

  // one read feeds the external-link harvest, the I/O aperture scan and the v2 city layers;
  // returns the per-file logging profile (or null) so walk() can stamp node.logging.
  function scanText(abs, rel, svcName, lang) {
    if (lang === 'binary' || lang === 'lockfile' || lang === 'svg') return 0;
    let txt; try { if (statSync(abs).size > MAX_LINKSCAN_BYTES) return 0; txt = readFileSync(abs, 'utf8'); } catch { return 0; }
    let ln = 0;
    for (const line of txt.split('\n')) {
      ln++;
      for (const m of line.matchAll(/https?:\/\/[^\s"'`<>)\]},\\]+/g)) {
        const url = m[0].replace(/[.,;:!?]+$/, '');
        if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])/i.test(url)) continue; // not external
        let host; try { host = new URL(url).host; } catch { continue; }
        if (!host) continue;
        const e = linkSeen.get(url);
        if (e) e.count++;
        else linkSeen.set(url, { url, host, source: `${svcName}/${rel}:${ln}`, service: svcName, count: 1 });
      }
    }
    scanIO(txt, rel, svcName, lang);
    // ── v2 §5 sewer: logging call-site profile (heuristic, capped per file) — {count, sink,
    // category} or null; sink = dominant family, category='audit' on a per-call-site keyword hit.
    let logging = null;
    if (lang !== 'yaml' && lang !== 'json' && lang !== 'config' && lang !== 'markdown' && lang !== 'toml') {
      let count = 0, slf4j = 0, cons = 0, stdio = 0, audit = false, lc = 0;
      for (const line of txt.split('\n')) {
        lc++; LOG_CALL_RE.lastIndex = 0; let m, lineHit = false;
        while ((m = LOG_CALL_RE.exec(line))) {
          if (count >= MAX_LOGGING_PER_FILE) { droppedLogging++; continue; }
          count++; lineHit = true;
          if (m[2]) cons++; else if (m[3]) stdio++; else slf4j++;
        }
        if (lineHit && !audit && LOG_AUDIT_RE.test(line)) audit = true;
      }
      if (count) {
        const sink = (slf4j && (cons || stdio)) || (cons && stdio) ? 'mixed' : cons ? 'console' : stdio ? 'stdio' : 'slf4j';
        logging = { count, sink, category: audit ? 'audit' : 'app' };
      }
    }
    // ── v2 §3 fileWiring: harvest import/require targets for later same-service resolution ────
    if (curSvc && (lang === 'javascript' || lang === 'typescript' || lang === 'java')) {
      const spec = new Set();
      if (lang === 'java') { for (const m of txt.matchAll(/^import\s+(?:static\s+)?([\w.]+)\s*;/gm)) spec.add(m[1]); }
      else { for (const m of txt.matchAll(/(?:import[^'"`]*from\s*|(?:import|require)\s*\(?\s*)['"]([^'"]+)['"]/g)) spec.add(m[1]); }
      if (spec.size) curSvc.imports.set(rel, spec);
    }
    // ── v2 §2 roads: cache the body for the function-call identifier scan (bounded) ───────────
    if (curSvc && txt.length <= WIRING_BODY_CAP_BYTES && (lang === 'javascript' || lang === 'typescript' || lang === 'java' || lang === 'python' || lang === 'go' || lang === 'ruby')) {
      curSvc.bodies.push({ file: rel, lines: txt.split('\n') });
    }
    return logging;
  }

  function walk(dir, relBase, svcName, tags, exclude) {
    const nodes = [];
    let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return nodes; }
    entries.sort((a, b) => (b.isDirectory() - a.isDirectory()) || a.name.localeCompare(b.name));
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name) || e.name.startsWith('.') || isBak(e.name)) continue;
      const abs = join(dir, e.name);
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      // caller-supplied exclusion (gitignored trees): the harvest describes the PRODUCT, not the
      // scan output parked inside it. Counted in provenance.files.excluded, never silent.
      if (exclude && exclude.has(rel)) { rollup.files.excluded++; continue; }
      if (e.isDirectory()) {
        const children = walk(abs, rel, svcName, tags, exclude);
        if (children.length) nodes.push({ name: e.name, type: 'dir', path: rel, children });
        continue;
      }
      if (!e.isFile()) continue;
      const lang = langOf(e.name);
      let size = 0, voidFile = false, totalLines = 0, fileText = null;
      try { size = statSync(abs).size; fileText = readFileSync(abs, 'utf8'); totalLines = fileText.split('\n').length; } catch { voidFile = true; }
      rollup.files.scanned++;
      const L = rollup.byLanguage[lang] || (rollup.byLanguage[lang] = { files: 0, symbols: 0, tier: CTAGS_LANGS.has(lang) && ctagsVersion() ? 'ast' : 'inventory' });
      L.files++;
      let symbols = (tags && tags.get(rel)) || [];
      // JSON shape via the heuristic walker (never ctags); bounded by the link-scan size guard so a
      // huge file is never JSON.parse'd. Provenance stays 'heuristic' (set inside jsonSymbols).
      if (lang === 'json' && !symbols.length && fileText !== null && size <= MAX_LINKSCAN_BYTES) {
        const js = jsonSymbols(fileText); symbols = js.symbols; droppedSymbols += js.dropped;
      }
      if (symbols.length > MAX_SYMBOLS_PER_FILE) { droppedSymbols += symbols.length - MAX_SYMBOLS_PER_FILE; symbols = symbols.slice(0, MAX_SYMBOLS_PER_FILE); }
      // ── v2 §1 function sizing: endLine = next symbol's line - 1, or file end — heuristic
      // estimate (ctags gives no block end); only stamped when there is a usable start line.
      if (symbols.length && totalLines) {
        symbols = symbols.map((s, i) => {
          if (!s.line) return s;
          const next = symbols[i + 1] && symbols[i + 1].line > s.line ? symbols[i + 1].line - 1 : totalLines;
          const endLine = Math.max(s.line, next);
          return { ...s, span: { startLine: s.line, endLine, lines: endLine - s.line + 1 } };
        });
      }
      L.symbols += symbols.length;
      const segs = rel.toLowerCase().split('/');
      const isPage = (lang === 'typescript' || lang === 'javascript' || lang === 'vue' || lang === 'svelte' || lang === 'html') && segs.slice(0, -1).some((s) => PAGE_SEGS.has(s));
      const isConfig = (lang === 'yaml' || lang === 'json' || lang === 'config' || lang === 'toml') && (segs.length <= 2 || rel.includes('src/main/resources'));
      // file tier = its symbols' own provenance when symbolled; else 'ast' if a real parser ran empty; else inventory
      const provenance = voidFile ? 'void' : symbols.length ? symbols[0].provenance : (CTAGS_LANGS.has(lang) && ctagsVersion()) ? 'ast' : 'inventory';
      if (provenance === 'void') rollup.files.void++;
      else if (symbols.length) rollup.files.symbolled++;
      else rollup.files.inventoryOnly++;
      let logging = null;
      if (!voidFile) logging = scanText(abs, rel, svcName, lang);
      nodes.push({ name: e.name, type: isPage ? 'page' : isConfig ? 'config' : 'file', path: rel, lang, provenance, size, ...(logging && { logging }), ...(symbols.length && { symbols }) });
    }
    return nodes;
  }

  // ── v2 §2 roads: intra-service function-call edges. HEURISTIC — an identifier sighting is not a
  // proven call (comments/strings/shadowing false-match); capped, dropped-count surfaced.
  function computeWiring(tree, bodies) {
    // index all functions by name -> [{file, symbol, line, endLine}]; collect per-file function lists
    const fnByName = new Map(); const fnsInFile = new Map();
    (function walkSyms(ns) { for (const n of ns) {
      if (n.children) { walkSyms(n.children); continue; }
      if (!n.symbols) continue;
      const fns = n.symbols.filter((s) => s.type === 'function' && s.line && identSafe(s.name));
      if (fns.length) fnsInFile.set(n.path, fns);
      for (const f of fns) { if (!fnByName.has(f.name)) fnByName.set(f.name, []); fnByName.get(f.name).push({ file: n.path, ...f }); }
    } })(tree);
    if (!fnByName.size) return [];
    const edges = new Map(); // `${from.file}|${from.symbol}->${to.file}|${to.symbol}` -> weight
    const bodyByFile = new Map(bodies.map((b) => [b.file, b.lines]));
    for (const [file, fns] of fnsInFile) {
      const lines = bodyByFile.get(file); if (!lines) continue; // body wasn't cached (too big/other lang)
      for (const caller of fns) {
        const cEnd = (caller.span && caller.span.endLine) || caller.line;
        const from = caller.line - 1, to = Math.min(cEnd, lines.length);
        // scan callee names present anywhere in the service; a word-boundary hit inside the window = edge
        const window = lines.slice(from, to).join('\n');
        for (const [callee, defs] of fnByName) {
          if (callee === caller.name) continue; // self-name (recursion/overload) — not a road
          const re = new RegExp(`\\b${callee.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\(`, 'g');
          let hits = 0; while (re.exec(window)) hits++;
          if (!hits) continue;
          const target = defs[0]; // ambiguous same-name across files -> first def (heuristic, documented)
          const key = `${file}|${caller.name}->${target.file}|${callee}`;
          edges.set(key, (edges.get(key) || 0) + hits);
        }
      }
    }
    const out = [];
    for (const [key, weight] of edges) {
      if (out.length >= MAX_WIRING_PER_SERVICE) { droppedWiring += edges.size - out.length; break; }
      const [l, r] = key.split('->'); const [ff, fs] = l.split('|'); const [tf, ts] = r.split('|');
      out.push({ from: { file: ff, symbol: fs }, to: { file: tf, symbol: ts }, kind: 'call', provenance: 'heuristic', weight });
    }
    out.sort((a, b) => b.weight - a.weight || a.from.file.localeCompare(b.from.file) || a.from.symbol.localeCompare(b.from.symbol));
    return out;
  }

  // ── v2 §3 wiring between files: resolve import specs to same-service files (JS/TS relative +
  // extensions/index; Java dotted-tail suffix match). HEURISTIC, capped.
  function computeFileWiring(imports, filePaths) {
    const pathSet = new Set(filePaths);
    const byNoExt = new Map(); // 'a/b/c' (no ext) -> first concrete path
    for (const p of filePaths) { const k = p.replace(/\.[^./]+$/, ''); if (!byNoExt.has(k)) byNoExt.set(k, p); }
    const resolveJs = (fromFile, spec) => {
      if (!spec.startsWith('.')) return null; // bare = external dep (io/externalLinks own it)
      const dir = fromFile.includes('/') ? fromFile.slice(0, fromFile.lastIndexOf('/')) : '';
      const parts = (dir ? dir + '/' + spec : spec).split('/'); const stack = [];
      for (const p of parts) { if (p === '.' || p === '') continue; if (p === '..') stack.pop(); else stack.push(p); }
      const base = stack.join('/');
      for (const cand of [base, base + '/index']) if (byNoExt.has(cand)) return byNoExt.get(cand);
      if (pathSet.has(base)) return base;
      return null;
    };
    const resolveJava = (spec) => {
      // io.sqx.foo.Bar -> match a file path ending .../foo/Bar.java (tail of >=2 segs to avoid noise)
      const segs = spec.split('.'); if (segs.length < 2) return null;
      const tail = segs.slice(-3).join('/');
      for (const p of filePaths) if (p.endsWith('/' + tail + '.java') || p.endsWith(tail + '.java')) return p;
      return null;
    };
    const edges = new Map(); // `${from}->${to}` -> count
    for (const [fromFile, specs] of imports) {
      const isJava = fromFile.endsWith('.java');
      for (const spec of specs) {
        const to = isJava ? resolveJava(spec) : resolveJs(fromFile, spec);
        if (!to || to === fromFile) continue; // unresolved = external (kept in externalLinks); no self-edge
        const key = `${fromFile}->${to}`; edges.set(key, (edges.get(key) || 0) + 1);
      }
    }
    const out = [];
    for (const [key, count] of edges) {
      if (out.length >= MAX_FILEWIRING_PER_SERVICE) { droppedFileWiring += edges.size - out.length; break; }
      const [fromPath, toPath] = key.split('->');
      out.push({ fromPath, toPath, kind: 'import', provenance: 'heuristic', count });
    }
    out.sort((a, b) => a.fromPath.localeCompare(b.fromPath) || a.toPath.localeCompare(b.toPath));
    return out;
  }

  return {
    // harvest one service dir into a manifest service entry. `exclude`: svcDir-relative paths kept
    // out of the walk and the ctags run (derived from `git ls-files --others --ignored`); null by
    // default — the fixture path is byte-identical without it (F3 mirror).
    service(svcDir, name, { kind = null, pathLabel = null, lifecycle = null, supersededBy = null, exclude = null } = {}) {
      curSvc = { imports: new Map(), bodies: [] }; // v2 scratch, reset per service (no cross-service blend)
      const excl = exclude ? new Set(exclude) : null;
      const tags = ctagsRun(svcDir, excl);
      const tree = walk(svcDir, '', name, tags, excl);
      const languages = {}; const filePaths = []; let logFiles = 0, logCalls = 0, logAudit = false;
      (function census(ns) { for (const n of ns) {
        if (n.children) { census(n.children); continue; }
        if (n.lang) languages[n.lang] = (languages[n.lang] || 0) + 1;
        if (n.path && n.type !== 'dir') filePaths.push(n.path);
        if (n.logging) { logFiles++; logCalls += n.logging.count; if (n.logging.category === 'audit') logAudit = true; }
      } })(tree);
      // v2 §2/§3 reduce the per-service scratch into edge lists, then discard the scratch
      const wiring = computeWiring(tree, curSvc.bodies);
      const fileWiring = computeFileWiring(curSvc.imports, filePaths);
      curSvc = null;
      return {
        id: name, name,
        kind: kind || (/frontend|web|console|website/.test(name) ? 'frontend' : /gateway/.test(name) ? 'gateway' : /docs/.test(name) ? 'docs' : /buildout|infra/.test(name) ? 'infra' : 'service'),
        path: pathLabel || `services/${name}`,
        ...(lifecycle && lifecycle !== 'active' && { lifecycle, ...(supersededBy && { supersededBy }) }),
        container: containerOf(svcDir, name),
        io: [...(ioBy.get(name) || new Map()).values()].sort((a, b) => a.kind.localeCompare(b.kind) || String(a.detail).localeCompare(String(b.detail))),
        languages: Object.fromEntries(Object.entries(languages).sort(([a], [b]) => a.localeCompare(b))),
        ...(wiring.length && { wiring }),          // v2 §2 roads (empty => omitted; renderer treats absent as no data)
        ...(fileWiring.length && { fileWiring }),  // v2 §3 wiring between files
        ...(logCalls && { logSinks: { files: logFiles, calls: logCalls, ...(logAudit && { audit: true }) } }), // v2 §5 sewer rollup
        tree,
      };
    },
    // assemble the manifest around already-harvested services
    manifest(services, { project, tool, fixture = false }) {
      const links = [...linkSeen.values()].sort((a, b) => b.count - a.count || a.url.localeCompare(b.url));
      const droppedLinks = Math.max(0, links.length - MAX_LINKS);
      return {
        $schema: '../../schema/sitemap.schema.json',
        schemaVersion: 2,
        project,
        generated: new Date().toISOString(),
        generator: { tool, ...(ctagsVersion() && { ctags: ctagsVersion() }), ...(fixture && { fixture: true }) },
        provenance: rollup,
        services,
        externalLinks: links.slice(0, MAX_LINKS),
        // airBridges + vulnerabilities are attached by attachOverlays() in monitor/sitemap-data.mjs;
        // the pure harvest engine has no fs access to reports/. Absent here on purpose.
        ...((droppedLinks || droppedSymbols || droppedIO || droppedWiring || droppedFileWiring || droppedLogging) && { truncation: {
          note: `caps applied: ${MAX_SYMBOLS_PER_FILE} symbols/file, ${MAX_LINKS} external links, ${IO_CAP_PER_SERVICE} io/service, ${MAX_WIRING_PER_SERVICE} wiring/service, ${MAX_FILEWIRING_PER_SERVICE} fileWiring/service, ${MAX_LOGGING_PER_FILE} logging/file — dropped counts below are shown, not hidden`,
          ...(droppedSymbols && { droppedSymbols }), ...(droppedLinks && { droppedLinks }), ...(droppedIO && { droppedIO }),
          ...(droppedWiring && { droppedWiring }), ...(droppedFileWiring && { droppedFileWiring }), ...(droppedLogging && { droppedLogging }) } }),
      };
    },
  };
}
