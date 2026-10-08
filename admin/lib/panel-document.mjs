import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const ROOT = new URL('../', import.meta.url);
const PARTS = new Set(['top-bar.html', 'account-menu.html', 'section-rail.html', 'view-menu.html', 'account-security.html', 'styles.html', 'navigation.js', 'account-menu.js']);
const fromDisk = (path) => readFileSync(new URL(path, ROOT), 'utf8');

// Fixed, repository-owned fragments only. Missing components fail rather than serving half a menu.
// `read` resolves a path under admin/; a guard that must see a commit rather than the working tree
// passes one that reads blobs, so both answer with this one expansion.
export function readPanelDocument(read = fromDisk) {
  function expand(source, ancestors = []) {
    return source.replace(/<!-- menu:([\w.-]+) -->|^\/\/ menu:([\w.-]+)$/gm, (_, html, js) => {
      const name = html || js;
      if (!PARTS.has(name) || ancestors.includes(name)) throw new Error(`Invalid panel component: ${name}`);
      return expand(read(`menus/${name}`), [...ancestors, name]);
    });
  }
  return expand(read('panel.html'));
}

// Authorize precisely the inline CSS served, without allowing arbitrary inline stylesheet elements.
export function inlineStyleSources(html) {
  return [...String(html).matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)]
    .map((m) => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`).join(' ');
}
