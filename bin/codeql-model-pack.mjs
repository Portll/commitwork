#!/usr/bin/env node
// bin/codeql-model-pack.mjs — a repository's own CodeQL sources and sinks, as a model pack.
//
// usage: node bin/codeql-model-pack.mjs <language>      (run from the scanned repository)
// Prints the `codeql database analyze` arguments that load the pack, or nothing when the repository
// declares no models for this language. Writes the pack under $CW_REPORT_DIR/codeql-models/ and a
// record of what it did to $CW_REPORT_DIR/codeql-<language>-models.json.
// exit: 0 always: a lane must still run when its models are absent or unusable, and the record says
//       which (applied: false with the error), so an unapplied model never reads as an applied one.
// env, read at call time: CW_REPORT_DIR, CW_CODEQL_MODELS (via monitor/store-paths.mjs)
//
// CodeQL models a fixed set of frameworks and libraries. A repository with its own database client
// or interpreter gets no flow for its own calls: measured on a Rust runtime with a hand-written
// Postgres client, rust/sql-injection reported nothing until its statement hand-off was declared a
// sink and its program-data reads a source, then reported the six dynamic-SQL flows. The models are
// fleet configuration, so they live in the private store: <models dir>/<repo dir name>/*.yml, each
// a CodeQL data-extension file. A file joins the pack for <language> when its addsTo pack is
// codeql/<language>-all. Shape: manifests/codeql-models.example.yml.
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, basename, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { codeqlModelsDirFor } from '../monitor/store-paths.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// The lane's --language value → the library pack its extensions target.
const LIBRARY = Object.freeze({
  'javascript-typescript': 'javascript', javascript: 'javascript', java: 'java', ruby: 'ruby', python: 'python',
  cpp: 'cpp', swift: 'swift', csharp: 'csharp', rust: 'rust', go: 'go',
});
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '') || 'repo';

/** Model files for one repository and language: [{name, text}], sorted by name. */
export function modelFiles(modelsDir, repo, language) {
  const lib = LIBRARY[language];
  if (!lib) throw new Error(`unknown CodeQL language ${language}`);
  const dir = join(modelsDir, repo);
  let names;
  try { names = readdirSync(dir).filter((n) => /\.ya?ml$/.test(n)).sort(); } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  return names.map((n) => ({ name: n, text: readFileSync(join(dir, n), 'utf8') }))
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- lib is a value of the frozen LIBRARY map, checked at the top of this function
    .filter((f) => new RegExp(`pack:\\s*["']?codeql/${lib}-all["']?\\s*$`, 'm').test(f.text));
}

// Models that ship with commitwork and apply to every repository of a language: the runtime APIs
// CodeQL's own library does not model (manifests/codeql-models/<library>/, e.g. the Deno global).
// They join the repository's own models in one pack; a name clash is resolved in the repository's
// favour, so a fleet model can be overridden per repository but never silently replaced.
// No env override: repo-code CodeQL lanes run under an allowlisted env (bin/lib/scanner-env.mjs),
// and a path override nothing needs is one more name to hold there. Tests pass `dir` instead.
export const SHIPPED_DIR = () => join(ROOT, 'manifests', 'codeql-models');

/** Shipped model files for one language: [{name, text}] with names prefixed `shipped-`. */
export function shippedModelFiles(language, dir = SHIPPED_DIR()) {
  const lib = LIBRARY[language];
  if (!lib) throw new Error(`unknown CodeQL language ${language}`);
  let names;
  try { names = readdirSync(join(dir, lib)).filter((n) => /\.ya?ml$/.test(n)).sort(); } catch (e) {
    if (e.code === 'ENOENT') return [];
    throw e;
  }
  return names.map((n) => ({ name: `shipped-${n}`, text: readFileSync(join(dir, lib, n), 'utf8') }))
    // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp -- lib is a value of the frozen LIBRARY map, checked at the top of this function
    .filter((f) => new RegExp(`pack:\\s*["']?codeql/${lib}-all["']?\\s*$`, 'm').test(f.text));
}

/** Repository models and shipped models together; the repository's file wins a name clash. */
export function mergedModelFiles(repoFiles, shipped) {
  const names = new Set(repoFiles.map((f) => f.name));
  return [...repoFiles, ...shipped.filter((f) => !names.has(f.name))].sort((a, b) => a.name.localeCompare(b.name));
}

/** Writes the pack and returns {name, dir, files}, or null when there is nothing to load. */
export function buildPack(files, repo, language, outRoot) {
  if (!files.length) return null;
  const name = `commitwork-models/${slug(repo)}-${slug(LIBRARY[language])}`;
  const dir = join(outRoot, `${slug(repo)}-${slug(LIBRARY[language])}`);
  mkdirSync(join(dir, 'models'), { recursive: true });
  writeFileSync(join(dir, 'qlpack.yml'), [
    `name: ${name}`, 'version: 0.0.1', 'library: true',
    'extensionTargets:', `  codeql/${LIBRARY[language]}-all: "*"`,
    'dataExtensions:', '  - models/*.yml', '',
  ].join('\n'));
  for (const f of files) writeFileSync(join(dir, 'models', f.name), f.text);
  return { name, dir, files: files.map((f) => f.name) };
}

if (isMainModule(import.meta.url)) {
  const language = process.argv[2];
  const repo = basename(resolve('.'));
  const reportDir = process.env.CW_REPORT_DIR || '.';
  const record = { repo, language, modelsDir: null, files: [], shipped: [], pack: null, applied: false, error: null };
  try {
    const modelsDir = codeqlModelsDirFor(ROOT);
    record.modelsDir = existsSync(modelsDir) ? 'present' : 'absent';
    const shipped = shippedModelFiles(language);
    record.shipped = shipped.map((f) => f.name);
    const files = mergedModelFiles(modelFiles(modelsDir, repo, language), shipped);
    const pack = buildPack(files, repo, language, join(reportDir, 'codeql-models'));
    if (pack) {
      record.files = pack.files; record.pack = pack.name; record.applied = true;
      process.stdout.write(`--additional-packs ${join(reportDir, 'codeql-models')} --model-packs ${pack.name}\n`);
    }
  } catch (e) {
    record.error = String(e && e.message || e);
  }
  try { writeFileSync(join(reportDir, `codeql-${slug(language || 'unknown')}-models.json`), `${JSON.stringify(record, null, 1)}\n`); } catch { /* the report dir is the lane's; its absence is the lane's failure */ }
}
