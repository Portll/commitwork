// node --test monitor/test/  — the scheduling contradiction: no *.plist stays committed (agents
// are generated-only), any that reappears must byte-match this machine's generated body, and the
// scheduled scope covers every declared area. Importing install-agents.mjs is safe only because
// every write/launchctl/exit is behind isMain — the LaunchAgents snapshot test is the safety net.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AGENTS, plist, CW, AGENT_DIR, LIVE_LLM_ENV, docsiteDeployEnv } from '../install-agents.mjs';
import { main as witnessMain, EXIT as WITNESS_EXIT } from '../envelope-witness.mjs';
import { loadRegistry, deployHosts } from '../registry.mjs';

const SWEEP_LABEL_PREFIX = 'com.portll.commitwork-monitor-';
const sweepAgents = () => AGENTS.filter((a) => a.label.startsWith(SWEEP_LABEL_PREFIX));

// ── shared repo walker: every *.plist file, same ignore rules as test-coverage-meta's walker ──────
const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', 'reports', 'tmp']);
const isIgnoredDir = (name) => name.startsWith('.') || IGNORED_DIR_NAMES.has(name);
function findPlists(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (isIgnoredDir(e.name)) continue;
      findPlists(join(dir, e.name), out);
    } else if (e.isFile() && e.name.endsWith('.plist')) {
      out.push(join(dir, e.name));
    }
  }
  return out;
}

// ── snapshot the REAL LaunchAgents dir so this whole file is provably a --dry-only exercise ────────
function snapshotAgentDir() {
  try {
    return readdirSync(AGENT_DIR).sort().map((name) => {
      const st = statSync(join(AGENT_DIR, name));
      return `${name} ${st.size}b mtime=${st.mtimeMs}`;
    }).join('\n');
  } catch (e) {
    return `<unreadable: ${e.message}>`;
  }
}
let beforeSnapshot;
before(() => { beforeSnapshot = snapshotAgentDir(); });
after(() => {
  assert.equal(snapshotAgentDir(), beforeSnapshot,
    'importing/testing monitor/install-agents.mjs must NEVER modify the REAL ~/Library/LaunchAgents. ' +
    'Every write/launchctl/process.exit call is gated behind isMain, which is false on import — if this ' +
    'fails, something in this file (or a regression in install-agents.mjs) escaped that gate.');
});

// ── gate 1, part (a): no stale committed plist survives ────────────────────────────────────────────
test('no *.plist file is committed anywhere in the tree — every commitwork launchd agent is generated-only', () => {
  const found = findPlists(CW);
  assert.deepEqual(found, [],
    `${found.length} committed *.plist file(s) found: ${found.join(', ')}. ` +
    'monitor/com.portll.commitwork-{monitor,liveness}.plist (hardcoded /Users/username/… paths and a ' +
    'stale client-a scope) and cra/com.portll.commitwork-cra-watch.plist (folded into this generator) ' +
    'were deleted as stale artifacts (bifocal R10) — monitor/install-agents.mjs is now the only source ' +
    'of a commitwork launchd agent. A file here means either a stale plist crept back in, or a new ' +
    'hand-written one was added — see the next test for what "stale" would concretely mean.');
});

// ── gate 1, part (b): the regression guard, for if a plist ever reappears ──────────────────────────
test('any committed plist whose Label matches a generated agent must byte-for-byte match this machine\'s generated body', () => {
  const byLabel = new Map(AGENTS.map((a) => [a.label, a]));
  for (const path of findPlists(CW)) {
    const xml = readFileSync(path, 'utf8');
    const label = (xml.match(/<key>Label<\/key><string>([^<]*)<\/string>/) || [])[1];
    assert.ok(label, `${path}: no <key>Label</key> found — is this really a launchd agent plist?`);
    const agent = byLabel.get(label);
    assert.ok(agent, `${path}: Label '${label}' does not match any agent this machine's generator ` +
      `would produce (known labels: ${[...byLabel.keys()].join(', ')}) — an orphaned/stale committed plist.`);
    assert.equal(xml, plist(agent),
      `${path}: committed content differs from what monitor/install-agents.mjs generates for THIS ` +
      "machine right now for label '" + label + "' — exactly the staleness class (hardcoded " +
      '/Users/username/… paths, a stale client-a scope argument) that made the original plists dead ' +
      'on every machine but one. Regenerate: node monitor/install-agents.mjs --write.');
  }
});

// ── gate 1, part (c): proof the comparator in (b) is not a dead branch ─────────────────────────────
test('proof: the byte-for-byte comparator above actually detects drift (nothing is left in the tree to trigger it for real)', () => {
  const agent = AGENTS[0];
  const real = plist(agent);
  const stale = real.replace(CW, '/Users/username/Repositories/External/Portll/commitwork');
  assert.notEqual(stale, real, 'fixture is broken: the substitution produced no actual difference');
  assert.throws(() => assert.equal(stale, real), assert.AssertionError,
    'a plist body whose paths point at a different machine must NOT compare equal to the one this ' +
    'machine\'s generator actually produces');
});

// ── gate 2: scheduled scope covers every area declaring deploy.public:true ─────────────────────────
test('the scheduled scope covers every area declaring deploy.public: true', () => {
  const reg = loadRegistry({ quiet: true }); // independent read of the real registry, not the generator's cache
  const publicAreas = new Set(deployHosts(reg).filter((h) => h.public).map((h) => h.area));
  assert.ok(publicAreas.size > 0,
    'sanity: expected at least one area with deploy.public:true in monitor/projects.json (client-d, ' +
    'commitwork-admin, lab-landing) — if this is 0 the registry changed and this test needs a second ' +
    'look, not a silent pass');
  const scheduledSlugs = new Set(sweepAgents().map((a) => a.argv[a.argv.length - 1]));
  const missing = [...publicAreas].filter((slug) => !scheduledSlugs.has(slug));
  assert.deepEqual(missing, [],
    `${missing.length} area(s) declare deploy.public:true but no generated sweep agent names them as ` +
    `its scope: ${missing.join(', ')}. scheduled areas: ${[...scheduledSlugs].join(', ')}`);
});

// ── stronger form actually implemented: EVERY declared area, not just the public ones ──────────────
test('every declared area (areas[]) gets its own scheduled sweep agent naming that area explicitly — no fewer, no more', () => {
  const reg = loadRegistry({ quiet: true });
  // MINUS the paused ones, which are declared un-swept on purpose. Stated as a subtraction rather
  // than by relaxing the equality: "fewer means an area is silently un-swept" is still the defect,
  // and the only thing that may excuse an absence is a declaration that says so.
  const paused = new Set((reg.areas || []).filter((a) => a.paused).map((a) => a.slug));
  const expected = (reg.areas || []).map((a) => a.slug).filter((s) => !paused.has(s));
  const scheduled = new Set(sweepAgents().map((a) => a.argv[a.argv.length - 1]));
  assert.deepEqual(expected.sort(), [...scheduled].sort(),
    'the generated sweep agents must cover EXACTLY the registry\'s declared, unpaused areas: fewer means an ' +
    'area is silently un-swept (the original bug), more means a phantom agent for an area that no longer exists');
});

test('a paused area gets NO agent — the schedule is what actually sweeps this box', () => {
  const reg = loadRegistry({ quiet: true });
  const paused = (reg.areas || []).filter((a) => a.paused).map((a) => a.slug);
  // Non-vacuous only while something is paused; when nothing is, the test above carries the whole
  // contract and this one has nothing to say. Assert which case we are in rather than passing blind.
  if (!paused.length) {
    assert.deepEqual(paused, [], 'nothing paused — coverage is asserted in full by the test above');
    return;
  }
  const scoped = new Set(AGENTS.map((a) => a.argv[a.argv.length - 1]));
  for (const slug of paused) {
    assert.ok(!scoped.has(slug),
      `${slug} is paused but still has a generated agent — the agents name their scope EXPLICITLY, so a ` +
      'pause that only filters --all changes nothing about the nightly run');
  }
});

test('every sweep agent names its scope EXPLICITLY — never the bare `all` that silently falls back to the primary area', () => {
  assert.ok(sweepAgents().length >= 2, 'expected more than one sweep agent — check the registry/fixture');
  for (const a of sweepAgents()) {
    assert.equal(a.argv.length, 4, `${a.label}: expected [node, sweep.mjs, 'all', <area-slug>], got ${JSON.stringify(a.argv)}`);
    const [, script, group, scope] = a.argv;
    assert.match(script, /monitor[\\/]sweep\.mjs$/, `${a.label}: argv[1] must be monitor/sweep.mjs`);
    assert.equal(group, 'all', `${a.label}: argv[2] must be the scanner group 'all'`);
    assert.ok(typeof scope === 'string' && scope.length > 0, `${a.label}: argv[3] must be a non-empty explicit area slug`);
  }
});

// ── the staggering requirement ──────────────────────────────────────────────────────────────────
test('no two sweep agents share a start time (staggered, so N agents never hit the shared reports lock at once)', () => {
  const schedules = sweepAgents().map((a) => a.schedule);
  assert.equal(new Set(schedules).size, schedules.length,
    `two or more sweep agents share an identical <StartCalendarInterval>: ${JSON.stringify(schedules)}`);
});

// ── the CRA-watch fold-in ───────────────────────────────────────────────────────────────────────
test('the CRA watch is folded into the generated roster with its CRA_FETCH env preserved', () => {
  const cra = AGENTS.find((a) => a.label === 'com.portll.commitwork-cra-watch');
  assert.ok(cra, 'com.portll.commitwork-cra-watch must be one of the generated agents');
  assert.ok(cra.argv.some((a) => String(a).replace(/\\/g, '/').endsWith('cra/watch.mjs')),
    'the cra-watch agent must invoke cra/watch.mjs');
  assert.equal(cra.env?.CRA_FETCH, '1', 'CRA_FETCH=1 must be preserved from the folded-in plist');
  assert.equal(cra.runAtLoad, true, 'RunAtLoad=true must be preserved from the folded-in plist');
});

test('the evidence pack refresh is a declared daily job, claimed by the charter, not started at load', () => {
  const job = AGENTS.find((a) => a.label === 'com.portll.commitwork-cra-refresh');
  assert.ok(job, 'com.portll.commitwork-cra-refresh must be one of the generated agents');
  assert.ok(job.argv.some((a) => String(a).replace(/\\/g, '/').endsWith('cra/refresh.mjs')), 'it must invoke cra/refresh.mjs');
  assert.match(job.schedule, /<key>StartCalendarInterval<\/key>\s*<dict><key>Hour<\/key><integer>\d+<\/integer><key>Minute<\/key>/,
    'a daily calendar slot, not an interval that fires at every load');
  assert.notEqual(job.runAtLoad, true);
  const charter = JSON.parse(readFileSync(new URL('../../manifests/feature-charter.json', import.meta.url), 'utf8'));
  const group = charter.groups.find((g) => g.surface === 'job' && g.keys.includes(job.label));
  assert.equal(group?.id, 'jobs.cra');
});

test('the docsite publish is a declared daily job behind the docsite flag, not started at load', () => {
  const job = AGENTS.find((a) => a.label === 'com.portll.commitwork-docsite-publish');
  assert.ok(job, 'com.portll.commitwork-docsite-publish must be one of the generated agents');
  assert.ok(job.argv.some((a) => String(a).replace(/\\/g, '/').endsWith('bin/docsite-publish-scheduled.mjs')));
  assert.match(job.schedule, /<key>StartCalendarInterval<\/key>\s*<dict><key>Hour<\/key><integer>\d+<\/integer><key>Minute<\/key>/);
  assert.notEqual(job.runAtLoad, true, 'loading the job must not deploy');
  const charter = JSON.parse(readFileSync(new URL('../../manifests/feature-charter.json', import.meta.url), 'utf8'));
  const group = charter.groups.find((g) => g.surface === 'job' && g.keys.includes(job.label));
  assert.deepEqual([group?.id, group?.flag], ['jobs.docsite', 'docsite']);
});

test('the docsite job carries only the deploy settings the installing shell has', () => {
  assert.equal(docsiteDeployEnv({}), undefined);
  assert.deepEqual(docsiteDeployEnv({ CW_WRANGLER: '/x/wrangler', CW_CLOUDFLARE_ZONE_ID: 'z', OTHER: '1' }), { CW_WRANGLER: '/x/wrangler', CW_CLOUDFLARE_ZONE_ID: 'z' });
});

test('the liveness deadman reports on load, not one interval after a boot or reload', () => {
  const live = AGENTS.find((a) => a.label === 'com.portll.commitwork-liveness');
  assert.ok(live, 'com.portll.commitwork-liveness must be one of the generated agents');
  assert.equal(live.runAtLoad, true);
});

// ── the live witness opt-in ─────────────────────────────────────────────────────────────────────
// Driven through the witness's own gate with the environment each plist declares, against a witness
// that is already fresh, so the opt-in is exercised and no model is called.
const plistEnv = (agent) => Object.fromEntries(
  [...plist(agent).split('<key>EnvironmentVariables</key>')[1].split('</dict>')[0].matchAll(/<key>([^<]+)<\/key><string>([^<]*)<\/string>/g)].map((m) => [m[1], m[2]]));

test('a scheduled sweep carries the witness opt-in past the gate that reads it; no other agent does', async () => {
  const d = mkdtempSync(join(tmpdir(), 'cw-agents-witness-'));
  try {
    const wp = join(d, 'witness.json');
    const now = '2026-10-04T00:00:00.000Z';
    writeFileSync(wp, JSON.stringify({ pass: true, at: now }));
    assert.ok(sweepAgents().length > 0, 'no sweep agent was generated, so nothing below was checked');
    for (const agent of AGENTS) {
      const said = [];
      const code = await witnessMain([], { ...plistEnv(agent), CW_STPA_ENVELOPE_WITNESS: wp, CW_NOW: now }, (l) => said.push(l));
      assert.equal(code, WITNESS_EXIT.skipped, `${agent.label}: ${said.join(' | ')}`);
      const optedIn = !said.some((l) => l.includes(`${LIVE_LLM_ENV} is not 1`));
      assert.equal(optedIn, agent.label.startsWith(SWEEP_LABEL_PREFIX),
        `${agent.label}: ${optedIn ? 'opts in to a live model replay it has no witness step for' : 'its witness step would skip every night and the witness would lapse after seven days'} — ${said.join(' | ')}`);
      if (optedIn) assert.match(said.join('\n'), /is fresh/, 'the opted-in run reached the freshness gate');
    }
  } finally { rmSync(d, { recursive: true, force: true }); }
});
