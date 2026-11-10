// Whether a package id was ever ASKED OF ITS MANAGER, and what that costs when nobody asked.
//
// The catalogue's winget and scoop ids came out of each project's install documentation. Two of
// them named no package at all — `TruffleSecurity.TruffleHog` and `GitHub.CodeQL` — and the
// catalogue offered both as the way to get the tool on Windows, so `commitwork setup` ran an
// install that could not succeed and the operator had no way to tell that id from a working one.
// The catalogue's own note had the answer and could not be read by anything: it named two ids as
// verified in prose, which left every other id in the same sentence's silence.
//
// Three states, and the third is the point: `resolves` and `unresolved` are measurements and the
// ABSENCE of a record is neither. A measured `unresolved` is withheld from every install path. An
// unprobed one is still offered — withholding all of them would leave Windows with no installer
// for most of the catalogue — and every surface that offers it SAYS it is unprobed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { idState, unverifiedManagers, absenceKind, KNOWN_MANAGERS } from '../setup.mjs';

const CW = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CATALOG = JSON.parse(readFileSync(join(CW, 'manifests', 'install-catalog.json'), 'utf8'));
const BY_MANAGER = CATALOG.idChecksByManager;
const STATES = new Set(['resolves', 'unresolved']);
// bin/setup.mjs managerOrder() on Windows. Duplicated deliberately: `WIN` there is fixed at module
// load, so the win32 order cannot be driven from this host, and the degrade below is what the
// defect was about.
const WIN_ORDER = ['release', 'winget', 'scoop', 'pipx', 'npm', 'cargo', 'gem', 'composer', 'go'];

// The record's own shape, applied to both grains. A state with no account of how it was reached is
// the defect this field exists for: a claim of verification carrying none.
function assertRecord(where, rec, allowed) {
  assert.ok(allowed.has(rec.state), `${where}.state must be one of ${[...allowed].join('/')}`);
  // `checkedAt: null` is a DECLARED unknown date and passes; the key missing altogether does not.
  assert.ok('checkedAt' in rec, `${where} must carry checkedAt (null where the date was never recorded)`);
  assert.ok(rec.checkedAt === null || /^\d{4}-\d{2}-\d{2}$/.test(rec.checkedAt), `${where}.checkedAt must be a date or null`);
  assert.ok(typeof rec.how === 'string' && rec.how.length > 20, `${where}.how must say what was run or who reported it`);
}

test('every idChecks entry carries the evidence its state claims', () => {
  let records = 0;
  for (const [name, spec] of Object.entries(CATALOG.tools)) {
    const checks = spec.idChecks;
    if (checks === undefined) continue;
    assert.equal(typeof checks, 'object', `${name}.idChecks must be a {manager: record} map`);
    for (const [manager, rec] of Object.entries(checks)) {
      records++;
      assert.ok(KNOWN_MANAGERS.includes(manager), `${name}.idChecks.${manager} names no manager setup.mjs drives`);
      assert.ok(spec[manager], `${name}.idChecks.${manager} records a probe of an id ${name} does not declare`);
      // Only the two measurements here: 'unprobed' is said by having no entry, and spelling it as
      // a per-id state would give the same fact two spellings nothing keeps in step.
      assertRecord(`${name}.idChecks.${manager}`, rec, STATES);
    }
  }
  assert.ok(records >= 4, `only ${records} id checks found — the catalogue has recorded probes and this is not reading them`);
});

test('every manager setup.mjs drives declares, at class grain, whether its ids were ever probed', () => {
  assert.ok(BY_MANAGER, 'idChecksByManager is what keeps a whole manager\'s ids from defaulting into a claim nobody made');
  for (const m of KNOWN_MANAGERS) {
    assert.ok(BY_MANAGER[m], `${m} has no class record, so every ${m} id reads unprobed by omission rather than by a decision`);
    assertRecord(`idChecksByManager.${m}`, BY_MANAGER[m], new Set([...STATES, 'unprobed']));
  }
  assert.deepEqual(Object.keys(BY_MANAGER).filter((m) => !KNOWN_MANAGERS.includes(m)), [],
    'a class record for a manager setup.mjs cannot drive is dead data');
  // The grain that matters: brew's ids were measured as a class and winget's were not, and before
  // this field both read the same way.
  assert.equal(BY_MANAGER.brew.state, 'resolves');
  assert.equal(BY_MANAGER.winget.state, 'unprobed');
});

test('the two ids an operator found to name no package are recorded as unresolved, with the id kept', () => {
  for (const [tool, id] of [['trufflehog', 'TruffleSecurity.TruffleHog'], ['codeql', 'GitHub.CodeQL']]) {
    const spec = CATALOG.tools[tool];
    assert.equal(idState(spec, 'winget', BY_MANAGER), 'unresolved', `${tool}'s winget id resolved to no package and must say so`);
    // The id STAYS. Deleting it would erase the original claim and leave the next session free to
    // copy it back out of the same docs; the record is what stops that.
    assert.equal(spec.winget, id, `${tool}'s winget id must be preserved beside its verdict, not erased`);
  }
});

test('on Windows the withheld id degrades to the next manager, and codeql does not start with winget', () => {
  const offerable = (spec) => WIN_ORDER.filter((m) => spec[m] && idState(spec, m, BY_MANAGER) !== 'unresolved');
  // The defect, from the operator's side: `winget install --id GitHub.CodeQL` was the first thing
  // `commitwork setup` ran on Windows, and it could not succeed.
  assert.equal(WIN_ORDER.find((m) => CATALOG.tools.codeql[m]), 'winget', 'codeql still declares the id; the fix is that it is not offered');
  assert.equal(offerable(CATALOG.tools.codeql)[0], 'scoop', 'the withheld winget id must fall through to the next manager, never block the tool');
  // trufflehog's release pin already outranked winget, so its bad id never ran — the record is
  // what makes that an established fact rather than an ordering accident.
  assert.equal(offerable(CATALOG.tools.trufflehog)[0], 'release');
  for (const tool of ['codeql', 'trufflehog']) {
    assert.ok(!offerable(CATALOG.tools[tool]).includes('winget'), `${tool} must not offer an id measured not to resolve`);
  }
});

test('an unprobed id is unprobed, not verified — and that is most of the catalogue', () => {
  assert.equal(idState(CATALOG.tools.gitleaks, 'winget', BY_MANAGER), 'unprobed', 'Gitleaks.Gitleaks came from the docs and nobody has queried winget for it');
  assert.equal(idState(CATALOG.tools.gitleaks, 'brew', BY_MANAGER), 'resolves', 'brew ids carry a class measurement');
  assert.ok(unverifiedManagers(CATALOG.tools.gitleaks, BY_MANAGER).includes('winget'));
  // The scale is the argument for labelling rather than withholding: refusing every unprobed id
  // would take most of the Windows install surface with it.
  const unprobed = Object.values(CATALOG.tools).reduce((n, s) => n + unverifiedManagers(s, BY_MANAGER).length, 0);
  assert.ok(unprobed > 20, `only ${unprobed} unprobed ids — if this has fallen to a handful, withhold them instead of labelling them`);
  assert.deepEqual(unverifiedManagers({ winget: 'x', idChecks: { winget: { state: 'resolves', checkedAt: null, how: 'probed on the box' } } }), [],
    'a probed id is not unprobed');
  assert.deepEqual(unverifiedManagers({ winget: 'x', idChecks: { winget: { state: 'unresolved', checkedAt: null, how: 'probed; no such package' } } }), [],
    'a measured failure is not an unknown either — it is withheld, which is a different row');
  assert.deepEqual(unverifiedManagers({ winget: 'x' }), ['winget'],
    'with no record at either grain an id is unprobed, which is the state that must never read as verified');
});

test('an unresolved id is no installer: the absence names OUR gap, not a manager to install', () => {
  const bad = { winget: 'Nobody.Nothing', url: 'https://example.invalid',
    idChecks: { winget: { state: 'unresolved', checkedAt: null, how: 'probed on a Windows box; no such package' } } };
  assert.equal(absenceKind(bad), 'catalog-gap',
    'needs-manager tells the operator to install winget, and installing winget would not help');
  // The control, asserted separately: the same entry WITHOUT the verdict still reads as an
  // installer, so the line above is the record doing the work and not absenceKind refusing winget.
  assert.equal(absenceKind({ winget: 'Nobody.Nothing', url: 'https://example.invalid' }), 'needs-manager');
  assert.equal(absenceKind({ winget: 'Real.Package', url: 'https://example.invalid',
    idChecks: { winget: { state: 'resolves', checkedAt: null, how: 'winget search returned it' } } }), 'needs-manager');
});
