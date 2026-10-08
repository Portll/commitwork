#!/usr/bin/env node
// monitor/lane-trust.mjs — how far to trust each lane, three columns per SCANNER_SPECS category.
//
//   fixture       where the lane's golden fixture came from (lane-capability PROVENANCE.json):
//                 real · synthetic (with the recorded reason) · unrecorded · no-fixture
//   canary        the scan canary's last record for the lane's tool, in both directions: false-clean
//                 over the canary runs the lane called clean, false-alarm over the runs it alarmed on
//                 (the stratum convention of monitor/sweep-verdict.mjs). Only an explicit
//                 both-directions verdict with both runs recorded is scored; any other verdict is
//                 `unscored` with the verdict kept. No record is `not-measured`, never 0 of 0.
//   undetermined  the share of the lane's published findings carried in `undetermined` rather than
//                 crit/high/med/low, summed over every declared area's rollup.json. No rollup, or a
//                 lane with no findings, is `not-measured`.
//
// A missing input makes its column `not-measured`, never a number. A store that exists and cannot be
// read throws: only ENOENT is absence.
//
// usage: node monitor/lane-trust.mjs [--json] [--table]
// writes: <reportsRoot>/lane-trust.json (atomic) unless --json. It reads the live fleet's rollups, so
// the output is an operational record and never belongs in the tree. CW_NOW pins `generated`;
// CW_LANE_FIXTURES, CW_CANARY_DIR, CW_REGISTRY and CW_LANE_TRUST_OUT are read at call time.

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { SCANNER_SPECS } from './extractors.mjs';
import { canaryEvidence } from './lane-capability.mjs';
import { loadRegistry, registryPath, isExampleRegistry } from './registry.mjs';
import { reportsRootDir } from './area.mjs';
import { writeAtomic } from './lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '..');

const fixtureRoot = () => process.env.CW_LANE_FIXTURES || join(HERE, 'test', 'fixtures', 'lane-capability');
const canaryRoot = () => process.env.CW_CANARY_DIR || join(CW, 'fixtures', 'scan-canary');

const GRADED = ['crit', 'high', 'med', 'low'];
const SOURCES = ['real', 'synthetic'];

const notMeasured = (why) => ({ state: 'not-measured', why });
const rate = (n, of) => ({ state: 'measured', n, of, rate: n / of });

/** PROVENANCE.json lanes, or null when the file is absent. Unreadable throws. */
export function readProvenance(fixtures = fixtureRoot()) {
  try { return JSON.parse(readFileSync(join(fixtures, 'PROVENANCE.json'), 'utf8')).lanes || {}; } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    throw e;
  }
}

function hasFixture(fixtures, category) {
  try { return readdirSync(join(fixtures, category)).some((n) => !n.startsWith('.')); } catch (e) {
    if (e && e.code === 'ENOENT') return false;
    throw e;
  }
}

/** Fixture-source column for one lane. */
export function fixtureColumn(category, provenance, present) {
  if (!present) return { source: 'no-fixture' };
  const p = provenance ? provenance[category] : null;
  if (!p) return { source: 'unrecorded', why: provenance ? 'fixture predates provenance records' : 'PROVENANCE.json is absent' };
  if (!SOURCES.includes(p.source)) return { source: 'unrecorded', recorded: p.source ?? null, why: 'provenance names no recognised source' };
  const out = { source: p.source, ...(p.accepted ? { accepted: p.accepted } : {}) };
  if (p.source === 'synthetic') out.reason = p.why || null;
  return out;
}

/** Canary column for one lane, from canaryEvidence().byCategory[category]. */
export function canaryColumn(evidence, canaryRead) {
  if (!canaryRead) return notMeasured('no scan-canary record');
  if (!evidence || !evidence.length) return notMeasured('the scan canary records no run of this lane\'s tool');
  const lanes = evidence.map((e) => e.lane);
  const date = evidence.map((e) => e.date).filter(Boolean).sort().pop() || null;
  const scored = evidence.filter((e) => e.credits);
  if (scored.length !== evidence.length) {
    return { state: 'unscored', lanes, date,
      verdicts: evidence.map((e) => ({ lane: e.lane, verdict: e.verdict })),
      why: 'a canary record exists without a both-directions verdict and both runs recorded' };
  }
  // A both-directions record is one clean-tree run called clean and one dirty-tree run called alarm.
  const k = scored.length;
  return { state: 'measured', lanes, date, falseClean: rate(0, k), falseAlarm: rate(0, k) };
}

/** Every declared area's rollup.json, read through the registry. Absent rollups are counted, not
 *  guessed at; an unreadable one throws. */
export function readRollups(reg, { example = false } = {}) {
  if (example) return { state: 'not-measured', why: 'the registry is the shipped example; there are no fleet findings to read', rollups: [], areas: { declared: 0, read: 0, absent: 0 } };
  const root = reportsRootDir(reg);
  const rollups = [];
  let absent = 0;
  const areas = reg.areas || [];
  for (const area of areas) {
    const p = join(root, area.out || area.slug, 'rollup.json');
    let raw;
    try { raw = readFileSync(p, 'utf8'); } catch (e) {
      if (e && e.code === 'ENOENT') { absent += 1; continue; }
      throw e;
    }
    rollups.push(JSON.parse(raw));
  }
  return { state: rollups.length ? 'read' : 'not-measured', ...(rollups.length ? {} : { why: 'no declared area has a rollup.json' }),
    rollups, areas: { declared: areas.length, read: rollups.length, absent } };
}

/** Undetermined-share column for one lane over the read rollups. */
export function undeterminedColumn(category, fleet) {
  if (fleet.state !== 'read') return notMeasured(fleet.why);
  let undetermined = 0; let graded = 0; let areas = 0;
  for (const r of fleet.rollups) {
    const c = r && r.scanners ? r.scanners[category] : undefined;
    if (!c) continue;
    for (const k of [...GRADED, 'undetermined']) {
      const v = c[k];
      if (v !== undefined && !(Number.isFinite(v) && v >= 0)) {
        return { state: 'unreadable', why: `a rollup carries a non-count ${k} for this lane` };
      }
    }
    areas += 1;
    undetermined += c.undetermined || 0;
    graded += GRADED.reduce((n, k) => n + (c[k] || 0), 0);
  }
  if (!areas) return notMeasured('no rollup carries this lane');
  const of = graded + undetermined;
  if (!of) return { ...notMeasured('the lane published no findings, so no share exists'), areas };
  return { state: 'measured', undetermined, graded, of, share: undetermined / of, areas };
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** The join. Pure given its inputs. */
export function laneTrust({ specs = SCANNER_SPECS, fixtures = fixtureRoot(), canary, fleet }) {
  const provenance = readProvenance(fixtures);
  const lanes = {};
  for (const [category, check] of [...specs].sort(([a], [b]) => (a < b ? -1 : 1))) {
    lanes[category] = {
      check,
      fixture: fixtureColumn(category, provenance, hasFixture(fixtures, category)),
      canary: canaryColumn(canary.byCategory[category], canary.read),
      undetermined: undeterminedColumn(category, fleet),
    };
  }
  const rows = Object.values(lanes);
  const count = (pick) => rows.reduce((o, r) => { const k = pick(r); o[k] = (o[k] || 0) + 1; return o; }, {});
  const shares = rows.filter((r) => r.undetermined.state === 'measured').map((r) => r.undetermined.share);
  const sorted = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));
  return {
    summary: {
      lanes: rows.length,
      fixtureSource: sorted(count((r) => r.fixture.source)),
      canary: sorted(count((r) => r.canary.state)),
      undetermined: {
        ...sorted(count((r) => r.undetermined.state)),
        medianShare: median(shares),
        lanesWithAnyUndetermined: shares.filter((s) => s > 0).length,
      },
    },
    inputs: {
      provenance: provenance ? 'read' : 'absent',
      canary: { read: canary.read, date: canary.date ?? null },
      fleet: { state: fleet.state, areas: fleet.areas },
    },
    lanes,
  };
}

/** Read every input at call time and join. */
export function gatherLaneTrust() {
  const path = registryPath();
  const example = isExampleRegistry(path);
  const reg = loadRegistry({ path, quiet: true });
  return { reg, result: laneTrust({ canary: canaryEvidence(canaryRoot()), fleet: readRollups(reg, { example }) }) };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
function cell(c, kind) {
  if (kind === 'fixture') return c.source === 'synthetic' ? `synthetic (${c.reason || 'no reason recorded'})` : c.source;
  if (kind === 'canary') {
    return c.state === 'measured'
      ? `fc ${c.falseClean.n}/${c.falseClean.of} · fa ${c.falseAlarm.n}/${c.falseAlarm.of} (${c.date || 'undated'})`
      : c.state === 'unscored' ? 'unscored' : 'not measured';
  }
  return c.state === 'measured' ? `${pct(c.share)} (${c.undetermined}/${c.of})` : c.state === 'unreadable' ? 'unreadable' : 'not measured';
}

function main() {
  const { reg, result } = gatherLaneTrust();
  const out = { generated: process.env.CW_NOW || new Date().toISOString(), ...result };
  if (process.argv.includes('--json')) { console.log(JSON.stringify(out, null, 1)); return; }
  const dest = process.env.CW_LANE_TRUST_OUT || join(reportsRootDir(reg), 'lane-trust.json');
  writeAtomic(dest, JSON.stringify(out, null, 1) + '\n');
  const s = out.summary;
  const list = (o) => Object.entries(o).filter(([k]) => typeof o[k] === 'number' && k !== 'medianShare' && k !== 'lanesWithAnyUndetermined').map(([k, v]) => `${v} ${k}`).join(', ');
  console.log(`lane-trust: ${s.lanes} lanes · fixture ${list(s.fixtureSource)}`);
  console.log(`lane-trust: canary ${list(s.canary)}`);
  console.log(`lane-trust: undetermined share ${list(s.undetermined)} · median ${s.undetermined.medianShare === null ? 'not measured' : pct(s.undetermined.medianShare)} · ${s.undetermined.lanesWithAnyUndetermined} lane(s) above zero`);
  if (process.argv.includes('--table')) {
    for (const [cat, r] of Object.entries(out.lanes)) {
      console.log(`  ${cat.padEnd(24)} ${cell(r.fixture, 'fixture').padEnd(28)} ${cell(r.canary, 'canary').padEnd(34)} ${cell(r.undetermined, 'undetermined')}`);
    }
  }
  console.log(`-> ${dest}`);
}

if (isMainModule(import.meta.url)) main();
