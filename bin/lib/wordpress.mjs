// What a WordPress tree holds, read the way WordPress itself reads it. Shared by bin/wp-integrity.mjs
// and bin/wp-advisories.mjs, which ask two different questions of the same inventory: is each
// component the code wordpress.org shipped, and does a published advisory name its version.
//
// WordPress is the one platform commitwork reads specifically, because it runs a large share of the
// web and its plugin layout is fixed: wp-content/plugins/<slug>/ holds one plugin, the plugin's main
// file is whichever PHP file directly in that directory carries a `Plugin Name:` header, and its
// version is that file's `Version:` header. Everything here follows wp-admin/includes/plugin.php
// (get_plugins, get_plugin_data) and wp-includes/functions.php (get_file_data): the first 8 KiB, CR
// folded to LF, the header regex WordPress uses and its comment cleanup. A reader that disagreed
// with WordPress about which file is the plugin would verify a file WordPress never loads.
//
// Nothing here touches the network and nothing reports a file's contents: header VALUES (a name, a
// version) are read because they are how WordPress and wordpress.org identify a component.
import { readdirSync, lstatSync, openSync, readSync, closeSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, basename } from 'node:path';
import { wordpressCoreVersion, wordpressLayout } from './webroot.mjs';

export const HEADER_BYTES = 8 * 1024;
const CHUNK = 1024 * 1024;

const stat = (p) => { try { return lstatSync(p); } catch { return null; } };
const isDir = (p) => { const s = stat(p); return !!s && s.isDirectory(); };
const isFile = (p) => { const s = stat(p); return !!s && s.isFile(); };
export const relPath = (root, abs) => relative(root, abs).split('\\').join('/') || '.';
const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

// A slug or version becomes a URL path segment and a cache file name, so anything beyond the shapes
// wordpress.org itself uses is refused rather than escaped: a hostile tree names its own directories.
export const SLUG_RX = /^[a-z0-9][a-z0-9._-]{0,127}$/i;
export const VERSION_RX = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/;
export const LOCALE_RX = /^[a-z]{2,3}(_[A-Z]{2})?(_[a-z0-9]+)?$/;

/** The first `bytes` of a file as text; throws on a read error (the caller decides what it means). */
export function readHead(abs, bytes = HEADER_BYTES) {
  const fd = openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = readSync(fd, buf, 0, bytes, 0);
    return buf.toString('utf8', 0, n);
  } finally {
    closeSync(fd);
  }
}

const quote = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// get_file_data's regex and _cleanup_header_comment, unchanged in meaning.
export function headersFrom(text, names) {
  const t = text.replace(/\r/g, '\n');
  const out = {};
  for (const name of names) {
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- name passes through quote(), which escapes every regex metacharacter
    const m = new RegExp(`^(?:[ \\t]*<\\?php)?[ \\t/*#@]*${quote(name)}:(.*)$`, 'mi').exec(t);
    out[name] = m ? m[1].replace(/\s*(?:\*\/|\?>).*/, '').trim() : '';
  }
  return out;
}

/** A header value fit for a report: printable, single-line, capped. Never a file's contents beyond it. */
export const cleanHeader = (s, cap = 80) => String(s || '').replace(/[^\x20-\x7e]/g, '').slice(0, cap);

// ── PHP version_compare ──────────────────────────────────────────────────────────────────────────
// Advisory ranges are written for PHP's version_compare (the WPVulnerability plugin evaluates them
// with it), so they are evaluated with the same algorithm (ext/standard/versioning.c): every
// non-alphanumeric becomes `.`, a `.` is inserted where digits meet letters, and word parts order
// dev < alpha=a < beta=b < RC=rc < (number) < pl=p, with any other word below dev. A naive
// split-and-compare puts 1.0rc1 above 1.0, which PHP does not.
const SPECIAL = [['dev', 0], ['alpha', 1], ['a', 1], ['beta', 2], ['b', 2], ['RC', 3], ['rc', 3], ['#', 4], ['pl', 5], ['p', 5]];
const special = (s) => { for (const [name, order] of SPECIAL) if (s.startsWith(name)) return order; return -1; };
const isDigits = (s) => /^\d+$/.test(s);

export function canonVersion(v) {
  let out = '';
  let prev = '';
  for (const c of String(v)) {
    if (!/[0-9A-Za-z]/.test(c)) { if (out && !out.endsWith('.')) out += '.'; prev = '.'; continue; }
    const kind = /\d/.test(c) ? 'd' : 'w';
    if (prev && prev !== '.' && prev !== kind) out += '.';
    out += c;
    prev = kind;
  }
  return out.split('.').filter(Boolean);
}

function comparePart(a, b) {
  if (isDigits(a) && isDigits(b)) { const x = BigInt(a); const y = BigInt(b); return x < y ? -1 : x > y ? 1 : 0; }
  const x = isDigits(a) ? 4 : special(a);
  const y = isDigits(b) ? 4 : special(b);
  return Math.sign(x - y);
}

/** PHP version_compare(a, b): -1, 0 or 1. */
export function versionCompare(a, b) {
  const p = canonVersion(a);
  const q = canonVersion(b);
  const n = Math.min(p.length, q.length);
  for (let i = 0; i < n; i++) { const c = comparePart(p[i], q[i]); if (c) return c; }
  if (p.length > n) return isDigits(p[n]) ? 1 : comparePart(p[n], '#');
  if (q.length > n) return isDigits(q[n]) ? -1 : comparePart('#', q[n]);
  return 0;
}

const OPS = {
  lt: (c) => c < 0, '<': (c) => c < 0, le: (c) => c <= 0, '<=': (c) => c <= 0,
  gt: (c) => c > 0, '>': (c) => c > 0, ge: (c) => c >= 0, '>=': (c) => c >= 0,
  eq: (c) => c === 0, '==': (c) => c === 0, ne: (c) => c !== 0, '!=': (c) => c !== 0, '<>': (c) => c !== 0,
};
/** version_compare(a, b, op); null for an operator PHP does not know, so a caller never guesses. */
export function versionSatisfies(a, op, b) {
  const f = OPS[String(op)];
  return f ? f(versionCompare(a, b)) : null;
}

// ── HASHING ──────────────────────────────────────────────────────────────────────────────────────
/** md5 and sha256 of a file, read in chunks so a large asset is never held whole. */
export function hashFile(abs) {
  const md5 = createHash('md5');
  const sha256 = createHash('sha256');
  const fd = openSync(abs, 'r');
  try {
    const buf = Buffer.alloc(CHUNK);
    for (;;) {
      const n = readSync(fd, buf, 0, CHUNK, null);
      if (n <= 0) break;
      md5.update(buf.subarray(0, n));
      sha256.update(buf.subarray(0, n));
    }
  } finally {
    closeSync(fd);
  }
  return { md5: md5.digest('hex'), sha256: sha256.digest('hex') };
}

// ── THE INVENTORY ────────────────────────────────────────────────────────────────────────────────
/** version.php's $wp_version and $wp_local_package (the locale a localized build was packaged for). */
export function coreOf(siteAbs) {
  const v = wordpressCoreVersion(siteAbs);
  if (v === null) return { state: 'absent', version: null, locale: null };
  if (v.unreadable) return { state: 'unreadable', version: null, locale: null, reason: v.unreadable };
  let locale = 'en_US';
  try {
    const m = /\$wp_local_package\s*=\s*['"]([^'"]+)['"]/.exec(readFileSync(join(siteAbs, 'wp-includes', 'version.php'), 'utf8'));
    if (m) locale = m[1];
  } catch { /* the version was just read from this file; a second read failing leaves the default */ }
  return { state: 'present', version: v.version, locale };
}

/** The plugin's main file the way get_plugins finds it: PHP files directly in the directory, the
 *  ones with a Plugin Name header; `<slug>.php` when several qualify, else the first by name. */
export function pluginMain(dirAbs, slug) {
  let entries;
  try { entries = readdirSync(dirAbs, { withFileTypes: true }); } catch (e) { return { error: `readdir failed: ${e.code || e.message}` }; }
  const mains = [];
  const unreadable = [];
  for (const e of entries.sort(byName)) {
    if (e.name.startsWith('.') || !e.name.endsWith('.php') || !e.isFile()) continue;
    let h;
    try { h = headersFrom(readHead(join(dirAbs, e.name)), ['Plugin Name', 'Version']); } catch (err) { unreadable.push(`${e.name}: ${err.code || err.message}`); continue; }
    if (h['Plugin Name']) mains.push({ file: e.name, name: h['Plugin Name'], version: h.Version || null });
  }
  if (!mains.length) return { main: null, unreadable };
  const pick = mains.find((m) => m.file === `${slug}.php`) || mains[0];
  return { main: pick.file, name: pick.name, version: pick.version, mains: mains.map((m) => m.file), unreadable };
}

/** Every component under one wp-content directory. Nothing is judged here; the lanes judge. */
export function inventory(contentAbs) {
  const out = { plugins: [], rootFiles: [], themes: [], muPlugins: [], unreadable: [] };
  const list = (dir) => {
    try { return readdirSync(dir, { withFileTypes: true }).sort(byName); } catch (e) {
      if (e.code !== 'ENOENT') out.unreadable.push({ path: dir, why: `readdir failed: ${e.code || e.message}` });
      return [];
    }
  };
  const pluginsAbs = join(contentAbs, 'plugins');
  for (const e of list(pluginsAbs)) {
    const abs = join(pluginsAbs, e.name);
    const st = stat(abs);
    if (!st) { out.unreadable.push({ path: abs, why: 'lstat failed' }); continue; }
    if (st.isSymbolicLink()) { out.plugins.push({ slug: e.name, abs, symlink: true }); continue; }
    if (st.isDirectory()) {
      if (e.name.startsWith('.')) { out.plugins.push({ slug: e.name, abs, hidden: true }); continue; }
      out.plugins.push({ slug: e.name, abs, ...pluginMain(abs, e.name) });
      continue;
    }
    if (!st.isFile()) continue;
    let pluginName = '';
    let version = '';
    if (e.name.endsWith('.php') && !e.name.startsWith('.')) {
      try { const h = headersFrom(readHead(abs), ['Plugin Name', 'Version']); pluginName = h['Plugin Name']; version = h.Version; } catch (err) {
        out.unreadable.push({ path: abs, why: `read failed: ${err.code || err.message}` });
      }
    }
    out.rootFiles.push({ name: e.name, abs, pluginName, version, mode: st.mode });
  }
  const themesAbs = join(contentAbs, 'themes');
  for (const e of list(themesAbs)) {
    const abs = join(themesAbs, e.name);
    const st = stat(abs);
    if (!st || !st.isDirectory() || st.isSymbolicLink() || e.name.startsWith('.')) continue;
    let h = { 'Theme Name': '', Version: '' };
    let unreadable = null;
    try { h = headersFrom(readHead(join(abs, 'style.css')), ['Theme Name', 'Version']); } catch (err) {
      if (err.code !== 'ENOENT') unreadable = `style.css: ${err.code || err.message}`;
    }
    out.themes.push({ slug: e.name, abs, name: h['Theme Name'] || null, version: h.Version || null, ...(unreadable ? { unreadable } : {}) });
  }
  for (const e of list(join(contentAbs, 'mu-plugins'))) {
    if (e.name === 'index.php' || e.name.startsWith('.')) continue;
    out.muPlugins.push({ name: e.name, abs: join(contentAbs, 'mu-plugins', e.name), dir: e.isDirectory() });
  }
  return out;
}

// A wp-content found BELOW the scan root counts only when it holds something WordPress would load —
// a plugin or theme with its header — because a directory that merely has the name is not a site.
// (The scan root itself is taken on wordpressLayout's word: it was named as the target.)
function holdsComponent(contentAbs) {
  const inv = inventory(contentAbs);
  return inv.plugins.some((p) => p.main) || inv.themes.some((t) => t.name);
}

function installAt(root, abs, layout) {
  const site = layout === 'site-root';
  const contentAbs = site ? join(abs, 'wp-content') : abs;
  return {
    path: relPath(root, abs), abs, layout,
    contentAbs: isDir(contentAbs) ? contentAbs : null,
    // a symlinked wp-content is never followed, and is said to be unmeasured rather than skipped quietly
    contentLink: site && !!stat(contentAbs) && stat(contentAbs).isSymbolicLink(),
    contentPath: isDir(contentAbs) ? relPath(root, contentAbs) : null,
    core: site ? coreOf(abs) : { state: 'absent', version: null, locale: null },
  };
}

/**
 * Every WordPress install in the tree: a site root (wp-includes/version.php, or wp-config.php beside
 * wp-content) or a wp-content-only tree. The walk stops at the first install on a branch, so a backup
 * nested inside a site is not counted as a second site. Skips are by name or by root-relative path.
 */
export function findInstalls(root, { skip = new Set(), maxDepth = 4 } = {}) {
  const installs = [];
  const skippedPaths = [];
  const unreadable = [];
  // wordpressLayout's last resort (any directory with a wp-content beside it is a site root) is right
  // for a target somebody named, and wrong for a walk: a repository can hold a directory called
  // wp-content that is not a site. So a site root is taken on core's own files, wp-config.php, or a
  // wp-content that holds a component, and a wp-content tree on its name plus a component; only the
  // root's own wp-content shape (wordpressLayout's plugins+themes reading) is taken on its word.
  const visit = (abs, depth) => {
    const content = join(abs, 'wp-content');
    if (isFile(join(abs, 'wp-includes', 'version.php')) || isFile(join(abs, 'wp-load.php'))
      || (isDir(content) && (isFile(join(abs, 'wp-config.php')) || holdsComponent(content)))) {
      installs.push(installAt(root, abs, 'site-root'));
      return;
    }
    if ((abs === root && wordpressLayout(root) === 'wp-content') || (basename(abs) === 'wp-content' && holdsComponent(abs))) {
      installs.push(installAt(root, abs, 'wp-content'));
      return;
    }
    if (depth >= maxDepth) return;
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }).sort(byName); } catch (e) {
      unreadable.push({ path: relPath(root, abs), why: `readdir failed: ${e.code || e.message}` });
      return;
    }
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const child = join(abs, e.name);
      const rel = relPath(root, child);
      if (skip.has(e.name) || skip.has(rel)) { skippedPaths.push(rel); continue; }
      visit(child, depth + 1);
    }
  };
  visit(root, 0);
  return { installs, skippedPaths, unreadable };
}
