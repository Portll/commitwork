#!/usr/bin/env node
// docsite-new.mjs — the ONLY place a docsite urlPath is minted. bin/docsite-build.mjs refuses to
// invent identity (a build that mints would rotate a capability URL on a typo), and the manifest
// test asserts the build source contains no randomUUID call.
//
// Usage:
//   node bin/docsite-new.mjs <slug> "Title"            # capability doc: urlPath = fresh uuid
//   node bin/docsite-new.mjs <slug> "Title" --public   # public doc: urlPath = slug (clean path)
//   node bin/docsite-new.mjs --init                    # create an empty manifest (explicit bootstrap)
//
// fact: re-running with an existing slug REFUSES rather than re-minting / a second mint for the
//   same doc would strand the first urlPath in readers' bookmarks (idempotency: the safe re-run
//   is a no-op refusal, not a duplicate) (expiry: never)
// fact: a new doc is a DRAFT, and drafts are private material / with a private docsite root present
//   (lib/docsite-roots.mjs) the source and the manifest entry go there; a public checkout has none
//   and mints into docsite/ as before (expiry: never)
// env, read at call time: CW_DOCSITE_ROOT, CW_DOCSITE_PRIVATE

import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { loadManifest, manifestPath, ManifestError, SLUG_RE, writeManifestAtomic, draftRoot, withRoot } from '../lib/docsite-manifest.mjs';

const args = process.argv.slice(2);
const die = (msg, code = 2) => { console.error(`docsite-new: ${msg}`); process.exit(code); };

if (args[0] === '--init') {
  if (existsSync(manifestPath())) die(`manifest already exists at ${manifestPath()} — refusing to overwrite`);
  writeManifestAtomic({
    $schema: '../schema/docsite-manifest.schema.json',
    version: 1,
    note: 'slug and urlPath are IDENTITY — a urlPath never rotates on save or rebuild; only bin/docsite-new.mjs mints one. Removing a doc removes entry + page + source in one commit.',
    docs: [],
  });
  console.log(`initialised empty manifest at ${manifestPath()}`);
  process.exit(0);
}

const isPublic = args.includes('--public');
const pos = args.filter((a) => !a.startsWith('--'));
const [slug, title] = pos;
if (!slug || !title) die('usage: docsite-new.mjs <slug> "Title" [--public] | --init');
if (!SLUG_RE.test(slug)) die(`bad slug '${slug}' (want ${SLUG_RE})`);

let manifest;
try { manifest = loadManifest(); } catch (e) {
  if (e instanceof ManifestError && e.code === 'ABSENT') die(`${e.message} — run with --init first (bootstrap is explicit, not implied)`);
  die(e.message);
}
if (manifest.docs.some((d) => d.slug === slug)) die(`slug '${slug}' already exists — this tool never re-mints`, 3);

const urlPath = isPublic ? slug : randomUUID();
if (manifest.docs.some((d) => d.urlPath === urlPath)) die(`urlPath '${urlPath}' already exists`, 3);

const source = `content/${slug}.md`;
const root = draftRoot();
const srcPath = join(root, source);
if (existsSync(srcPath)) die(`${srcPath} already exists — adopt it by editing the manifest by hand, this tool only creates`, 3);

mkdirSync(dirname(srcPath), { recursive: true });
writeAtomic(srcPath, `# ${title}\n\nDraft.\n`);
writeManifestAtomic({
  ...manifest,
  docs: [...manifest.docs, withRoot({ slug, urlPath, title, source, kind: 'md', state: 'draft' }, root)],
});
console.log(`minted ${slug} → /${urlPath}/ (state: draft)\n  source: ${srcPath}\n  next: edit it, then node bin/docsite-build.mjs`);
