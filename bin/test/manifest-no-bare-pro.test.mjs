// fact: `opengrep --pro` exits 0 with a SARIF of zero results and zero rules / a bare `--pro` in a manifest command is refused; `--pro-intrafile` is a different flag and stays

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const MANIFESTS = join(ROOT, 'manifests');

/** `--pro` is a whole flag unless a word character or `-` continues it (`--pro-intrafile`, `--project`). */
export function hasBarePro(cmd) {
  return /(?<![\w-])--pro(?![\w-])/.test(cmd);
}

/** Every string inside a string or arbitrarily nested array. */
const strings = (value) => {
  if (typeof value === 'string') return [value];
  if (!Array.isArray(value)) return [];
  return value.flatMap(strings);
};

// A check field carries commands when it is an array of strings and at least one string is shaped
// like a shell command. Discovered from the data so a manifest that names the field `run`,
// `commands` or `steps` is covered without a second key list here.
const looksLikeCommand = (s) =>
  /(?:^|[\s;|&(])(?:\$CW_ROOT\/|node |npx |npm |python3? |bash |sh |docker |test |git |[a-z][\w.-]*\s+--)/.test(s)
  || /\$CW_(?:ROOT|REPORT_DIR)\b/.test(s);

const PROSE_FIELDS = new Set(['notes', 'description', 'remediationPrompt', 'formatNotes', 'scopeNotes', 'skipsOnGitHub']);

function loadManifests() {
  const names = readdirSync(MANIFESTS).filter((f) => f.endsWith('.json')).sort();
  // security-baseline.json is read first: it is the shipped scan manifest, and its checks are
  // where the command-field vocabulary is established.
  names.sort((a, b) => (a === 'security-baseline.json' ? -1 : b === 'security-baseline.json' ? 1 : 0));
  return names
    .map((manifest) => ({ manifest, doc: JSON.parse(readFileSync(join(MANIFESTS, manifest), 'utf8')) }))
    .filter(({ doc }) => Array.isArray(doc.checks));
}

function commandFields(docs) {
  const fields = new Set();
  for (const { doc } of docs) {
    for (const check of doc.checks) {
      for (const [key, value] of Object.entries(check)) {
        if (PROSE_FIELDS.has(key) || !Array.isArray(value)) continue;
        if (strings(value).some(looksLikeCommand)) fields.add(key);
      }
    }
  }
  return [...fields].sort();
}

function collectCommands(docs, fields) {
  const out = [];
  for (const { manifest, doc } of docs) {
    for (const check of doc.checks) {
      for (const field of fields) {
        if (!(field in check)) continue;
        for (const cmd of strings(check[field])) out.push({ manifest, id: check.id || '(unnamed)', field, cmd });
      }
    }
  }
  return out;
}

// bin/audit.mjs runs each tool's `run` string through sh at scan time; that registry has no `checks` array.
function toolRunCommands() {
  const manifest = 'security-tools.json';
  const doc = JSON.parse(readFileSync(join(MANIFESTS, manifest), 'utf8'));
  return doc.tools.filter((t) => typeof t.run === 'string').map((t) => ({ manifest, id: t.id, field: 'run', cmd: t.run }));
}

const docs = loadManifests();
const toolRuns = toolRunCommands();
const commands = [...collectCommands(docs, commandFields(docs)), ...toolRuns];

// Second witness: every string under a check outside the prose fields, at any depth, with no
// judgement of what looks like a command.
const deepStrings = (value) => (typeof value === 'string' ? [value]
  : Array.isArray(value) ? value.flatMap(deepStrings)
    : value && typeof value === 'object' ? Object.values(value).flatMap(deepStrings) : []);
const everyString = docs.flatMap(({ manifest, doc }) => doc.checks.flatMap((check) =>
  Object.entries(check).filter(([key]) => !PROSE_FIELDS.has(key))
    .flatMap(([field, value]) => deepStrings(value).map((cmd) => ({ manifest, id: check.id || '(unnamed)', field, cmd })))));

describe('hasBarePro', () => {
  test('a whole --pro flag is found in every terminator shape', () => {
    for (const cmd of [
      '--pro',
      'opengrep --pro',
      'opengrep --pro scan',
      'opengrep --pro=1 scan',
      'opengrep --pro"rules"',
      'opengrep --pro "rules"',
      'opengrep --pro)',
      '"--pro"',
      'opengrep --pro;next',
      'opengrep --pro&&next',
      'opengrep --pro|tee out',
      'opengrep --pro>out.sarif',
      'opengrep --pro\\\n  scan',
    ]) {
      assert.equal(hasBarePro(cmd), true, cmd);
    }
  });

  test('a longer flag that merely starts with --pro is not a bare --pro', () => {
    for (const cmd of [
      'semgrep --pro-intrafile',
      'semgrep --pro-languages',
      'npm --project .',
      'tool --profile ci',
      'tool --provenance',
      'tool --pros',
      'tool ---pro',
      'tool x--pro',
      'tool --PRO',
      'semgrep --pro-intrafile --pro-languages --project --profile --provenance',
    ]) {
      assert.equal(hasBarePro(cmd), false, cmd);
    }
  });
});

describe('bundled manifests', () => {
  test('no command passes a bare --pro', () => {
    const offenders = commands
      .filter((c) => hasBarePro(c.cmd))
      .map((c) => `${c.manifest} ${c.id} (${c.field}): ${c.cmd}`);
    assert.deepEqual(offenders, [], `a bare --pro scans nothing and reports a clean zero:\n${offenders.join('\n')}`);
  });

  test('no string outside the prose fields carries a bare --pro, whatever field holds it', () => {
    const offenders = everyString.filter((c) => hasBarePro(c.cmd)).map((c) => `${c.manifest} ${c.id} (${c.field}): ${c.cmd}`);
    assert.deepEqual(offenders, []);
  });

  test('every --pro-prefixed string the deep walk finds is in the collected commands', () => {
    const collected = new Set(commands.map((c) => `${c.manifest}\u0000${c.id}\u0000${c.cmd}`));
    const missed = everyString.filter((c) => c.cmd.includes('--pro') && !collected.has(`${c.manifest}\u0000${c.id}\u0000${c.cmd}`))
      .map((c) => `${c.manifest} ${c.id} (${c.field})`);
    assert.deepEqual(missed, [], 'a field holding a --pro flag was not recognised as a command field');
    assert.ok(everyString.length >= commands.length);
  });

  test('the collector reads the real command population', () => {
    assert.ok(commands.length > 50, `only ${commands.length} command strings found`);
    assert.ok(toolRuns.length >= 10, `only ${toolRuns.length} security-tools.json run commands found`);
    assert.ok(
      commands.some((c) => c.cmd.includes('--pro-intrafile')),
      'no command contains --pro-intrafile; the scan did not read the manifests\' commands',
    );
  });
});
