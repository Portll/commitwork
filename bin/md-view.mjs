#!/usr/bin/env node
// bin/md-view.mjs — render a Markdown file as a self-contained HTML page with its design values
// drawn (lib/md-view.mjs), write it under reports/md-view/ and open it in the default browser.
//
//   node bin/md-view.mjs <file.md> [--out <file.html>] [--no-open]
//
// env: CW_REPORTS_DIR · CW_MD_VIEW_FONTS_DIR · CW_MD_VIEW_ADMIN_DIR · CW_MD_VIEW_NO_OPEN
// exit: 0 written (and opened, unless told not to) · 2 usage error or unreadable input ·
//       3 written but the browser could not be launched

import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve, relative, basename, extname, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { renderPage } from '../lib/md-view.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..');
const reportsDir = () => process.env.CW_REPORTS_DIR || join(CW, 'reports');
const fontsDir = () => process.env.CW_MD_VIEW_FONTS_DIR || join(CW, 'admin', 'static', 'fonts');
const adminDir = () => process.env.CW_MD_VIEW_ADMIN_DIR || join(CW, 'admin');

const readOptional = (path) => {
  try { return readFileSync(path, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
};

// The panel's own stylesheets, for ```lockup fences: the base sheets style both containers and
// panel-light.css re-grades the light one. styles.html is the workspace shell the panel wears.
function lockupSheets() {
  const shell = readOptional(join(adminDir(), 'menus', 'styles.html'));
  const base = [
    readOptional(join(adminDir(), 'static', 'panel.css')),
    readOptional(join(adminDir(), 'static', 'theme.css')),
    shell && (/<style[^>]*>([\s\S]*?)<\/style>/i.exec(shell) || [])[1],
  ].filter(Boolean);
  const light = [readOptional(join(adminDir(), 'static', 'panel-light.css'))].filter(Boolean);
  return { base, light };
}

const USAGE = `usage: node bin/md-view.mjs <file.md> [--out <file.html>] [--no-open]

Renders the Markdown as one self-contained HTML file (fonts and images inlined, no network) with
colours, tokens, contrast ratios, shadows, font stacks, sizes, weights, tracking, radii, padding,
spacing steps, durations, opacities, line heights and measures drawn, then opens it.

  --out <file>   write here instead of reports/md-view/<path>.html
  --no-open      write only (also CW_MD_VIEW_NO_OPEN=1)
`;

const FONTS = [
  ['IBM Plex Sans', 400, 'normal', fontsDir, 'IBMPlexSans-Regular-Latin1.woff2'],
  ['IBM Plex Sans', 400, 'italic', fontsDir, 'IBMPlexSans-Italic-Latin1.woff2'],
  ['IBM Plex Sans', 500, 'normal', fontsDir, 'IBMPlexSans-Medium-Latin1.woff2'],
  ['IBM Plex Sans', 600, 'normal', fontsDir, 'IBMPlexSans-SemiBold-Latin1.woff2'],
  ['IBM Plex Sans', 700, 'normal', fontsDir, 'IBMPlexSans-Bold-Latin1.woff2'],
  ['IBM Plex Mono', 400, 'normal', fontsDir, 'IBMPlexMono-Regular-Latin1.woff2'],
  ['IBM Plex Mono', 600, 'normal', fontsDir, 'IBMPlexMono-SemiBold-Latin1.woff2'],
  ['IBM Plex Mono', 700, 'normal', fontsDir, 'IBMPlexMono-Bold-Latin1.woff2'],
];

// A missing font file is a legitimate absence (the page falls back to the system stack); any other
// read failure is not, and is raised rather than quietly rendered without it.
function loadFonts() {
  const out = [];
  for (const [family, weight, style, dir, file] of FONTS) {
    try {
      const format = file.endsWith('.ttf') ? 'truetype' : 'woff2';
      out.push({ family, weight, style, format, data: readFileSync(join(dir(), file)).toString('base64') });
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  return out;
}

const safeDecode = (s) => { try { return decodeURI(s); } catch { return s; } };

const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

function imageReader(baseDir) {
  return (src) => {
    const path = resolve(baseDir, safeDecode(src.split('#')[0].split('?')[0]));
    const type = IMAGE_TYPES[extname(path).toLowerCase()];
    if (!type) return null;
    try {
      return `data:${type};base64,${readFileSync(path).toString('base64')}`;
    } catch (e) {
      if (e.code === 'ENOENT') return null;
      throw e;
    }
  };
}

// Relative links are rewritten to absolute file:// URLs: the page is written somewhere else, so a
// relative href would resolve against reports/, not against the document that wrote it.
const hrefResolver = (baseDir) => (href) => {
  const [path, frag] = href.split('#');
  if (!path) return href;
  return pathToFileURL(resolve(baseDir, safeDecode(path))).href + (frag !== undefined ? `#${frag}` : '');
};

function defaultOut(abs) {
  const rel = relative(CW, abs);
  const inside = rel && !rel.startsWith('..') && !isAbsolute(rel);
  const stem = (inside ? rel : join('external', basename(abs))).replace(/\.(md|markdown)$/i, '');
  return join(reportsDir(), 'md-view', `${stem}.html`);
}

// No shell on any platform: `cmd /c start` parses the path as a command line, and `&` in a file
// name runs whatever follows it.
export function openerFor(path, platform = process.platform) {
  if (platform === 'darwin') return ['open', [path]];
  if (platform === 'win32') return ['explorer.exe', [path]];
  return ['xdg-open', [path]];
}

export function main(argv) {
  const args = [...argv];
  let file = null;
  let out = null;
  let open = !process.env.CW_MD_VIEW_NO_OPEN;
  while (args.length) {
    const a = args.shift();
    if (a === '--help' || a === '-h') { process.stdout.write(USAGE); return 0; }
    if (a === '--no-open') { open = false; continue; }
    if (a === '--out') {
      out = args.shift();
      if (!out) { process.stderr.write(`md-view: --out needs a path\n${USAGE}`); return 2; }
      continue;
    }
    if (a.startsWith('-')) { process.stderr.write(`md-view: unknown option ${a}\n${USAGE}`); return 2; }
    if (file) { process.stderr.write(`md-view: one file at a time (got ${file} and ${a})\n`); return 2; }
    file = a;
  }
  if (!file) { process.stderr.write(USAGE); return 2; }

  const abs = resolve(file);
  let md;
  try {
    md = readFileSync(abs, 'utf8');
  } catch (e) {
    process.stderr.write(`md-view: cannot read ${file}: ${e.code || e.message}\n`);
    return 2;
  }

  const rel = relative(CW, abs);
  const source = rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split('\\').join('/') : basename(abs);
  const { html, stats } = renderPage({
    md,
    source,
    fonts: loadFonts(),
    resolveHref: hrefResolver(dirname(abs)),
    readImage: imageReader(dirname(abs)),
    lockupSheets: lockupSheets(),
  });

  const target = resolve(out || defaultOut(abs));
  mkdirSync(dirname(target), { recursive: true });
  writeAtomic(target, html);
  process.stdout.write(`${target}\n`);
  process.stderr.write(`md-view: ${stats.headings} sections · ${stats.tokens} tokens · ${stats.colours} colours\n`);

  if (!open) return 0;
  const [cmd, cmdArgs] = openerFor(target);
  const child = spawn(cmd, cmdArgs, { detached: true, stdio: 'ignore' });
  child.on('error', (e) => {
    process.stderr.write(`md-view: written, but could not open it with ${cmd}: ${e.code || e.message}\n`);
    process.exitCode = 3;
  });
  child.unref();
  return 0;
}

if (isMainModule(import.meta.url)) {
  const code = main(process.argv.slice(2));
  if (code) process.exitCode = code;
}
