#!/usr/bin/env node
// usage: wp-integrity.mjs [rootDir]   (default '.')
// exit: 0 ran · 2 could not run
// env, read at call time: CW_WP_SKIP_DIRS (comma list of directory names or a/b paths; default
//   .git,node_modules,.claude/worktrees,fixtures/scan-canary/dirty — every skip is listed),
//   CW_WP_MAX_DEPTH (how deep an install is looked for, default 4), and the source variables of
//   bin/lib/wp-source.mjs: CW_WP_API_URL, CW_WP_DOWNLOADS_URL, CW_WP_CACHE, CW_WP_OFFLINE,
//   CW_WP_TIMEOUT_MS, CW_NOW
// output: {tool, summary:{findings, byRule, filesScanned, filesHashed, installs, components, verified,
//   unverifiable, unavailable, notMeasured, sources, requests, ...}, findings[]}
//   rule ids, paths, slugs, versions and counts only — never file contents.
//
// Is this WordPress code the code wordpress.org shipped? Core is compared file by file with the
// checksums api.wordpress.org publishes for its version and locale, and each plugin with the
// checksums downloads.wordpress.org publishes for its slug and version, read from the main file's
// Version header the way WordPress finds it. A modified file, a file added inside a verified core or
// plugin directory, and a missing one are each reported. So is every file sitting directly in
// wp-content/plugins/ other than index.php: no release puts one there, and on an exploited site that
// directory is where encoded droppers and their state file sat, beside plugins that verified.
//
// What has no checksum source is UNVERIFIABLE, counted and listed, never a pass: premium and custom
// plugins, must-use plugins, and every theme except a bundled default theme still at the version its
// core release ships (wordpress.org publishes no theme checksums). A wp-content-only backup has no
// core in it, so core is unmeasured and the run is partial, never clean.
//
// The lane sends each plugin slug and version to downloads.wordpress.org, and the core version to
// api.wordpress.org (EGRESS registry); bin/lib/wp-source.mjs caches the answers privately.
import { readdirSync, lstatSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { isMainModule } from '../lib/is-main.mjs';
import { findInstalls, inventory, hashFile, readHead, relPath, cleanHeader, SLUG_RX, VERSION_RX, LOCALE_RX } from './lib/wordpress.mjs';
import { request, mapPool, tally, baseOf, cacheLabel } from './lib/wp-source.mjs';
import { inertPhp } from './webshell-detect.mjs';

export const TOOL = 'wp-integrity';

export const RULES = Object.freeze({
  'wp-core-file-modified': { sev: 'high', cwe: 'CWE-345' },
  'wp-core-file-added': { sev: 'high', cwe: 'CWE-506' },
  'wp-core-file-missing': { sev: 'low', cwe: 'CWE-345' },
  'wp-plugin-file-modified': { sev: 'high', cwe: 'CWE-345' },
  'wp-plugin-file-added': { sev: 'high', cwe: 'CWE-506' },
  'wp-plugin-file-missing': { sev: 'low', cwe: 'CWE-345' },
  'wp-plugins-root-file': { sev: 'high', cwe: 'CWE-506' },
});

const DEFAULT_SKIP = ['.git', 'node_modules', '.claude/worktrees', 'fixtures/scan-canary/dirty'];
const LIST_CAP = 200;
const SAMPLE = 5;
const POOL = 4;
// Added files are judged by name first: server code (a double extension such as .php.b64 included),
// then server configuration; anything else is read for a PHP open tag before it is called inert.
const CODE_NAME = /\.(php[0-9]?|phtml|pht|phar|inc|cgi|pl|py|sh|aspx?|ashx|jspx?)(\.|$)/i;
const CONFIG_NAME = /^(\.htaccess|\.user\.ini|user\.ini|php\.ini|web\.config)$/i;
// WP-CLI's non-strict plugin check treats a changed readme as a soft change: wordpress.org rewrites
// the Stable tag line in trunk, so a byte difference there says nothing about the code.
const SOFT = new Set(['readme.txt', 'readme.md']);
// Core files above wp-content that are judged as "added": wp-admin/, wp-includes/ and the root's
// wp-* files other than wp-config.php — the set WP-CLI's core verify-checksums judges.
const CORE_ROOT_FILE = /^wp-(?!config\.php$)[^/]*$/;

export const skipDirs = () => {
  const raw = process.env.CW_WP_SKIP_DIRS;
  return raw == null ? DEFAULT_SKIP : raw.split(',').map((s) => s.trim()).filter(Boolean);
};
export const maxDepth = () => { const n = Number(process.env.CW_WP_MAX_DEPTH); return Number.isInteger(n) && n >= 0 ? n : 4; };

const asSet = (v) => new Set((Array.isArray(v) ? v : [v]).filter((x) => typeof x === 'string').map((x) => x.toLowerCase()));

/** Checksums for core ({path: md5}) and plugins ({path: {md5, sha256}}), as path -> {md5:Set, sha256:Set}. */
export function expectedFrom(kind, body) {
  const out = new Map();
  if (kind === 'core') {
    for (const [p, v] of Object.entries(body.checksums || {})) out.set(p, { md5: asSet(v), sha256: new Set() });
  } else {
    for (const [p, v] of Object.entries(body.files || {})) {
      if (!v || typeof v !== 'object') continue;
      out.set(p, { md5: asSet(v.md5), sha256: asSet(v.sha256) });
    }
  }
  return out;
}

function listFiles(baseAbs, startRel, unreadable) {
  const out = [];
  const walk = (rel) => {
    const abs = rel ? join(baseAbs, rel) : baseAbs;
    let entries;
    try { entries = readdirSync(abs, { withFileTypes: true }); } catch (e) {
      if (e.code !== 'ENOENT') unreadable.push({ abs, why: `readdir failed: ${e.code || e.message}` });
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isSymbolicLink()) { out.push({ rel: r, abs: join(baseAbs, r), link: true }); continue; }
      if (e.isDirectory()) { walk(r); continue; }
      if (e.isFile()) out.push({ rel: r, abs: join(baseAbs, r), link: false });
    }
  };
  walk(startRel);
  return out;
}

// A file the server runs as PHP is inert when it holds no PHP open tag (its text is sent as it is)
// or when webshell-detect's inertPhp finds only comments or an exit first. Plugins write both kinds
// into their own storage directories at run time, and hardening plugins drop silence-is-golden
// indexes into every directory; neither is server code a release forgot to list. A double
// extension (x.php.b64) is never inert here: it is the shape a dropper is stored in.
const SERVED_PHP = /\.(php[0-9]?|phtml|pht|phar)$/i;
const INERT_MAX = 64 * 1024;
function inertServed(f) {
  try {
    if (lstatSync(f.abs).size > INERT_MAX) return false;
    const text = readFileSync(f.abs, 'latin1');
    return !text.includes('<?') || inertPhp(text);
  } catch { return false; }
}

function addedKind(f) {
  const name = f.rel.split('/').pop();
  if (CODE_NAME.test(name)) return !f.link && SERVED_PHP.test(name) && inertServed(f) ? 'inert' : 'code';
  if (CONFIG_NAME.test(name)) return 'config';
  if (!f.link) {
    try { if (/<\?(php|=)/i.test(readHead(f.abs, 1024))) return 'code'; } catch { /* an unreadable added file stays "other"; the hash pass lists it */ }
  }
  return 'other';
}

// Core's "added" population: everything under wp-admin/ and wp-includes/, and the root's own wp-*
// files. The rest of a site root (wp-content, uploads) is never walked for it.
function coreCandidates(siteAbs, unreadable) {
  const out = [...listFiles(siteAbs, 'wp-admin', unreadable), ...listFiles(siteAbs, 'wp-includes', unreadable)];
  let entries = [];
  try { entries = readdirSync(siteAbs, { withFileTypes: true }); } catch (e) { unreadable.push({ abs: siteAbs, why: `readdir failed: ${e.code || e.message}` }); }
  for (const e of entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
    if ((e.isFile() || e.isSymbolicLink()) && CORE_ROOT_FILE.test(e.name)) out.push({ rel: e.name, abs: join(siteAbs, e.name), link: e.isSymbolicLink() });
  }
  return out;
}

// The same text with other line endings is the same file: a release zip built with CRLF, unpacked
// or copied by a tool that normalises to LF (or the reverse), differs in every byte-hash and in no
// statement. A file that matches once its line endings are converted is counted, not reported.
// Binary files (a NUL in them) and files over 8 MiB are never converted.
const EOL_MAX = 8 * 1024 * 1024;
function eolOnly(abs, want, size) {
  if (size > EOL_MAX) return false;
  let buf;
  try { buf = readFileSync(abs); } catch { return false; }
  if (buf.includes(0)) return false;
  const lf = Buffer.from(buf.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');
  const crlf = Buffer.from(lf.toString('latin1').replace(/\n/g, '\r\n'), 'latin1');
  const algo = want.sha256.size ? 'sha256' : 'md5';
  const set = want.sha256.size ? want.sha256 : want.md5;
  return [lf, crlf].some((b) => set.has(createHash(algo).update(b).digest('hex')));
}

/**
 * Compares one component directory with its expected files: each expected file is hashed (sha256
 * where the source publishes it, md5 otherwise), and each present file the source does not list is
 * "added". `candidates` lists the present files that may be called added; a plugin's is its whole
 * directory.
 */
function verifyAgainst({ baseAbs, expected, soft = new Set(), candidates = null }) {
  const r = { hashed: 0, matched: 0, modified: [], soft: 0, eol: 0, missing: [], added: { code: [], config: [], inert: [], other: [] }, unreadable: [], examined: 0 };
  for (const [rel, want] of [...expected.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const abs = join(baseAbs, rel);
    let st;
    try { st = lstatSync(abs); } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') { r.missing.push(rel); continue; }
      r.unreadable.push({ abs, why: `lstat failed: ${e.code || e.message}` });
      continue;
    }
    if (st.isSymbolicLink()) { r.modified.push({ rel, how: 'replaced by a symbolic link' }); continue; }
    if (!st.isFile()) { r.modified.push({ rel, how: 'not a regular file' }); continue; }
    let h;
    try { h = hashFile(abs); } catch (e) { r.unreadable.push({ abs, why: `read failed: ${e.code || e.message}` }); continue; }
    r.hashed++;
    const ok = want.sha256.size ? want.sha256.has(h.sha256) : want.md5.has(h.md5);
    if (ok) { r.matched++; continue; }
    if (soft.has(rel.toLowerCase())) { r.soft++; continue; }
    if (eolOnly(abs, want, st.size)) { r.eol++; continue; }
    r.modified.push({ rel, how: want.sha256.size ? 'sha256 differs' : 'md5 differs' });
  }
  for (const f of candidates || listFiles(baseAbs, '', r.unreadable)) {
    if (expected.has(f.rel)) continue;
    r.examined++;
    r.added[addedKind(f)].push(f.rel);
  }
  return r;
}

const sample = (arr) => `${arr.slice(0, SAMPLE).join(', ')}${arr.length > SAMPLE ? `, +${arr.length - SAMPLE} more` : ''}`;

export async function scanTree(root) {
  const skip = new Set(skipDirs());
  const summary = {
    findings: 0, byRule: {}, filesScanned: 0, filesHashed: 0, softChanges: 0, lineEndingOnly: 0,
    installs: [], components: { core: 0, plugins: 0, singleFilePlugins: 0, themes: 0, muPlugins: 0, verified: 0, unverifiable: 0, unavailable: 0 },
    verified: [], unverifiable: [], unavailable: [], notMeasured: [],
    sources: { coreChecksums: baseOf('core-checksums').label, pluginChecksums: baseOf('plugin-checksums').label, cache: cacheLabel() },
    requests: null, unreadable: 0, unreadableFiles: [], skipDirs: [...skip], skippedPaths: [],
  };
  const findings = [];
  const partial = [];
  const listed = (arr, entry) => { if (arr.length < LIST_CAP) arr.push(entry); };
  const unreadable = (abs, why) => { summary.unreadable++; listed(summary.unreadableFiles, { path: relPath(root, abs), why }); };
  const add = (rule, path, detail, sev = RULES[rule].sev, cwe = RULES[rule].cwe, extra = {}) => findings.push({ rule, path, sev, cwe, ...extra, detail });
  const answers = [];
  // Added files that are not server code are one row per component: server configuration
  // (.htaccess, .user.ini, php.ini) makes it med, because a lock or a handler an intruder copies into
  // every directory is configuration, and one row per copy buried everything else on a real site.
  const addedRest = (rule, path, r, what) => {
    const rest = [...r.added.config, ...r.added.inert, ...r.added.other].sort();
    if (!rest.length) return;
    const config = r.added.config.length;
    const inert = r.added.inert.length;
    add(rule, path, `${rest.length} file(s) that ${what}${config ? `, ${config} of them server configuration (${sample(r.added.config)})` : ''}${inert ? `, ${inert} of them PHP that runs nothing (no open tag, comments only, or an exit first)` : ''}: ${sample(rest)}`,
      config ? 'med' : 'low', config ? RULES[rule].cwe : 'CWE-345');
  };

  const found = findInstalls(root, { skip, maxDepth: maxDepth() });
  summary.skippedPaths = found.skippedPaths.slice(0, LIST_CAP);
  for (const u of found.unreadable) unreadable(join(root, u.path), u.why);

  for (const inst of found.installs) {
    const at = (rel) => (inst.path === '.' ? rel : `${inst.path}/${rel}`);
    const contentRel = (rel) => (inst.contentPath === '.' ? rel : `${inst.contentPath}/${rel}`);
    summary.installs.push({ path: inst.path, layout: inst.layout, core: { state: inst.core.state, version: inst.core.version, locale: inst.core.locale } });
    const record = (r) => {
      summary.filesHashed += r.hashed;
      summary.filesScanned += r.hashed + r.examined;
      summary.softChanges += r.soft;
      summary.lineEndingOnly += r.eol;
      for (const u of r.unreadable) unreadable(u.abs, u.why);
    };

    // ── core ──
    let coreExpected = null;
    const core = inst.core;
    if (core.state === 'present') {
      summary.components.core++;
      if (!VERSION_RX.test(core.version) || !LOCALE_RX.test(core.locale)) {
        summary.notMeasured.push({ component: 'core', path: inst.path, reason: 'the core version or locale in wp-includes/version.php is not a shape wordpress.org publishes checksums for' });
        partial.push('core version string unusable: core unmeasured');
      } else {
        const ans = await request('core-checksums', { version: core.version, locale: core.locale });
        answers.push(ans);
        if (ans.via === 'stale-cache') partial.push(`core checksums answered from an expired cache: ${ans.reason}`);
        if (ans.status === 'ok') {
          coreExpected = ans.body.checksums;
          // wp-content entries are the bundled plugins and themes, which a site updates or deletes on
          // its own schedule: they are judged below with their components, never as core.
          const expected = new Map([...expectedFrom('core', ans.body).entries()].filter(([p]) => !p.startsWith('wp-content/')));
          const scratch = [];
          const r = verifyAgainst({ baseAbs: inst.abs, expected, candidates: coreCandidates(inst.abs, scratch) });
          r.unreadable.push(...scratch);
          record(r);
          const label = `WordPress ${core.version} (${core.locale})`;
          for (const m of r.modified) add('wp-core-file-modified', at(m.rel), `differs from ${label} as api.wordpress.org publishes it: ${m.how}`);
          for (const p of r.added.code) add('wp-core-file-added', at(p), `server code ${label} does not ship, inside a core directory`);
          addedRest('wp-core-file-added', inst.path, r, `${label} does not ship under wp-admin/, wp-includes/ or as a root wp-* file`);
          if (r.missing.length) add('wp-core-file-missing', inst.path, `${r.missing.length} file(s) ${label} ships are absent: ${sample(r.missing)}`);
          summary.components.verified++;
          listed(summary.verified, { kind: 'core', slug: 'wordpress', version: core.version, locale: core.locale, path: inst.path, files: expected.size, modified: r.modified.length, added: r.examined, missing: r.missing.length });
        } else if (ans.status === 'not-found') {
          summary.notMeasured.push({ component: 'core', path: inst.path, reason: `api.wordpress.org publishes no checksums for WordPress ${core.version} (${core.locale}): not a release, or a modified version string` });
          partial.push(`no checksums for core ${core.version}: core unmeasured`);
        } else {
          summary.components.unavailable++;
          listed(summary.unavailable, { kind: 'core', slug: 'wordpress', version: core.version, path: inst.path, why: ans.reason });
          partial.push(`core checksums unavailable: ${ans.reason}`);
        }
      }
    } else if (core.state === 'unreadable') {
      summary.notMeasured.push({ component: 'core', path: inst.path, reason: `the core version could not be read: ${core.reason}` });
      partial.push('core version unreadable: core unmeasured');
    } else {
      const why = inst.layout === 'wp-content'
        ? 'WordPress core is not in the scanned tree (wp-content only): core files are unmeasured, and nothing beside wp-content in the web root was examined'
        : 'a WordPress site root without wp-includes/version.php: core files are unmeasured';
      summary.notMeasured.push({ component: 'core', path: inst.path, reason: why });
      partial.push('core not in the tree: core unmeasured');
    }

    if (inst.contentLink) {
      summary.notMeasured.push({ component: 'wp-content', path: at('wp-content'), reason: 'wp-content is a symbolic link, not followed: plugins, themes and must-use plugins are unmeasured' });
      partial.push('wp-content is a symbolic link: its components unmeasured');
    }
    if (!inst.contentAbs) continue;
    const inv = inventory(inst.contentAbs);
    for (const u of inv.unreadable) unreadable(u.path, u.why);
    const coreHash = (key, abs) => {
      if (!coreExpected || typeof coreExpected[key] !== 'string') return null;
      try { const h = hashFile(abs); summary.filesHashed++; return h.md5 === coreExpected[key].toLowerCase(); } catch (e) { unreadable(abs, `read failed: ${e.code || e.message}`); return null; }
    };

    // ── wp-content/index.php and themes/index.php, which core ships, verified where core is ──
    // (plugins/index.php is judged below with the other files directly in plugins/)
    for (const key of ['wp-content/index.php', 'wp-content/themes/index.php']) {
      const abs = join(inst.contentAbs, key.slice('wp-content/'.length));
      let present = false; try { present = lstatSync(abs).isFile(); } catch { present = false; }
      if (!present) continue;
      const ok = coreHash(key, abs);
      if (ok !== null) summary.filesScanned++;
      if (ok === false) add('wp-core-file-modified', contentRel(key.slice('wp-content/'.length)), `differs from WordPress ${core.version} (${core.locale}) as api.wordpress.org publishes it: md5 differs`);
    }

    // ── files directly in wp-content/plugins/ ──
    for (const f of inv.rootFiles) {
      summary.filesScanned++;
      const rel = contentRel(`plugins/${f.name}`);
      const key = `wp-content/plugins/${f.name}`;
      // index.php is the one file every release puts here; hello.php is the plugin core bundles, and
      // is judged against core's own copy when core is in the tree.
      if (f.name === 'index.php' || (f.name === 'hello.php' && coreExpected && typeof coreExpected[key] === 'string')) {
        if (coreHash(key, f.abs) === false) add('wp-core-file-modified', rel, `differs from WordPress ${core.version} (${core.locale}) as api.wordpress.org publishes it: md5 differs`);
        continue;
      }
      if (f.pluginName) {
        summary.components.singleFilePlugins++;
        summary.components.unverifiable++;
        listed(summary.unverifiable, { kind: 'single-file-plugin', slug: f.name, version: cleanHeader(f.version, 32) || null, path: rel, why: 'a single-file plugin: no checksum source covers one' });
        add('wp-plugins-root-file', rel, `a single-file plugin directly in plugins/ (Plugin Name: ${cleanHeader(f.pluginName, 60)}${f.version ? `, Version: ${cleanHeader(f.version, 32)}` : ''}): WordPress loads it on every request and no checksum source covers it`, 'med');
      } else {
        add('wp-plugins-root-file', rel, `a file directly in plugins/ that is neither index.php nor a plugin: no release puts a file here${f.name.startsWith('.') ? ', and this one is hidden' : ''}`);
      }
    }

    // ── plugins ──
    const jobs = [];
    for (const p of inv.plugins) {
      summary.components.plugins++;
      const path = contentRel(`plugins/${p.slug}`);
      const unverifiable = (why, version = null) => {
        summary.components.unverifiable++;
        listed(summary.unverifiable, { kind: 'plugin', slug: p.slug, version, path, why });
      };
      if (p.symlink) { unverifiable('a symbolic link, not followed'); continue; }
      if (p.hidden) { unverifiable('a hidden directory: WordPress never loads it as a plugin, but its files are reachable by URL'); continue; }
      if (p.error) { unreadable(p.abs, p.error); partial.push(`plugin ${p.slug} unreadable`); continue; }
      for (const u of p.unreadable || []) unreadable(p.abs, u);
      if (!p.main) { unverifiable('no PHP file directly in the directory carries a Plugin Name header, so WordPress does not load it as a plugin'); continue; }
      if (!p.version) { unverifiable(`the main file ${p.main} carries no Version header`); continue; }
      if (!SLUG_RX.test(p.slug) || !VERSION_RX.test(p.version)) { unverifiable('the directory name or version is not a shape wordpress.org publishes', cleanHeader(p.version, 64)); continue; }
      jobs.push({ p, path, version: p.version });
    }
    const results = await mapPool(jobs, POOL, (j) => request('plugin-checksums', { slug: j.p.slug, version: j.version }));
    answers.push(...results);
    const failed = new Map();
    jobs.forEach((j, i) => {
      const ans = results[i];
      const { p, path, version } = j;
      if (ans.via === 'stale-cache') partial.push(`plugin checksums answered from an expired cache: ${ans.reason}`);
      if (ans.status === 'not-found') {
        summary.components.unverifiable++;
        listed(summary.unverifiable, { kind: 'plugin', slug: p.slug, version, path, why: `downloads.wordpress.org publishes no checksums for ${p.slug} ${version}: a premium or custom plugin, or a version wordpress.org never released` });
        return;
      }
      if (ans.status !== 'ok') {
        summary.components.unavailable++;
        listed(summary.unavailable, { kind: 'plugin', slug: p.slug, version, path, why: ans.reason });
        failed.set(ans.reason, (failed.get(ans.reason) || 0) + 1);
        return;
      }
      const expected = expectedFrom('plugin', ans.body);
      const r = verifyAgainst({ baseAbs: p.abs, expected, soft: SOFT });
      record(r);
      const label = `${p.slug} ${version} as downloads.wordpress.org publishes it`;
      for (const m of r.modified) add('wp-plugin-file-modified', `${path}/${m.rel}`, `differs from ${label}: ${m.how}`);
      for (const f of r.added.code) add('wp-plugin-file-added', `${path}/${f}`, `server code ${p.slug} ${version} does not ship, inside a plugin that otherwise verifies`);
      addedRest('wp-plugin-file-added', path, r, `${p.slug} ${version} does not ship`);
      if (r.missing.length) add('wp-plugin-file-missing', path, `${r.missing.length} file(s) of ${p.slug} ${version} are absent: ${sample(r.missing)}`);
      summary.components.verified++;
      listed(summary.verified, { kind: 'plugin', slug: p.slug, version, path, files: expected.size, modified: r.modified.length, added: r.examined, missing: r.missing.length });
    });
    for (const [why, n] of [...failed.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) partial.push(`${n} plugin checksum request(s) failed: ${why}`);

    // ── themes: verifiable only as a default theme still at the version its core release bundles ──
    for (const t of inv.themes) {
      summary.components.themes++;
      const path = contentRel(`themes/${t.slug}`);
      const version = t.version ? cleanHeader(t.version, 64) : null;
      const unverifiable = (why) => { summary.components.unverifiable++; listed(summary.unverifiable, { kind: 'theme', slug: t.slug, version, path, why }); };
      if (t.unreadable) { unreadable(join(t.abs, 'style.css'), t.unreadable); unverifiable('style.css unreadable'); continue; }
      if (!t.name) { unverifiable('no Theme Name header in style.css'); continue; }
      const prefix = `wp-content/themes/${t.slug}/`;
      const bundled = coreExpected ? Object.keys(coreExpected).filter((k) => k.startsWith(prefix)) : [];
      if (!bundled.length) { unverifiable(coreExpected ? 'wordpress.org publishes no theme checksums, and this is not a theme the core release in the tree bundles' : 'wordpress.org publishes no theme checksums'); continue; }
      const style = coreHash(`${prefix}style.css`, join(t.abs, 'style.css'));
      if (style !== true) { unverifiable(`not the copy WordPress ${core.version} bundles (updated separately, or modified); wordpress.org publishes no theme checksums`); continue; }
      const expected = new Map(bundled.map((k) => [k.slice(prefix.length), { md5: asSet(coreExpected[k]), sha256: new Set() }]));
      const r = verifyAgainst({ baseAbs: t.abs, expected });
      record(r);
      const label = `the ${t.slug} theme WordPress ${core.version} bundles`;
      for (const m of r.modified) add('wp-core-file-modified', `${path}/${m.rel}`, `differs from ${label}: ${m.how}`);
      for (const f of r.added.code) add('wp-core-file-added', `${path}/${f}`, `server code ${label} does not ship`);
      addedRest('wp-core-file-added', path, r, `${label} does not ship`);
      if (r.missing.length) add('wp-core-file-missing', path, `${r.missing.length} file(s) of ${label} are absent: ${sample(r.missing)}`);
      summary.components.verified++;
      listed(summary.verified, { kind: 'theme', slug: t.slug, version, path, files: expected.size, modified: r.modified.length, added: r.examined, missing: r.missing.length });
    }

    // ── must-use plugins: loaded on every request, verified by nothing ──
    for (const m of inv.muPlugins) {
      summary.components.muPlugins++;
      summary.components.unverifiable++;
      listed(summary.unverifiable, { kind: 'mu-plugin', slug: m.name, version: null, path: contentRel(`mu-plugins/${m.name}`), why: 'must-use plugins have no checksum source' });
    }
  }

  summary.requests = tally(answers);
  findings.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.rule < b.rule ? -1 : a.rule > b.rule ? 1 : 0));
  for (const f of findings) summary.byRule[f.rule] = (summary.byRule[f.rule] || 0) + 1;
  summary.byRule = Object.fromEntries(Object.entries(summary.byRule).sort(([a], [b]) => (a < b ? -1 : 1)));
  summary.findings = findings.length;
  for (const k of ['verified', 'unverifiable', 'unavailable']) summary[k].sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  if (summary.unreadable) partial.push(`${summary.unreadable} file(s) or director(ies) unreadable`);
  const reasons = [...new Set(partial)];
  if (reasons.length) { summary.partial = true; summary.partialReasons = reasons; }
  if (!found.installs.length) {
    summary.voidReason = 'no WordPress install in the tree (wp-includes/version.php, or a wp-content holding a plugin or theme), so nothing was verified; a tree without WordPress is a void, not a clean result';
  } else if (summary.components.verified === 0) {
    summary.voidReason = `no component could be verified against wordpress.org: ${reasons.join('; ') || 'every component is unverifiable'}`;
  }
  return { tool: TOOL, summary, findings };
}

// process.exitCode and a return, never process.exit(): on Node 24 and 26 exit() can hang joining a
// worker thread (docs/TRAPS.md), and every error is caught here so none takes the uncaught path.
async function main() {
  const root = resolve(process.argv[2] || '.');
  let st;
  try { st = lstatSync(root); } catch (e) { process.stderr.write(`wp-integrity: cannot read ${root}: ${e.code || e.message}\n`); process.exitCode = 2; return; }
  if (!st.isDirectory()) { process.stderr.write(`wp-integrity: ${root} is not a directory\n`); process.exitCode = 2; return; }
  try {
    const report = await scanTree(root);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (e) { process.stderr.write(`wp-integrity: could not run: ${e.message}\n`); process.exitCode = 2; }
}

if (isMainModule(import.meta.url)) main();
