#!/usr/bin/env node
// docsite-build.mjs — manifest-walk build: every kind:md doc renders through the same
// renderAndWritePage() the admin save route uses, into docsite/pages/<urlPath>/index.html.
// Never a directory walk (the manifest is the declaration; a pages/ dir with no entry is an
// ORPHAN and fails the build rather than being adopted), never a mint (identity comes from
// bin/docsite-new.mjs only).
//
// Modes:
//   node bin/docsite-build.mjs           # build (idempotent: re-run produces zero byte changes)
//   node bin/docsite-build.mjs --check   # build to memory, diff against disk, exit 1 on drift
//
// fact: a missing/unreadable SOURCE is a build failure naming the entry, never a skip / a doc
//   silently dropped from the output reads as "site is complete" when it is not — fail closed
//   (expiry: never)
// fact: the build covers BOTH roots / the manifest is the union of docsite/manifest.json and the
//   private root's (lib/docsite-roots.mjs); every doc builds inside its own root and the orphan
//   check runs per root. Without a private root the build is the public site alone (expiry: never)
// env, read at call time: CW_DOCSITE_ROOT, CW_DOCSITE_PRIVATE

import { readFileSync, readdirSync, existsSync, mkdirSync, copyFileSync } from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { loadManifest, docsiteRoot, sourcePath, pagePath, docsiteNav, rootOf } from '../lib/docsite-manifest.mjs';
import { renderPage, renderAndWritePage } from '../lib/docsite-page.mjs';

const check = process.argv.includes('--check');
const errors = [];
const drift = [];
let built = 0;
let verified = 0;

let manifest;
try { manifest = loadManifest(); } catch (e) {
  console.error(`docsite-build: ${e.message}`);
  process.exit(2);
}

// Nav is derived from the manifest: published docs only, in declaration order. The derivation
// lives in lib/docsite-manifest.mjs so the generators share it rather than each deriving their own.
const nav = docsiteNav(manifest);

for (const doc of manifest.docs) {
  if (doc.kind === 'imported') {
    // Imported snapshots are verified present and COPIED, never rewritten. Copying matters:
    // docsite-publish assembles the bundle from imported/ directly, so before this the build
    // output and the deployed bundle were different artefacts and an imported doc could not be
    // previewed locally at all — you checked one thing and shipped another. The copy mirrors the
    // bundle's own layout (imported/x.html -> x.html beside the generated <urlPath>/index.html
    // dirs), so pages/ is now a faithful preview of what deploys rather than a subset of it.
    if (!existsSync(sourcePath(doc))) { errors.push(`${doc.slug}: imported source missing at ${doc.source}`); continue; }
    const dest = join(rootOf(doc), 'pages', relative(join(rootOf(doc), 'imported'), sourcePath(doc)));
    if (check) {
      let have = null;
      try { have = readFileSync(dest); } catch { /* missing = drift */ }
      if (have === null || !have.equals(readFileSync(sourcePath(doc)))) drift.push(`${doc.slug}: ${dest} ${have === null ? 'is missing' : 'differs from its imported source'}`);
      else verified++;
      continue;
    }
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(sourcePath(doc), dest);
    verified++;
    continue;
  }
  let md;
  try { md = readFileSync(sourcePath(doc), 'utf8'); } catch (e) {
    errors.push(`${doc.slug}: source unreadable at ${doc.source}: ${e.message}`);
    continue;
  }
  const out = pagePath(doc);
  if (check) {
    const want = renderPage({ doc, md, nav });
    let have = null;
    try { have = readFileSync(out, 'utf8'); } catch { /* missing = drift */ }
    if (have !== want) drift.push(`${doc.slug}: ${out} ${have === null ? 'is missing' : 'differs from its source render'}`);
    else verified++;
  } else {
    renderAndWritePage({ doc, md, outPath: out, nav });
    built++;
  }
}

// Orphan detection, per root: a pages/ dir that root's manifest does not declare. Report, never
// adopt, never delete.
const roots = [...new Set([docsiteRoot(), ...manifest.docs.map((d) => rootOf(d))])];
for (const root of roots) {
  const pagesDir = join(root, 'pages');
  if (!existsSync(pagesDir)) continue;
  const declared = new Set(manifest.docs.filter((d) => d.kind === 'md' && rootOf(d) === root).map((d) => d.urlPath));
  const label = root === docsiteRoot() ? 'pages' : `${root}/pages`;
  for (const entry of readdirSync(pagesDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !declared.has(entry.name)) {
      errors.push(`orphan: ${label}/${entry.name}/ has no manifest entry — removal is a git act (entry + page in one commit), adoption is a manifest edit`);
    }
  }
}

if (errors.length) { console.error(`docsite-build: FAILED\n  ${errors.join('\n  ')}`); process.exit(2); }
if (check) {
  if (drift.length) { console.error(`docsite-build --check: DRIFT\n  ${drift.join('\n  ')}`); process.exit(1); }
  console.log(`docsite-build --check: clean (${verified} verified)`);
} else {
  console.log(`docsite-build: ${built} built, ${verified} imported verified`);
}
