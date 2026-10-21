// node --test bin/test/ — the consent store. The properties that decide whether this gate can be
// trusted: an absent store never stops a runner that worked yesterday, an unreadable one is never
// an empty one, a lane nobody has ruled on runs while a tool nobody has approved does not, and a
// blocked lane leaves a reported void rather than vanishing from the run.
import { test, describe, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  readScanConfig, writeScanConfig, checkEnabled, toolApproved, gateChecks, toolRoster, toolsOf,
  diffConfig, configPath, GATE,
} from '../lib/scan-config.mjs';
import { consentVoids } from '../commitwork.mjs';
import { GATE_ROSTER, readJournalFile } from '../lib/verdict-journal-core.mjs';

const dirs = [];
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const scratch = () => { const d = mkdtempSync(join(tmpdir(), 'cw-scancfg-')); dirs.push(d); return d; };

const CHECKS = [
  { id: 'secrets', requires: { tools: ['trufflehog'] } },
  { id: 'sast-codeql', requires: { tools: ['codeql'] } },
  { id: 'deps-osv', requires: { tools: ['osv-scanner', 'node'] } },
];

describe('reading the store', () => {
  test('an absent store leaves the gate OFF — a box nobody configured is not a box that refused', () => {
    const cfg = readScanConfig({ path: join(scratch(), 'none.json') });
    assert.equal(cfg.absent, true);
    const g = gateChecks(CHECKS, cfg);
    assert.equal(g.gated, false);
    assert.equal(g.runnable.length, 3, 'upgrading must not silently stop every lane on the box');
    assert.deepEqual(g.blocked, []);
  });

  test('an unreadable store THROWS — it is never an empty one', () => {
    const p = join(scratch(), 'bad.json');
    writeFileSync(p, '{ not json');
    assert.throws(() => readScanConfig({ path: p }), /unreadable/);
    const v = join(scratch(), 'v.json');
    writeFileSync(v, JSON.stringify({ version: 99, checks: {}, tools: {} }));
    assert.throws(() => readScanConfig({ path: v }), /version 99/);
  });

  test('a lane nobody has ruled on is enabled; a tool nobody has approved is not approved', () => {
    const p = join(scratch(), 'c.json');
    writeFileSync(p, JSON.stringify({ version: 1, checks: { secrets: { enabled: false } }, tools: { codeql: { approved: true } } }));
    const cfg = readScanConfig({ path: p });
    assert.equal(checkEnabled(cfg, 'secrets'), false);
    assert.equal(checkEnabled(cfg, 'a-lane-added-next-week'), true, 'a new lane is new, not refused');
    assert.equal(toolApproved(cfg, 'codeql'), true);
    assert.equal(toolApproved(cfg, 'trufflehog'), false, 'unasked is not consent');
  });
});

describe('the gate', () => {
  const cfgFrom = (doc) => { const p = join(scratch(), 'g.json'); writeFileSync(p, JSON.stringify({ version: 1, ...doc })); return readScanConfig({ path: p }); };

  test('disabled and unapproved are DIFFERENT blocks, and the missing tool is named', () => {
    const cfg = cfgFrom({ checks: { secrets: { enabled: false } }, tools: { codeql: { approved: true } } });
    const g = gateChecks(CHECKS, cfg);
    assert.equal(g.gated, true);
    assert.deepEqual(g.runnable.map((c) => c.id), ['sast-codeql']);
    const by = Object.fromEntries(g.blocked.map((b) => [b.id, b]));
    assert.equal(by.secrets.reason, 'disabled');
    assert.deepEqual(by.secrets.tools, []);
    assert.equal(by['deps-osv'].reason, 'unapproved-tool');
    assert.deepEqual(by['deps-osv'].tools, ['osv-scanner', 'node']);
  });

  test('a lane is held until EVERY tool it needs is approved, and only the missing ones are named', () => {
    const cfg = cfgFrom({ tools: { 'osv-scanner': { approved: true } } });
    const by = Object.fromEntries(gateChecks(CHECKS, cfg).blocked.map((b) => [b.id, b]));
    assert.equal(by['deps-osv'].reason, 'unapproved-tool');
    assert.deepEqual(by['deps-osv'].tools, ['node'], 'the approved one is not re-asked');
  });

  test('disabled wins over unapproved — the operator is told the reason they can act on', () => {
    const cfg = cfgFrom({ checks: { 'deps-osv': { enabled: false } } });
    const by = Object.fromEntries(gateChecks(CHECKS, cfg).blocked.map((b) => [b.id, b]));
    assert.equal(by['deps-osv'].reason, 'disabled');
  });

  test('approval is keyed on the TOOL, so one approval releases every lane that needs it', () => {
    const many = [
      { id: 'a', requires: { tools: ['semgrep'] } },
      { id: 'b', requires: { tools: ['semgrep'] } },
      { id: 'c', requires: { tools: ['semgrep'] } },
    ];
    assert.equal(toolRoster(many).length, 1, 'three lanes, one question');
    const g = gateChecks(many, cfgFrom({ tools: { semgrep: { approved: true } } }));
    assert.equal(g.runnable.length, 3);
  });

  test('duplicate tool declarations collapse — a lane naming a tool twice asks once', () => {
    assert.deepEqual(toolsOf({ requires: { tools: ['go', 'go'] } }), ['go']);
    assert.deepEqual(toolsOf({}), []);
  });
});

describe('a blocked lane leaves a void, never a silence', () => {
  test('both reasons render as noscan with coverage unknown, and say which it was', () => {
    const voids = consentVoids([
      { id: 'secrets', reason: 'disabled', tools: [] },
      { id: 'deps-osv', reason: 'unapproved-tool', tools: ['osv-scanner'] },
    ]);
    assert.equal(voids.length, 2);
    assert.ok(voids.every((v) => v.status === 'noscan' && v.coverage === 'unknown'));
    assert.equal(voids[0].coverageBasis, 'disabled');
    assert.equal(voids[1].coverageBasis, 'unapproved-tool');
    assert.match(voids[1].reason, /osv-scanner/);
    assert.match(voids[1].reason, /not the same as finding nothing/);
  });
});

describe('writing is a journalled act', () => {
  test('the store round-trips, and the journal carries the DELTA rather than the snapshot', () => {
    const dir = scratch();
    const path = join(dir, 'scan-config.json');
    const first = writeScanConfig({ checks: {}, tools: { codeql: { approved: true } } }, { path, dir, actor: 'portll', reason: 'approved on /config' });
    assert.equal(first.wasAbsent, true);
    assert.deepEqual(first.toolsChanged, [{ tool: 'codeql', from: false, to: true }]);

    const back = readScanConfig({ path });
    assert.equal(toolApproved(back, 'codeql'), true);
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).version, 1);

    const second = writeScanConfig({ checks: { secrets: { enabled: false } }, tools: { codeql: { approved: true } } }, { path, dir, actor: 'portll' });
    assert.equal(second.wasAbsent, false);
    assert.deepEqual(second.checksChanged, [{ id: 'secrets', from: true, to: false }]);
    assert.deepEqual(second.toolsChanged, [], 'an unchanged approval is not a new decision');

    const j = readJournalFile(join(dir, `${GATE}.jsonl`));
    assert.equal(j.records.length, 2);
    assert.equal(j.records[0].gate, GATE);
    assert.equal(j.records[0].actor, 'portll');
    assert.equal(j.records[1].checksChanged[0].id, 'secrets');
  });

  test('an unattributed write records null — honest, never invented', () => {
    const dir = scratch();
    const r = writeScanConfig({ tools: { ruff: { approved: true } } }, { path: join(dir, 'c.json'), dir });
    assert.equal(r.toolsChanged.length, 1);
    assert.equal(readJournalFile(join(dir, `${GATE}.jsonl`)).records[0].actor, null);
  });

  test('withdrawing an approval is a recorded transition, not a deletion', () => {
    const dir = scratch();
    const path = join(dir, 'c.json');
    writeScanConfig({ tools: { nuclei: { approved: true } } }, { path, dir });
    const off = writeScanConfig({ tools: { nuclei: { approved: false } } }, { path, dir });
    assert.deepEqual(off.toolsChanged, [{ tool: 'nuclei', from: true, to: false }]);
    assert.equal(toolApproved(readScanConfig({ path }), 'nuclei'), false);
  });

  test('diffConfig reports only real transitions', () => {
    const a = { absent: false, checks: { x: { enabled: false } }, tools: {} };
    assert.deepEqual(diffConfig(a, a).checksChanged, []);
  });
});

describe('the gate is on the roster', () => {
  test('scan-config is declared, so an unwritten ledger renders ABSENT rather than missing', () => {
    const row = GATE_ROSTER.find((g) => g.gate === GATE);
    assert.ok(row, 'a journal nobody has written and a gate nobody wired must not render the same');
    assert.equal(row.baseline, null, 'consent has no floor to fall below');
  });

  test('the store path is env-overridable and read at CALL time', () => {
    const saved = process.env.CW_SCAN_CONFIG;
    try {
      process.env.CW_SCAN_CONFIG = '/tmp/cw-scan-config-probe.json';
      assert.equal(configPath(), '/tmp/cw-scan-config-probe.json');
    } finally {
      if (saved === undefined) delete process.env.CW_SCAN_CONFIG; else process.env.CW_SCAN_CONFIG = saved;
    }
    assert.notEqual(configPath(), '/tmp/cw-scan-config-probe.json');
  });
});
