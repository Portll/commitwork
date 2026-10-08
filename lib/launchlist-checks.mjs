// lib/launchlist-checks.mjs — the measured half of the launch checklist. Every check reads the
// COMMITTED tree (HEAD), because HEAD is what an export ships; the working tree is only consulted by
// dirtyTree. A check that cannot run returns UNMEASURED with the reason, never PASS.
//
// Evidence lines never carry a secret value or a redacted identity: names are reported by the scope
// document that holds them, with any name inside a printed path masked, and gitleaks runs with --redact.

import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, mkdirSync } from 'node:fs';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join, posix } from 'node:path';
import { STATUS } from './launchlist.mjs';
import { loadScope, scanEntries } from '../bin/lib/release-names-head-scan.mjs';
import { findNames, mask, withoutNames } from '../bin/lib/release-scope.mjs';
import { treeTexts, testCounts } from '../bin/lib/release-candidate-core.mjs';
import { scannedGit, scannedGitEnv, scannedGitOut } from '../bin/lib/git-env.mjs';

const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const UA = 'commitwork-launchlist (+https://commitwork.online)';
const MAX_EVIDENCE = 20;

const pass = (summary, evidence = []) => ({ status: STATUS.PASS, summary, evidence: evidence.slice(0, MAX_EVIDENCE) });
const fail = (summary, evidence = []) => ({ status: STATUS.FAIL, summary, evidence: evidence.slice(0, MAX_EVIDENCE) });
const warn = (summary, evidence = []) => ({ status: STATUS.WARN, summary, evidence: evidence.slice(0, MAX_EVIDENCE) });
const unmeasured = (summary, evidence = []) => ({ status: STATUS.UNMEASURED, summary, evidence: evidence.slice(0, MAX_EVIDENCE) });
const firstLine = (e) => String((e && (e.stderr && String(e.stderr).trim())) || (e && e.message) || e).split('\n')[0].slice(0, 200);

// ── git over HEAD ──────────────────────────────────────────────────────────────────────────────

// scannedGit: the checklist reads whichever repo it is pointed at, and status, diff and archive run
// that repo's fsmonitor, filter and textconv commands under a plain git.
function git(repo, args, { input, timeout = 120_000 } = {}) {
  return scannedGitOut(repo, args, { maxBuffer: 1 << 29, input, timeout, stdio: ['pipe', 'pipe', 'pipe'] });
}

// git grep exits 1 for "no match"; only >1 is a failure.
function gitGrep(repo, args) {
  const r = scannedGit(repo, ['grep', ...args], { maxBuffer: 1 << 29, timeout: 300_000 });
  if (r.error) throw r.error;
  if (r.status === 0) return r.stdout;
  if (r.status === 1 && !r.stderr.trim()) return '';
  throw new Error(`git grep failed (${r.status}): ${String(r.stderr).trim().split('\n')[0]}`);
}

/** HEAD tree as [{mode, type, sha, size, path}], cached per context. */
export function headTree(ctx) {
  if (ctx._tree) return ctx._tree;
  const out = git(ctx.repo, ['ls-tree', '-r', '-l', '-z', '--full-tree', 'HEAD']);
  ctx._tree = out.split('\0').filter(Boolean).map((line) => {
    const tab = line.indexOf('\t');
    const [mode, type, sha, size] = line.slice(0, tab).trim().split(/\s+/);
    return { mode, type, sha, size: size === '-' ? 0 : Number(size), path: line.slice(tab + 1) };
  });
  return ctx._tree;
}

const showHead = (ctx, path) => git(ctx.repo, ['show', `HEAD:${path}`]);

// Line-oriented reads go through here, never showHead().split('\n'). `git show` gives bytes, so a
// CRLF file's lines keep a trailing \r, which `.` does not match and an unflagged `$` does not
// tolerate — a whole CRLF file goes invisible to any line-anchored regex. showHead stays
// byte-faithful for the whole-text checks.
const headLines = (ctx, path) => showHead(ctx, path).split('\n').map((l) => l.replace(/\r$/, ''));

/** Every tracked path at HEAD plus every directory on the way to one. Cached per context. */
function trackedPrefixes(ctx) {
  if (ctx._prefixes) return ctx._prefixes;
  const set = new Set();
  for (const { path } of headTree(ctx)) {
    set.add(path);
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) set.add(parts.slice(0, i).join('/'));
  }
  ctx._prefixes = set;
  return set;
}

/** One row per MATCH, carrying the matched text — the text is what decides whether a hit is real. */
const SIBLING_BATCH = 64;

function matchesByFile(repo, args) {
  const out = gitGrep(repo, ['-I', '-o', ...args, 'HEAD', '--']);
  const rows = [];
  for (const line of out.split('\n')) {
    if (!line) continue;
    const body = line.startsWith('HEAD:') ? line.slice(5) : line;
    const i = body.indexOf(':');
    if (i < 0) continue;
    rows.push({ path: body.slice(0, i), match: body.slice(i + 1) });
  }
  return rows;
}

/** Paths → [{path, n}], commonest first. */
function tally(paths) {
  const per = new Map();
  for (const p of paths) per.set(p, (per.get(p) || 0) + 1);
  return [...per.entries()].map(([path, n]) => ({ path, n })).sort((a, b) => b.n - a.n || a.path.localeCompare(b.path));
}

function exportHead(ctx) {
  const dir = mkdtempSync(join(tmpdir(), 'launchlist-export-'));
  try {
    const tar = scannedGit(ctx.repo, ['archive', '--format=tar', 'HEAD'], { encoding: 'buffer', timeout: 600_000, maxBuffer: 1 << 30 });
    if (tar.error || tar.status !== 0) throw new Error(`git archive failed: ${String(tar.error?.message || tar.stderr || `exit ${tar.status}`).trim().split('\n')[0]}`);
    execFileSync('tar', ['-x', '-C', dir], { input: tar.stdout, timeout: 600_000, maxBuffer: 1 << 26 });
  } catch (e) { rmSync(dir, { recursive: true, force: true }); throw e; }
  return dir;
}

function which(bin) {
  const r = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 20_000 });
  return !r.error;
}

// ── GitHub ─────────────────────────────────────────────────────────────────────────────────────

export function githubSlug(ctx) {
  if (ctx.cfg.github) return ctx.cfg.github;
  let url = '';
  try { url = git(ctx.repo, ['remote', 'get-url', 'origin']).trim(); } catch { return null; }
  const m = url.match(/github\.com[:/]([^/]+)\/([^/]+?)(\.git)?$/);
  return m ? `${m[1]}/${m[2]}` : null;
}

function gh(ctx, args) {
  const bin = process.env.CW_GH || 'gh';
  return execFileSync(bin, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 1 << 26, stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

const sumLines = (s) => s.split('\n').filter(Boolean).reduce((a, n) => a + (Number(n) || 0), 0);

// ── registries ─────────────────────────────────────────────────────────────────────────────────

async function httpJson(ctx, url) {
  const f = ctx.fetch || fetch;
  const res = await f(url, { headers: { 'user-agent': UA, accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  let body = null;
  if (res.status === 200) { try { body = await res.json(); } catch { body = null; } }
  return { status: res.status, body };
}

/** {registry, name, state: free|owned|taken|exists, owners?} — `exists` means the owner could not be read. */
export async function probePackage(ctx, registry, name) {
  const key = `${registry}:${name}`;
  ctx._reg ||= new Map();
  if (ctx._reg.has(key)) return ctx._reg.get(key);
  const mine = String((ctx.accounts || {})[registry] || '').toLowerCase();
  let out;
  if (registry === 'npm') {
    const r = await httpJson(ctx, `https://registry.npmjs.org/${encodeURIComponent(name).replace(/^%40/, '@')}`);
    if (r.status === 404) out = { state: 'free' };
    else if (r.status !== 200) throw new Error(`npm answered ${r.status}`);
    else {
      const owners = ((r.body && r.body.maintainers) || []).map((m) => String(m.name || '').toLowerCase());
      out = { state: mine ? (owners.includes(mine) ? 'owned' : 'taken') : 'exists', owners };
    }
  } else if (registry === 'crates') {
    const r = await httpJson(ctx, `https://crates.io/api/v1/crates/${encodeURIComponent(name)}`);
    if (r.status === 404) out = { state: 'free' };
    else if (r.status !== 200) throw new Error(`crates.io answered ${r.status}`);
    else {
      const o = await httpJson(ctx, `https://crates.io/api/v1/crates/${encodeURIComponent(name)}/owners`);
      const owners = ((o.body && o.body.users) || []).map((u) => String(u.login || '').toLowerCase());
      out = { state: mine ? (owners.includes(mine) ? 'owned' : 'taken') : 'exists', owners };
    }
  } else if (registry === 'pypi') {
    const r = await httpJson(ctx, `https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
    if (r.status === 404) out = { state: 'free' };
    else if (r.status !== 200) throw new Error(`PyPI answered ${r.status}`);
    else {
      const owned = ((ctx.cfg.packages || {}).pypiOwned || []).includes(name);
      out = { state: owned ? 'owned' : 'exists', owners: [] };
    }
  } else if (registry === 'docker') {
    const [ns, repo] = name.includes('/') ? name.split('/') : ['library', name];
    const r = await httpJson(ctx, `https://hub.docker.com/v2/namespaces/${encodeURIComponent(ns)}/repositories/${encodeURIComponent(repo)}`);
    if (r.status === 404) out = { state: 'free' };
    else if (r.status !== 200) throw new Error(`Docker Hub answered ${r.status}`);
    else out = { state: mine && ns.toLowerCase() === mine ? 'owned' : 'exists', owners: [ns] };
  } else if (registry === 'brew') {
    const r = await httpJson(ctx, `https://formulae.brew.sh/api/formula/${encodeURIComponent(name)}.json`);
    if (r.status === 404) out = { state: 'free' };
    else if (r.status !== 200) throw new Error(`Homebrew answered ${r.status}`);
    else out = { state: 'exists', owners: [] };
  } else {
    throw new Error(`unknown registry ${registry}`);
  }
  const res = { registry, name, ...out };
  ctx._reg.set(key, res);
  return res;
}

const describePkg = (p) => `${p.registry} ${p.name}: ${p.state}${p.owners && p.owners.length && p.state !== 'owned' ? ` (owners: ${p.owners.slice(0, 3).join(', ')})` : ''}`;

// ── site fetches ───────────────────────────────────────────────────────────────────────────────

async function fetchText(ctx, url, { redirect = 'follow', method = 'GET' } = {}) {
  const f = ctx.fetch || fetch;
  const res = await f(url, { method, redirect, headers: { 'user-agent': UA }, signal: AbortSignal.timeout(20_000) });
  const text = method === 'HEAD' ? '' : await res.text();
  return { status: res.status, url: res.url || url, headers: res.headers, text };
}

async function home(ctx) {
  if (!ctx.cfg.site) return null;
  if (!ctx._home) ctx._home = fetchText(ctx, ctx.cfg.site);
  return ctx._home;
}

function siteGuard(ctx) {
  if (!ctx.cfg.site) return unmeasured('no site URL declared for this project (config: site)');
  return null;
}

const TAG_RE = /<(meta|link|script|a|html|title)\b([^>]*)>/gi;
const ATTR_RE = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/g;

export function parseTags(html) {
  const tags = [];
  for (const m of html.matchAll(TAG_RE)) {
    const attrs = {};
    for (const a of m[2].matchAll(ATTR_RE)) attrs[a[1].toLowerCase()] = a[3] ?? a[4] ?? a[5] ?? '';
    tags.push({ tag: m[1].toLowerCase(), attrs });
  }
  const t = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return { tags, title: t ? t[1].trim() : '' };
}

const metaContent = (tags, key) => {
  const t = tags.find((x) => x.tag === 'meta' && ((x.attrs.name || '').toLowerCase() === key || (x.attrs.property || '').toLowerCase() === key));
  return t ? (t.attrs.content || '') : '';
};

async function siteCheck(ctx, fn) {
  const g = siteGuard(ctx);
  if (g) return g;
  let h;
  try { h = await home(ctx); } catch (e) { return unmeasured(`could not fetch ${ctx.cfg.site}: ${firstLine(e)}`); }
  if (h.status !== 200) return unmeasured(`home page answered HTTP ${h.status}; page-level checks need a 200`);
  return fn(h);
}

// ── the checks ─────────────────────────────────────────────────────────────────────────────────

const accountHome = () => { try { return userInfo().homedir; } catch { return null; } };

export const CHECKS = {
  async githubExposure(ctx) {
    const slug = githubSlug(ctx);
    if (!slug) return unmeasured('no GitHub origin remote and no github slug in config');
    try {
      const vis = gh(ctx, ['api', `repos/${slug}`, '--jq', '.visibility']);
      if (vis === 'public') return pass(`${slug} is already public`);
      const branches = sumLines(gh(ctx, ['api', `repos/${slug}/branches`, '--paginate', '--jq', 'length']));
      const tags = sumLines(gh(ctx, ['api', `repos/${slug}/tags`, '--paginate', '--jq', 'length']));
      const releases = sumLines(gh(ctx, ['api', `repos/${slug}/releases`, '--paginate', '--jq', 'length']));
      const runs = Number(gh(ctx, ['api', `repos/${slug}/actions/runs?per_page=1`, '--jq', '.total_count'])) || 0;
      const artifacts = Number(gh(ctx, ['api', `repos/${slug}/actions/artifacts?per_page=1`, '--jq', '.total_count'])) || 0;
      const prs = Number(gh(ctx, ['api', `search/issues?q=repo:${slug}+is:pr&per_page=1`, '--jq', '.total_count'])) || 0;
      const issues = Number(gh(ctx, ['api', `search/issues?q=repo:${slug}+is:issue&per_page=1`, '--jq', '.total_count'])) || 0;
      // Run and artifact history as presence, not counts: every CI run moves the count, and an
      // acceptance is bound to this evidence, so a count lapsed a ruled decision on each push.
      const ev = [`${slug}: ${vis}`, `branches ${branches}, tags ${tags}, releases ${releases}`,
        `Actions run history ${runs ? 'present' : 'none'}, artifacts ${artifacts ? 'present' : 'none'}`, `pull requests ${prs}, issues ${issues}`,
        'plus every orphaned commit still fetchable by SHA'];
      const exposed = branches > 1 || tags || releases || runs || artifacts || prs || issues;
      return exposed ? warn('flipping visibility would publish all of this', ev) : pass('nothing beyond the default branch would be exposed', ev);
    } catch (e) { return unmeasured(`gh could not read ${slug}: ${firstLine(e)}`); }
  },

  async packageNames(ctx) {
    const pk = ctx.cfg.packages || {};
    const wanted = ['npm', 'crates', 'pypi', 'docker', 'brew'].flatMap((r) => (pk[r] || []).map((n) => [r, n]));
    if (!wanted.length) return unmeasured('no package names declared for this project (config: packages)');
    const found = [];
    for (const [r, n] of wanted) {
      try { found.push(await probePackage(ctx, r, n)); } catch (e) { return unmeasured(`${r} ${n}: ${firstLine(e)}`); }
    }
    const ev = found.map(describePkg);
    const n = (s) => found.filter((p) => p.state === s).length;
    const tally = [['taken', 'taken by someone else'], ['exists', 'exist, owner unverified (config: accounts)'], ['free', 'free and unclaimed'], ['owned', 'held']]
      .filter(([s]) => n(s)).map(([s, label]) => `${n(s)} ${label}`).join(', ');
    if (n('taken')) return fail(tally, ev);
    if (n('free') || n('exists')) return warn(tally, ev);
    return pass('every declared name is held by the configured account', ev);
  },

  async licenceFile(ctx) {
    const f = headTree(ctx).find((e) => !e.path.includes('/') && /^(LICEN[CS]E|COPYING)(\.(md|txt))?$/i.test(e.path));
    if (!f) return fail('no LICENSE or COPYING at the root of HEAD');
    const head = showHead(ctx, f.path).slice(0, 6000);
    const kind = /GNU AFFERO GENERAL PUBLIC LICENSE/i.test(head) ? 'AGPL-3.0'
      : /GNU LESSER GENERAL PUBLIC LICENSE/i.test(head) ? 'LGPL'
        : /GNU GENERAL PUBLIC LICENSE/i.test(head) ? 'GPL'
          : /Apache License[\s\S]{0,40}Version 2\.0/i.test(head) ? 'Apache-2.0'
            : /Permission is hereby granted, free of charge/i.test(head) ? 'MIT'
              : /Mozilla Public License/i.test(head) ? 'MPL-2.0'
                : /PolyForm/i.test(head) ? 'PolyForm' : null;
    return kind ? pass(`${f.path}: ${kind}`) : warn(`${f.path} present but not a licence text this check recognises`);
  },

  async licensingDoc(ctx) {
    return headTree(ctx).some((e) => e.path === 'LICENSING.md') ? pass('LICENSING.md present') : fail('no LICENSING.md at the root of HEAD');
  },

  async copyrightHolders(ctx) {
    const files = headTree(ctx).filter((e) => e.type === 'blob' && /(^|\/)(LICEN[CS]E[^/]*|NOTICE[^/]*|COPYING[^/]*|LICENSING\.md)$/i.test(e.path)
      && !/(^|\/)(node_modules|vendor|third_party|upstream)\//.test(e.path));
    const found = [];
    const re = /copyright\s*(?:\(c\)|©)?\s*((?:\d{4}\s*[-–,]\s*)*\d{4})[,\s]+(.+)$/i;
    for (const f of files) {
      const lines = headLines(ctx, f.path);
      lines.forEach((line, i) => {
        const m = line.match(re);
        if (!m) return;
        const holder = m[2].replace(/\s*(all rights reserved\.?)\s*$/i, '').replace(/[.\s]+$/, '').trim();
        if (!holder || /free software foundation|<name of author>|\[name of copyright owner\]|\{name of copyright owner\}/i.test(holder)) return;
        found.push({ file: f.path, line: i + 1, holder });
      });
    }
    const expected = [...(ctx.cfg.copyrightHolders || []), ...(ctx.cfg.upstreamHolders || [])].map((s) => s.toLowerCase());
    const ev = found.map((h) => `${h.file}:${h.line} — ${h.holder}`);
    if (!expected.length) return found.length ? warn('holders found; declare copyrightHolders to judge them', ev) : warn('no copyright line names a holder');
    const odd = found.filter((h) => !expected.some((x) => h.holder.toLowerCase().includes(x)));
    if (odd.length) return fail(`${odd.length} copyright line(s) name an unexpected holder`, odd.map((h) => `${h.file}:${h.line} — ${h.holder}`));
    return found.length ? pass(`${found.length} copyright line(s), all expected holders`, ev) : warn('no copyright line names a holder');
  },

  async secretsHead(ctx) {
    const bin = process.env.CW_GITLEAKS || 'gitleaks';
    if (!which(bin)) return unmeasured(`${bin} is not installed`);
    const dir = exportHead(ctx);
    const report = join(dir, '..', `${dir.split('/').pop()}.gitleaks.json`);
    try {
      const r = spawnSync(bin, ['dir', dir, '--no-banner', '--redact', '--report-format', 'json', '--report-path', report, '--exit-code', '0', '--max-target-megabytes', '5'],
        { encoding: 'utf8', timeout: 900_000, maxBuffer: 1 << 26 });
      if (r.error || r.status !== 0) return unmeasured(`gitleaks failed: ${firstLine(r.error || r.stderr)}`);
      const rows = JSON.parse(readFileSync(report, 'utf8') || '[]');
      const expected = (ctx.cfg.secretsExpected || []);
      const rel = (p) => p.startsWith(dir) ? p.slice(dir.length + 1) : p;
      const isExpected = (p) => expected.some((pre) => rel(p).startsWith(pre));
      const real = rows.filter((x) => !isExpected(x.File));
      const byRule = {};
      for (const x of real) byRule[x.RuleID] = (byRule[x.RuleID] || 0) + 1;
      const ev = [...Object.entries(byRule).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`),
        ...real.slice(0, 12).map((x) => `${rel(x.File)}:${x.StartLine} ${x.RuleID}`)];
      if (real.length) return fail(`${real.length} finding(s) outside declared fixture paths${rows.length > real.length ? ` (+${rows.length - real.length} in fixtures)` : ''}`, ev);
      return rows.length ? warn(`${rows.length} finding(s), all under declared fixture paths`, expected.map((p) => `expected: ${p}`)) : pass('gitleaks found nothing in the HEAD export');
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(report, { force: true });
    }
  },

  async secretsHistory(ctx) {
    if (!ctx.flags.history) return unmeasured('history scan not run (pass --history)');
    const bin = process.env.CW_GITLEAKS || 'gitleaks';
    if (!which(bin)) return unmeasured(`${bin} is not installed`);
    const dir = mkdtempSync(join(tmpdir(), 'launchlist-hist-'));
    const report = join(dir, 'report.json');
    try {
      // gitleaks runs `git log -p` itself; the neutralising config rides its environment to that git
      const prepared = scannedGitEnv(ctx.repo);
      if (prepared.error) return unmeasured(`gitleaks not run: ${prepared.error}`);
      const r = spawnSync(bin, ['git', ctx.repo, '--no-banner', '--redact', '--report-format', 'json', '--report-path', report, '--exit-code', '0'],
        { encoding: 'utf8', timeout: 1_800_000, maxBuffer: 1 << 26, env: prepared.env });
      if (r.error || r.status !== 0) return unmeasured(`gitleaks failed: ${firstLine(r.error || r.stderr)}`);
      const rows = JSON.parse(readFileSync(report, 'utf8') || '[]');
      const commits = new Set(rows.map((x) => x.Commit));
      const byRule = {};
      for (const x of rows) byRule[x.RuleID] = (byRule[x.RuleID] || 0) + 1;
      const ev = [`${commits.size} commit(s)`, ...Object.entries(byRule).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}: ${n}`)];
      return rows.length ? fail(`${rows.length} finding(s) in history — review and rotate`, ev) : pass('gitleaks found nothing in history');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  },

  // One matcher, one scope and one reader with the release gates: bin/release-candidate.mjs clears a
  // candidate with this same scanEntries(treeTexts()) call. A literal per-name grep over the release
  // manifest alone counted 4 occurrences where the gate counted 378 (2026-10-04), missing separator
  // variants, prefix forms and two of the three scope documents.
  async identities(ctx) {
    let scope;
    try { scope = ctx.nameScope !== undefined ? ctx.nameScope : loadScope(); } catch (e) { return unmeasured(`name scope unreadable: ${firstLine(e)}`); }
    if (!scope) return unmeasured('no name scope available (the sidecar is absent) — this is not a pass');
    scope = withoutNames(scope, [...(ctx.cfg.selfNames || []), ctx.project, ctx.repoName].filter(Boolean));
    let r;
    try { r = scanEntries(treeTexts(ctx.repo), scope); } catch (e) { return unmeasured(`HEAD unreadable: ${firstLine(e)}`); }
    const shown = (p) => mask(p, findNames(p, scope));
    const groups = new Map();
    for (const { path, hits } of r.content) {
      for (const h of hits) {
        const files = groups.get(`${h.source} ${h.kind}`) || new Map();
        files.set(path, (files.get(path) || 0) + 1);
        groups.set(`${h.source} ${h.kind}`, files);
      }
    }
    let occ = 0;
    const ev = [...groups.entries()].map(([label, files]) => {
      const n = [...files.values()].reduce((a, b) => a + b, 0);
      occ += n;
      const top = [...files.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
      return { n, line: `${label}: ${n} in ${files.size} file(s) — ${top.map(([p, c]) => `${shown(p)} ${c}`).join(', ')}` };
    }).sort((a, b) => b.n - a.n || a.line.localeCompare(b.line)).map((x) => x.line);
    if (r.paths.length) ev.push(`${r.paths.length} path(s) carry a name — ${r.paths.slice(0, 3).map(shown).join(', ')}`);
    const total = occ + r.paths.length;
    return total
      ? fail(`${total} name occurrence(s) at HEAD: ${occ} in ${r.content.length} file(s), ${r.paths.length} in paths`, ev)
      : pass(`none of ${scope.words.length} names or ${scope.prefixes.length} prefixes appear at HEAD`);
  },

  // THE TWO BUCKETS ARE DIFFERENT CLAIMS, so they are counted and reported apart. `/Users/<me>/`
  // discloses the publisher's machine layout, which is the stated reason this item exists.
  // `/Users/x/` in a test fixture discloses nothing and breaks nothing — it is a string the test
  // constructs, and this repository's publication boundary asks for synthetic fixtures by name.
  // Lumping them gave commitwork 115 "home-directory paths" of which ZERO named the operator
  // (measured 2026-10-04), i.e. a number whose whole mass was the check's own conflation. The
  // second bucket is still printed rather than dropped: a home-shaped path naming no account HERE
  // may still name a real one somewhere, and that judgement is the operator's, not this check's.
  // `homePrefixes` is read at call time so a test can declare the home it is measuring against.
  // The account's home comes from the user database as well as $HOME: under a scratch HOME (a
  // clean-export test run) $HOME is a temp path, and `/Users/<me>/` would land in the second bucket.
  async absolutePaths(ctx) {
    const mine = [...new Set([...(ctx.cfg.homePrefixes || []), homedir(), accountHome()])]
      .filter(Boolean).map((p) => (p.endsWith('/') ? p : `${p}/`));
    const hits = matchesByFile(ctx.repo, ['-E', '-e', '/Users/[A-Za-z0-9._-]+/', '-e', '/home/[A-Za-z0-9._-]+/']);
    const own = hits.filter((h) => mine.some((p) => p.startsWith(h.match)));
    const other = hits.filter((h) => !own.includes(h));
    const ownCounts = tally(own.map((h) => h.path));
    const otherCounts = tally(other.map((h) => h.path));
    const otherNote = other.length
      ? `${other.length} home-shaped path(s) in ${otherCounts.length} file(s) name no account on this machine — review as fixtures or placeholders`
      : '';
    if (!own.length) {
      return other.length
        ? warn(`no path names this machine's home; ${otherNote}`, otherCounts.slice(0, 15).map((c) => `${c.path} ${c.n}`))
        : pass('no home-directory paths at HEAD');
    }
    return warn(
      `${own.length} path(s) name this machine's home in ${ownCounts.length} file(s)${otherNote ? `; also ${otherNote}` : ''}`,
      [...ownCounts.map((c) => `${c.path} ${c.n}`), ...(otherNote ? [`— other: ${otherNote}`] : []), ...otherCounts.slice(0, 5).map((c) => `  ${c.path} ${c.n}`)],
    );
  },

  async emails(ctx) {
    const out = gitGrep(ctx.repo, ['-I', '-h', '-o', '-E', '-e', '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\\.[A-Za-z0-9-]+)*\\.[A-Za-z]{2,}', 'HEAD', '--']);
    const allowed = new Set((ctx.cfg.allowedEmails || []).map((s) => s.toLowerCase()));
    const benign = /(@|\.)(example\.(com|org|net)|test|invalid|localhost|users\.noreply\.github\.com)$|^(noreply|no-reply|git)@github\.com$|\.(png|jpe?g|gif|svg|webp)$/i;
    const seen = new Map();
    for (const raw of out.split('\n')) {
      const a = raw.replace(/^HEAD:[^:]*:/, '').trim().toLowerCase();
      if (!a || allowed.has(a) || benign.test(a)) continue;
      seen.set(a, (seen.get(a) || 0) + 1);
    }
    const masked = [...seen.entries()].sort((x, y) => y[1] - x[1]).map(([a, n]) => `${a[0]}***@${a.split('@')[1]} ×${n}`);
    return seen.size ? warn(`${seen.size} address(es) not on the allowlist`, masked) : pass('only allowlisted or example addresses');
  },

  async symlinks(ctx) {
    const links = headTree(ctx).filter((e) => e.mode === '120000');
    const bad = [];
    for (const l of links) {
      const target = git(ctx.repo, ['cat-file', 'blob', l.sha]).trim();
      const resolved = posix.normalize(posix.join(posix.dirname(l.path), target));
      if (target.startsWith('/') || resolved.startsWith('..')) bad.push(`${l.path} → ${target}`);
    }
    return bad.length ? fail(`${bad.length} tracked symlink(s) leave the repository`, bad) : pass(`${links.length} tracked symlink(s), none leave the repository`);
  },

  async binaryAssets(ctx) {
    const numstat = git(ctx.repo, ['diff', '--numstat', '-z', EMPTY_TREE, 'HEAD']);
    const bins = new Set();
    for (const rec of numstat.split('\0')) {
      const m = rec.match(/^-\t-\t(.+)$/);
      if (m) bins.add(m[1]);
    }
    if (!bins.size) return pass('no binary files at HEAD');
    const sized = headTree(ctx).filter((e) => bins.has(e.path)).sort((a, b) => b.size - a.size);
    const total = sized.reduce((a, e) => a + e.size, 0);
    return warn(`${sized.length} binary file(s), ${(total / 1048576).toFixed(1)} MiB — review each`, sized.slice(0, 20).map((e) => `${e.path} ${(e.size / 1024).toFixed(0)} KiB`));
  },

  async agentInstructions(ctx) {
    const re = /(^|\/)(CLAUDE\.md|AGENTS\.md|GEMINI\.md|\.cursorrules|copilot-instructions\.md)$|(^|\/)\.(claude|cursor|windsurf|codex|continue)\//;
    const hits = headTree(ctx).filter((e) => re.test(e.path)).map((e) => e.path);
    if (!hits.length) return pass('no agent instruction files at HEAD');
    const groups = {};
    for (const p of hits) { const k = p.includes('/.') ? p.split('/.')[0] + '/.' + p.split('/.')[1].split('/')[0] : p.split('/').slice(0, 2).join('/'); groups[k] = (groups[k] || 0) + 1; }
    return warn(`${hits.length} agent instruction file(s) — review for private material`, Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`));
  },

  async siblingRefs(ctx) {
    const names = [...new Set(ctx.fleetNames || [])].filter((n) => n && n !== ctx.repoName).sort((a, b) => b.length - a.length);
    if (!names.length) return unmeasured('no sibling repository names known (fleet registry unavailable)');
    const esc = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    // One alternation over a large fleet exceeds the platform regex size limit, and git grep exits 128.
    // Each -e is compiled separately, so a batch per pattern keeps every one small.
    const patterns = [];
    for (let i = 0; i < esc.length; i += SIBLING_BATCH) patterns.push('-e', `(\\.\\./)+(${esc.slice(i, i + SIBLING_BATCH).join('|')})([/"'\`[:space:]]|$)`);
    // THE WHOLE LEADING `../` RUN, not just the segment before the name. `../../name/x` written in a
    // file two directories deep is this repository's OWN path, and only the full run says so: matching
    // `\.\./name` alone matches the tail of it and reports a sibling dependency that does not exist.
    // Measured on commitwork 2026-10-04: 4 of 9 reported references were dot-dot-doubled paths in
    // bin/ and lib/test/ naming the tracked in-tree commitwork-web directory.
    const hits = matchesByFile(ctx.repo, ['-E', ...patterns]);
    const inside = trackedPrefixes(ctx);
    const outside = [];
    const exempt = [];
    for (const { path, match } of hits) {
      const spec = match.replace(/[/"'`\s]+$/, '');
      const resolved = posix.normalize(posix.join(posix.dirname(path), spec)).replace(/\/+$/, '');
      // Resolving to something we ship is proof it is not a sibling checkout. Anything else — a path
      // that leaves the root, or one inside it that nothing tracks — is still reported.
      (inside.has(resolved) ? exempt : outside).push({ path, resolved });
    }
    const counts = tally(outside.map((o) => o.path));
    const n = outside.length;
    const note = exempt.length ? `; ${exempt.length} in-repo reference(s) exempt (resolve to tracked paths: ${[...new Set(exempt.map((e) => e.resolved))].slice(0, 3).join(', ')})` : '';
    return n
      ? fail(`${n} reference(s) to sibling repositories in ${counts.length} file(s)${note}`, counts.slice(0, 15).map((c) => `${c.path} ${c.n}`))
      : pass(`no ../ references to ${names.length} sibling repositories${note}`);
  },

  async publicTest(ctx) {
    const t = ctx.cfg.publicTest;
    if (!t || !t.cmd) return unmeasured('no publicTest declared for this project (config: publicTest {cmd, args})');
    if (!ctx.flags.tests) return unmeasured('public test not run (pass --tests)');
    const dir = exportHead(ctx);
    const homeDir = mkdtempSync(join(tmpdir(), 'launchlist-home-'));
    try {
      // A public clone is a git repository with one root commit, not a bare archive; tests that read
      // their own history would otherwise fail for a reason no stranger's clone has.
      const root = ['-c', 'user.name=launchlist', '-c', 'user.email=launchlist@example.invalid', '-c', 'commit.gpgsign=false'];
      execFileSync('git', ['init', '-q', '-b', 'main', dir], { timeout: 60_000 });
      execFileSync('git', ['-C', dir, 'add', '-A'], { timeout: 600_000, maxBuffer: 1 << 26 });
      execFileSync('git', ['-C', dir, ...root, 'commit', '-q', '--no-verify', '-m', 'root'], { timeout: 600_000, maxBuffer: 1 << 26, env: { ...process.env, HOME: homeDir } });
      if (t.setup) {
        const s = spawnSync(t.setup.cmd, t.setup.args || [], { cwd: dir, encoding: 'utf8', timeout: t.setup.timeoutMs || 900_000, maxBuffer: 1 << 26, env: { ...process.env, HOME: homeDir } });
        if (s.error || s.status !== 0) return fail(`setup (${t.setup.cmd}) exited ${s.status}`, String(s.stderr || s.stdout || '').trim().split('\n').slice(-15));
      }
      const r = spawnSync(t.cmd, t.args || [], {
        cwd: dir, encoding: 'utf8', timeout: t.timeoutMs || 1_800_000, maxBuffer: 1 << 28,
        env: { ...process.env, HOME: homeDir, CW_SIDECAR: join(homeDir, 'no-sidecar'), ...(t.env || {}) },
      });
      if (r.error) return unmeasured(`could not run ${t.cmd}: ${firstLine(r.error)}`);
      // A 44-minute suite's last lines were an assertion tail and npm's upgrade notice: no count and
      // no name of what failed. The node:test summary and the failing names are the evidence.
      const text = `${r.stdout || ''}\n${r.stderr || ''}`;
      const lines = text.trim().split('\n').filter((l) => !/^npm notice\b/.test(l));
      const c = testCounts(text);
      const counted = c.tests === null ? [] : [`${c.tests} tests · ${c.pass} pass · ${c.fail} fail · ${c.skipped ?? 0} skipped`];
      if (r.status === 0) return pass(`${t.cmd} ${(t.args || []).join(' ')} passed from a clean export`, [...counted, ...lines.slice(-3)]);
      const failing = [...new Set(lines
        .map((l) => l.match(/^\s*(?:✖|not ok \d+ - )\s*(.+?)(?:\s+\([\d.]+m?s\))?\s*$/))
        .filter((m) => m && m[1] !== 'failing tests:').map((m) => m[1]))];
      const of = c.fail === null ? '' : ` (${c.fail} of ${c.tests} failed)`;
      return fail(`${t.cmd} exited ${r.status} from a clean export${of}`, [...counted, ...failing.slice(0, 12), ...lines.slice(-5)]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
      rmSync(homeDir, { recursive: true, force: true });
    }
  },

  async dirtyTree(ctx) {
    const out = git(ctx.repo, ['status', '--porcelain=v1']);
    const lines = out.split('\n').filter(Boolean);
    const untracked = lines.filter((l) => l.startsWith('??')).length;
    return lines.length ? warn(`${lines.length - untracked} modified, ${untracked} untracked`) : pass('working tree clean');
  },

  async originSync(ctx) {
    let branch;
    try { branch = ctx.cfg.branch || git(ctx.repo, ['symbolic-ref', '--short', 'HEAD']).trim(); } catch { return unmeasured('HEAD is detached'); }
    let remote;
    try { remote = git(ctx.repo, ['ls-remote', 'origin', `refs/heads/${branch}`], { timeout: 30_000 }).split('\t')[0].trim(); } catch (e) { return unmeasured(`origin unreachable: ${firstLine(e)}`); }
    if (!remote) return warn(`origin has no ${branch}`);
    const local = git(ctx.repo, ['rev-parse', branch]).trim();
    if (remote === local) return pass(`${branch} matches origin at ${local.slice(0, 8)}`);
    try {
      git(ctx.repo, ['cat-file', '-e', `${remote}^{commit}`]);
      const [behind, ahead] = git(ctx.repo, ['rev-list', '--left-right', '--count', `${remote}...${local}`]).trim().split(/\s+/).map(Number);
      return warn(`${branch}: origin ahead ${behind}, local ahead ${ahead}`);
    } catch { return warn(`origin ${branch} is at ${remote.slice(0, 8)}, not fetched locally`); }
  },

  async readme(ctx) {
    const f = headTree(ctx).find((e) => !e.path.includes('/') && /^README(\.[a-z]+)?$/i.test(e.path));
    return f ? pass(`${f.path} present`) : fail('no README at the root of HEAD');
  },

  async securityPolicy(ctx) {
    const f = headTree(ctx).find((e) => /^(|\.github\/|docs\/)SECURITY\.md$/i.test(e.path));
    return f ? pass(`${f.path} present`) : fail('no SECURITY.md at the root, .github/ or docs/');
  },

  async contributing(ctx) {
    const f = headTree(ctx).find((e) => /^(|\.github\/|docs\/)CONTRIBUTING(\.md)?$/i.test(e.path));
    return f ? pass(`${f.path} present`) : fail('no CONTRIBUTING at the root, .github/ or docs/');
  },

  async readmeBadges(ctx) {
    const f = headTree(ctx).find((e) => !e.path.includes('/') && /^README(\.md)?$/i.test(e.path));
    if (!f) return pass('no README to carry badges');
    const text = showHead(ctx, f.path);
    const refs = new Set();
    const add = (r, n) => { if (n) refs.add(`${r}\t${decodeURIComponent(n).replace(/\.(svg|png|json)$/, '')}`); };
    for (const m of text.matchAll(/img\.shields\.io\/crates\/[a-z]+\/([A-Za-z0-9_-]+)/g)) add('crates', m[1]);
    for (const m of text.matchAll(/crates\.io\/crates\/([A-Za-z0-9_-]+)/g)) add('crates', m[1]);
    for (const m of text.matchAll(/img\.shields\.io\/npm\/[a-z]+\/((?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+)/g)) add('npm', m[1]);
    for (const m of text.matchAll(/npmjs\.com\/package\/((?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+)/g)) add('npm', m[1]);
    for (const m of text.matchAll(/img\.shields\.io\/pypi\/[a-z]+\/([A-Za-z0-9._-]+)/g)) add('pypi', m[1]);
    for (const m of text.matchAll(/pypi\.org\/project\/([A-Za-z0-9._-]+)/g)) add('pypi', m[1]);
    for (const m of text.matchAll(/img\.shields\.io\/docker\/[a-z-]+\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)/g)) add('docker', m[1]);
    for (const m of text.matchAll(/hub\.docker\.com\/r\/([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)/g)) add('docker', m[1]);
    if (!refs.size) return pass('no registry badges or links in the README');
    const found = [];
    for (const r of [...refs].sort()) {
      const [reg, name] = r.split('\t');
      try { found.push(await probePackage(ctx, reg, name)); } catch (e) { return unmeasured(`${reg} ${name}: ${firstLine(e)}`); }
    }
    const ev = found.map(describePkg);
    if (found.some((p) => p.state === 'free' || p.state === 'taken')) return fail('the README links packages that do not exist or belong to someone else', ev);
    if (found.some((p) => p.state === 'exists')) return warn('linked packages exist; ownership unverified (config: accounts)', ev);
    return pass('every linked package exists under the configured account', ev);
  },

  async workflows(ctx) {
    const files = headTree(ctx).filter((e) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(e.path));
    if (!files.length) return pass('no GitHub Actions workflows');
    const hard = [];
    const soft = [];
    for (const f of files) {
      const y = showHead(ctx, f.path);
      if (/\bpull_request_target\b/.test(y)) hard.push(`${f.path}: pull_request_target`);
      if (/runs-on:[^\n]*self-hosted/.test(y)) hard.push(`${f.path}: self-hosted runner`);
      if (!/^permissions:/m.test(y)) soft.push(`${f.path}: no top-level permissions block`);
      for (const m of y.matchAll(/uses:\s*['"]?([^@\s'"]+)@([^\s#'"]+)/g)) {
        const [action, ref] = [m[1], m[2]];
        if (action.startsWith('./') || action.startsWith('docker://') || /^[0-9a-f]{40}$/.test(ref)) continue;
        soft.push(`${f.path}: ${action}@${ref} not pinned to a SHA`);
      }
    }
    if (hard.length) return fail(`${hard.length} unsafe trigger/runner(s) across ${files.length} workflow(s)`, [...hard, ...soft]);
    return soft.length ? warn(`${soft.length} hardening gap(s) across ${files.length} workflow(s)`, soft) : pass(`${files.length} workflow(s): pinned, scoped, no unsafe triggers`);
  },

  async githubSecrets(ctx) {
    const slug = githubSlug(ctx);
    if (!slug) return unmeasured('no GitHub origin remote');
    try {
      const names = gh(ctx, ['api', `repos/${slug}/actions/secrets`, '--jq', '.secrets[].name']).split('\n').filter(Boolean);
      return names.length ? warn(`${names.length} repository secret(s) — review scope`, names) : pass('no repository secrets');
    } catch (e) { return unmeasured(`gh could not read secrets for ${slug}: ${firstLine(e)}`); }
  },

  async siteReach(ctx) {
    const g = siteGuard(ctx);
    if (g) return g;
    try {
      const h = await home(ctx);
      return h.status === 200 ? pass(`${h.url} answered 200`) : fail(`${h.url} answered HTTP ${h.status}`);
    } catch (e) { return unmeasured(`could not fetch ${ctx.cfg.site}: ${firstLine(e)}`); }
  },

  async siteHttps(ctx) {
    const g = siteGuard(ctx);
    if (g) return g;
    const u = new URL(ctx.cfg.site);
    try {
      const r = await fetchText(ctx, `http://${u.host}/`, { redirect: 'manual' });
      const loc = r.headers.get('location') || '';
      if ([301, 302, 307, 308].includes(r.status) && loc.startsWith('https://')) return pass(`http → ${r.status} → ${loc}`);
      return fail(`http://${u.host}/ answered ${r.status}${loc ? ` → ${loc}` : ''}`);
    } catch (e) { return warn(`http://${u.host}/ unreachable (${firstLine(e)}) — acceptable only if port 80 is closed on purpose`); }
  },

  async siteHeaders(ctx) {
    return siteCheck(ctx, (h) => {
      const hd = (k) => h.headers.get(k) || '';
      const csp = hd('content-security-policy');
      const missing = [];
      if (!hd('strict-transport-security')) missing.push('strict-transport-security');
      if (!csp) missing.push('content-security-policy');
      if (!/nosniff/i.test(hd('x-content-type-options'))) missing.push('x-content-type-options: nosniff');
      if (!hd('referrer-policy')) missing.push('referrer-policy');
      if (!hd('x-frame-options') && !/frame-ancestors/i.test(csp)) missing.push('x-frame-options or CSP frame-ancestors');
      return missing.length ? warn(`${missing.length} header(s) missing`, missing) : pass('HSTS, CSP, nosniff, referrer policy and framing all set');
    });
  },

  async siteMeta(ctx) {
    return siteCheck(ctx, (h) => {
      const { tags, title } = parseTags(h.text);
      const missing = [];
      if (!title) missing.push('<title>');
      if (!metaContent(tags, 'description')) missing.push('meta description');
      if (!metaContent(tags, 'viewport')) missing.push('meta viewport');
      if (!tags.some((t) => t.tag === 'html' && t.attrs.lang)) missing.push('html lang');
      if (!tags.some((t) => t.tag === 'link' && /(^|\s)canonical(\s|$)/i.test(t.attrs.rel || ''))) missing.push('link rel=canonical');
      return missing.length ? warn(`${missing.length} missing`, missing) : pass(`title "${title.slice(0, 60)}", description, viewport, lang, canonical`);
    });
  },

  async siteSocial(ctx) {
    return siteCheck(ctx, async (h) => {
      const { tags } = parseTags(h.text);
      const missing = ['og:title', 'og:description', 'og:image'].filter((k) => !metaContent(tags, k));
      if (missing.length) return warn(`${missing.length} Open Graph tag(s) missing`, missing);
      const img = new URL(metaContent(tags, 'og:image'), h.url).href;
      try {
        const r = await fetchText(ctx, img, { method: 'HEAD' });
        return r.status === 200 ? pass('og:title, og:description, og:image (resolves)') : warn(`og:image answered HTTP ${r.status}`, [img]);
      } catch (e) { return warn(`og:image did not load: ${firstLine(e)}`, [img]); }
    });
  },

  async siteFavicon(ctx) {
    return siteCheck(ctx, async (h) => {
      const { tags } = parseTags(h.text);
      const link = tags.find((t) => t.tag === 'link' && /(^|\s)icon(\s|$)/i.test(t.attrs.rel || '') && t.attrs.href);
      if (link && link.attrs.href.startsWith('data:')) return pass('inline data: favicon');
      const url = new URL(link ? link.attrs.href : '/favicon.ico', h.url).href;
      try {
        const r = await fetchText(ctx, url, { method: 'HEAD' });
        return r.status === 200 ? pass(`${url} resolves`) : warn(`${url} answered HTTP ${r.status}`);
      } catch (e) { return warn(`${url} did not load: ${firstLine(e)}`); }
    });
  },

  async siteCrawl(ctx) {
    const g = siteGuard(ctx);
    if (g) return g;
    const base = new URL(ctx.cfg.site);
    const out = [];
    for (const p of ['/robots.txt', '/sitemap.xml']) {
      try {
        const r = await fetchText(ctx, new URL(p, base).href);
        const ok = r.status === 200 && (p === '/robots.txt' ? !/<html/i.test(r.text.slice(0, 200)) : /<(urlset|sitemapindex)\b/i.test(r.text.slice(0, 2000)));
        out.push({ p, ok, detail: `${p}: HTTP ${r.status}${r.status === 200 && !ok ? ' but not the expected format' : ''}` });
      } catch (e) { return unmeasured(`${p}: ${firstLine(e)}`); }
    }
    return out.every((x) => x.ok) ? pass('robots.txt and sitemap.xml present', out.map((x) => x.detail)) : warn('crawler files missing or malformed', out.map((x) => x.detail));
  },

  async site404(ctx) {
    const g = siteGuard(ctx);
    if (g) return g;
    const url = new URL('/__launchlist-404-probe__', ctx.cfg.site).href;
    try {
      const r = await fetchText(ctx, url);
      if (r.status === 404) return pass('unknown paths answer 404');
      if (r.status === 200) return fail('unknown paths answer 200 (soft 404)', [url]);
      return warn(`unknown paths answer HTTP ${r.status}`, [url]);
    } catch (e) { return unmeasured(`${url}: ${firstLine(e)}`); }
  },

  async siteThirdParty(ctx) {
    return siteCheck(ctx, (h) => {
      const { tags } = parseTags(h.text);
      const origin = new URL(h.url).origin;
      const ext = new Set();
      for (const t of tags) {
        const src = t.tag === 'script' ? t.attrs.src : (t.tag === 'link' && /stylesheet|preload|modulepreload/i.test(t.attrs.rel || '') ? t.attrs.href : null);
        if (!src) continue;
        try { const o = new URL(src, h.url).origin; if (o !== origin) ext.add(o); } catch { /* malformed src is not an origin */ }
      }
      return ext.size ? warn(`${ext.size} third-party origin(s)`, [...ext].sort()) : pass('all scripts and styles are first-party');
    });
  },

  async sitePrivacyLink(ctx) {
    return siteCheck(ctx, (h) => (/<a\b[^>]*href=["'][^"']*privacy[^"']*["']/i.test(h.text) || /<a\b[^>]*>[^<]*privacy[^<]*<\/a>/i.test(h.text)
      ? pass('privacy link present') : warn('no link to a privacy policy on the home page')));
  },
};

/** Run every measured item for one project. Never throws per check: a crash is UNMEASURED with its reason. */
export async function runChecks(ctx, items) {
  mkdirSync(tmpdir(), { recursive: true });
  const results = {};
  for (const it of items) {
    if (!it.check) continue;
    const fn = CHECKS[it.check];
    if (!fn) { results[it.id] = unmeasured(`unknown check ${it.check}`); continue; }
    try { results[it.id] = await fn(ctx); } catch (e) { results[it.id] = unmeasured(`check failed to run: ${firstLine(e)}`); }
  }
  return results;
}

export function repoFacts(repo) {
  const head = git(repo, ['rev-parse', 'HEAD']).trim();
  let branch = null;
  try { branch = git(repo, ['symbolic-ref', '--short', 'HEAD']).trim(); } catch { /* detached */ }
  return { head, branch };
}
