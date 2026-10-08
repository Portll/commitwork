// install-agents under the experimental flags: a job whose flag is off is not installed, and one
// already installed is listed for retirement. agentPlan() is asked with a temp agent dir and an
// isInstalled callback; nothing here runs launchctl or writes under ~/Library.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const TMP = mkdtempSync(join(tmpdir(), 'cw-agents-exp-'));
const KEYS = ['CW_REGISTRY', 'CW_SETTINGS', 'CW_EXPERIMENTAL', 'CW_FEATURE_OFFBOX', 'CW_FEATURE_SITEMAP'];
const saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
for (const k of KEYS) delete process.env[k];
writeFileSync(join(TMP, 'projects.json'), JSON.stringify({
  reportsRoot: join(TMP, 'reports'), defaultManifest: 'security-baseline', roots: [],
  projects: [{ name: 'fixrepo', area: 'fixarea', path: join(TMP, 'src'), manifest: 'security-baseline' }],
  areas: [{ slug: 'fixarea', label: 'fixarea', out: 'fixarea', primary: true, members: ['fixrepo'] }],
}));
process.env.CW_REGISTRY = join(TMP, 'projects.json');
process.env.CW_SETTINGS = join(TMP, 'settings.json');
const { agentPlan, AGENTS } = await import('../install-agents.mjs');
after(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  rmSync(TMP, { recursive: true, force: true });
});

const FETCH = 'com.portll.commitwork-offbox-fetch';
const WATCH = 'com.portll.commitwork-offbox-watch';
const SITEMAP = 'com.portll.commitwork-sitemap-data';
const agentDir = join(TMP, 'LaunchAgents');
mkdirSync(agentDir, { recursive: true });
writeFileSync(join(agentDir, `${FETCH}.plist`), '<plist/>'); // installed; WATCH is not

const labels = (plan) => plan.install.map((p) => p.agent.label);

test('ON (the default): every declared job is installed, the experimental ones tagged with their flag', () => {
  const plan = agentPlan({ agentDir });
  assert.deepEqual(labels(plan), AGENTS.map((a) => a.label));
  assert.deepEqual(plan.retire, []);
  assert.equal(plan.install.find((p) => p.agent.label === FETCH).flag, 'offbox');
  assert.equal(plan.install.find((p) => p.agent.label === SITEMAP).flag, 'sitemap');
  assert.equal(plan.install.find((p) => p.agent.label === 'com.portll.commitwork-panel').flag, null);
});

test('OFF: the group is not installed, and only the job already installed is listed for removal', () => {
  process.env.CW_FEATURE_OFFBOX = 'off';
  try {
    const plan = agentPlan({ agentDir });
    assert.ok(!labels(plan).includes(FETCH) && !labels(plan).includes(WATCH));
    assert.ok(labels(plan).includes(SITEMAP), 'another group is untouched');
    assert.deepEqual(plan.retire.map((r) => [r.label, r.flag]), [[FETCH, 'offbox']]);
    assert.match(plan.retire[0].why, /CW_FEATURE_OFFBOX/);
  } finally { delete process.env.CW_FEATURE_OFFBOX; }
});

test('the store switches a job group off too, and the core jobs never move', () => {
  writeFileSync(process.env.CW_SETTINGS, JSON.stringify({ v: 1, settings: { experimentalFeatures: { sitemap: 'off' } } }));
  try {
    const plan = agentPlan({ agentDir, isInstalled: (l) => l === SITEMAP });
    assert.ok(!labels(plan).includes(SITEMAP));
    assert.deepEqual(plan.retire.map((r) => r.label), [SITEMAP]);
    for (const core of ['com.portll.commitwork-panel', 'com.portll.commitwork-liveness', 'com.portll.commitwork-daily']) {
      assert.ok(labels(plan).includes(core), core);
    }
  } finally { rmSync(process.env.CW_SETTINGS, { force: true }); }
});
