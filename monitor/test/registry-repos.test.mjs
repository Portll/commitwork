// node --test monitor/test/  — the hostname → area → repos join.
// The non-negotiable: an area with no repos is `not-scanned`, NEVER "clean".

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRegistry, areaRepos, reposForHost, areaOfHost, deployHosts, repoArea, areaOf, areaOut, areaBySlug, allAreas, AREA_STATUS, OUT_RE, SLUG_RE, registryPath, isExampleRegistry } from '../registry.mjs';
import { existsSync } from 'node:fs';
import { registryPathFor } from '../store-paths.mjs';
import { resolveRepos, expandHome } from '../discover.mjs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LIVE = loadRegistry({ quiet: true });
// the sweep's own repo universe — asserted against directly, never a hand-built list
const REPOS = resolveRepos(LIVE, { selfRoot: CW }).repos;

const STATUSES = new Set(Object.values(AREA_STATUS));


// Stand down where no declared registry path exists on this machine. Deliberately not a repo-count
// guard — a shrunken fleet must stay loud.
// undefined, NOT null: node:test reads `{ skip: null }` as SKIP.
const FLEET_PRESENT = (LIVE.projects || [])
  .map((x) => x.path).filter(Boolean)
  .some((x) => { try { return existsSync(expandHome(x)); } catch { return false; } });
const NO_FLEET = FLEET_PRESENT ? undefined
  : 'no path declared in monitor/projects.json exists on this machine, so there is no resolved '
    + 'fleet to join the registry against. Meaningful only where the fleet lives.';

// Without the private registry loadRegistry() reads the example, which the join tests below still
// exercise; only the floor on the live fleet's hostname count has no subject there.
const LIVE_SKIP = isExampleRegistry(registryPath())
  ? `private registry absent: ${registryPathFor(CW)} does not exist, so loadRegistry() reads the example and the live hostname floor is not measured`
  : undefined;

describe('the live registry — hostname → area', () => {
  test('the live registry\'s hostnames reach deployHosts() — a floor, not a fleet-size pin', { skip: LIVE_SKIP }, () => {
    const hosts = deployHosts(LIVE);
    // the floor catches deployHosts() returning nothing — not a pin on exact fleet size
    assert.ok(hosts.length >= 4, `expected the declared hostnames to be present, got ${hosts.length}`);
  });

  test('every declared hostname resolves to exactly the area that declares it', () => {
    const hosts = deployHosts(LIVE);
    assert.ok(hosts.length >= 1, 'no hostname is declared anywhere — the resolution loop below would assert nothing');
    for (const h of hosts) {
      assert.equal(areaOfHost(h.hostname, LIVE), h.area, `${h.hostname} must resolve to ${h.area}`);
      assert.ok(areaBySlug(h.area, LIVE), `${h.hostname} names area '${h.area}' which has no areas[] block`);
    }
  });

  test('a hostname is claimed by ONE area — deployHosts has no duplicates', () => {
    const seen = new Map();
    for (const h of deployHosts(LIVE)) {
      assert.ok(!seen.has(h.hostname), `${h.hostname} claimed by both '${seen.get(h.hostname)}' and '${h.area}'`);
      seen.set(h.hostname, h.area);
    }
  });

  test('hostname matching is case-insensitive and whitespace-tolerant, not fuzzy', () => {
    // Derived: any declared hostname exercises the matcher, and naming one couples this test to a
    // deployment that can be retired.
    const [h0] = deployHosts(LIVE);
    assert.ok(h0, 'no hostname is declared anywhere — the matcher below would assert nothing');
    const H = h0.hostname;
    assert.equal(areaOfHost(H.toUpperCase(), LIVE), h0.area);
    assert.equal(areaOfHost(`  ${H}  `, LIVE), h0.area);
    // a SUBDOMAIN or a superstring is a DIFFERENT name and must never be attributed
    assert.equal(areaOfHost(`x.${H}`, LIVE), null);
    assert.equal(areaOfHost(`${H}.evil.com`, LIVE), null);
    assert.equal(areaOfHost('', LIVE), null);
    assert.equal(areaOfHost(null, LIVE), null);
  });
});

// THE WORKED EXAMPLE IS DERIVED, NOT NAMED. These blocks used `client-d` throughout, and on 2026-08-26
// client-d's deploy declaration was removed — it claimed an origin (127.0.0.1:8099) that serves nothing,
// while Deno Deploy actually serves its hostnames. Six tests failed at once for a reason that was not
// a defect. An example area picked by PROPERTY survives the next such change; one picked by name does
// not, which is the same lesson the hostname list in this file already learned.
//
// Wanted: an area that declares at least one hostname AND resolves to at least one repo, so the join
// under test has both halves to join.
function pickExample(reg, repos) {
  const areas = (reg.areas || []).filter((a) => (a.deploy?.hostnames || []).length);
  for (const a of areas) {
    const mine = repos.filter((r) => r.area === a.slug);
    if (mine.length) return { area: a, hostname: a.deploy.hostnames[0], repos: mine };
  }
  return null;
}

describe('the live registry — the join returns the RIGHT repos for a hostname that has them', { skip: NO_FLEET }, () => {
  // THE EXAMPLE IS DERIVED. This block named client-d and its three hostnames; one hostname was retired
  // on 2026-08-25 and the whole deploy declaration on 2026-08-26 (it claimed an origin serving
  // nothing, while Deno Deploy served the names), and six tests failed at once for reasons that were
  // not defects. pickExample() chooses any area that declares a hostname AND resolves to repos, so
  // the join under test always has both halves and no single deployment can take these tests down.
  const EX = pickExample(LIVE, REPOS);

  // A DERIVED EXAMPLE CAN COME BACK NULL, and a skipped body is a passing test that asserts nothing.
  test('some area declares a hostname AND resolves to repos — else the joins below are vacuous', () => {
    assert.ok(EX, 'no area both declares a hostname and resolves to a repo; the join tests would assert nothing');
  });

  for (const host of (EX ? EX.area.deploy.hostnames : [])) {
    test(`${host} → area ${EX.area.slug} → its repos, status mapped`, () => {
      const j = reposForHost(host, LIVE, { repos: REPOS });
      assert.equal(j.status, AREA_STATUS.MAPPED, j.reason);
      assert.equal(j.area, EX.area.slug);
      assert.equal(j.out, EX.area.out || EX.area.slug, 'the report dir the findings are read from');
      assert.equal(j.count, j.repos.length);
      assert.ok(j.count > 0, 'a mapped hostname with zero repos is the not-scanned case, not this one');
      // the deploy facts travel with the join so a consumer never re-walks areas[] by hand
      assert.equal(j.deploy.service, EX.area.deploy.service);
      assert.equal(j.deploy.public, EX.area.deploy.public);
      // and the repo is a REAL resolved repo, not a name the join invented
      assert.ok(j.repos[0].path, 'the joined repo carries the path the sweep scans');
    });
  }

  test('the joined repo is the one the sweep resolves — same object, not a lookalike', () => {
    assert.ok(EX, 'no derived example');
    const j = reposForHost(EX.hostname, LIVE, { repos: REPOS });
    assert.ok(REPOS.includes(j.repos[0]), 'the join must return resolveRepos() entries by reference');
  });

  // The fleet area is found by its SHAPE (prefixes, several members, out != slug), never by a name:
  // the tracked tree carries the public slug and the private registry carries its own, and a
  // literal for either goes stale the moment one of them moves.
  test('the multi-repo area joins to ALL of its repos, not just the declared members', (t) => {
    const fleet = (LIVE.areas || []).filter((a) => (a.prefixes || []).length > 0 && (a.members || []).length > 1 && a.out && a.out !== a.slug);
    if (fleet.length !== 1) return t.skip(`${fleet.length} areas have the fleet shape (prefixes, several members, out != slug); this join needs exactly one`);
    const area = fleet[0];
    // A paused area whose members resolve to nothing is idle by declaration: the operator's
    // statement, not a broken join. Only a declared pause explains the absence; without one it
    // still fails below.
    if (area.paused && !area.members.some((n) => REPOS.some((r) => r.name === n))) {
      return t.skip(`the only fleet-shaped area is paused and none of its members resolves on this machine, so the live join has no subject`);
    }
    const j = areaRepos(area.slug, LIVE, { repos: REPOS });
    assert.equal(j.status, AREA_STATUS.MAPPED);
    assert.equal(j.out, area.out, 'slug != out, and the join must return OUT');
    // expand:children members and prefixed repos must both be in, or findings are under-reported
    const members = area.members.filter((n) => REPOS.some((r) => r.name === n));
    const prefixed = REPOS.filter((r) => area.prefixes.some((p) => r.name.startsWith(p))).map((r) => r.name);
    assert.ok(members.length > 0, `none of the fleet area's declared members resolves on this machine — the join has no subject`);
    for (const n of [...members, ...prefixed]) {
      assert.ok(j.repos.some((r) => r.name === n), `${n} missing from the ${area.slug} join`);
    }
    assert.ok(j.count >= members.length + prefixed.length, `expected the whole fleet, got ${j.count}`);
    // Announced, not swallowed: on a machine without the fleet's prefixed checkouts the prefix half
    // of the join has no subject, and a pass here says nothing about it.
    if (!prefixed.length) t.diagnostic(`no repo with a fleet prefix (${area.prefixes.join(', ')}) resolves on this machine — the prefixed half of the join is unexercised here`);
  });
});

// a fixture, deliberately — a rule tied to whichever live area happened to be repo-less vanishes with it
const ZERO_REPO_FIXTURE = {
  areas: [{
    slug: 'ghost-area', label: 'ghost', out: 'ghost-area',
    deploy: { hostnames: ['ghost.example.test'], service: 'http://127.0.0.1:9', public: true, requiresAuth: false },
  }],
  projects: [], roots: [],
};

describe('THE HONESTY RULE — zero repos is not-scanned, never clean', { skip: NO_FLEET }, () => {
  test('a declared, PUBLISHED area with no repos is NOT-SCANNED — never mapped, never clean', () => {
    const j = reposForHost('ghost.example.test', ZERO_REPO_FIXTURE, { repos: [] });
    assert.equal(j.status, AREA_STATUS.NOT_SCANNED, `expected not-scanned, got ${j.status}: ${j.reason}`);
    assert.notEqual(j.status, AREA_STATUS.MAPPED);
    assert.equal(j.area, 'ghost-area');
    assert.equal(j.count, 0);
    assert.deepEqual(j.repos, []);
    // the signal must be legible without reading the code that produced it
    assert.match(j.reason, /not\b.*"clean"|nothing is known/i, `reason must say why: ${j.reason}`);
    // the deploy declaration still travels — a not-scanned hostname is still a PUBLISHED one
    assert.equal(j.deploy.public, true);
  });

  test('a zero-repo result carries its DECLARED out — never a guessed dir, never a silent null', () => {
    const j = areaRepos('ghost-area', ZERO_REPO_FIXTURE, { repos: [] });
    assert.equal(j.declared, true);
    assert.equal(j.out, 'ghost-area', 'a declared area keeps its out so a consumer can say "that dir does not exist"');
    const u = areaRepos('never-heard-of-it', ZERO_REPO_FIXTURE, { repos: [] });
    assert.equal(u.declared, false);
    assert.equal(u.out, null, 'an unmapped slug must not be handed a report directory');
  });

  // flipped from NOT_SCANNED when commitwork became scanned; kept because "mapped" can regress
  test('commitwork.portll.net is requiresAuth AND now genuinely scanned — the void is closed, not hidden', () => {
    const j = reposForHost('commitwork.portll.net', LIVE, { repos: REPOS });
    assert.equal(j.deploy.requiresAuth, true);
    assert.equal(j.deploy.authAt, 'origin');
    assert.equal(j.status, AREA_STATUS.MAPPED,
      'the origin of a published requiresAuth hostname must resolve to real code, not an inference');
    // Was ['commitwork'] exactly. The 2026-08-22 area merge folded commitwork-web/-research/-remote
    // into this area, so the host→repo join is now 1:4 — three of these do NOT serve this hostname.
    // That is the cost of the merge, recorded rather than papered over: the guard that still matters
    // is that the SERVING checkout is present and that the set does not drift beyond the area.
    const names = j.repos.map((r) => r.name).sort();
    assert.ok(names.includes('commitwork'),
      'the checkout that actually serves this hostname must be in the join — otherwise the declaration drifted');
    // DERIVED from the area's own members. This froze the four names the 2026-08-22 merge produced,
    // so declaring commitwork-business into the area on 2026-08-26 failed a test that was not
    // measuring anything about that repo. The guard this comment says still matters — "the set does
    // not drift BEYOND the area" — is preserved exactly by comparing against what the area declares.
    const declared = (LIVE.areas.find((a) => a.slug === j.area)?.members || []).slice().sort();
    assert.ok(declared.length > 0, 'the area declares no members; the comparisons below would be vacuous');

    // THE GUARD, as the comments above state it twice: the set must not drift BEYOND the area. That
    // is containment, and deepEqual was the wrong shape for it — equality also forbids a SUBSET,
    // which is exactly what a member checked out on another machine produces. This registry's note
    // says its paths are ~-relative so it works across machines, and it keeps `commitwork-business`
    // for that reason: a member that exists but is elsewhere is a different fact from one that does
    // not exist, and only the second is a defect. Equality made this test machine-specific inside a
    // registry built not to be. It is the same defect one step along from the one recorded above —
    // freezing four names broke when a fifth was declared; deriving from members broke when one of
    // them was not checked out here.
    const extra = names.filter((n) => !declared.includes(n));
    assert.deepEqual(extra, [],
      'a repo joined a published requiresAuth hostname without being declared in its area');

    // AND EVERY ABSENCE MUST BE EXPLAINED, or this would be strictly weaker than what it replaces.
    // A declared member missing from the join is acceptable ONLY when it resolves nowhere on this
    // box. One that resolved but joined a different area is real drift, and a bare containment
    // check would pass it.
    const resolvedNames = new Set(REPOS.map((r) => r.name));
    const misfiled = declared.filter((n) => !names.includes(n) && resolvedNames.has(n));
    assert.deepEqual(misfiled, [],
      'a declared member resolved on this box but joined a different area — drift, not an absent checkout');
  });

  test('an UNDECLARED hostname is unmapped and is NEVER attributed to a project', () => {
    for (const host of ['panel.portll.net', 'not-declared.example.com', 'portll.net', 'client-d']) {
      const j = reposForHost(host, LIVE, { repos: REPOS });
      assert.equal(j.status, AREA_STATUS.UNMAPPED, `${host} must be unmapped, got ${j.status}`);
      assert.equal(j.area, null, `${host} must name no area`);
      assert.equal(j.deploy, null);
      assert.deepEqual(j.repos, []);
    }
  });

  test('an area slug used as a HOSTNAME stays unmapped — the join is on declarations, not name similarity', () => {
    const slug = allAreas(LIVE).find((candidate) =>
      areaRepos(candidate, LIVE, { repos: REPOS }).status === AREA_STATUS.MAPPED
      && reposForHost(candidate, LIVE, { repos: REPOS }).status === AREA_STATUS.UNMAPPED);
    assert.ok(slug, 'no mapped area with an undeclared same-name hostname was available to exercise the join');
    assert.equal(reposForHost(slug, LIVE, { repos: REPOS }).status, AREA_STATUS.UNMAPPED);
    assert.equal(areaRepos(slug, LIVE, { repos: REPOS }).status, AREA_STATUS.MAPPED);
  });

  test('NO area anywhere can return status mapped with zero repos', () => {
    for (const slug of [...allAreas(LIVE), ...new Set(REPOS.map((r) => repoArea(r, LIVE)))]) {
      if (!slug) continue;
      const j = areaRepos(slug, LIVE, { repos: REPOS });
      assert.ok(STATUSES.has(j.status), `${slug}: status '${j.status}' is outside the closed vocabulary`);
      if (j.count === 0) assert.notEqual(j.status, AREA_STATUS.MAPPED, `${slug} reported mapped with zero repos`);
      if (j.status === AREA_STATUS.MAPPED) assert.ok(j.count > 0, `${slug} reported mapped with count ${j.count}`);
      assert.ok(typeof j.reason === 'string' && j.reason.length, `${slug} carries no reason`);
    }
  });

});

describe('the primitive cannot be misused into a silent green', () => {
  // A DECLARED hostname, derived. These named ad.portll.net, and once client-d's deploy declaration was
  // removed on 2026-08-26 that name resolved UNMAPPED — so reposForHost returned early and never
  // reached the argument check these tests exist to prove. The guard was not broken; it had stopped
  // being exercised, which is the quieter failure and the one a green suite hides.
  const [DECLARED] = deployHosts(LIVE);
  const anyArea = (LIVE.areas || [])[0]?.slug;

  test('areaRepos THROWS when `repos` is omitted — a forgotten argument must not look like a finding', () => {
    assert.ok(DECLARED, 'no hostname is declared; the reposForHost misuse checks below would be vacuous');
    assert.throws(() => areaRepos(anyArea, LIVE), TypeError);
    assert.throws(() => areaRepos(anyArea, LIVE, {}), TypeError);
    assert.throws(() => areaRepos(anyArea, LIVE, { repos: null }), TypeError);
    assert.throws(() => reposForHost(DECLARED.hostname, LIVE), TypeError);
    // and the message must name the fix, not just the failure
    try { areaRepos(anyArea, LIVE); } catch (e) { assert.match(e.message, /resolveRepos/); }
  });

  test('an EMPTY repo universe reports not-scanned for a declared area — not mapped, not clean', () => {
    const j = reposForHost(DECLARED.hostname, LIVE, { repos: [] });
    assert.equal(j.status, AREA_STATUS.NOT_SCANNED);
    assert.equal(j.count, 0);
  });

  test('a path-traversal or malformed slug is UNMAPPED and is handed no report dir', () => {
    for (const bad of ['../evil', 'client-d/../client-a', 'client-d', '', null, 'a b']) {
      const j = areaRepos(bad, LIVE, { repos: REPOS });
      assert.equal(j.status, AREA_STATUS.UNMAPPED, `${JSON.stringify(bad)} must be unmapped, got ${j.status}`);
      assert.equal(j.out, null, `${JSON.stringify(bad)} must not resolve to a report directory`);
      assert.deepEqual(j.repos, []);
    }
  });

  test('the status vocabulary is closed and none of its values reads as "clean"', () => {
    assert.deepEqual(Object.values(AREA_STATUS).sort(), ['mapped', 'not-scanned', 'unmapped']);
    for (const v of Object.values(AREA_STATUS)) assert.notEqual(v, 'none');
    assert.ok(Object.isFrozen(AREA_STATUS));
  });
});

describe('the join agrees with the sweep about what exists', () => {
  test('repoArea() and areaOf() agree on every repo the sweep resolves', () => {
    for (const r of REPOS) {
      assert.equal(repoArea(r, LIVE), r.area || areaOf(r.name, LIVE), `${r.name} resolves two ways`);
    }
  });

  test('every resolved repo appears in exactly ONE area join — no repo is double-counted or lost', () => {
    const areas = new Set(REPOS.map((r) => repoArea(r, LIVE)).filter(Boolean));
    assert.ok(areas.size > 0, 'no repo resolved to any area — the double-count check below would pass having joined nothing');
    const seen = new Map();
    for (const a of areas) {
      for (const r of areaRepos(a, LIVE, { repos: REPOS }).repos) {
        assert.ok(!seen.has(r.name), `${r.name} joined to both '${seen.get(r.name)}' and '${a}'`);
        seen.set(r.name, a);
      }
    }
    const unresolvable = REPOS.filter((r) => !repoArea(r, LIVE));
    // non-slug repo names resolve to no area — they must be absent from every join
    for (const r of unresolvable) assert.ok(!seen.has(r.name), `${r.name} has no resolvable area yet joined to '${seen.get(r.name)}'`);
    assert.equal(seen.size + unresolvable.length, REPOS.length,
      `${REPOS.length} repos resolved, ${seen.size} joined + ${unresolvable.length} unresolvable`);
  });

  test('areaRepos OUT matches areaOut — one resolver, not two', () => {
    for (const slug of allAreas(LIVE)) {
      assert.equal(areaRepos(slug, LIVE, { repos: REPOS }).out, areaOut(slug, LIVE), `${slug}`);
    }
  });
});

describe('a synthetic registry — the contract without depending on today\'s projects.json', () => {
  const REG = {
    areas: [
      { slug: 'alpha', label: 'Alpha', out: 'alpha-out', members: ['alpha-core'], prefixes: ['al-'],
        deploy: { hostnames: ['alpha.example.com', 'a2.example.com'], service: 'https://127.0.0.1:1', public: true, requiresAuth: false } },
      { slug: 'ghost', label: 'Ghost',
        deploy: { hostnames: ['ghost.example.com'], service: 'http://127.0.0.1:2', public: true, requiresAuth: true, authAt: 'edge' } },
      { slug: 'quiet', label: 'Quiet', members: ['quiet-repo'] },
    ],
    projects: [{ name: 'alpha-core', area: 'alpha', path: '/x', manifest: 'm' }],
  };
  const repos = [
    { name: 'alpha-core', area: 'alpha', path: '/x' },
    { name: 'al-widget', path: '/y' },                  // resolves via prefixes[]
    { name: 'quiet-repo', path: '/z' },                 // resolves via members[], no deploy block
    { name: 'loner', path: '/w' },                      // own-area fallback
  ];

  test('a deploy area with members AND prefixes joins to both', () => {
    const j = reposForHost('alpha.example.com', REG, { repos });
    assert.equal(j.status, AREA_STATUS.MAPPED);
    assert.deepEqual(j.repos.map((r) => r.name).sort(), ['al-widget', 'alpha-core']);
    assert.equal(j.out, 'alpha-out');
  });

  test('both hostnames of one area join to the same repo set', () => {
    const a = reposForHost('alpha.example.com', REG, { repos }).repos.map((r) => r.name);
    const b = reposForHost('a2.example.com', REG, { repos }).repos.map((r) => r.name);
    assert.deepEqual(a, b);
  });

  test('a DEPLOY-ONLY area (hostname, no members, no prefixes, no matching repo) is not-scanned', () => {
    const j = reposForHost('ghost.example.com', REG, { repos });
    assert.equal(j.status, AREA_STATUS.NOT_SCANNED);
    assert.equal(j.area, 'ghost');
    assert.equal(j.count, 0);
    assert.match(j.reason, /deploy-only/);
    assert.equal(j.deploy.requiresAuth, true);
    assert.equal(j.deploy.authAt, 'edge');
  });

  test('an area with repos but NO deploy block still joins by slug — the primitive is not exposure-specific', () => {
    const j = areaRepos('quiet', REG, { repos });
    assert.equal(j.status, AREA_STATUS.MAPPED);
    assert.deepEqual(j.repos.map((r) => r.name), ['quiet-repo']);
    assert.equal(j.out, 'quiet', 'out defaults to slug');
  });

  test('an undeclared repo is its own area and is reachable by that slug', () => {
    const j = areaRepos('loner', REG, { repos });
    assert.equal(j.status, AREA_STATUS.MAPPED);
    assert.equal(j.declared, false, 'no areas[] block, but the repo is real');
    assert.equal(j.out, 'loner');
  });

  test('deployHosts enumerates every declared hostname with its origin facts', () => {
    assert.deepEqual(deployHosts(REG).map((h) => `${h.hostname}=${h.area}`),
      ['alpha.example.com=alpha', 'a2.example.com=alpha', 'ghost.example.com=ghost']);
    assert.deepEqual(deployHosts({}), []);
    assert.deepEqual(deployHosts(null), []);
  });

  test('a registry with no areas[] at all does not throw and reports unmapped', () => {
    const bare = { projects: [] };
    assert.equal(areaOfHost('x.example.com', bare), null);
    assert.equal(reposForHost('x.example.com', bare, { repos: [] }).status, AREA_STATUS.UNMAPPED);
    assert.equal(areaRepos('anything', bare, { repos: [] }).status, AREA_STATUS.UNMAPPED);
  });
});


// -- OUT_RE vs SLUG_RE: slug is a ROUTE (dash-only), out is a DIRECTORY NAME ---------------------
describe('OUT_RE - a directory name may carry a domain, but never hide or escape', () => {
  test('the shapes that must stay REFUSED', () => {
    for (const bad of ['.hidden', '..', '.', '../escape', 'a/b', 'a\\b', '', ' ', 'with space',
      'UPPER', 'MiXeD', '-leading-dash', 'x y']) {
      assert.equal(OUT_RE.test(bad), false, `${JSON.stringify(bad)} must be refused as an out`);
    }
  });

  test('a leading dot is impossible, so no report dir can be hidden and no bare `..` can pass', () => {
    // this is the whole reason internal dots are safe: the leading class is [a-z0-9]
    for (const d of ['.a', '..a', '...']) assert.equal(OUT_RE.test(d), false, `${d} must be refused`);
    assert.equal(OUT_RE.test('a..b'), true, 'an internal double dot is a filename, not a path segment');
  });

  test('a live domain is accepted as a report directory', () => {
    for (const ok of ['example.net.au', 'a.b.c', 'client-a-monorepo', 'x9', 'example.garden']) {
      assert.equal(OUT_RE.test(ok), true, `${ok} must be accepted as an out`);
    }
  });

  test('SLUG_RE stays STRICTER than OUT_RE - a route must not inherit the looser rule', () => {
    // admin/serve.mjs matches /map/([a-z0-9][a-z0-9-]*), so a dotted slug would route nowhere
    assert.equal(SLUG_RE.test('example.net.au'), false, 'a dotted slug must still be refused');
    assert.equal(OUT_RE.test('example.net.au'), true);
  });

  test('every declared out in the LIVE registry resolves - the loader and areaOut() must agree', () => {
    // the loader once accepted a dotted `out` that areaOut() resolved to null
    for (const a of LIVE.areas || []) {
      assert.ok(areaOut(a.slug, LIVE), `${a.slug} declares out '${a.out}' but areaOut() resolves null`);
    }
  });
});
