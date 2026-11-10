// bin/lib/wp-observables.mjs — the corpus a WordPress posture reading is made from: typed rows about
// the install, its components, its options, users, audit sources, served directories and server
// directives, read from a tree and (when one is found) a database dump. Nothing here judges; the
// catalogue's predicates do, over these rows, so a new weakness is a catalogue entry and not code.
//
// What never enters a row: an option value, a password hash, an email address, a file's contents.
// An option is described by its key, its autoload flag and the CLASS of its value; a user by an id,
// roles, the hash scheme and whether the login is a dictionary name. A type that could not be read
// is listed in `unmeasured` with the reason, so a predicate over it is not measured rather than
// silently passed.
import { readdirSync, readFileSync, openSync, readSync, closeSync, existsSync, statSync } from 'node:fs';
import { join, extname, resolve } from 'node:path';
import { findInstalls, inventory, readHead, relPath } from './wordpress.mjs';
import { readDump } from './wp-dump.mjs';
import { tryUnserialize, stringList } from './php-serialize.mjs';
import { rethrowIfBug } from '../rethrow.mjs';

export const TYPES = Object.freeze(['wp-install', 'wp-component', 'wp-option', 'wp-setting', 'wp-user', 'audit-source', 'served-dir', 'file', 'server-directive']);

const CODE_EXT = new Set(['.php', '.php3', '.php4', '.php5', '.php7', '.phtml', '.phar', '.inc', '.cgi', '.pl', '.py', '.sh', '.jsp', '.asp', '.aspx']);
const ARCHIVE_EXT = new Set(['.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.rar', '.wpress']);
const DATA_EXT = new Set(['.csv', '.tsv', '.xlsx', '.xls', '.sql', '.sqlite', '.db']);
const LOG_EXT = new Set(['.log']);
const DIR_KIND = Object.freeze({
  uploads: 'uploads', logs: 'logs', log: 'logs', 'ai1wm-backups': 'backups', updraft: 'backups', backups: 'backups', backup: 'backups',
  wpvivid_backup: 'backups', 'backup-db': 'backups', 'backups-dup-lite': 'backups', 'backups-dup-pro': 'backups', cache: 'cache',
  upgrade: 'upgrade', 'upgrade-temp-backup': 'upgrade', plugins: null, themes: null, 'mu-plugins': null, languages: null, index: null,
});
const DEFAULT_LOGIN_NAMES = new Set(['admin', 'administrator', 'root', 'test', 'demo', 'user', 'wordpress', 'webmaster', 'support', 'manager', 'editor']);
const CREDENTIAL_KEY_RX = /(^|[_-])(pass(word|wd)?|secret|token|api[_-]?key|apikey|private[_-]?key|client[_-]?secret|auth[_-]?key|access[_-]?key|licen[cs]e[_-]?key|webhook[_-]?secret|app[_-]?secret|signing[_-]?key)([_-]|$)/i;
const CREDENTIAL_KEY_FALSE_RX = /(_timeout|_expires?|_updated|_last_|_checked|_hash$|_length$|_strength$|_policy|_reset_|_nonce|_salt$|_enabled$|_required$|_disabled$|_count$|_limit$|_attempts)/i;
const SECRET_SHAPE_RX = /https?:\/\/[^\s/:@]+:[^\s@/]+@|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKIA[0-9A-Z]{16}|sk_(live|test)_[0-9A-Za-z]{16,}|xox[abp]-[0-9A-Za-z-]{10,}|ghp_[0-9A-Za-z]{30,}/;
const LOG_CREDENTIAL_RX = /user_pass|\$P\$[A-Za-z0-9./]{20,}|\$wp\$2y\$|\$2[aby]\$1\d\$|["']?pass(word)?["']?\s*[:=]\s*["'][^"']{4,}|passwd=|user_activation_key/i;
const WP_CONFIG_NAMES = ['WP_DEBUG', 'WP_DEBUG_LOG', 'WP_DEBUG_DISPLAY', 'DISALLOW_FILE_EDIT', 'DISALLOW_FILE_MODS', 'AUTOMATIC_UPDATER_DISABLED', 'WP_AUTO_UPDATE_CORE', 'DISABLE_WP_CRON', 'FORCE_SSL_ADMIN', 'WP_ALLOW_REPAIR', 'SCRIPT_DEBUG', 'SAVEQUERIES', 'ALLOW_UNFILTERED_UPLOADS', 'WP_HTTP_BLOCK_EXTERNAL'];
const CONFIG_BACKUP_RX = /^(backup[._-])?wp-config([._-][^/]*)?\.(bak|old|orig|save|copy|txt|dist|php~|php\.\w+)$|^wp-config\.php\.\w+$|^backup[._-]wp-config\.php$/i;
const DB_DUMP_NAMES = /\.sql(\.gz)?$|-db\.gz$/i;
const FILE_CAP = 300000;
const SAMPLE_BYTES = 64 * 1024;
const SAMPLE_CAP = 5000;
const LIST_CAP = 100;

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
const ext = (name) => extname(name).toLowerCase();
const isoDay = (d) => (d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : null);
const days = (a, b) => Math.round((b - a) / 86400000);
function maxGapOf(sortedDates) {
  let best = { days: 0, from: null, to: null };
  for (let i = 1; i < sortedDates.length; i++) {
    const d = days(sortedDates[i - 1], sortedDates[i]);
    if (d > best.days) best = { days: d, from: isoDay(sortedDates[i - 1]), to: isoDay(sortedDates[i]) };
  }
  return best;
}
const parseMysqlDate = (s) => { const m = /^(\d{4})-(\d\d)-(\d\d)(?:[ T](\d\d):(\d\d):(\d\d))?/.exec(String(s || '')); if (!m || m[1] === '0000') return null; const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0))); return Number.isNaN(d.getTime()) ? null : d; };

function sampleHead(abs, bytes = SAMPLE_BYTES) {
  let fd;
  try {
    fd = openSync(abs, 'r');
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.toString('latin1', 0, n);
  } catch (e) { rethrowIfBug(e); return null; } finally { if (fd !== undefined) closeSync(fd); }
}

function fileKind(name) {
  const e = ext(name);
  if (CODE_EXT.has(e)) return 'code';
  if (/\.(php|phtml|phar)\.[a-z0-9]+$/i.test(name)) return 'code';
  if (ARCHIVE_EXT.has(e)) return 'archive';
  if (LOG_EXT.has(e)) return 'log';
  if (DATA_EXT.has(e)) return 'data';
  if (name === '.htaccess' || name === 'web.config' || name === '.user.ini' || name === 'php.ini') return 'control';
  return 'other';
}

/** php execution denied by this .htaccess text, as far as text can say. */
export function htaccessDeniesPhp(text) {
  const t = String(text || '');
  if (/php_flag\s+engine\s+off/i.test(t) || /php_admin_flag\s+engine\s+off/i.test(t)) return true;
  if (/RemoveHandler\s+[^\n]*\.php/i.test(t) || /RemoveType\s+[^\n]*\.php/i.test(t)) return true;
  if (/<Files(Match)?\s+[^>]*php[^>]*>[\s\S]*?(deny\s+from\s+all|Require\s+all\s+denied)[\s\S]*?<\/Files(Match)?>/i.test(t)) return true;
  if (/^\s*(deny\s+from\s+all|Require\s+all\s+denied)\s*$/im.test(t) && !/<Files/i.test(t)) return true;
  if (/SetHandler\s+default-handler/i.test(t) || /ForceType\s+text\/plain/i.test(t)) return true;
  return false;
}

/** every request to the directory refused, as far as text can say: a deny outside any <Files> scope. */
export function htaccessDeniesRead(text) {
  const t = String(text || '').replace(/<Files(Match)?[\s\S]*?<\/Files(Match)?>/gi, '');
  return /^\s*(deny\s+from\s+all|Require\s+all\s+denied)\s*$/im.test(t);
}

function readHtaccess(abs) {
  try { return readFileSync(abs, 'latin1'); } catch (e) { return e.code === 'ENOENT' ? null : { unreadable: e.code || e.message }; }
}

/** The defines wp-config.php states, as name -> true|false|number|'string'|'expr'. Values of secrets are never kept. */
export function parseWpConfig(text) {
  const out = { defines: {}, tablePrefix: null };
  const rx = /define\s*\(\s*['"]([A-Z0-9_]+)['"]\s*,\s*([^)]*?)\s*\)/g;
  let m;
  while ((m = rx.exec(text))) {
    const name = m[1];
    const raw = m[2].trim();
    let value;
    if (/^true$/i.test(raw)) value = true;
    else if (/^false$/i.test(raw)) value = false;
    else if (/^-?\d+(\.\d+)?$/.test(raw)) value = Number(raw);
    else if (/^(['"]).*\1$/s.test(raw)) value = 'string';
    else value = 'expr';
    out.defines[name] = value;
  }
  const p = /\$table_prefix\s*=\s*['"]([A-Za-z0-9_$]+)['"]/.exec(text);
  if (p) out.tablePrefix = p[1];
  return out;
}

function classify(slug, name, classes) {
  const out = [];
  for (const [cls, spec] of Object.entries(classes || {})) {
    if ((spec.slugs || []).includes(slug)) { out.push(cls); continue; }
    if (spec.nameRegex && name && new RegExp(spec.nameRegex, 'i').test(name)) out.push(cls);
  }
  return out.sort();
}

function walkServedDir(root, dirAbs, { budget, out, sampleLogs }) {
  const counts = { files: 0, code: 0, archive: 0, data: 0, log: 0, control: 0, other: 0, logsSampled: 0, logsWithCredentialShape: 0 };
  const samples = { code: [], archive: [], data: [], log: [] };
  let unreadable = 0;
  const visit = (abs, depth) => {
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }).sort(byName); } catch (e) { rethrowIfBug(e); unreadable++; return; }
    for (const e of entries) {
      if (budget.files >= FILE_CAP) { budget.exhausted = true; return; }
      const child = join(abs, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) { if (depth < 24) visit(child, depth + 1); continue; }
      if (!e.isFile()) continue;
      budget.files++;
      counts.files++;
      const kind = fileKind(e.name);
      counts[kind]++;
      const rel = relPath(root, child);
      if (kind === 'code' && e.name === 'index.php' && depth === 0) continue;
      if (kind === 'code' || kind === 'archive' || kind === 'data') {
        if (samples[kind].length < LIST_CAP) samples[kind].push(rel);
      }
      if ((kind === 'log' || (sampleLogs && (kind === 'other' || kind === 'data'))) && counts.logsSampled < SAMPLE_CAP) {
        counts.logsSampled++;
        const head = sampleHead(child);
        const credentialShape = head !== null && LOG_CREDENTIAL_RX.test(head);
        if (credentialShape) counts.logsWithCredentialShape++;
        const debugLog = /^debug[^/]*\.log$/i.test(e.name);
        if ((credentialShape || debugLog || kind === 'log') && samples.log.length < LIST_CAP) {
          let st = null;
          try { st = statSync(child); } catch (e) { rethrowIfBug(e); unreadable++; }
          out.push({ type: 'file', path: rel, kind: kind === 'log' ? 'log' : kind, name: e.name, bytes: st ? st.size : null, mtime: st ? st.mtime.toISOString() : null, credentialShape, sampled: head !== null, debugLog });
          samples.log.push(rel);
        }
      }
    }
  };
  visit(dirAbs, 0);
  return { counts, samples, unreadable };
}

/** Observables from the tree alone. */
export function collectTree(root, { skip = new Set(), maxDepth = 4, classes = {} } = {}) {
  const out = [];
  const measured = new Set();
  const unmeasured = [];
  const partial = [];
  const found = findInstalls(root, { skip, maxDepth });
  const budget = { files: 0, exhausted: false };
  const installs = [];
  for (const inst of found.installs) {
    measured.add('wp-install');
    const install = { type: 'wp-install', path: inst.path, layout: inst.layout, core: inst.core.state, coreVersion: inst.core.version, contentPath: inst.contentPath };
    out.push(install);
    installs.push(install);
    const rel = (abs) => relPath(root, abs);

    if (inst.core.state === 'present') out.push({ type: 'wp-component', kind: 'core', slug: 'wordpress', name: 'WordPress', version: inst.core.version, state: 'present', classes: [], path: inst.path, install: inst.path });

    if (inst.layout === 'site-root') {
      measured.add('server-directive');
      const cfgAbs = join(inst.abs, 'wp-config.php');
      let cfgText = null;
      try { cfgText = readFileSync(cfgAbs, 'latin1'); } catch (e) { if (e.code !== 'ENOENT') partial.push(`${rel(cfgAbs)} unreadable: ${e.code || e.message}`); }
      if (cfgText !== null) {
        const cfg = parseWpConfig(cfgText);
        out.push({ type: 'server-directive', scope: 'wp-config', path: rel(cfgAbs), name: 'present', value: true, install: inst.path });
        for (const n of WP_CONFIG_NAMES) if (n in cfg.defines) out.push({ type: 'server-directive', scope: 'wp-config', path: rel(cfgAbs), name: n, value: cfg.defines[n], install: inst.path });
        if (cfg.tablePrefix) { measured.add('wp-setting'); out.push({ type: 'wp-setting', key: 'table_prefix_default', value: cfg.tablePrefix === 'wp_', install: inst.path, path: rel(cfgAbs), from: 'wp-config' }); }
      }
      let rootEntries = [];
      try { rootEntries = readdirSync(inst.abs, { withFileTypes: true }).sort(byName); } catch (e) { partial.push(`${inst.path} unreadable: ${e.code || e.message}`); }
      for (const e of rootEntries) {
        if (!e.isFile()) continue;
        if (CONFIG_BACKUP_RX.test(e.name) && e.name !== 'wp-config-sample.php') out.push({ type: 'file', path: rel(join(inst.abs, e.name)), kind: 'config-backup', name: e.name, install: inst.path });
        if (e.name === '.htaccess') {
          const t = readHtaccess(join(inst.abs, e.name));
          if (t && typeof t === 'string') {
            out.push({ type: 'server-directive', scope: 'htaccess', path: rel(join(inst.abs, e.name)), name: 'present', value: true, install: inst.path, location: 'site-root' });
            out.push({ type: 'server-directive', scope: 'htaccess', path: rel(join(inst.abs, e.name)), name: 'directory-listing-off', value: /Options\s+[^\n]*-Indexes/i.test(t), install: inst.path, location: 'site-root' });
          }
        }
        if (DB_DUMP_NAMES.test(e.name) || ARCHIVE_EXT.has(ext(e.name))) out.push({ type: 'file', path: rel(join(inst.abs, e.name)), kind: DB_DUMP_NAMES.test(e.name) ? 'data' : 'archive', name: e.name, install: inst.path, servedRoot: true });
      }
    } else {
      unmeasured.push({ type: 'server-directive', why: `${inst.path}: wp-content-only tree, wp-config.php and the site root .htaccess are not in it` });
    }

    if (!inst.contentAbs) { partial.push(`${inst.path}: wp-content absent or a symlink; components and served directories not read`); continue; }
    measured.add('wp-component');
    measured.add('served-dir');
    measured.add('file');
    const inv = inventory(inst.contentAbs);
    for (const u of inv.unreadable) partial.push(`${rel(u.path)}: ${u.why}`);
    for (const p of inv.plugins) {
      const name = p.name || null;
      out.push({ type: 'wp-component', kind: 'plugin', slug: p.slug, name, version: p.version || null, main: p.main || null, state: 'unknown', classes: classify(p.slug, name, classes), path: rel(p.abs), install: inst.path, hidden: !!p.hidden, symlink: !!p.symlink });
    }
    for (const t of inv.themes) out.push({ type: 'wp-component', kind: 'theme', slug: t.slug, name: t.name, version: t.version, state: 'unknown', classes: classify(t.slug, t.name, classes), path: rel(t.abs), install: inst.path });
    for (const m of inv.muPlugins) {
      const cls = classify(m.name, m.name, classes);
      if (!m.dir) { const head = readHead(m.abs); if (/DOING_CRON|wp-cron|action_scheduler/i.test(head)) cls.push('cron-control'); }
      out.push({ type: 'wp-component', kind: 'mu-plugin', slug: m.name, name: m.name, version: null, state: 'active', classes: cls.sort(), path: rel(m.abs), install: inst.path });
    }

    let contentEntries = [];
    try { contentEntries = readdirSync(inst.contentAbs, { withFileTypes: true }).sort(byName); } catch (e) { partial.push(`${inst.contentPath}: ${e.code || e.message}`); }
    const contentHt = readHtaccess(join(inst.contentAbs, '.htaccess'));
    if (typeof contentHt === 'string') out.push({ type: 'server-directive', scope: 'htaccess', path: rel(join(inst.contentAbs, '.htaccess')), name: 'php-denied', value: htaccessDeniesPhp(contentHt), install: inst.path, location: 'wp-content' });
    for (const e of contentEntries) {
      if (e.isFile()) {
        const k = fileKind(e.name);
        if (e.name === 'debug.log' || k === 'log') {
          const abs = join(inst.contentAbs, e.name);
          let st = null; try { st = statSync(abs); } catch (e) { rethrowIfBug(e); }
          const head = sampleHead(abs);
          out.push({ type: 'file', path: rel(abs), kind: 'log', name: e.name, bytes: st ? st.size : null, mtime: st ? st.mtime.toISOString() : null, credentialShape: head !== null && LOG_CREDENTIAL_RX.test(head), sampled: head !== null, install: inst.path, debugLog: /^debug[^/]*\.log$/i.test(e.name) });
        } else if (k === 'archive' || DB_DUMP_NAMES.test(e.name)) {
          out.push({ type: 'file', path: rel(join(inst.contentAbs, e.name)), kind: k === 'archive' ? 'archive' : 'data', name: e.name, install: inst.path });
        }
        continue;
      }
      if (!e.isDirectory()) continue;
      const kindOf = e.name in DIR_KIND ? DIR_KIND[e.name] : 'other';
      if (kindOf === null) continue;
      const dirAbs = join(inst.contentAbs, e.name);
      const ht = readHtaccess(join(dirAbs, '.htaccess'));
      const guardHtaccess = typeof ht === 'string';
      const phpDenied = guardHtaccess ? htaccessDeniesPhp(ht) : false;
      const readDenied = guardHtaccess ? htaccessDeniesRead(ht) : false;
      const guardIndex = existsSync(join(dirAbs, 'index.php')) || existsSync(join(dirAbs, 'index.html'));
      const walked = walkServedDir(root, dirAbs, { budget, out, sampleLogs: kindOf === 'logs' || kindOf === 'other' });
      if (walked.unreadable) partial.push(`${rel(dirAbs)}: ${walked.unreadable} entr(ies) unreadable`);
      out.push({
        type: 'served-dir', path: rel(dirAbs), name: e.name, kind: kindOf, install: inst.path, guardIndex, guardHtaccess, phpDenied, readDenied,
        fileCount: walked.counts.files, codeFiles: walked.counts.code, archiveFiles: walked.counts.archive, dataFiles: walked.counts.data, logFiles: walked.counts.log,
        logsSampled: walked.counts.logsSampled, logsWithCredentialShape: walked.counts.logsWithCredentialShape,
        codeSample: walked.samples.code, archiveSample: walked.samples.archive, dataSample: walked.samples.data,
      });
      if (guardHtaccess) out.push({ type: 'server-directive', scope: 'htaccess', path: rel(join(dirAbs, '.htaccess')), name: 'php-denied', value: phpDenied, install: inst.path, location: kindOf, dir: e.name });
      if (kindOf === 'logs' || kindOf === 'other') {
        const dated = [];
        try {
          for (const f of readdirSync(dirAbs)) { const m = /^(\d{4})[_-]?(\d{2})[_-]?(\d{2})/.exec(f); if (m) { const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])); if (!Number.isNaN(d.getTime())) dated.push(d); } }
        } catch (e) { rethrowIfBug(e); }
        if (dated.length >= 5) {
          dated.sort((a, b) => a - b);
          const gap = maxGapOf(dated);
          measured.add('audit-source');
          out.push({ type: 'audit-source', name: `${rel(dirAbs)} dated files`, kind: 'files', present: true, rows: dated.length, from: isoDay(dated[0]), to: isoDay(dated[dated.length - 1]), spanDays: days(dated[0], dated[dated.length - 1]), maxGapDays: gap.days, gapFrom: gap.from, gapTo: gap.to, retentionLimited: false, install: inst.path, path: rel(dirAbs) });
        }
      }
    }
  }
  if (budget.exhausted) partial.push(`served-directory walk stopped at ${FILE_CAP} files; counts beyond it are not known`);
  if (!found.installs.length) unmeasured.push(...TYPES.map((type) => ({ type, why: 'no WordPress install in the tree' })));
  for (const t of ['wp-option', 'wp-user']) if (!measured.has(t)) unmeasured.push({ type: t, why: 'needs a database dump' });
  if (!measured.has('audit-source')) unmeasured.push({ type: 'audit-source', why: 'needs a database dump or a dated log directory' });
  if (found.installs.length && !measured.has('wp-setting')) unmeasured.push({ type: 'wp-setting', why: 'needs a database dump or wp-config.php' });
  return { observables: out, measured, unmeasured, partial, installs, skippedPaths: found.skippedPaths, unreadable: found.unreadable };
}

function valueClassOf(key, value) {
  const v = value == null ? '' : String(value);
  if (v === '' || v === 'a:0:{}' || v === 'N;') return 'empty';
  // ACF writes `_options_<name>` = `field_<id>`: a pointer to the field definition, never the value
  if (/^field_[0-9a-f]{6,}$/i.test(v)) return 'reference';
  const keyLooksSecret = CREDENTIAL_KEY_RX.test(key) && !CREDENTIAL_KEY_FALSE_RX.test(key);
  if (SECRET_SHAPE_RX.test(v)) return 'credential';
  if (/^(a|O):\d+:\{/.test(v) || /^s:\d+:"/.test(v)) {
    const parsed = tryUnserialize(v, null);
    if (parsed && typeof parsed === 'object' && holdsCredential(parsed, 0)) return 'credential';
    return keyLooksSecret && v !== 'a:0:{}' ? 'credential' : 'serialized';
  }
  if (keyLooksSecret) return 'credential';
  if (/^https?:\/\//i.test(v)) return 'url';
  return 'plain';
}
function holdsCredential(obj, depth) {
  if (depth > 6 || !obj || typeof obj !== 'object') return false;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === 'string' && v.length >= 4 && CREDENTIAL_KEY_RX.test(String(k)) && !CREDENTIAL_KEY_FALSE_RX.test(String(k))) return true;
    if (typeof v === 'string' && SECRET_SHAPE_RX.test(v)) return true;
    if (v && typeof v === 'object' && holdsCredential(v, depth + 1)) return true;
  }
  return false;
}
const schemeOf = (hash) => { const h = String(hash || ''); if (h === '') return 'none'; if (h.startsWith('$wp$2y$')) return 'bcrypt'; if (h.startsWith('$P$') || h.startsWith('$H$')) return 'phpass'; if (/^\$2[aby]\$/.test(h)) return 'bcrypt-plain'; if (/^[a-f0-9]{32}$/i.test(h)) return 'md5'; return 'other'; };

/** Observables from a dump, joined to the tree's components. Mutates component rows' `state`. */
export async function collectDump(dbPath, tree, { classes = {}, now = null } = {}) {
  const out = [];
  const measured = new Set();
  const partial = [];
  const dump = await readDump(dbPath);
  partial.push(...dump.partial);
  const install = tree.installs[0]?.path || '.';
  const source = { path: dbPath, bytes: dump.bytes, gzip: dump.gzip, prefix: dump.prefix, tables: dump.tableNames.length, statements: dump.statements };
  if (!dump.prefix) { partial.push(`${dbPath}: no WordPress options and users tables found`); return { observables: out, measured, partial, source }; }
  const prefix = dump.prefix;
  const has = (suffix) => dump.tableNames.includes(prefix + suffix);

  measured.add('wp-setting');
  out.push({ type: 'wp-setting', key: 'table_prefix_default', value: prefix === 'wp_', install, path: 'db', from: 'dump' });
  const options = new Map();
  for (const row of dump.rows.options) { if (row.length >= 3) options.set(String(row[1]), { value: row[2], autoload: String(row[3] ?? '') }); }
  measured.add('wp-option');
  let transients = 0;
  for (const [key, { value, autoload }] of options) {
    if (/^_?(site_)?transient_/.test(key)) { transients++; continue; }
    const ns = /^_?options_/.test(key) ? 'acf' : /^(siteurl|home|blogname|admin_email|users_can_register|default_role|active_plugins|template|stylesheet|db_version|cron|auto_update_)/.test(key) ? 'core' : 'plugin';
    out.push({ type: 'wp-option', key, autoload: /^(yes|on|auto-on|auto)$/.test(autoload), valueClass: valueClassOf(key, value), hasValue: value != null && String(value) !== '', namespace: ns, install, path: `db/options/${key}` });
  }
  const setting = (key, value, extra = {}) => out.push({ type: 'wp-setting', key, value, install, path: `db/options/${key}`, from: 'dump', ...extra });
  const opt = (k) => (options.has(k) ? String(options.get(k).value ?? '') : null);
  for (const k of ['users_can_register', 'default_role', 'blog_public', 'auto_update_core_dev', 'auto_update_core_minor', 'auto_update_core_major', 'template', 'stylesheet', 'db_version']) if (opt(k) !== null) setting(k, opt(k));
  for (const k of ['siteurl', 'home']) { const v = opt(k); if (v !== null) setting(`${k}_scheme`, /^https:/i.test(v) ? 'https' : /^http:/i.test(v) ? 'http' : 'other'); }
  const adminEmail = opt('admin_email'); if (adminEmail) setting('admin_email_domain', adminEmail.split('@')[1] || null);
  const active = stringList(opt('active_plugins') || '') || [];
  const autoUpdate = new Set(stringList(opt('auto_update_plugins') || '') || []);
  setting('active_plugins_count', active.length);
  setting('auto_update_plugins_count', autoUpdate.size);
  const cron = tryUnserialize(opt('cron') || '', null);
  if (cron && typeof cron === 'object') setting('cron_events_count', Object.keys(cron).filter((k) => /^\d+$/.test(k)).length);
  setting('transients_count', transients);

  const onDisk = new Map();
  for (const c of tree.observables) if (c.type === 'wp-component' && c.kind === 'plugin') onDisk.set(c.slug, c);
  const activeSlugs = new Set();
  for (const entry of active) {
    const slug = entry.includes('/') ? entry.split('/')[0] : entry.replace(/\.php$/, '');
    activeSlugs.add(slug);
    const c = onDisk.get(slug);
    if (c) { c.state = 'active'; c.autoUpdate = autoUpdate.has(entry); }
    else out.push({ type: 'wp-component', kind: 'plugin', slug, name: null, version: null, state: 'phantom', classes: classify(slug, null, classes), path: `wp-content/plugins/${entry}`, install, autoUpdate: autoUpdate.has(entry) });
  }
  for (const c of onDisk.values()) if (c.state === 'unknown') { c.state = 'inactive'; c.autoUpdate = false; }
  const stylesheet = opt('stylesheet'); const template = opt('template');
  for (const c of tree.observables) if (c.type === 'wp-component' && c.kind === 'theme') c.state = c.slug === stylesheet || c.slug === template ? 'active' : 'inactive';

  if (has('users')) {
    measured.add('wp-user');
    const caps = new Map();
    for (const row of dump.rows.usermeta) {
      if (String(row[2]) !== `${prefix}capabilities`) continue;
      const parsed = tryUnserialize(String(row[3] ?? ''), null);
      caps.set(Number(row[1]), parsed && typeof parsed === 'object' ? Object.keys(parsed).filter((k) => parsed[k]).sort() : []);
    }
    let oldest = null;
    for (const row of dump.rows.users) {
      const id = Number(row[0]);
      const login = String(row[1] ?? '');
      const email = String(row[4] ?? '');
      const registered = parseMysqlDate(row[6]);
      if (registered && (!oldest || registered < oldest)) oldest = registered;
      const roles = caps.get(id) || [];
      const isDefault = DEFAULT_LOGIN_NAMES.has(login.toLowerCase());
      out.push({
        type: 'wp-user', path: `db/users/${id}`, id, login: isDefault ? login : null, loginIsDefault: isDefault, loginLooksEmail: login.includes('@'),
        roles, admin: roles.includes('administrator'), registered: registered ? registered.toISOString() : null,
        emailDomain: email.includes('@') ? email.split('@')[1].toLowerCase() : null, passwordScheme: schemeOf(row[2]), install,
      });
    }
    tree.siteStart = oldest;
  }

  const stamps = [];
  const auditRows = [];
  const addAudit = (name, present, dates, { rows = dates.length, retentionLimited = false } = {}) => {
    const ds = dates.filter(Boolean).sort((a, b) => a - b);
    const gap = maxGapOf(ds);
    for (const d of ds) stamps.push(d);
    auditRows.push({ type: 'audit-source', name, kind: 'table', present, rows, from: isoDay(ds[0]), to: isoDay(ds[ds.length - 1]), spanDays: ds.length ? days(ds[0], ds[ds.length - 1]) : null, maxGapDays: ds.length > 1 ? gap.days : null, gapFrom: gap.from, gapTo: gap.to, retentionLimited, install, path: `db/${name}` });
  };
  measured.add('audit-source');
  if (has('simple_history')) {
    const rows = dump.rows.simple_history;
    let minId = Infinity;
    for (const r of rows) { const id = Number(r[0]); if (Number.isFinite(id) && id < minId) minId = id; }
    addAudit('simple_history', true, rows.map((r) => parseMysqlDate(r[1])), { retentionLimited: minId !== Infinity && minId > 1 });
  } else auditRows.push({ type: 'audit-source', name: 'simple_history', kind: 'table', present: false, rows: 0, install, path: 'db/simple_history' });
  if (has('aiowps_audit_log')) addAudit('aiowps_audit_log', true, dump.rows.aiowps_audit_log.map((r) => (Number.isFinite(Number(r[9])) && Number(r[9]) > 0 ? new Date(Number(r[9]) * 1000) : null)));
  else auditRows.push({ type: 'audit-source', name: 'aiowps_audit_log', kind: 'table', present: false, rows: 0, install, path: 'db/aiowps_audit_log' });
  if (has('login_limit_fails')) {
    const rows = dump.rows.login_limit_fails;
    addAudit('login_limit_fails', true, rows.map((r) => parseMysqlDate(r[2])));
    const last = auditRows[auditRows.length - 1];
    last.realAccountFails = rows.filter((r) => Number(r[1]) > 0).length;
  }
  let newest = null;
  for (const d of stamps) if (!newest || d > newest) newest = d;
  const asOf = now || newest;
  for (const a of auditRows) {
    a.asOf = isoDay(asOf);
    a.siteAgeDays = asOf && tree.siteStart ? days(tree.siteStart, asOf) : null;
    out.push(a);
  }
  for (const a of tree.observables) if (a.type === 'audit-source') { a.asOf = isoDay(asOf); a.siteAgeDays = asOf && tree.siteStart ? days(tree.siteStart, asOf) : null; }
  return { observables: out, measured, partial, source };
}

/** A database dump beside the tree, if one is there: the largest of the usual names, root and one level down. */
export function findDump(root) {
  const candidates = [];
  const consider = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch (e) { rethrowIfBug(e); return; }
    for (const e of entries) {
      if (e.isFile() && DB_DUMP_NAMES.test(e.name)) { try { candidates.push({ path: join(dir, e.name), bytes: statSync(join(dir, e.name)).size }); } catch (e) { rethrowIfBug(e); } }
    }
  };
  consider(root);
  let entries = [];
  try { entries = readdirSync(root, { withFileTypes: true }); } catch (e) { rethrowIfBug(e); return null; }
  for (const e of entries) if (e.isDirectory() && !['wp-content', 'wp-admin', 'wp-includes', 'node_modules', '.git'].includes(e.name)) consider(join(root, e.name));
  if (!candidates.length) return null;
  candidates.sort((a, b) => b.bytes - a.bytes || (a.path < b.path ? -1 : 1));
  return candidates[0].path;
}

/** The whole corpus: tree, then dump when there is one. */
export async function collectObservables(root, { dbPath = undefined, skip, maxDepth, classes, now } = {}) {
  const tree = collectTree(resolve(root), { skip, maxDepth, classes });
  const db = dbPath === null ? null : dbPath || findDump(resolve(root));
  const result = { observables: tree.observables, measured: new Set(tree.measured), unmeasured: [...tree.unmeasured], partial: [...tree.partial], installs: tree.installs, sources: { tree: resolve(root), db: null }, skippedPaths: tree.skippedPaths };
  if (!db || !tree.installs.length) {
    if (db && !tree.installs.length) result.partial.push(`${db} not read: no WordPress install in the tree to join it to`);
    return finish(result);
  }
  try {
    const d = await collectDump(db, tree, { classes, now });
    for (const o of d.observables) result.observables.push(o);
    for (const t of d.measured) result.measured.add(t);
    result.partial.push(...d.partial);
    result.sources.db = d.source;
    // the dump the scan joined may have been placed beside the tree for scanning; it is marked, and
    // the served-tree predicates leave it out, because the reader can see it in sources.db instead
    const dbAbs = resolve(db);
    for (const o of result.observables) if (o.type === 'file' && resolve(result.sources.tree, o.path) === dbAbs) { o.joinedDump = true; result.sources.db.inTree = o.path; }
  } catch (e) {
    result.partial.push(`${db}: could not be read: ${e.code || e.message}`);
    result.sources.db = { path: db, error: e.code || e.message };
  }
  return finish(result);
}

function finish(result) {
  result.unmeasured = result.unmeasured.filter((u) => !result.measured.has(u.type));
  const seen = new Set();
  result.unmeasured = result.unmeasured.filter((u) => { const k = `${u.type}|${u.why}`; if (seen.has(k)) return false; seen.add(k); return true; });
  return result;
}
