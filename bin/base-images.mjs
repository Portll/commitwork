#!/usr/bin/env node
// bin/base-images.mjs — OS-package CVEs in the base images a repository's Dockerfiles and Compose
// files name, by pinned reference, without building anything.
//
// usage: node bin/base-images.mjs <repoDir> --out <file.sarif>
// Each image named by a Dockerfile FROM or a Compose image: line is scanned with
// `trivy image --image-src remote` (no Docker daemon). A vulnerability with a fixed version becomes a
// finding on the line that names the image: bumping that tag is the fix. Unfixed vulnerabilities are
// counted per image in the run properties, never dropped. An image Trivy could not scan is a
// "Image not scanned" notification on its file, which reads as reduced coverage, never as clean.
// exit: 0 written · 2 bad arguments
// env, read at call time: CW_TRIVY_TIMEOUT_MS (per image, default 300000), CW_BASE_IMAGES_MAX (images
//   per repository, default 20), CW_TRIVY (the trivy binary, default `trivy`)
import { readFileSync, readdirSync, writeFileSync, lstatSync } from 'node:fs';
import { join, relative, basename, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { classifyWorktreePath } from '../monitor/worktree-paths.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const SKIP_DIRS = new Set(['.git', 'node_modules', 'vendor', 'target', 'dist', 'build', '.next', '.venv', 'venv', '__pycache__']);
const DEPTH_MAX = 8;
const trivyBin = () => process.env.CW_TRIVY || 'trivy';
const timeoutMs = () => Number(process.env.CW_TRIVY_TIMEOUT_MS) || 300_000;
const imagesMax = () => Number(process.env.CW_BASE_IMAGES_MAX) || 20;

// Trivy severity → SARIF level and the security-severity band monitor/sarif-read.mjs reads.
const SEVERITY = Object.freeze({
  CRITICAL: { level: 'error', score: '9.5' }, HIGH: { level: 'error', score: '8.0' },
  MEDIUM: { level: 'warning', score: '5.5' }, LOW: { level: 'note', score: '2.0' }, UNKNOWN: { level: 'note', score: '2.0' },
});

const isDockerfile = (n) => { const l = n.toLowerCase(); return l === 'dockerfile' || l.endsWith('.dockerfile') || l.startsWith('dockerfile.'); };
const isCompose = (n) => /^(docker-)?compose[\w.-]*\.ya?ml$/.test(n.toLowerCase());

/** Image references one file names: [{ref, line}]. Build stages, scratch and variable refs are skipped. */
export function imageRefsIn(name, text) {
  const out = [];
  if (isDockerfile(name)) {
    const stages = new Set();
    text.split('\n').forEach((l, i) => {
      const m = /^\s*FROM\s+(?:--platform=\S+\s+)?(\S+)(?:\s+AS\s+(\S+))?/i.exec(l);
      if (!m) return;
      const ref = m[1];
      const earlierStage = stages.has(ref.toLowerCase());
      if (m[2]) stages.add(m[2].toLowerCase());
      if (ref.includes('$') || ref.toLowerCase() === 'scratch' || earlierStage) return;
      out.push({ ref, line: i + 1 });
    });
  } else if (isCompose(name)) {
    text.split('\n').forEach((l, i) => {
      const m = /^\s*image:\s*["']?([^"'\s#]+)/.exec(l);
      if (m && !m[1].includes('$')) out.push({ ref: m[1], line: i + 1 });
    });
  }
  return out;
}

function* walk(root, dir = root, depth = 0) {
  let entries; try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e.name);
    const rel = relative(root, p);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name) || depth >= DEPTH_MAX) continue;
      if (classifyWorktreePath(`${rel}/x/y`).worktree && rel.split('/').length >= 2) continue;
      yield* walk(root, p, depth + 1);
    } else if (e.isFile() && (isDockerfile(e.name) || isCompose(e.name))) yield rel;
  }
}

/** {ref → [{file, line}]}, refs sorted. */
export function collectRefs(repoDir) {
  const byRef = new Map();
  for (const rel of [...walk(repoDir)].sort()) {
    let text; try {
      if (lstatSync(join(repoDir, rel)).size > 1_000_000) continue;
      text = readFileSync(join(repoDir, rel), 'utf8');
    } catch { continue; }
    for (const { ref, line } of imageRefsIn(basename(rel), text)) {
      if (!byRef.has(ref)) byRef.set(ref, []);
      byRef.get(ref).push({ file: rel, line });
    }
  }
  return new Map([...byRef].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** Trivy JSON for one image, or {error}. */
export function scanImage(ref) {
  const r = spawnSync(trivyBin(), ['image', '--image-src', 'remote', '--scanners', 'vuln', '--format', 'json', '--quiet', ref],
    { encoding: 'utf8', timeout: timeoutMs(), maxBuffer: 256 * 1024 * 1024 });
  if (r.error) return { error: r.error.code === 'ETIMEDOUT' ? 'timed out' : String(r.error.code || r.error.message) };
  if (r.status !== 0) return { error: (r.stderr || '').trim().split('\n').filter(Boolean).pop() || `trivy exited ${r.status}` };
  try { return { report: JSON.parse(r.stdout) }; } catch { return { error: 'trivy wrote no readable JSON' }; }
}

/** SARIF from the refs and a scan function (injectable for tests). */
export function toSarif(refs, scan = scanImage, { trivyPresent = true } = {}) {
  const rules = new Map(); const results = []; const notifications = []; const images = [];
  const seen = new Set();
  if (!trivyPresent && refs.size) {
    return sarifDoc([], [], [{ descriptor: { id: 'trivy-missing' }, level: 'error', message: { text: 'trivy is not installed; no base image was scanned' } }], [], false);
  }
  let n = 0;
  for (const [ref, where] of refs) {
    const notice = (why) => where.forEach((w) => notifications.push({
      descriptor: { id: 'Image not scanned' }, level: 'warning', message: { text: `Image ${ref} not scanned: ${why}` },
      locations: [{ physicalLocation: { artifactLocation: { uri: w.file }, region: { startLine: w.line } } }],
    }));
    if (++n > imagesMax()) { notice(`over the ${imagesMax()}-image limit (CW_BASE_IMAGES_MAX)`); images.push({ ref, scanned: false }); continue; }
    const out = scan(ref);
    if (out.error) { notice(out.error); images.push({ ref, scanned: false }); continue; }
    // A distribution past end of support gets no advisories, so Trivy reports nothing for it: a zero
    // that is silence, not a clean image (measured: alpine:3.15, EOSL true, 0 vulnerabilities).
    const os = (out.report.Metadata && out.report.Metadata.OS) || {};
    if (os.EOSL) notice(`its OS (${os.Family || '?'} ${os.Name || '?'}) is past end of support, so Trivy has no advisories for it`);
    const vulns = (out.report.Results || []).flatMap((r) => r.Vulnerabilities || []);
    const unfixed = {};
    let fixable = 0;
    for (const v of vulns) {
      const sev = SEVERITY[v.Severity] ? v.Severity : 'UNKNOWN';
      if (!v.FixedVersion) { unfixed[sev] = (unfixed[sev] || 0) + 1; continue; }
      fixable++;
      const id = String(v.VulnerabilityID);
      if (!rules.has(id)) {
        rules.set(id, { id, name: id, shortDescription: { text: String(v.Title || `${v.PkgName} ${id}`).replace(/\s+/g, ' ').slice(0, 200) },
          defaultConfiguration: { level: SEVERITY[sev].level }, properties: { 'security-severity': SEVERITY[sev].score } });
      }
      for (const w of where) {
        const key = `${id}\u0000${w.file}`;
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({
          ruleId: id, level: SEVERITY[sev].level,
          message: { text: `${ref} ships ${v.PkgName} ${v.InstalledVersion}; ${id} is fixed in ${v.FixedVersion}. Move to a tag of the image that includes the fix.` },
          locations: [{ physicalLocation: { artifactLocation: { uri: w.file }, region: { startLine: w.line } } }],
          properties: { 'security-severity': SEVERITY[sev].score },
        });
      }
    }
    images.push({ ref, scanned: true, ...(os.EOSL ? { endOfSupport: true } : {}), vulnerabilities: vulns.length, fixable, unfixed });
  }
  return sarifDoc([...rules.values()].sort((a, b) => (a.id < b.id ? -1 : 1)), results, notifications, images, true);
}

function sarifDoc(rules, results, notifications, images, ok) {
  results.sort((a, b) => {
    const fa = a.locations[0].physicalLocation.artifactLocation.uri; const fb = b.locations[0].physicalLocation.artifactLocation.uri;
    return fa < fb ? -1 : fa > fb ? 1 : a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
  });
  return {
    version: '2.1.0',
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    runs: [{
      tool: { driver: { name: 'commitwork-base-images', rules } },
      invocations: [{ executionSuccessful: ok, toolExecutionNotifications: notifications }],
      properties: { images },
      results,
    }],
  };
}

if (isMainModule(import.meta.url)) {
  const args = process.argv.slice(2);
  const outAt = args.indexOf('--out');
  const out = outAt >= 0 ? args[outAt + 1] : null;
  const repo = args.find((a, i) => !a.startsWith('--') && (outAt < 0 || i !== outAt + 1));
  if (!repo || !out) { console.error('usage: node bin/base-images.mjs <repoDir> --out <file.sarif>'); process.exit(2); }
  const refs = collectRefs(resolve(repo));
  const probe = spawnSync(trivyBin(), ['--version'], { encoding: 'utf8', timeout: 60_000 });
  const trivyPresent = !probe.error && probe.signal === null && probe.status === 0;
  writeFileSync(out, `${JSON.stringify(toSarif(refs, scanImage, { trivyPresent }), null, 1)}\n`);
}
