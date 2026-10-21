// Every module path a TRACKED DOC cites must exist at HEAD.
//
// bin/test/tracked-imports.test.mjs guards import specifiers in .mjs sources. Nothing guarded the
// paths cited in prose, and the instruction files are what agents actually follow: vscode-skills's
// /close told every session to import lib/memory-layer-client.mjs for weeks after commitwork renamed it,
// and the failure surfaced as ERR_MODULE_NOT_FOUND mid-close rather than as a gate.
//
// HEAD, not the working tree — a doc committed citing an untracked file is the defect.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname, resolve, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const git = (...a) => execFileSync('git', ['-C', REPO, ...a], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });

const MODULE_DIRS = 'bin|lib|monitor|admin|schema|flow|cra|mcp|sitemap|map|chunk-diff|workflows|ci|prompts|manifests|design|docsite|provenance';
// CODE only. A .json path is as often a generated store (monitor/data/kev.json, monitor/issues.json,
// cra/cases.json) as a tracked schema, and failing on a gitignored cache is over-reporting — the
// direction that costs more here than a miss.
// The whole path, leading segments included: `\b` alone lifted `bin/x.sh` out of `sub/bin/x.sh` and
// judged a path the doc never cited.
// A leading `$VAR/` (`"$PWD/bin/commitwork.mjs"`) stands for a root and is dropped.
const CITED = new RegExp(`(?<![\\w./$~-])(?:\\$\\{?[A-Za-z_]\\w*\\}?/)?(?:(?:\\.\\.|[A-Za-z0-9_-][A-Za-z0-9_.-]*)/)*(?:${MODULE_DIRS})/[A-Za-z0-9_./-]+\\.(?:mjs|sh)\\b`, 'g');
const citedPaths = (text) => [...new Set((text.match(CITED) || []).map((m) => m.replace(/^\$\{?[A-Za-z_]\w*\}?\//, '')))];

const headFiles = () => new Set(git('ls-tree', '-r', 'HEAD', '--name-only').split('\n').filter(Boolean));
const headDocs = () => git('ls-tree', '-r', 'HEAD', '--name-only').split('\n')
  .filter((p) => p.endsWith('.md') && !p.startsWith('evaluations/') && !p.startsWith('reference/'));
const blob = (p) => { try { return git('show', `HEAD:${p}`); } catch { return ''; } };

// Known dead at the moment the guard landed, each with its reason. It MAY NOT GROW, and an entry
// that stops being dead must be DELETED — a baseline that keeps naming a repaired citation is a
// suppression outliving its judgement (E2).
const BASELINE = new Map([
  ['docs/TOP-100.md cites monitor/test/posture-taxonomy.test.mjs',
    'no successor found under that name; the posture tests live in admin/test/ and the mapping is not obvious'],
]);

test('every module path cited in a tracked doc resolves at HEAD', () => {
  const files = headFiles();
  const docs = headDocs();
  const dead = [];
  let cited = 0;

  for (const doc of docs) {
    const text = blob(doc);
    for (const m of citedPaths(text)) {
      cited++;
      // A module README citing `lib/theme.mjs` means ITS OWN lib/. Resolve doc-relative first,
      // then repo-root — reading every citation as repo-root called four live files dead.
      const rel = posix.normalize(doc.includes('/') ? `${doc.slice(0, doc.lastIndexOf('/'))}/${m}` : m);
      if (!files.has(m) && !files.has(rel)) dead.push(`${doc} cites ${m}`);
    }
  }

  // NON-VACUITY. A regex that matches nothing reports a clean tree it never read — the exact
  // shape that let a comment stripper swallow 1,375 lines and pass.
  assert.ok(docs.length >= 10, `only ${docs.length} tracked docs found — the doc set is wrong, not clean`);
  assert.ok(cited >= 25, `only ${cited} module paths extracted from ${docs.length} docs — the extractor is broken, not the tree clean`);

  const fresh = dead.filter((d) => !BASELINE.has(d));
  assert.deepEqual(fresh, [], `tracked docs cite ${fresh.length} NEW path(s) that do not exist at HEAD:\n  ${fresh.join('\n  ')}`);

  // The ratchet's other direction: a baselined citation that now resolves has been repaired, and
  // the entry must go. Otherwise the baseline outlives its cause and quietly re-suppresses.
  const repaired = [...BASELINE.keys()].filter((k) => !dead.includes(k));
  assert.deepEqual(repaired, [],
    `${repaired.length} baselined citation(s) now resolve — DELETE them from BASELINE:\n  ${repaired.join('\n  ')}`);
});

test('the extractor finds a planted dead path — the guard can fail', () => {
  const files = headFiles();
  const planted = 'One line citing lib/definitely-not-here.mjs and bin/commit-phase.mjs.';
  const found = citedPaths(planted);
  assert.deepEqual(found.sort(), ['bin/commit-phase.mjs', 'lib/definitely-not-here.mjs']);
  assert.deepEqual(citedPaths('see sub/bin/x.sh, ../lib/y.mjs and "$PWD/bin/z.mjs"'), ['sub/bin/x.sh', '../lib/y.mjs', 'bin/z.mjs'],
    'a nested or parent-relative path is cited whole, never as the suffix that happens to start with a module dir');
  assert.equal(files.has('lib/definitely-not-here.mjs'), false, 'the planted dead path must be judged dead');
  assert.equal(files.has('bin/commit-phase.mjs'), true, 'and the real one alive — a guard that fails both ways proves nothing');
});
