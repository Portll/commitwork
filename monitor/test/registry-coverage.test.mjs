// node --test monitor/test/  — REGISTRY COVERAGE (S6): every area declares a real writable `out`;
// every resolved project is DECLARED into exactly one area. If red: fix the registry, never the
// assertion. Universe = resolveRepos(reg, { selfRoot }), same as the sweep.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { accessSync, constants, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRegistry, areaOut } from '../registry.mjs';
import { resolveRepos, expandHome } from '../discover.mjs';
import { reportsRootDir } from '../area.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIVE = loadRegistry({ quiet: true });
const REPOS = resolveRepos(LIVE, { selfRoot: CW }).repos;

// declared areas only — areaOf()'s own-name fallback is the inference this test exposes
function declaredAreasOf(repo, reg) {
  const declared = new Set();
  if (repo.area) declared.add(repo.area);
  const entry = (reg.projects || []).find((p) => p.name === repo.name);
  if (entry && entry.area) declared.add(entry.area);
  for (const a of reg.areas || []) {
    if ((a.members || []).includes(repo.name)) declared.add(a.slug);
    if ((a.prefixes || []).some((px) => String(repo.name).startsWith(px))) declared.add(a.slug);
  }
  return declared;
}

// Reads the live fleet off this disk — stand down where no declared path exists. Deliberately not
// a repo-count guard: absent fleet and shrunken fleet are different facts.
const DECLARED_PATHS = (LIVE.projects || []).map((p) => p.path).filter(Boolean);
const FLEET_PRESENT = DECLARED_PATHS.some((p) => { try { return existsSync(expandHome(p)); } catch { return false; } });
// undefined, NOT null — node:test reads `{ skip: null }` as SKIP
const NO_FLEET = FLEET_PRESENT
  ? undefined
  : `none of the ${DECLARED_PATHS.length} paths declared in monitor/projects.json exists on this `
    + 'machine, so there is no resolved world to compare the declared one against. This suite is '
    + 'meaningful only where the fleet lives. Remedy: run it on the fleet machine.';

describe('registry coverage — the declared world must cover the resolved one', { skip: NO_FLEET }, () => {
  test('the universe is non-trivial — an empty resolution would make every assertion below vacuous', () => {
    assert.ok((LIVE.areas || []).length >= 1, 'registry declares no areas[] — nothing to check');
    assert.ok(REPOS.length > 10, `resolveRepos() found only ${REPOS.length} repos — the fleet is bigger than that on this box`);
  });

  test('every declared area has an EXPLICIT `out` that resolves to a writable report directory', () => {
    const root = reportsRootDir(LIVE);
    const failures = [];
    for (const a of LIVE.areas || []) {
      // an undeclared `out` still resolves via fallback — a resolution is not a declaration
      if (typeof a.out !== 'string' || !a.out.length) {
        failures.push(`${a.slug}: declares no \`out\` — its report directory is an areaOut() fallback guess, not a declaration`);
      }
      const out = areaOut(a.slug, LIVE);
      if (!out) { failures.push(`${a.slug}: areaOut() resolves to nothing at all`); continue; }
      const dir = join(root, out);
      // reports/ is gitignored, so absence is legitimate on a fresh checkout — require the nearest
      // existing ancestor to be writable instead. No mkdir: a guard must not change what it measures.
      let probe = dir;
      while (!existsSync(probe) && dirname(probe) !== probe) probe = dirname(probe);
      try { accessSync(probe, constants.W_OK); }
      catch {
        failures.push(existsSync(dir)
          ? `${a.slug}: resolved output dir ${dir} exists but is not writable`
          : `${a.slug}: resolved output dir ${dir} does not exist and cannot be created — nearest existing ancestor ${probe} is not writable`);
      }
    }
    assert.deepEqual(failures, [],
      `area output declarations do not hold (${failures.length} of ${(LIVE.areas || []).length} areas):\n  - ${failures.join('\n  - ')}`);
  });

  test('every resolved project is DECLARED into exactly one area — zero means no rollup will ever see it', () => {
    const none = [], multiple = [];
    for (const r of REPOS) {
      const declared = declaredAreasOf(r, LIVE);
      if (declared.size === 0) none.push(r.name);
      else if (declared.size > 1) multiple.push(`${r.name} -> [${[...declared].join(', ')}]`);
    }
    const failures = [
      ...(none.length ? [`${none.length} of ${REPOS.length} resolved repos are declared into NO area (own-name fallback only — they appear in no rollup): ${none.join(', ')}`] : []),
      ...(multiple.length ? [`declared into MORE than one area (findings would land in two durable records): ${multiple.join('; ')}`] : []),
    ];
    // goes red on fleet state (a new directory under a scanned root), not on commits — the remedy
    // string in the failure message says so
    const remedy = none.length
      ? '\n\nTHIS IS USUALLY FLEET STATE, NOT A REGRESSION: the check resolves repos from disk, so a '
        + 'new directory under a scanned root reddens it until someone declares it. Do NOT baseline '
        + 'it and do not go looking for the commit that broke it — there may not be one. Declare the '
        + 'repo into an area in monitor/projects.json (members[] or prefixes[], with an explicit '
        + '`out`), or exclude it WITH a stated reason if it has nothing to scan. Only the person who '
        + 'knows what the repo is can make that call.'
      : '';
    assert.deepEqual(failures, [], `registry coverage does not hold:\n  - ${failures.join('\n  - ')}${remedy}`);
  });
});
