// Shared by the WordPress lane tests: synthetic site trees and a file:// source mirror written at test
// time, so every test runs with no network. Nothing here is executed; the PHP is text.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

export const md5 = (s) => createHash('md5').update(s).digest('hex');
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');

const roots = [];
export function scratch(prefix = 'cw-wp-') {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}
export function cleanup() { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); }

export function write(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, body);
  }
  return root;
}
const json = (dir, rel, obj) => write(dir, { [rel]: JSON.stringify(obj) });

export const coreChecksums = (dir, version, files, locale = 'en_US') =>
  json(dir, `core/checksums/1.0/${version}-${locale}.json`, { checksums: Object.fromEntries(Object.entries(files).map(([p, b]) => [p, md5(b)])) });
export const pluginChecksums = (dir, slug, version, files) =>
  json(dir, `plugin-checksums/${slug}/${version}.json`, { plugin: slug, version, files: Object.fromEntries(Object.entries(files).map(([p, b]) => [p, { md5: md5(b), sha256: sha256(b) }])) });
export const stableCheck = (dir, map) => json(dir, 'core/stable-check/1.0.json', map);
export const advisories = (dir, type, key, data, updated = 1767225600) => json(dir, `${type}/${key}.json`, { error: 0, message: null, data, updated });

export const pluginMain = (name, version) => `<?php\n/**\n * Plugin Name: ${name}\n * Version: ${version}\n */\nreturn;\n`;
export const themeStyle = (name, version) => `/*\nTheme Name: ${name}\nVersion: ${version}\n*/\n`;
export const versionPhp = (v, extra = '') => `<?php\n$wp_version = '${v}';\n${extra}`;

/** Points every source at `dir` (file://), with no cache and no network, for the length of fn. */
export async function withSource(dir, fn, extra = {}) {
  const url = pathToFileURL(dir).href;
  const env = { CW_WP_API_URL: url, CW_WP_DOWNLOADS_URL: url, CW_WPVULN_URL: url, CW_WP_CACHE: 'off', CW_WP_OFFLINE: '1', ...extra };
  const saved = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
/** The same environment as a plain object, for a child process. */
export const sourceEnv = (dir, extra = {}) => {
  const url = pathToFileURL(dir).href;
  return { ...process.env, CW_WP_API_URL: url, CW_WP_DOWNLOADS_URL: url, CW_WPVULN_URL: url, CW_WP_CACHE: 'off', CW_WP_OFFLINE: '1', ...extra };
};
