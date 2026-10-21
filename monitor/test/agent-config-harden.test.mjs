// The declare-only fixer: pins npx packages and narrows Bash(*) as a unified diff, never a write.
// `git apply --check` is the second witness for the diff — a diff this module thinks is valid and
// git rejects would be a fixer that produces nothing a human can apply.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { pinNpx, narrowBashAllow, addCredentialDeny, unifiedDiff, hardenAgentConfig, lockfileResolver, observedBashFromSettings } from '../agent-config-harden.mjs';
import { CREDENTIAL_DENY, denyCoversCredentials } from '../../bin/agent-config.mjs';

const BIN = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'agent-config-harden.mjs');

function tree(files) {
  const d = mkdtempSync(join(tmpdir(), 'cw-agentcfg-harden-'));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(d, p)), { recursive: true });
    writeFileSync(join(d, p), typeof body === 'string' ? body : `${JSON.stringify(body, null, 2)}\n`);
  }
  return d;
}

/** `git apply --check` inside a scratch repo holding the BEFORE files: the witness that cannot share our failure mode. */
function gitApplyCheck(repo, diff) {
  spawnSync('git', ['init', '-q'], { cwd: repo });
  const patch = join(repo, 'harden.patch');
  writeFileSync(patch, diff);
  return spawnSync('git', ['apply', '--check', '--verbose', patch], { cwd: repo, encoding: 'utf8' });
}

const MCP = { mcpServers: {
  fetcher: { command: 'npx', args: ['-y', 'canary-mcp-fetch'] },
  scoped: { command: 'npx', args: ['-y', '@scope/tool', '--flag'] },
  pinned: { command: 'npx', args: ['-y', 'already@1.0.0'] },
  local: { command: 'node', args: ['server.mjs'] },
} };
const LOCK = { name: 't', lockfileVersion: 3, packages: { '': {}, 'node_modules/canary-mcp-fetch': { version: '2.3.4' }, 'node_modules/@scope/tool': { version: '0.9.1' } } };
const resolver = (pkg) => ({ 'canary-mcp-fetch': '2.3.4', '@scope/tool': '0.9.1' }[pkg] || null);

describe('pinNpx', () => {
  test('pins unpinned packages, scoped too, and leaves a pinned one and a non-npx server alone', () => {
    const text = `${JSON.stringify(MCP, null, 2)}\n`;
    const r = pinNpx(text, resolver);
    assert.deepEqual(r.pinned, [{ server: 'fetcher', package: 'canary-mcp-fetch', version: '2.3.4' }, { server: 'scoped', package: '@scope/tool', version: '0.9.1' }]);
    assert.deepEqual(r.skipped, []);
    assert.match(r.text, /"canary-mcp-fetch@2\.3\.4"/);
    assert.match(r.text, /"@scope\/tool@0\.9\.1"/);
    assert.match(r.text, /"already@1\.0\.0"/);
    assert.deepEqual(JSON.parse(r.text).mcpServers.pinned, MCP.mcpServers.pinned);
  });
  test('fails OPEN on an unresolved package: unchanged text, stated skip', () => {
    const text = `${JSON.stringify({ mcpServers: { x: { command: 'npx', args: ['-y', 'nobody-knows'] } } }, null, 2)}\n`;
    const r = pinNpx(text, () => null);
    assert.equal(r.text, text);
    assert.deepEqual(r.skipped, [{ server: 'x', package: 'nobody-knows', reason: 'unresolved' }]);
  });
  test('a resolver answering something that is not a version is treated as unresolved', () => {
    const text = `${JSON.stringify({ mcpServers: { x: { command: 'npx', args: ['-y', 'p'] } } }, null, 2)}\n`;
    assert.equal(pinNpx(text, () => 'latest').pinned.length, 0);
  });
  test('@latest is replaced by the resolved version — a tag is not a pin', () => {
    const text = `${JSON.stringify({ mcpServers: { x: { command: 'npx', args: ['-y', 'p@latest'] } } }, null, 2)}\n`;
    const r = pinNpx(text, () => '1.2.3');
    assert.match(r.text, /"p@1\.2\.3"/);
  });
  test('idempotent: a second pass over pinned text changes nothing', () => {
    const once = pinNpx(`${JSON.stringify(MCP, null, 2)}\n`, resolver).text;
    assert.equal(pinNpx(once, resolver).text, once);
  });
});

describe('narrowBashAllow', () => {
  const observed = ['Bash(git status:*)', 'Bash(npm test:*)', 'Bash(*)', 'Read'];
  test('replaces a Bash(*) element on its own line with the observed list, indentation kept', () => {
    const text = '{\n  "permissions": {\n    "allow": [\n      "Bash(*)",\n      "Read"\n    ]\n  }\n}\n';
    const r = narrowBashAllow(text, observed);
    assert.equal(r.narrowed, true);
    assert.deepEqual(JSON.parse(r.text).permissions.allow, ['Bash(git status:*)', 'Bash(npm test:*)', 'Read']);
    assert.match(r.text, /\n      "Bash\(git status:\*\)",\n      "Bash\(npm test:\*\)",\n      "Read"\n/);
  });
  test('handles a one-line array', () => {
    const r = narrowBashAllow('{"permissions":{"allow":["Read", "Bash(*)"]}}\n', observed);
    assert.deepEqual(JSON.parse(r.text).permissions.allow, ['Read', 'Bash(git status:*)', 'Bash(npm test:*)']);
  });
  test('drops the broad grant when every observed entry is already allowed', () => {
    const r = narrowBashAllow('{\n  "permissions": {\n    "allow": [\n      "Bash(git status:*)",\n      "Bash(*)"\n    ]\n  }\n}\n', ['Bash(git status:*)']);
    assert.equal(r.narrowed, true);
    assert.deepEqual(JSON.parse(r.text).permissions.allow, ['Bash(git status:*)']);
  });
  test('refuses, with a reason, when there is no broad grant or nothing observed', () => {
    assert.equal(narrowBashAllow('{"permissions":{"allow":["Read"]}}', observed).reason, 'no unbounded Bash grant');
    assert.equal(narrowBashAllow('{"permissions":{"allow":["Bash(*)"]}}', ['Read', 'Bash(*)']).reason, 'no observed Bash usage to derive an explicit list from');
    assert.equal(narrowBashAllow('{}', observed).reason, 'no permissions.allow');
    assert.equal(narrowBashAllow('{{', observed).reason, 'unparseable');
  });
});

describe('addCredentialDeny', () => {
  const shapes = {
    multiline: '{\n  "permissions": {\n    "allow": [\n      "Bash(npm test:*)",\n      "Read"\n    ]\n  },\n  "env": {}\n}\n',
    oneLineFile: '{"permissions":{"allow":["Bash(npm test:*)", "Read"]},"hooks":{}}\n',
    allowIsLastKey: '{\n  "permissions": {\n    "allow": ["Bash(git status:*)"]\n  }\n}\n',
    emptyDeny: '{\n  "permissions": {\n    "allow": ["Bash(*)"],\n    "deny": []\n  }\n}\n',
    someDeny: '{\n  "permissions": {\n    "allow": ["Bash(*)"],\n    "deny": [\n      "Write(/etc/**)"\n    ]\n  }\n}\n',
    oneLineDeny: '{"permissions":{"allow":["Bash(*)"],"deny":["Write(/etc/**)"]}}\n',
  };
  test('every shape of settings file gains a deny list the scanner accepts, as a diff git applies, and the existing deny entries survive', () => {
    for (const [name, before] of Object.entries(shapes)) {
      const r = addCredentialDeny(before);
      assert.deepEqual(r.added, [...CREDENTIAL_DENY], `${name}: ${r.reason}`);
      const after = JSON.parse(r.text);
      assert.ok(denyCoversCredentials(after.permissions.deny), name);
      if (before.includes('Write(/etc/**)')) assert.ok(after.permissions.deny.includes('Write(/etc/**)'), `${name}: an existing deny entry was lost`);
      const repo = mkdtempSync(join(tmpdir(), 'cw-deny-'));
      writeFileSync(join(repo, 's.json'), before);
      const chk = gitApplyCheck(repo, unifiedDiff('s.json', before, r.text));
      assert.equal(chk.status, 0, `${name}: git rejected the diff:\n${chk.stderr}`);
      spawnSync('git', ['apply', join(repo, 'harden.patch')], { cwd: repo });
      assert.equal(readFileSync(join(repo, 's.json'), 'utf8'), r.text, name);
    }
  });
  test('idempotent: a second pass refuses because the deny already covers credential reads', () => {
    const once = addCredentialDeny(shapes.multiline).text;
    assert.equal(addCredentialDeny(once).reason, 'permissions.deny already covers credential reads');
  });
  test('refuses, with a reason, when there is no Bash grant, no permissions block, or the text is not JSON', () => {
    assert.equal(addCredentialDeny('{"permissions":{"allow":["Read"]}}').reason, 'no Bash grant to bound');
    assert.equal(addCredentialDeny('{"permissions":{"allow":["Bash(*)"],"deny":["Read(~/.ssh/**)"]}}').reason, 'permissions.deny already covers credential reads');
    assert.equal(addCredentialDeny('{}').reason, 'no permissions.allow');
    assert.equal(addCredentialDeny('{{').reason, 'unparseable');
  });
});

describe('unifiedDiff is a diff git accepts', () => {
  test('a one-line replacement, a multi-line insertion, and a no-trailing-newline file all pass git apply --check', () => {
    const cases = [
      ['a.json', '{\n  "x": "old"\n}\n', '{\n  "x": "new"\n}\n'],
      ['b.json', '[\n  "one",\n  "three"\n]\n', '[\n  "one",\n  "two",\n  "two-b",\n  "three"\n]\n'],
      ['c.txt', 'first\nlast', 'first\nchanged'],
      ['d.txt', 'first\nlast\n', 'first\nlast'],
    ];
    for (const [file, before, after] of cases) {
      const repo = mkdtempSync(join(tmpdir(), 'cw-diff-'));
      writeFileSync(join(repo, file), before);
      const diff = unifiedDiff(file, before, after);
      const r = gitApplyCheck(repo, diff);
      assert.equal(r.status, 0, `${file}: git rejected the diff:\n${r.stderr}\n${diff}`);
      const applied = spawnSync('git', ['apply', join(repo, 'harden.patch')], { cwd: repo, encoding: 'utf8' });
      assert.equal(applied.status, 0, applied.stderr);
      assert.equal(readFileSync(join(repo, file), 'utf8'), after, `${file}: applying the diff did not produce the intended text`);
    }
  });
  test('identical texts produce an empty diff', () => {
    assert.equal(unifiedDiff('x', 'same\n', 'same\n'), '');
  });
});

describe('hardenAgentConfig — declare-only', () => {
  const SETTINGS = { permissions: { allow: ['Bash(*)', 'Read'] } };
  const LOCAL = { permissions: { allow: ['Bash(git status:*)', 'Bash(npm test:*)'] } };
  const DENY = ['Read(~/.ssh/**)', 'Read(~/.aws/**)'];
  const SETTINGS_DENIED = { permissions: { allow: ['Bash(*)', 'Read'], deny: DENY } };
  const LOCAL_DENIED = { permissions: { allow: ['Bash(git status:*)', 'Bash(npm test:*)'], deny: DENY } };

  test('pins from the lockfile, narrows from settings.local.json and adds the deny block to both settings files, emitting a diff git accepts; the target is untouched', () => {
    const repo = tree({ '.mcp.json': MCP, 'package-lock.json': LOCK, '.claude/settings.json': SETTINGS, '.claude/settings.local.json': LOCAL });
    const before = Object.fromEntries(['.mcp.json', '.claude/settings.json', '.claude/settings.local.json'].map((f) => [f, readFileSync(join(repo, f), 'utf8')]));
    const out = hardenAgentConfig({ repoDir: repo });
    assert.equal(out.ok, true, out.reason);
    assert.equal(out.applied, false);
    assert.deepEqual(out.files, ['.mcp.json', '.claude/settings.json', '.claude/settings.local.json']);
    assert.equal(out.pinned.length, 2);
    assert.deepEqual(out.narrowed, [{ file: '.claude/settings.json', removed: 'Bash(*)', added: ['Bash(git status:*)', 'Bash(npm test:*)'] }]);
    assert.deepEqual(out.denied.map((d) => [d.file, d.added.length]), [['.claude/settings.json', CREDENTIAL_DENY.length], ['.claude/settings.local.json', CREDENTIAL_DENY.length]]);
    for (const [f, text] of Object.entries(before)) assert.equal(readFileSync(join(repo, f), 'utf8'), text, `${f} was written`);
    const r = gitApplyCheck(repo, out.diff);
    assert.equal(r.status, 0, `git rejected the diff:\n${r.stderr}\n${out.diff}`);
    spawnSync('git', ['apply', join(repo, 'harden.patch')], { cwd: repo });
    const mcp = JSON.parse(readFileSync(join(repo, '.mcp.json'), 'utf8'));
    assert.deepEqual(mcp.mcpServers.fetcher.args, ['-y', 'canary-mcp-fetch@2.3.4']);
    const settings = JSON.parse(readFileSync(join(repo, '.claude/settings.json'), 'utf8'));
    assert.deepEqual(settings.permissions.allow, ['Bash(git status:*)', 'Bash(npm test:*)', 'Read']);
    assert.deepEqual(settings.permissions.deny, [...CREDENTIAL_DENY], 'the narrowed allow and the new deny land in ONE diff');
    const local = JSON.parse(readFileSync(join(repo, '.claude/settings.local.json'), 'utf8'));
    assert.ok(denyCoversCredentials(local.permissions.deny));
  });

  test('REFUSES when nothing would change: ok:false with the reasons, never an empty diff', () => {
    const repo = tree({ '.mcp.json': { mcpServers: { p: { command: 'npx', args: ['-y', 'already@1.0.0'] } } }, '.claude/settings.json': LOCAL_DENIED });
    const out = hardenAgentConfig({ repoDir: repo });
    assert.equal(out.ok, false);
    assert.match(out.reason, /nothing to change/);
    assert.match(out.reason, /no unbounded Bash grant/);
    assert.match(out.reason, /already covers credential reads/);
    assert.equal(out.diff, undefined);
  });

  test('REFUSES when the only fix needs a version and no lockfile pins it — refusal, not a guess', () => {
    const repo = tree({ '.mcp.json': { mcpServers: { p: { command: 'npx', args: ['-y', 'unknown-pkg'] } } } });
    const out = hardenAgentConfig({ repoDir: repo });
    assert.equal(out.ok, false);
    assert.match(out.reason, /unknown-pkg.*unresolved|unresolved/);
  });

  test('REFUSES when Bash(*) is present, no observed usage exists to narrow it to, and the deny already covers credential reads', () => {
    const repo = tree({ '.claude/settings.json': SETTINGS_DENIED });
    const out = hardenAgentConfig({ repoDir: repo });
    assert.equal(out.ok, false);
    assert.match(out.reason, /no observed Bash usage/);
  });

  test('a Bash grant with no deny is enough on its own: the deny block is the whole diff, and it applies', () => {
    const repo = tree({ '.claude/settings.json': SETTINGS });
    const out = hardenAgentConfig({ repoDir: repo });
    assert.equal(out.ok, true, out.reason);
    assert.deepEqual(out.files, ['.claude/settings.json']);
    assert.deepEqual(out.narrowed, []);
    assert.equal(out.denied.length, 1);
    assert.equal(gitApplyCheck(repo, out.diff).status, 0);
  });

  test('the seams are injectable: a resolver and an observed list replace the lockfile and settings reads', () => {
    const repo = tree({ '.mcp.json': MCP, '.claude/settings.json': SETTINGS });
    const out = hardenAgentConfig({ repoDir: repo, resolveVersion: resolver, observed: ['Bash(make:*)'] });
    assert.equal(out.ok, true, out.reason);
    assert.deepEqual(out.narrowed[0].added, ['Bash(make:*)']);
    assert.equal(out.pinned.length, 2);
    assert.equal(out.denied.length, 1);
  });

  test('default seams read the target: the lockfile resolver and the observed list', () => {
    const repo = tree({ 'package-lock.json': LOCK, '.claude/settings.local.json': LOCAL, '.claude/settings.json': SETTINGS });
    assert.equal(lockfileResolver(repo)('canary-mcp-fetch'), '2.3.4');
    assert.equal(lockfileResolver(repo)('absent'), null);
    assert.equal(lockfileResolver(tree({}))('anything'), null, 'ENOENT lockfile is a null resolution');
    assert.deepEqual(observedBashFromSettings(repo), ['Bash(git status:*)', 'Bash(npm test:*)'], 'the broad grant itself is never observed usage');
  });
});

describe('the CLI', () => {
  test('prints the diff, exits 0, writes nothing, and honours CW_AGENT_CONFIG_ROOT at call time', () => {
    const repo = tree({ '.mcp.json': MCP, 'package-lock.json': LOCK });
    const mtime = statSync(join(repo, '.mcp.json')).mtimeMs;
    const text = readFileSync(join(repo, '.mcp.json'), 'utf8');
    const r = spawnSync(process.execPath, [BIN], { encoding: 'utf8', env: { ...process.env, CW_AGENT_CONFIG_ROOT: repo } });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^--- a\/\.mcp\.json\n\+\+\+ b\/\.mcp\.json\n@@ /);
    assert.match(r.stdout, /\+.*"canary-mcp-fetch@2\.3\.4"/);
    assert.match(r.stderr, /dry-run; nothing written/);
    assert.equal(readFileSync(join(repo, '.mcp.json'), 'utf8'), text);
    assert.equal(statSync(join(repo, '.mcp.json')).mtimeMs, mtime);
  });
  test('a refusal exits 2 with the reason on stderr and nothing on stdout', () => {
    const repo = tree({ '.claude/settings.json': { permissions: { allow: ['Read'] } } });
    const r = spawnSync(process.execPath, [BIN, repo], { encoding: 'utf8', env: { ...process.env, CW_AGENT_CONFIG_ROOT: '' } });
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /refused — nothing to change/);
  });
});
