// Per-category scan scope answers from the gitleaks config and baseline manifest (monitor/scan-scope.mjs scanScopes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanScopes } from '../scan-scope.mjs';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const D = '\u2014';
const TOML = '[[allowlists]]\ndescription = "d"\npaths = ["p"]\n';
const BLK = [{ description: 'd', paths: ['p'], targetRules: null }];
const TAIL = '. Update scopeNotes in the manifest if the command change was intended. The path exclusions below are still derived from the command and remain accurate; the non-path bounds are what cannot be stated.';
const head = (id) => `${id}: the command no longer matches its declared scopeNotes ${D} `;
const pre = (r) => ({ ...r, notes: r.notes.map((n) => n.slice(0, 24)) });

function inDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'scanScopes-'));
  try { fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
function setup(dir, baseline, toml) {
  const b = join(dir, 'baseline.json');
  const g = join(dir, 'gitleaks.toml');
  if (baseline !== undefined) writeFileSync(b, typeof baseline === 'string' ? baseline : JSON.stringify(baseline));
  if (toml !== undefined) writeFileSync(g, toml);
  process.env.CW_BASELINE_MANIFEST = b;
  process.env.CW_GITLEAKS_CONFIG = g;
  return { b, g };
}

test('parses allowlist blocks, sorts rule-scoped ones last and reads the size bound off the gitleaks check', () => inDir((dir) => {
  const toml = ['[[allowlists]]', 'description = "scoped"', 'targetRules = ["r1"]', 'paths = ["a"]',
    '[[allowlists]]', 'description = "global"', 'paths = [', '  "b",', '  "c"', ']', 'other = "x"', 'no equals',
    '[extend]', 'paths = ["z"]', '[[allowlists]]', 'paths = ["d"]', 'targetRules = []'].join('\n');
  const { b, g } = setup(dir, { checks: [{ id: 'secrets-gitleaks', local: ['gitleaks', '--max-target-megabytes=5'] }] }, toml);
  const result = scanScopes();
  assert.deepEqual(result.secrets, { known: true, source: g, maxTargetMB: 5, blocks: [
    { description: 'global', paths: ['b', 'c'], targetRules: null },
    { description: '', paths: ['d'], targetRules: null },
    { description: 'scoped', paths: ['a'], targetRules: ['r1'] }] });
  assert.deepEqual(result.accessibility, { known: false, reason: 'undeclared', source: b, detail: "no check 'a11y-wcag' in the manifest" });
}));

test('marks the size bound unknown and every command scope absent when the baseline manifest is missing', () => inDir((dir) => {
  const { b, g } = setup(dir, undefined, TOML);
  const result = scanScopes();
  assert.deepEqual(result.secrets, { known: true, source: g, maxTargetMB: null, maxTargetUnknown: 'absent', blocks: BLK });
  assert.deepEqual(result.accessibility, { known: false, reason: 'absent', source: b, detail: 'ENOENT' });
  assert.deepEqual(result.actionsGaps, { known: false, reason: 'absent', source: b, detail: 'ENOENT' });
}));

test('marks the size bound and command scopes unreadable when the baseline path is a directory', () => inDir((dir) => {
  const { b, g } = setup(dir, undefined, TOML);
  mkdirSync(b);
  const result = scanScopes();
  assert.deepEqual(result.secrets, { known: true, source: g, maxTargetMB: null, maxTargetUnknown: 'unreadable', blocks: BLK });
  assert.deepEqual(result.accessibility, { known: false, reason: 'unreadable', source: b, detail: 'EISDIR' });
}));

test('marks the size bound and command scopes unparsed when the baseline is not valid JSON', () => inDir((dir) => {
  const { b, g } = setup(dir, '{ not json', TOML);
  const result = scanScopes();
  assert.deepEqual(result.secrets, { known: true, source: g, maxTargetMB: null, maxTargetUnknown: 'unparsed', blocks: BLK });
  assert.deepEqual(result.accessibility, { known: false, reason: 'unparsed', source: b, detail: 'bad json' });
}));

test('derives de-duplicated excludes, skip dirs, size bound and signed-off notes from check commands', () => inDir((dir) => {
  const { b, g } = setup(dir, { checks: [
    { id: 'a11y-wcag', local: ['tool --exclude vendor', "--exclude='dist' --exclude vendor", '--skip-dirs a,,b --skip-dirs="c"', '--max-target-megabytes 7'] },
    { id: 'actions-gaps', local: 'not an array --exclude x' },
    { id: 'actions-health', local: ['codeql --language=python --build-mode=none'], scopeNotes: ['build-mode-none', 'language', 'MINUS x - y'] },
    { id: 'actions-actionlint', local: ['docker run img', 'scan $CW_TARGET_URL'] },
  ] }, TOML);
  const result = scanScopes();
  assert.deepEqual(result.secrets, { known: true, source: g, maxTargetMB: null, maxTargetUnknown: 'undeclared', blocks: BLK });
  assert.deepEqual(result.accessibility, { known: true, source: b, maxTargetMB: 7, notes: [], blocks: [
    { description: 'paths excluded by --exclude in the a11y-wcag command', paths: ['vendor', 'dist'], targetRules: null },
    { description: 'directories skipped by --skip-dirs in the a11y-wcag command', paths: ['a', 'b', 'c'], targetRules: null }] });
  assert.deepEqual(result.actionsGaps, { known: true, source: b, blocks: [], notes: [] });
  assert.deepEqual(result.actionsHealth, { known: true, source: b, blocks: [], notes: [
    `analyses python only ${D} other languages in the repo are not scanned by this check`,
    `build-mode none ${D} source-only analysis; nothing that only exists after a build is reached`] });
  assert.deepEqual(result.actionsLint, { known: true, source: b, blocks: [], notes: [
    `runs inside docker ${D} on a box without docker the check is skipped, not scanned`,
    `runs against the declared live target URL only ${D} a repo with no declared target is skipped, not scanned`] });
}));

test('reports scope drift with derived blocks when notes and declared scopeNotes disagree in either direction', () => inDir((dir) => {
  const { b, g } = setup(dir, { checks: [
    { id: 'secrets-gitleaks', local: ['gitleaks detect'] },
    { id: 'a11y-wcag', scopeNotes: [], local: ['x', '--build-mode autobuild', 'docker run i', '$CW_TARGET_URL', '-ept dns', '--config auto', '--pro-intrafile',
      'semgrep-oss.sarif', 'zizmor .github/', 'xcodebuild clean', '--metrics=on', 'package-lock.json', '--max-target-megabytes=3'] },
    { id: 'actions-gaps', scopeNotes: ['language', 'gone'], local: ['semgrep --language javascript --build-mode=none', '--config p/a --config=p/b',
      '${CW_SEMGREP_PRO:+--pro-intrafile}', 'zizmor --metrics off package.json --exclude=v'] },
    { id: 'actions-health', scopeNotes: ['clean-build-traced', 'engine-pro-interfile', 'extra'], local: ['semgrep --pro', 'codeql-swift-build.sh'] },
  ] }, TOML);
  const result = scanScopes();
  assert.deepEqual(result.secrets, { known: true, source: g, maxTargetMB: null, blocks: BLK });
  assert.deepEqual(result.accessibility, { known: false, reason: 'scope-drift', source: b, blocks: [], maxTargetMB: 3,
    detail: head('a11y-wcag') + 'derived but not declared: build-mode-autobuild, docker, target-url, probe-host-excluded, ruleset-auto, '
      + 'engine-pro-intrafile, pro-delta-control, workflows-dir-and-root-action, clean-build-traced, metrics, package-lock' + TAIL });
  assert.deepEqual(result.actionsGaps, { known: false, reason: 'scope-drift', source: b,
    blocks: [{ description: 'paths excluded by --exclude in the actions-gaps command', paths: ['v'], targetRules: null }],
    detail: head('actions-gaps') + 'declared but not derived: gone; derived but not declared: build-mode-none, ruleset-pinned, engine-per-repo, metrics, package-json' + TAIL });
  assert.deepEqual(result.actionsHealth, { known: false, reason: 'scope-drift', source: b, blocks: [], detail: head('actions-health') + 'declared but not derived: extra' + TAIL });
}));

test('follows codeql filter files and fails closed when one is missing, unreadable or has no exclude rules', () => inDir((dir) => {
  const f = (n) => join(dir, `${n}-codeql-filters.txt`);
  writeFileSync(f('js'), '# c\n\n  exclude:node_modules  \ninclude:src\nexclude:dist\n');
  writeFileSync(f('py'), 'include:x\n');
  mkdirSync(f('dir'));
  writeFileSync(f('nl'), 'exclude:a\n');
  const missing = join(dir, 'missing', 'codeql-filters.txt');
  const { b, g } = setup(dir, { checks: [
    { id: 'a11y-wcag', local: ['codeql --language=javascript-typescript', f('js')] },
    { id: 'actions-gaps', local: ['codeql', missing] },
    { id: 'actions-health', local: ['codeql --language=python', f('py')] },
    { id: 'actions-actionlint', local: ['codeql', f('dir')] },
    { id: 'actions-zizmor', local: ['codeql', f('nl')] },
    { id: 'agent-config', local: ['codeql --language=python', f('nl')] },
  ] });
  const result = scanScopes();
  assert.deepEqual(result.secrets, { known: false, reason: 'absent', source: g, detail: 'ENOENT' });
  assert.deepEqual(pre(result.accessibility), { known: true, source: b, notes: ['analyses javascript-type', 'the CodeQL extractor add'],
    blocks: [{ description: `paths CodeQL was not allowed to index, from ${f('js')} (LGTM_INDEX_FILTERS)`, paths: ['node_modules', 'dist'], targetRules: null }] });
  assert.deepEqual(result.actionsGaps, { known: false, reason: 'absent', source: missing, detail: 'ENOENT' });
  assert.deepEqual(result.actionsHealth, { known: false, reason: 'unparsed', source: f('py'), detail: 'no exclude rules were recognised in the filter file' });
  assert.deepEqual(result.actionsLint, { known: false, reason: 'unreadable', source: f('dir'), detail: 'EISDIR' });
  const nl = [{ description: `paths CodeQL was not allowed to index, from ${f('nl')} (LGTM_INDEX_FILTERS)`, paths: ['a'], targetRules: null }];
  assert.deepEqual(pre(result.actionsPosture), { known: true, source: b, blocks: nl, notes: ['the CodeQL extractor app'] });
  assert.deepEqual(pre(result.agentConfig), { known: true, source: b, blocks: nl, notes: [`analyses python only ${D} o`, 'the python extractor app'] });
}));

test('reports a gitleaks path under a file as unreadable and states probe-host, pack, ruleset and metrics bounds', () => inDir((dir) => {
  writeFileSync(join(dir, 'plain'), 'x');
  const { b } = setup(dir, { checks: [
    { id: 'a11y-wcag', local: ['nuclei -ept dns,ssl --metrics=off', '--config p/x --config=p/y'] },
    { id: 'actions-gaps', local: ['semgrep --config p/a --config auto --metrics auto'] },
  ] });
  const g = join(dir, 'plain', 'gitleaks.toml');
  process.env.CW_GITLEAKS_CONFIG = g;
  const result = scanScopes();
  assert.deepEqual(result.secrets, { known: false, reason: 'unreadable', source: g, detail: 'ENOTDIR' });
  assert.deepEqual(pre(result.accessibility), { known: true, source: b, blocks: [], notes: ['template types dns,ssl a', 'runs 2 named registry pa', 'sends NO usage telemetry'] });
  assert.equal(result.accessibility.notes[1].slice(0, 41), `runs 2 named registry pack(s) ${D} p/x, p/y.`);
  assert.deepEqual(pre(result.actionsGaps), { known: true, source: b, blocks: [], notes: ['the rule set is chosen R', 'sends pseudonymous usage'] });
}));

test('reports a gitleaks config that is a directory as unreadable and states engine notes', () => inDir((dir) => {
  const { b, g } = setup(dir, { checks: [
    { id: 'a11y-wcag', local: ['semgrep --pro-intrafile'], scopeNotes: ['engine-pro-intrafile'] },
    { id: 'actions-gaps', local: ['semgrep ${CW_SEMGREP_PRO:+--pro-intrafile}'] },
  ] });
  mkdirSync(g);
  const result = scanScopes();
  assert.deepEqual(result.secrets, { known: false, reason: 'unreadable', source: g, detail: 'EISDIR' });
  assert.deepEqual(pre(result.accessibility), { known: true, source: b, blocks: [], notes: ['runs the Pro engine, int'] });
  assert.deepEqual(pre(result.actionsGaps), { known: true, source: b, blocks: [], notes: ['the engine is NOT fixed '] });
  assert.equal(result.actionsGaps.notes[0].split('`')[1], 'CW_SEMGREP_PRO');
}));

test('reports a gitleaks config without allowlist blocks as unparsed and ignores non-array scopeNotes', () => inDir((dir) => {
  const { b, g } = setup(dir, { checks: [{ id: 'a11y-wcag', local: ['codeql --language go'], scopeNotes: 'nothing' }] }, '[allowlists]\npaths = ["x"]\n[[allow]]\n');
  const result = scanScopes();
  assert.deepEqual(result.secrets, { known: false, reason: 'unparsed', source: g, detail: 'no allowlist blocks were recognised' });
  assert.deepEqual(result.accessibility, { known: true, source: b, blocks: [], notes: [`analyses go only ${D} other languages in the repo are not scanned by this check`] });
}));
