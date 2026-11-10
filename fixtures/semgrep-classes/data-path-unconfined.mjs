// Annotated fixture for manifests/semgrep-classes/data-path-unconfined.yaml (JavaScript rule).
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve, relative, basename } from 'node:path';

const ROOT = '/srv/data';

export function serveFile(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const name = url.searchParams.get('file');
  // ruleid: cw-path-from-request-js
  res.end(readFileSync(join(ROOT, name)));
}

export function serveBasename(req, res) {
  const url = new URL(req.url, 'http://localhost');
  const name = basename(url.searchParams.get('file'));
  // ok: cw-path-from-request-js
  res.end(readFileSync(join(ROOT, name)));
}

export function saveUpload(req, body) {
  const target = resolve(ROOT, req.query.dest);
  // ruleid: cw-path-from-request-js
  writeFileSync(target, body);
}

export function saveConfined(req, body) {
  const target = resolve(ROOT, req.query.dest);
  if (relative(ROOT, target).startsWith('..')) throw new Error('outside root');
  // ok: cw-path-from-request-js
  writeFileSync(target, body);
}

export function annotate(sarif, repoDir) {
  for (const result of sarif.runs[0].results) {
    const loc = result.locations[0].physicalLocation;
    // ruleid: cw-path-from-request-js
    const text = readFileSync(join(repoDir, loc.artifactLocation.uri), 'utf8');
    result.snippet = text.slice(0, 80);
  }
}

export function clearCache() {
  // ok: cw-path-from-request-js
  rmSync(join(ROOT, 'cache'), { recursive: true, force: true });
}

const ALLOWED_DIRS = ['assets', 'workers'];

export function devMiddleware(req, res, next) {
  const pathname = decodeURIComponent((req.url ?? '').split('?')[0]);
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length !== 2 || !ALLOWED_DIRS.includes(parts[0]) || parts[1].includes('..')) {
    next();
    return;
  }
  const file = join(ROOT, parts[0], parts[1]);
  // ok: cw-path-from-request-js
  readFileSync(file, (error, data) => res.end(data));
}

export function devMiddlewareNoGuard(req, res) {
  const pathname = decodeURIComponent((req.url ?? '').split('?')[0]);
  const parts = pathname.split('/').filter(Boolean);
  const file = join(ROOT, parts[0], parts[1]);
  // ruleid: cw-path-from-request-js
  readFileSync(file, (error, data) => res.end(data));
}

export function devMiddlewareSlashOnly(req, res) {
  const pathname = decodeURIComponent((req.url ?? '').split('?')[0]);
  const parts = pathname.split('/').filter(Boolean);
  if (parts.some((p) => p === '..')) return;
  const file = join(ROOT, parts[0], parts[1]);
  // ruleid: cw-path-from-request-js
  readFileSync(file, (error, data) => res.end(data));
}
