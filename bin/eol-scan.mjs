#!/usr/bin/env node
// bin/eol-scan.mjs — runtimes and base images a repository pins to a release past its end of life.
//
// usage: node bin/eol-scan.mjs <repoDir> [--out <file.sarif>]
// Writes SARIF (stdout without --out). Reads manifests/eol-snapshot.json offline.
// exit: 0 written, whatever it found · 2 bad arguments or an unreadable snapshot
// env, read at call time: CW_NOW (the as-of date), CW_EOL_SNAPSHOT (snapshot path)
//
// What counts as a declaration is a version the repository RUNS on, pinned to one release line:
// a Dockerfile FROM or Compose image tag, .nvmrc / .node-version, package.json engines.node when it
// names one major, .python-version, runtime.txt, .ruby-version, .tool-versions and go.mod's toolchain
// line. Minimums are not declarations: `engines: ">=16"`, `requires-python >= 3.8` and go.mod's `go`
// directive accept current releases, so they are skipped rather than reported. CI matrices are skipped
// too: testing on an old release is how a library proves it still supports it.
import { readFileSync, readdirSync, writeFileSync, lstatSync } from 'node:fs';
import { join, relative, basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { snapshotPath } from './eol-snapshot.mjs';
import { classifyWorktreePath } from '../monitor/worktree-paths.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'target', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__', '.tox', 'bower_components']);
const DEPTH_MAX = 8;
const ENDING_DAYS = 90;

const LABEL = Object.freeze({
  nodejs: 'Node.js', python: 'Python', go: 'Go', ruby: 'Ruby', php: 'PHP', 'eclipse-temurin': 'Eclipse Temurin',
  dotnet: '.NET', debian: 'Debian', ubuntu: 'Ubuntu', 'alpine-linux': 'Alpine Linux', postgresql: 'PostgreSQL',
  mysql: 'MySQL', redis: 'Redis', nginx: 'nginx',
});
// Docker Hub image name (last path segment, or a known registry path) → endoflife.date product.
const IMAGE_PRODUCT = Object.freeze({
  node: 'nodejs', python: 'python', golang: 'go', ruby: 'ruby', php: 'php', 'eclipse-temurin': 'eclipse-temurin',
  debian: 'debian', ubuntu: 'ubuntu', alpine: 'alpine-linux', postgres: 'postgresql', mysql: 'mysql',
  redis: 'redis', nginx: 'nginx',
});
const TOOL_PRODUCT = Object.freeze({ nodejs: 'nodejs', node: 'nodejs', python: 'python', golang: 'go', go: 'go', ruby: 'ruby', php: 'php' });

const asOf = () => {
  const n = process.env.CW_NOW ? new Date(process.env.CW_NOW) : new Date();
  return Number.isNaN(n.getTime()) ? new Date() : n;
};

/** A declared version string → the snapshot cycle it belongs to, or null. Longest prefix wins. */
export function cycleFor(product, version, snapshot) {
  const cycles = (snapshot.products || {})[product];
  if (!cycles || !version) return null;
  const v = String(version).trim().toLowerCase().replace(/^v(?=\d)/, '');
  const m = /^(\d+(?:\.\d+)*)/.exec(v);
  if (m) {
    const parts = m[1].split('.');
    for (let n = parts.length; n >= 1; n--) {
      const hit = cycles.find((c) => c.cycle === parts.slice(0, n).join('.'));
      if (hit) return hit;
    }
    return null;
  }
  const word = v.split(/[-_.]/)[0];
  return cycles.find((c) => c.codename && c.codename.split(' ')[0] === word) || null;
}

/** eol | ending | supported, from the cycle's eol field and the as-of date. */
export function statusOf(cycle, now = asOf()) {
  if (cycle.eol === true) return { status: 'eol', date: null };
  if (cycle.eol === false || cycle.eol == null) return { status: 'supported', date: null };
  const end = new Date(`${cycle.eol}T00:00:00Z`);
  if (end <= now) return { status: 'eol', date: cycle.eol };
  if ((end - now) / 86_400_000 <= ENDING_DAYS) return { status: 'ending', date: cycle.eol };
  return { status: 'supported', date: cycle.eol };
}

/** {product, version} from an image reference, or null for an image or tag it cannot read. */
export function imageVersion(ref) {
  const r = String(ref || '').trim().replace(/@sha256:[0-9a-f]+$/i, '');
  if (!r || r.includes('$')) return null;
  const at = r.lastIndexOf(':');
  const slash = r.lastIndexOf('/');
  const name = at > slash ? r.slice(0, at) : r;
  const tag = at > slash ? r.slice(at + 1) : '';
  if (!tag || tag === 'latest') return null;
  const dotnet = /^mcr\.microsoft\.com\/dotnet\/(?:sdk|aspnet|runtime|runtime-deps)$/i.test(name);
  // Official images only: a third-party image reuses the name and tags its own version (mxnet/python:1.9.1).
  const official = !name.includes('/') || /(^|\/)library\/[^/]+$/i.test(name) || /^docker\.io\/[^/]+$/i.test(name);
  const product = dotnet ? 'dotnet' : (official ? IMAGE_PRODUCT[name.split('/').pop().toLowerCase()] : undefined);
  return product ? { product, version: tag } : null;
}

/** package.json engines.node when it pins one major ("16", "16.x", "^16", "~16.1", "16.20.0"). */
export function enginesNodeVersion(spec) {
  const s = String(spec || '').trim();
  const m = /^[\^~]?v?(\d+)(?:\.(?:\d+|x|\*))?(?:\.(?:\d+|x|\*))?$/.exec(s);
  return m ? m[1] : null;
}

function lineOf(text, needle) {
  const i = text.indexOf(needle);
  return i < 0 ? 1 : text.slice(0, i).split('\n').length;
}

/** Every declaration in one file: [{product, version, line, source}]. */
export function declarationsIn(name, text) {
  const out = [];
  const lower = name.toLowerCase();
  if (lower === 'dockerfile' || lower.endsWith('.dockerfile') || lower.startsWith('dockerfile.')) {
    text.split('\n').forEach((l, i) => {
      const m = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)/i.exec(l);
      const iv = m && imageVersion(m[1]);
      if (iv) out.push({ ...iv, line: i + 1, source: 'Dockerfile FROM' });
    });
  } else if (/^(docker-)?compose[\w.-]*\.ya?ml$/.test(lower)) {
    text.split('\n').forEach((l, i) => {
      const m = /^\s*image:\s*["']?([^"'\s#]+)/.exec(l);
      const iv = m && imageVersion(m[1]);
      if (iv) out.push({ ...iv, line: i + 1, source: 'Compose image' });
    });
  } else if (lower === '.nvmrc' || lower === '.node-version') {
    const v = text.split('\n')[0].trim();
    if (/^v?\d/.test(v)) out.push({ product: 'nodejs', version: v, line: 1, source: lower });
  } else if (lower === 'package.json') {
    let j; try { j = JSON.parse(text); } catch { return out; }
    const spec = j && j.engines && typeof j.engines.node === 'string' ? j.engines.node : null;
    const major = enginesNodeVersion(spec);
    if (major) out.push({ product: 'nodejs', version: major, line: lineOf(text, '"node"'), source: 'package.json engines.node' });
  } else if (lower === '.python-version') {
    const v = text.split('\n')[0].trim();
    if (/^\d/.test(v)) out.push({ product: 'python', version: v, line: 1, source: lower });
  } else if (lower === 'runtime.txt') {
    const m = /^python-(\d[\d.]*)/m.exec(text);
    if (m) out.push({ product: 'python', version: m[1], line: lineOf(text, m[0]), source: lower });
  } else if (lower === '.ruby-version') {
    const v = text.split('\n')[0].trim().replace(/^ruby-/, '');
    if (/^\d/.test(v)) out.push({ product: 'ruby', version: v, line: 1, source: lower });
  } else if (lower === '.tool-versions') {
    text.split('\n').forEach((l, i) => {
      const m = /^\s*(\S+)\s+(\d[\w.]*)/.exec(l);
      const product = m && TOOL_PRODUCT[m[1].toLowerCase()];
      if (product) out.push({ product, version: m[2], line: i + 1, source: lower });
    });
  } else if (lower === 'go.mod') {
    const m = /^toolchain\s+go(\d[\d.]*)/m.exec(text);
    if (m) out.push({ product: 'go', version: m[1], line: lineOf(text, m[0]), source: 'go.mod toolchain' });
  }
  return out;
}

const CANDIDATE = (n) => {
  const l = n.toLowerCase();
  return l === 'dockerfile' || l.endsWith('.dockerfile') || l.startsWith('dockerfile.') || /^(docker-)?compose[\w.-]*\.ya?ml$/.test(l)
    || ['.nvmrc', '.node-version', 'package.json', '.python-version', 'runtime.txt', '.ruby-version', '.tool-versions', 'go.mod'].includes(l);
};

function* walk(root, dir = root, depth = 0) {
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    const rel = relative(root, p);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || depth >= DEPTH_MAX) continue;
      if (classifyWorktreePath(`${rel}/x/y`).worktree && rel.split('/').length >= 2) continue;
      yield* walk(root, p, depth + 1);
    } else if (e.isFile() && CANDIDATE(e.name)) yield rel;
  }
}

/** SARIF for one repository. */
export function scan(repoDir, snapshot, now = asOf()) {
  const rules = new Map(); const results = []; const undetermined = [];
  for (const rel of [...walk(repoDir)].sort()) {
    let text; try {
      if (lstatSync(join(repoDir, rel)).size > 2_000_000) continue;
      text = readFileSync(join(repoDir, rel), 'utf8');
    } catch { continue; }
    for (const d of declarationsIn(basename(rel), text)) {
      const cycle = cycleFor(d.product, d.version, snapshot);
      if (!cycle) { undetermined.push({ file: rel, line: d.line, product: d.product, version: d.version }); continue; }
      const st = statusOf(cycle, now);
      if (st.status === 'supported') continue;
      const id = `eol/${d.product}-${cycle.cycle}`;
      const label = `${LABEL[d.product]} ${cycle.cycle}`;
      const when = st.status === 'eol' ? (st.date ? `reached end of life on ${st.date}` : 'is past end of life') : `reaches end of life on ${st.date}`;
      if (!rules.has(id)) rules.set(id, { id, name: id, shortDescription: { text: `${label} ${when}` }, defaultConfiguration: { level: st.status === 'eol' ? 'warning' : 'note' }, properties: { tags: ['CWE-1104: Use of Unmaintained Third Party Components'] } });
      results.push({
        ruleId: id, level: st.status === 'eol' ? 'warning' : 'note',
        message: { text: `${rel} pins ${LABEL[d.product]} ${d.version} (${d.source}); ${label} ${when}, after which it receives no security fixes. Move to a supported release.` },
        locations: [{ physicalLocation: { artifactLocation: { uri: rel }, region: { startLine: d.line } } }],
      });
    }
  }
  return {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [{
      tool: { driver: { name: 'commitwork-eol', rules: [...rules.values()].sort((a, b) => (a.id < b.id ? -1 : 1)) } },
      invocations: [{ executionSuccessful: true, toolExecutionNotifications: [] }],
      properties: { snapshotFetched: snapshot.fetched || null, asOf: now.toISOString().slice(0, 10), undetermined },
      results,
    }],
  };
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const outAt = args.indexOf('--out');
  const out = outAt >= 0 ? args[outAt + 1] : null;
  const repo = args.find((a, i) => !a.startsWith('--') && (outAt < 0 || i !== outAt + 1));
  if (!repo) { console.error('usage: node bin/eol-scan.mjs <repoDir> [--out <file.sarif>]'); process.exit(2); }
  let snapshot;
  try { snapshot = JSON.parse(readFileSync(snapshotPath(), 'utf8')); } catch (e) {
    console.error(`eol-scan: cannot read the snapshot at ${snapshotPath()}: ${e.message}`);
    process.exit(2);
  }
  const doc = `${JSON.stringify(scan(resolve(repo), snapshot), null, 1)}\n`;
  if (out) writeFileSync(out, doc); else process.stdout.write(doc);
}
