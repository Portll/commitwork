// `--exclude <area>` must drop the area from what --all ACTUALLY fans out to.
//
// Two bugs are pinned here, and the second is why this file is shaped the way it is.
//
//  1. The first implementation filtered the `repos` array. --dry read that array and printed
//     "135 projects"; --all ignored it, mapped `reg.areas` independently, and spawned
//     `sweep.mjs all client-a` — the excluded area — as its first child.
//
//  2. The first TEST for (1) asserted on --dry's printed fan-out. It passed with the fix reverted,
//     because --dry exits before the fleet loop: the assertion could not see the code path that
//     was broken. A test that cannot fail on the bug it was written for is worse than none, since
//     it retires the suspicion.
//
// So the list is now one exported function and the unit tests below hit it directly. The CLI tests
// only check WIRING, and every one passes --dry: a test for a "do not sweep this" guard must not
// be able to start a sweep.

import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { loadRegistry } from '../registry.mjs';
import { fleetAreaSlugs, resolveExcludedAreas, allScopeArea } from '../sweep-scope.mjs';

const CW = fileURLToPath(new URL('../..', import.meta.url));
const SWEEP = join(CW, 'monitor/sweep.mjs');
const REG = { areas: [{ slug: 'alpha' }, { slug: 'beta' }, { slug: 'gamma' }] };

describe('fleetAreaSlugs — the list --all fans out to', () => {
  test('returns every area in registry order when nothing is excluded', () => {
    assert.deepEqual(fleetAreaSlugs(REG), ['alpha', 'beta', 'gamma']);
    assert.deepEqual(fleetAreaSlugs(REG, new Set()), ['alpha', 'beta', 'gamma']);
  });

  test('drops exactly the excluded areas, and keeps the rest in order', () => {
    assert.deepEqual(fleetAreaSlugs(REG, new Set(['beta'])), ['alpha', 'gamma']);
    assert.deepEqual(fleetAreaSlugs(REG, new Set(['alpha', 'gamma'])), ['beta']);
  });

  test('an exclusion matching nothing removes nothing — it does not empty the fleet', () => {
    assert.deepEqual(fleetAreaSlugs(REG, new Set(['nope'])), ['alpha', 'beta', 'gamma']);
  });

  test('survives a registry with no areas rather than throwing', () => {
    assert.deepEqual(fleetAreaSlugs({}), []);
    assert.deepEqual(fleetAreaSlugs(null), []);
  });
});

describe('resolveExcludedAreas', () => {
  const reg = loadRegistry();
  const known = (reg.areas || []).map((a) => a.slug);
  assert.ok(known.length > 1, 'registry declares fewer than two areas — the assertions below would be vacuous');

  test('comma-separated and repeated forms both resolve', () => {
    const a = resolveExcludedAreas([known.slice(0, 2).join(',')], reg);
    const b = resolveExcludedAreas([known[0], known[1]], reg);
    assert.deepEqual([...a.areas].sort(), known.slice(0, 2).sort());
    assert.deepEqual([...b.areas].sort(), known.slice(0, 2).sort());
    assert.deepEqual(a.unresolved, []);
  });

  test('an unknown value is REPORTED unresolved, never silently dropped', () => {
    const { areas, unresolved } = resolveExcludedAreas(['no-such-area-xyz'], reg);
    assert.equal(areas.size, 0);
    assert.deepEqual(unresolved, ['no-such-area-xyz']);
  });

  test('empty and whitespace values are ignored, not treated as unresolved', () => {
    const { areas, unresolved } = resolveExcludedAreas(['', '  ', undefined], reg);
    assert.equal(areas.size, 0);
    assert.deepEqual(unresolved, []);
  });
});

describe('sweep.mjs wiring', () => {
  // A FIXTURE fleet, never the ambient registry. The example registry declares ~/Repositories as a
  // root, so on 2026-09-27 these tests listed 3,365 of the operator's repos (530 KB of --dry) and
  // measured that disk instead of the wiring. `roots: []` walks nothing.
  const tmp = mkdtempSync(join(tmpdir(), 'cw-sweep-exclude-'));
  after(() => rmSync(tmp, { recursive: true, force: true }));
  const regPath = join(tmp, 'projects.json');
  writeFileSync(regPath, JSON.stringify({
    reportsRoot: relative(CW, join(tmp, 'reports')),
    areas: [
      { slug: 'alpha', out: 'alpha', primary: true, members: ['alpha-app'] },
      { slug: 'beta', out: 'beta', members: ['beta-app'] },
      { slug: 'gamma', out: 'gamma', members: ['gamma-app'] },
    ],
    roots: [],
    projects: ['alpha', 'beta', 'gamma'].map((s) => ({
      name: `${s}-app`, area: s, path: join(tmp, `${s}-app`), manifest: 'security-baseline',
    })),
  }, null, 1));
  const env = {
    ...process.env, CW_REGISTRY: regPath, CW_SKIP_SETUP: '1', CW_NO_COLOR: '1', CW_MONITOR_OUT: '',
    CW_SWEEP_REFUSALS: join(tmp, 'sweep-refusals.jsonl'),
  };
  const run = (args) => {
    try {
      return { out: execFileSync(process.execPath, [SWEEP, ...args, '--dry'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env }), code: 0 };
    } catch (e) {
      return { out: `${e.stdout || ''}${e.stderr || ''}`, code: e.status };
    }
  };
  const reg = loadRegistry({ path: regPath, quiet: true });
  // The PRIMARY area, so excluding it also prints the out-dir notice ahead of the plan.
  const victim = reg.areas.find((a) => a.primary).slug;
  // Read the plan by its own `areas:` marker, never "the line after the header": when the header
  // went missing, lines[-1 + 1] was lines[0], and a missing plan reported itself as a wrong one.
  const fanOut = (out) => {
    const lines = out.split('\n');
    const header = lines.findIndex((l) => l.includes('fans out per AREA'));
    assert.ok(header >= 0, `--dry printed no fan-out header:\n${out.slice(-1500)}`);
    const list = lines.slice(header + 1).find((l) => /^\s*areas:/.test(l));
    assert.ok(list !== undefined, `no \`areas:\` list follows the fan-out header:\n${out.slice(-1500)}`);
    assert.match(out, /dry run: \d+ projects/, 'the closing summary is missing, so the output was cut short');
    return list.replace(/^\s*areas:/, '').trim().split(/\s+/).filter(Boolean);
  };

  // Bug 2's guard. The fleet loop must consume the shared list rather than re-deriving it, and no
  // behavioural test can see that: --dry exits first. Asserting on the source is the only place
  // the two paths can be compared without starting a real sweep.
  test('the fleet loop consumes the shared list instead of re-deriving it', () => {
    const src = readFileSync(SWEEP, 'utf8');
    assert.match(src, /const slugs = fleetSlugs;/,
      'the --all fan-out no longer reads fleetSlugs. If it re-derives the area list, --exclude '
      + 'silently stops applying to the real run while --dry keeps reporting it correctly.');
    assert.match(src, /import \{[^}]*fleetAreaSlugs[^}]*\} from '\.\/sweep-scope\.mjs'/);
  });

  test('--dry reports the AREA plan, not just the repo list', () => {
    const { out } = run(['all', '--all']);
    assert.match(out, /fans out per AREA/,
      'without this line a dry run describes a scope --all does not use');
    assert.deepEqual(fanOut(out), fleetAreaSlugs(reg));
  });

  test('--dry fan-out agrees with fleetAreaSlugs for the same exclusion', () => {
    const { out, code } = run(['all', '--all', '--exclude', victim]);
    assert.equal(code, 0, out);
    assert.match(out, /--all out dir moves/, 'excluding the primary area must move the out dir, and say so');
    const printed = fanOut(out);
    assert.deepEqual(printed, fleetAreaSlugs(reg, new Set([victim])));
    assert.ok(!printed.includes(victim));
  });

  test('an unresolvable area exits 2 rather than sweeping it', () => {
    const { out, code } = run(['all', '--all', '--exclude', 'no-such-area-xyz']);
    assert.equal(code, 2);
    assert.match(out, /does not resolve to a known area/);
  });

  test('the flag value never leaks into the positional scope argument', () => {
    const { out, code } = run(['all', '--all', '--exclude', victim]);
    assert.equal(code, 0);
    assert.doesNotMatch(out, /cannot resolve/, 'the exclusion value was parsed as a scope argument');
  });
});


// #7 — where --all writes its FLEET-LEVEL artefacts.
//
// The destination used to be `primaryArea(reg)`, read before `--exclude` was parsed, so a run told
// to skip an area could still write that area's report dir. The scan DATA was never wrong; only its
// address was, which is why no result-shaped assertion could see it: the excluded area's directory
// simply grew fresh files while its own scan went stale, and a stale scan under fresh files reads
// as a current one.
//
// These hit allScopeArea directly. Each must FAIL against the old expression — see the file header.
describe('#7 — --all never addresses an excluded or paused area', () => {
  test('with nothing excluded the primary area still wins', () => {
    assert.equal(allScopeArea(REG, new Set()), 'alpha');
  });

  test('excluding the PRIMARY area moves the out dir off it', () => {
    // The bug: this returned 'alpha' — the area the run was told to skip.
    assert.equal(allScopeArea(REG, new Set(['alpha'])), 'beta');
  });

  test('an explicitly flagged primary is honoured, and dropped when excluded', () => {
    const reg = { areas: [{ slug: 'alpha' }, { slug: 'beta', primary: true }, { slug: 'gamma' }] };
    assert.equal(allScopeArea(reg, new Set()), 'beta');
    assert.equal(allScopeArea(reg, new Set(['beta'])), 'alpha');
  });

  test('a PAUSED primary is skipped too — same destination, same rule', () => {
    const reg = { areas: [{ slug: 'alpha', paused: { since: '2026-09-01', reason: 'r' } }, { slug: 'beta' }] };
    assert.equal(allScopeArea(reg, new Set()), 'beta');
  });

  test('every area excluded yields null, so the caller refuses instead of inventing a destination', () => {
    assert.equal(allScopeArea(REG, new Set(['alpha', 'beta', 'gamma'])), null);
  });

  test('the destination is always a member of the fan-out list — one source, not two', () => {
    for (const excl of [[], ['alpha'], ['alpha', 'beta']]) {
      const set = new Set(excl);
      const got = allScopeArea(REG, set);
      const fleet = fleetAreaSlugs(REG, set);
      if (got === null) assert.equal(fleet.length, 0);
      else assert.ok(fleet.includes(got), `${got} must be in ${JSON.stringify(fleet)}`);
    }
  });
});
