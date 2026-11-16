// bin/test/wp-dynamic-witness.test.mjs — the witness driver's pure parts, provable without booting
// WordPress: entry enumeration, parameter synthesis, request shaping, the ambient control and the
// trust gate. The live Playground path is a single test that SKIPS with an explicit not-measured
// reason unless CW_WP_LIVE=1 — a skipped live test must never read as a pass (house invariant).

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  repoTrusted, exitCodeFor, findEntryFile, findPluginRoot, scanActionRegistrations, scanSuperglobalKeys,
  restEntriesFromIndex, actionEntriesFromRoutes, prioritize, paramBag, valueFor, ambientIgnore,
  runWitness, UNSCANNED_REASON, runNuclei,
} from '../wp-dynamic-witness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIX = join(HERE, 'fixtures', 'wp-witness', 'cw-witness-fixture');

describe('trust gate', () => {
  test('refused unless the runner-derived CW_REPO_TRUSTED=1', () => {
    assert.equal(repoTrusted({}), false);
    assert.equal(repoTrusted({ CW_REPO_TRUSTED: '0' }), false);
    assert.equal(repoTrusted({ CW_REPO_TRUSTED: '1' }), true);
    // the operator switch is stripped from lane envs; the tool must not honour it directly
    assert.equal(repoTrusted({ COMMITWORK_TRUST_REPO_MANIFEST: '1' }), false);
  });

  test('runWitness returns an UNSCANNED noscan, never a pass, without consent', async () => {
    const r = await runWitness({ pluginDir: FIX, env: {} });
    assert.equal(r.status, 'noscan');
    assert.equal(r.coverage, 'unknown');
    assert.equal(r.reason, UNSCANNED_REASON);
    assert.equal(r.summary.confirmed, 0);
  });

  test('an unmeasured status maps to a non-zero exit so lane coverage reads reduced', () => {
    assert.equal(exitCodeFor('findings'), 0);
    assert.equal(exitCodeFor('no-confirmed-change'), 0);
    assert.equal(exitCodeFor('noscan'), 3);
    assert.equal(exitCodeFor('undetermined'), 6, 'unattributable changes are not a clean pass');
    assert.equal(exitCodeFor('could-not-install'), 4);
    assert.equal(exitCodeFor('error'), 5);
  });
});

describe('plugin shape scanning', () => {
  test('finds the file carrying the Plugin Name header', () => {
    assert.equal(findEntryFile(FIX), 'cw-witness-fixture.php');
  });

  test('a non-plugin PHP dir is could-not-install, never a wrong-file activation', () => {
    assert.equal(findEntryFile(HERE), null); // bin/test has .mjs/.php tests, no plugin header
  });

  test('a repo holding the plugin one level down resolves to that subdirectory', () => {
    assert.equal(findPluginRoot(dirname(FIX)), FIX);
    assert.equal(findPluginRoot(FIX), FIX);
    assert.equal(findPluginRoot(join(HERE, '..', '..', 'docs')), null);
  });

  test('enumerates ajax/admin-post registrations from the plugin source itself', () => {
    const got = scanActionRegistrations(FIX).map((e) => `${e.entryKind}:${e.selector}`).sort();
    assert.deepEqual(got, ['ajax-nopriv:cw_save', 'ajax:cw_nocap', 'ajax:cw_safe']);
  });

  test('collects request keys and nonce actions for the parameter bag', () => {
    const sg = scanSuperglobalKeys(FIX);
    assert.ok(sg.keys.includes('v') && sg.keys.includes('key') && sg.keys.includes('cw_reset'));
    assert.ok(sg.nonceActions.includes('cw_safe'));
    assert.ok(sg.keys.includes('value'), 'REST get_param keys join the bag');
  });
});

describe('REST enumeration from the live index', () => {
  const index = {
    routes: {
      '/': {},
      '/wp/v2/posts': { endpoints: [{ methods: ['GET', 'POST'], args: {} }] },
      '/oembed/1.0/embed': { endpoints: [{ methods: ['GET'] }] },
      '/cwfx/v1/save': { endpoints: [{ methods: ['POST'], args: { value: {} } }] },
      '/cwfx/v1/safe': { endpoints: [{ methods: ['POST'] }] },
    },
  };
  test('core namespaces are dropped, plugin routes kept with their methods and args', () => {
    const out = restEntriesFromIndex(index);
    assert.deepEqual(out.map((e) => e.selector), ['/cwfx/v1/safe', '/cwfx/v1/save']);
    const save = out.find((e) => e.selector === '/cwfx/v1/save');
    assert.deepEqual(save.methods, ['POST']);
    assert.deepEqual(save.args, ['value']);
  });
});

describe('action list from a wpaudit-style route doc', () => {
  test('ajax / admin-post hooks become entries; other kinds are ignored', () => {
    const doc = { entrySummaries: [
      { kind: 'ajax-nopriv', hook: 'wp_ajax_nopriv_fx_save', cap: false, nonce: false },
      { kind: 'ajax', hook: 'wp_ajax_fx_safe', cap: true, nonce: true },
      { kind: 'admin-post', hook: 'admin_post_do_thing' },
      { kind: 'rest', hook: '?/x' },
      { kind: 'shortcode', hook: 'sc' },
    ] };
    const out = actionEntriesFromRoutes(doc).map((e) => `${e.entryKind}:${e.selector}`).sort();
    assert.deepEqual(out, ['admin-post:do_thing', 'ajax-nopriv:fx_save', 'ajax:fx_safe']);
  });
});

describe('prioritisation and parameters', () => {
  test('nopriv / permission-missing / mutating-REST sort ahead of gated entries', () => {
    const entries = [
      { entryKind: 'ajax', selector: 'gated', cap: true, nonce: true },
      { entryKind: 'ajax-nopriv', selector: 'open', nopriv: true, cap: false },
      { entryKind: 'rest', selector: '/w', methods: ['POST'], permMissing: true },
    ];
    const ordered = prioritize(entries).map((e) => e.selector);
    assert.equal(ordered[ordered.length - 1], 'gated');
  });

  test('valueFor types a sentinel by key shape', () => {
    assert.match(valueFor('redirect_url'), /127\.0\.0\.1/);
    assert.match(valueFor('email'), /@example\.invalid/);
    assert.equal(valueFor('post_id'), '1');
    assert.match(valueFor('option_name'), /^cwprobe_/);
  });

  test('paramBag merges plugin-scanned keys over the common set', () => {
    const bag = paramBag(['cw_reset']);
    assert.ok('v' in bag && 'key' in bag && 'cw_reset' in bag);
  });
});

describe('ambient control', () => {
  test('keys that move in an idle double-snapshot become the ignore set', () => {
    const a = { options: { stable: '1', churn: 'x' } };
    const b = { options: { stable: '1', churn: 'y' } };
    const ig = ambientIgnore(a, b);
    assert.ok(ig.options.has('churn'));
    assert.ok(!ig.options.has('stable'));
  });
});

describe('nuclei pass', () => {
  test('an absent nuclei is recorded as absent, labelled apart from the oracle', async () => {
    const r = await runNuclei('http://127.0.0.1:1', { CW_WP_NUCLEI_BIN: '/nonexistent/cw-no-nuclei' });
    assert.equal(r.state, 'absent');
    assert.match(r.label, /NOT the state-change oracle/);
  });
});

describe('live Playground witness', () => {
  test('end-to-end on the runnable fixture (CW_WP_LIVE=1 with network to measure)', async (t) => {
    if (process.env.CW_WP_LIVE !== '1') {
      t.skip('live Playground not measured here: set CW_WP_LIVE=1 on a networked host to run it');
      return;
    }
    const npx = spawnSync('npx', ['--version'], { encoding: 'utf8' });
    if (npx.status !== 0) { t.skip('npx not present: dynamic witness not measured'); return; }
    const r = await runWitness({ pluginDir: FIX, env: { ...process.env, CW_REPO_TRUSTED: '1' }, maxEntries: 20 });
    assert.equal(r.install.ok, true, 'fixture must boot and activate');
    const keys = new Set(r.findings.map((f) => `${f.entryKind}:${f.selector}:${f.role}`));
    assert.ok(keys.has('ajax-nopriv:cw_save:anonymous'), 'unauth ajax option write must confirm');
    assert.ok(keys.has('ajax:cw_nocap:subscriber'), 'nocap ajax must confirm for a subscriber');
    const safe = r.entries.find((e) => e.selector === 'cw_safe');
    assert.equal(safe.verdict, 'exercised-no-effect', 'the nonce+cap twin must not confirm');
  });
});
