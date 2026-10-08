// node --test monitor/test/  — AREA RESOLUTION: a repo name resolves to exactly ONE area.
// Three load-bearing contracts: projectOf(name) -> area LABEL (picker), projectSlug(label) ->
// area SLUG (routes/artifacts), areaSlugOf(name) -> area SLUG (the OUT resolver's input).
// The synthetic block uses _setRegistry() so the invariants hold independent of today's registry.

import { describe, test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { projectOf, projectSlug, areaSlugOf, fleetInfra, _setRegistry } from '../project-scope.mjs';
import { loadRegistry, validateRegistry, areaOf, areaOut, areaBySlug, NAME_RE, SLUG_RE, registryPath, isExampleRegistry } from '../registry.mjs';
import { resolveRepos } from '../discover.mjs';

const LIVE = loadRegistry({ quiet: true });

// Every area that could possibly claim `name`, by declaration site. More than one DISTINCT area
// slug in here means resolution is order-dependent — the ambiguity this model exists to remove.
function claimants(name, reg) {
  const by = [];
  const entry = (reg.projects || []).find((p) => p.name === name);
  if (entry?.area) by.push({ via: 'entry', slug: entry.area });
  for (const a of reg.areas || []) if ((a.members || []).includes(name)) by.push({ via: 'members', slug: a.slug });
  for (const a of reg.areas || []) if ((a.prefixes || []).some((px) => String(name).startsWith(px))) by.push({ via: 'prefixes', slug: a.slug });
  return by;
}

// ── the live registry ───────────────────────────────────────────────────────────────────────────
// The live registry is private and carries real names, so nothing here names an area or a repo. The
// fleet area is found by its shape: several members, prefixes[], and an out dir distinct from its
// slug. Test titles and failure messages cite positions, never names, because both reach logs.
// A checkout without the private registry loads the example one; these assertions then skip rather
// than describe a fleet that is not there. The same invariants run on SYNTH below regardless.
const LIVE_SKIP = isExampleRegistry(registryPath())
  ? `private registry absent: ${registryPath()} is the example registry, so live area resolution is not measured`
  : false;
const fleetAreas = () => (LIVE.areas || []).filter((a) => (a.prefixes || []).length > 0 && (a.members || []).length > 1 && a.out && a.out !== a.slug);
const PROBE = 'zz-selection-probe';

const BAD_NAME = '<img src=x onerror=1>'; // COMPOUND-CRITICAL 2's directory name

describe('area resolution against the live registry', { skip: LIVE_SKIP }, () => {
  const fleet = () => {
    const found = fleetAreas();
    assert.equal(found.length, 1, `${found.length} areas have the fleet shape (prefixes, several members, out != slug); resolution below needs exactly one`);
    return found[0];
  };
  // Every name the fleet area claims: its declared members, and one probe per prefix.
  const claimed = () => { const f = fleet(); return [...f.members, ...f.prefixes.map((px) => `${px}${PROBE}`)]; };

  test('exactly one area has the fleet shape, and its out dir stays distinct from its slug', () => {
    const f = fleet();
    assert.notEqual(f.out, f.slug, 'slug and out are deliberately DISTINCT; collapsing them renames live artifacts');
    assert.equal(areaOut(f.slug, LIVE), f.out);
  });

  test('every member and every prefix probe resolves to the fleet area, in all three resolvers', () => {
    const f = fleet();
    claimed().forEach((name, i) => {
      assert.equal(areaSlugOf(name), f.slug, `claimed name #${i}: areaSlugOf is the OUT resolver's input`);
      assert.equal(areaOf(name, LIVE), f.slug, `claimed name #${i}: registry.areaOf and project-scope.areaSlugOf must agree`);
      assert.equal(projectSlug(projectOf(name)), f.slug, `claimed name #${i}: the picker identity must round-trip to the fleet slug`);
    });
  });

  test('every claimed name is claimed by at most ONE area (resolution is not order-dependent)', () => {
    const f = fleet();
    claimed().forEach((name, i) => {
      const distinct = [...new Set(claimants(name, LIVE).map((b) => b.slug))];
      assert.deepEqual(distinct, [f.slug], `claimed name #${i} has ${distinct.length} claimant areas`);
    });
  });

  test('resolution is stable across calls (no order/caching drift)', () => {
    for (const name of claimed()) assert.equal(areaSlugOf(name), areaSlugOf(name));
  });

  test('the fleet members do NOT resolve to themselves — the production bug', () => {
    const f = fleet();
    f.members.filter((m) => m !== f.slug).forEach((m, i) => {
      assert.notEqual(areaSlugOf(m), m, `member #${i} resolved to its OWN area; its reports would be written outside the fleet area`);
      assert.notEqual(projectOf(m), m, `member #${i} became its own phantom project in the picker`);
    });
  });

  test('the fleet slug passes through projectSlug unchanged — routes and artifact names depend on it', () => {
    const f = fleet();
    assert.equal(projectSlug(f.slug), f.slug);
    assert.equal(projectSlug(projectOf(f.slug)), f.slug);
  });

  test('an unknown name resolves to its own area, never a foreign one', () => {
    const unknown = 'totally-unknown-repo-xyz';
    assert.equal(areaSlugOf(unknown), unknown);
    assert.equal(projectOf(unknown), unknown);
    assert.deepEqual(claimants(unknown, LIVE), []);
  });

  test('fleetInfra() is DERIVED from the registry, not a hardcoded set', () => {
    const infra = fleetInfra();
    fleet().members.forEach((m, i) => assert.ok(infra.has(m), `fleetInfra() is missing declared member #${i}`));
    assert.equal(infra.size, (LIVE.areas || []).flatMap((a) => a.members || []).length);
  });
});

// ── the charset guard ───────────────────────────────────────────────────────────────────────────
describe('a name failing the charset guard', () => {
  let root;
  before(() => {
    root = mkdtempSync(join(tmpdir(), 'cw-area-root-'));
    mkdirSync(join(root, BAD_NAME, '.git'), { recursive: true });
    mkdirSync(join(root, 'goodrepo', '.git'), { recursive: true });
  });
  after(() => { if (root) rmSync(root, { recursive: true, force: true }); });

  test('NAME_RE rejects it and SLUG_RE rejects it as an area slug', () => {
    assert.equal(NAME_RE.test(BAD_NAME), false, `NAME_RE accepted ${BAD_NAME} — it reaches report dir names AND the panel DOM`);
    assert.equal(SLUG_RE.test(BAD_NAME), false);
    assert.equal(NAME_RE.test('goodrepo-name'), true, 'control: a legitimate name still passes');
  });

  test('discover.mjs skips it LOUDLY — a printed note and no repo entry', () => {
    const reg = { roots: [{ path: root, maxDepth: 1 }], defaultManifest: 'security-baseline' };
    const { repos, notes } = resolveRepos(reg, {});
    assert.deepEqual(repos.map((r) => r.name), ['goodrepo'], 'the rejected directory must not become a repo');
    assert.equal(notes.length, 1, 'the skip must be printed, never silent');
    assert.match(notes[0], /^skipped \(name not \[A-Za-z0-9\._-\]\): /);
    assert.ok(notes[0].includes(BAD_NAME));
  });

  test('projectSlug sanitises it to a URL/filename-safe slug (no < > = or spaces survive)', () => {
    const s = projectSlug(BAD_NAME);
    assert.equal(s, 'img-src-x-onerror-1');
    assert.equal(SLUG_RE.test(s), true, 'projectSlug must only ever emit a SLUG_RE-clean value or ""');
    assert.equal(projectSlug('!!!'), '', 'nothing salvageable => "" , never a partial slug');
  });
});

// ── the synthetic registry (the _setRegistry seam) ──────────────────────────────────────────────
// Same invariants, zero dependence on monitor/projects.json's current contents.
const SYNTH = {
  reportsRoot: 'reports',
  areas: [
    { slug: 'alpha', label: 'Alpha Fleet', out: 'alpha-monorepo', primary: true, members: ['alpha-core', 'alpha-libs'], prefixes: ['ax-'] },
    { slug: 'beta', label: 'Beta', members: ['beta-core', 'ax-shared'] },
  ],
  projects: [
    { name: 'alpha-core', area: 'alpha', path: '/nonexistent/alpha-core', manifest: 'm' },
    { name: 'alpha-libs', area: 'alpha', path: '/nonexistent/alpha-libs', manifest: 'm' },
    { name: 'beta-core', area: 'beta', path: '/nonexistent/beta-core', manifest: 'm' },
    { name: 'ax-oddball', area: 'beta', path: '/nonexistent/ax-oddball', manifest: 'm' },
  ],
};

describe('area resolution against a synthetic registry (_setRegistry seam)', () => {
  before(() => _setRegistry(SYNTH));
  after(() => _setRegistry(LIVE)); // never leave a foreign registry behind for another suite

  test('the fixture itself is a VALID registry (so a failure below is not a bad fixture)', () => {
    const { errors } = validateRegistry(SYNTH);
    assert.deepEqual(errors, []);
  });

  test('precedence 1: an explicit registry entry beats another area\'s prefix', () => {
    // ax-oddball matches alpha's prefixes[] 'ax-' but its entry declares area beta.
    assert.equal(areaSlugOf('ax-oddball'), 'beta');
    assert.equal(projectOf('ax-oddball'), 'Beta');
  });

  test('precedence 2: members[] beats prefixes[] across areas', () => {
    // ax-shared matches alpha's 'ax-' prefix but is a declared member of beta.
    assert.equal(areaSlugOf('ax-shared'), 'beta');
  });

  test('precedence 3: prefixes[] claims an otherwise-unknown name', () => {
    assert.equal(areaSlugOf('ax-brand-new-service'), 'alpha');
    assert.equal(projectOf('ax-brand-new-service'), 'Alpha Fleet');
  });

  test('precedence 4: an unclaimed name is its own area (standalone repo, unchanged behaviour)', () => {
    assert.equal(areaSlugOf('lonely-repo'), 'lonely-repo');
    assert.equal(projectOf('lonely-repo'), 'lonely-repo');
    assert.equal(areaOut('lonely-repo', SYNTH), 'lonely-repo', 'standalone repos get reports/<name>/');
  });

  // contested names (ax-oddball, ax-shared) prove the tie-break is declared precedence, not array order
  test('every name resolves to exactly ONE slug, contested names included', () => {
    const expected = {
      'alpha-core': 'alpha', 'alpha-libs': 'alpha', 'beta-core': 'beta',
      'ax-oddball': 'beta', 'ax-shared': 'beta', 'ax-new': 'alpha', 'lonely-repo': 'lonely-repo',
    };
    for (const [n, want] of Object.entries(expected)) {
      const resolved = areaSlugOf(n);
      assert.equal(typeof resolved, 'string');
      assert.equal(resolved, want, `${n} resolved to ${resolved}, expected ${want} (claimants: ${claimants(n, SYNTH).map((c) => `${c.via}:${c.slug}`).join(', ') || 'none'})`);
      assert.equal(areaSlugOf(n), resolved, 'and it is stable across calls');
      const declared = areaBySlug(resolved, SYNTH);
      assert.equal(declared ? declared.slug : resolved, want, 'the resolved slug is either a declared area or the name itself');
    }
  });

  test('label -> slug uses the DECLARED slug, and out is independent of it', () => {
    assert.equal(projectSlug('Alpha Fleet'), 'alpha');
    assert.equal(projectSlug('alpha'), 'alpha');
    assert.equal(areaOut('alpha', SYNTH), 'alpha-monorepo');
    assert.equal(areaOut('beta', SYNTH), 'beta', 'no declared out => the slug is the report dir');
  });

  test('a registry with NO areas[] falls back to the entry\'s declared area (reverted-binary path)', () => {
    _setRegistry({ projects: [{ name: 'alpha-core', area: 'alpha', path: '/x', manifest: 'm' }] });
    assert.equal(areaSlugOf('alpha-core'), 'alpha');
    assert.equal(areaSlugOf('ax-brand-new-service'), 'ax-brand-new-service', 'no areas[] => no prefix rule');
    _setRegistry(SYNTH);
  });

  test('an unreadable registry degrades to the repo\'s own name — never blanks a report', () => {
    _setRegistry(null);
    assert.equal(projectOf('alpha-core'), 'alpha-core');
    assert.equal(areaSlugOf('alpha-core'), 'alpha-core');
    assert.equal(projectSlug('client-a'), 'client-a', 'the sanitiser still yields the historic slug with no registry');
    _setRegistry(SYNTH);
  });
});
