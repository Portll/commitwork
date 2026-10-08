// The install catalogue's two honesty properties: (1) a tool that needs an external account
// DECLARES it — no local probe can detect a vendor-side gap; (2) account-gated tools sort LAST.
// Catalogue key order IS the printed order (toolPlan maps Object.entries).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolPlan, loadCatalog, stepLines, strandedSummary } from '../setup.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CATALOG = JSON.parse(readFileSync(join(CW, 'manifests', 'install-catalog.json'), 'utf8'));

test('socket declares that installing it is NOT enough — vendor, org, token and role are all named', () => {
  const ra = CATALOG.tools.socket.requiresAccount;
  assert.ok(ra, 'socket must declare requiresAccount — a silent ✓ is the failure this guards');
  assert.match(ra.vendor, /Socket/);
  const needs = (ra.needs || []).join(' ').toLowerCase();
  for (const term of ['account', 'organization', 'token', 'role']) {
    assert.match(needs, new RegExp(term), `requiresAccount.needs must name the ${term} requirement`);
  }
});

test('every account-gated tool sorts LAST in the catalogue', () => {
  const names = Object.keys(CATALOG.tools);
  const gated = names.filter((n) => CATALOG.tools[n].requiresAccount);
  assert.ok(gated.length, 'this test is vacuous if nothing is account-gated');
  const firstGated = Math.min(...gated.map((n) => names.indexOf(n)));
  const ungatedAfter = names.slice(firstGated).filter((n) => !CATALOG.tools[n].requiresAccount);
  assert.deepEqual(ungatedAfter, [], `account-gated tools must be last; found ${ungatedAfter.join(', ')} after them`);
});

test('toolPlan carries requiresAccount through, and leaves it null for ordinary tools', () => {
  const plan = toolPlan();
  const socket = plan.find((r) => r.name === 'socket');
  assert.ok(socket, 'socket must appear in the plan');
  assert.ok(socket.requiresAccount, 'the declaration must survive into the row setup.mjs renders');
  // presence and usability are independent — the assertion is about the fields, not this machine
  const gitleaks = plan.find((r) => r.name === 'gitleaks');
  assert.equal(gitleaks.requiresAccount, null, 'a tool that works on install alone declares nothing');
});

test('guarddog and safe-chain are catalogued, and neither is account-gated', () => {
  // the free/OSS answer to the lane socket never covered; growing an account requirement fails here
  const cat = loadCatalog();
  for (const name of ['guarddog', 'safe-chain']) {
    assert.ok(cat.tools[name], `${name} must be in the install catalogue`);
    assert.equal(cat.tools[name].requiresAccount, undefined, `${name} is tokenless — do not gate it`);
    assert.ok(cat.tools[name].url, `${name} needs a url fallback`);
  }
});

test('every account declaration names its vendor, and every manual tool says how to get it', () => {
  for (const [name, spec] of Object.entries(CATALOG.tools)) {
    if (spec.requiresAccount !== undefined) {
      assert.equal(typeof spec.requiresAccount?.vendor, 'string', `${name}: setup prints "needs a <vendor> account", so a bare true printed "undefined"`);
    }
    if (spec.manual) assert.ok(spec.url || stepLines(spec.steps).length, `${name}: a manual tool with neither url nor steps printed "manual: undefined"`);
  }
});

test('steps render from both catalogue shapes', () => {
  assert.deepEqual(stepLines(['a', 'b']), ['a', 'b']);
  assert.deepEqual(stepLines({ one: 'x', two: 'y' }), ['one: x', 'two: y']);
  assert.deepEqual(stepLines(null), []);
});

test('the stranded summary names the managers that would unblock the most missing tools', () => {
  const row = (couldUse, extra = {}) => ({ present: false, absence: 'needs-manager', couldUse, ...extra });
  const rows = [row(['brew', 'pipx']), row(['brew']), row(['pipx', 'npm']), row(['winget']),
    row(['brew'], { present: true }), { present: false, absence: 'manual', couldUse: null }];
  assert.equal(strandedSummary(rows, ['brew', 'pipx', 'npm']),
    '4 missing tool(s) need a package manager this machine lacks — brew would install 2, pipx would install 2, npm would install 1');
  assert.equal(strandedSummary([row(['brew'], { present: true })]), null);
});
