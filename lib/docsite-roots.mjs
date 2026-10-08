// docsite-roots.mjs — where docsite documents live. A LEAF: docsite-manifest, docsite-versions and
// docsite-page all import it, and it imports none of them.
//
// Two roots, each with the same layout (manifest.json, content/, imported/, pages/, .versions/):
//   public   docsite/ — published documents, and the only root a public checkout has
//   private  monitor/private/docsite (the sidecar link; CW_DOCSITE_PRIVATE overrides) — draft and
//            hidden documents. They stay private under the 2026-09-07 publication boundary, and a
//            hidden page's capability urlPath is not disclosed by the public manifest.
//
// fact: a fixture root never inherits the operator's drafts / with CW_DOCSITE_ROOT set and
//   CW_DOCSITE_PRIVATE unset there is NO private root, so a test aimed at a fixture can never read
//   or write the live sidecar (expiry: never)
// env, read at call time: CW_DOCSITE_ROOT, CW_DOCSITE_PRIVATE

import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateDocsiteDirFor } from '../monitor/store-paths.mjs';

const REPO = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

export const docsiteRoot = () => process.env.CW_DOCSITE_ROOT || join(REPO, 'docsite');

/** The private root's path, or null when this process has none (a fixture root with no override). */
export const privateRoot = () => {
  if (process.env.CW_DOCSITE_PRIVATE) return resolve(process.env.CW_DOCSITE_PRIVATE);
  if (process.env.CW_DOCSITE_ROOT) return null;
  return privateDocsiteDirFor(REPO, { ambient: false });
};

/** The private root when it exists on disk, else null. A public checkout answers null. */
export const presentPrivateRoot = () => {
  const r = privateRoot();
  return r && existsSync(r) ? r : null;
};

/** Where a NEW draft is created: the private root when present, else the public one. */
export const draftRoot = () => presentPrivateRoot() || docsiteRoot();

// A doc loaded from the private manifest carries its root under this symbol. Symbol-keyed, so it
// survives object spread ({ ...doc, state }) and never reaches JSON.stringify or validateManifest.
export const DOC_ROOT = Symbol('docsite root');

/** The root a doc's source and pages live in. Untagged docs are public. */
export const rootOf = (doc) => (doc && doc[DOC_ROOT]) || docsiteRoot();

/** Whether a doc lives in the private root. */
export const isPrivateDoc = (doc) => Boolean(doc && doc[DOC_ROOT]) && doc[DOC_ROOT] !== docsiteRoot();

/** Tag a plain doc object with a root (returns a new object). */
export const withRoot = (doc, root) => (root && root !== docsiteRoot() ? { ...doc, [DOC_ROOT]: root } : { ...doc });
