// THE trust boundary: "Repo-local commitwork.json manifests never execute without
// --trust-repo-manifest; only bundled manifests run via the MCP server."
//
// That sentence is a house invariant, and until this file existed nothing tested it. It is the one
// property of this server that matters most, because a manifest is a list of shell commands: if a
// scanned repository could name its own manifest through MCP, then pointing the server at a hostile
// repo would execute that repo's commands on this machine. The refusal is the boundary.
//
// EVERYTHING HERE IS NON-EXECUTING BY CONSTRUCTION. Every refusal asserted below happens before
// spawnSync is reached, and the one call that gets past the manifest check names a repo path that
// does not exist, so it refuses there instead. No test in this file runs a scanner.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, rmSync, readFileSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SERVER = join(REPO, 'mcp', 'server.mjs');

function call(name, args) {
  const out = execFileSync(process.execPath, [SERVER], {
    input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
    encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'], maxBuffer: 32 * 1024 * 1024,
  });
  for (const line of out.split('\n').filter(Boolean)) {
    try {
      const m = JSON.parse(line);
      if (m.id === 1) return { isError: !!m.result?.isError, text: m.result?.content?.[0]?.text ?? '', error: m.error };
    } catch { /* not a frame */ }
  }
  throw new Error(`no response frame: ${out.slice(0, 300)}`);
}

const bundled = () => readdirSync(join(REPO, 'manifests')).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));

describe('only bundled manifests are runnable', () => {
  test('NOT VACUOUS: there are bundled manifests, and security-baseline is one', () => {
    const names = bundled();
    assert.ok(names.length >= 3, `only ${names.length} bundled manifests — the refusals below would prove little`);
    assert.ok(names.includes('security-baseline'), 'the default manifest is missing from manifests/');
  });

  test('a manifest name that is not bundled is REFUSED, and the refusal says why', () => {
    const r = call('run_checks', { repo: REPO, manifest: 'attacker-supplied' });
    assert.equal(r.isError, true, 'an unbundled manifest was accepted — a manifest is a list of shell commands');
    assert.match(r.text, /bundled/i);
  });

  test('a repo-local commitwork.json cannot be named through MCP', () => {
    // The exact scenario the invariant describes: a scanned repository carrying its own manifest.
    const dir = mkdtempSync(join(tmpdir(), 'cw-hostile-'));
    writeFileSync(join(dir, 'commitwork.json'), JSON.stringify({
      repo: 'hostile', checks: [{ id: 'pwn', local: 'echo OWNED > /tmp/cw-should-never-exist' }], groups: { quick: ['pwn'] },
    }));
    for (const name of ['commitwork', './commitwork.json', join(dir, 'commitwork.json'), 'commitwork.json']) {
      const r = call('run_checks', { repo: dir, manifest: name });
      assert.equal(r.isError, true, `manifest '${name}' was not refused`);
      assert.match(r.text, /bundled/i, `manifest '${name}' failed for the wrong reason: ${r.text.slice(0, 160)}`);
    }
    rmSync(dir, { recursive: true, force: true });
  });

  test('a traversal path as a manifest name is refused', () => {
    for (const name of ['../../../../etc/passwd', '../manifests/security-baseline', '/etc/passwd']) {
      const r = call('run_checks', { repo: REPO, manifest: name });
      assert.equal(r.isError, true, `traversal manifest '${name}' was accepted`);
      assert.match(r.text, /bundled/i);
    }
  });

  test('the refusal names the allowed set, so a caller can correct itself', () => {
    const r = call('run_checks', { repo: REPO, manifest: 'nope' });
    assert.match(r.text, /security-baseline/, 'the refusal should name what IS runnable');
  });
});

describe('a group that matches nothing must refuse, not report a pass', () => {
  // The recorded regression, verbatim from the handler's own comment: the old default was a literal
  // 'quick', which security-baseline does not define, so the runner matched nothing, wrote no
  // checks-status.json, and the gate returned PASS having executed zero checks. An agent calling
  // run_checks to gate its own commit was told it was clear by a scan that never ran.
  test('an undefined group is refused loudly and names the groups that exist', () => {
    const r = call('run_checks', { repo: REPO, manifest: 'security-baseline', group: 'no-such-group' });
    assert.equal(r.isError, true, 'an unknown group must never run zero checks and pass');
    assert.match(r.text, /not defined in manifest/);
    assert.match(r.text, /has:/, 'the refusal should name the groups that do exist');
  });

  test('the refusal happens before any repo work — a bad group on a bad repo still says group', () => {
    const r = call('run_checks', { repo: REPO, manifest: 'security-baseline', group: 'definitely-not-a-group' });
    assert.match(r.text, /definitely-not-a-group/);
  });
});

describe('the repo argument', () => {
  test('a nonexistent repo path is refused before anything is spawned', () => {
    const r = call('run_checks', { repo: '/definitely/not/a/real/path' });
    assert.equal(r.isError, true);
    assert.match(r.text, /repo path not found/);
  });

  test('repo is required — an omitted path cannot default to somewhere convenient', () => {
    const r = call('run_checks', {});
    assert.equal(r.isError, true);
    assert.match(r.text, /required key 'repo' is missing/);
  });
});

describe('the tool description tells the truth about the boundary', () => {
  test('run_checks advertises the refusal it actually performs', () => {
    // A description is what an agent reads to decide whether calling this is safe. If it claimed a
    // protection the handler did not implement, the lie would be load-bearing.
    const out = execFileSync(process.execPath, [SERVER], {
      input: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'],
    });
    const tools = JSON.parse(out.split('\n').filter(Boolean)[0]).result.tools;
    const t = tools.find((x) => x.name === 'run_checks');
    assert.match(t.description, /bundled/i);
    assert.match(t.description, /refus|untrusted/i);
    // and the claim is backed, which the refusal tests above establish
  });
});

// run_checks points scanners at a caller-chosen repo, and several lanes execute that repo's build
// code. Harness credentials in the MCP server's environment must not reach them.
describe('run_checks environment', () => {
  test('harness and memory-store credentials are stripped before a scanner is spawned', async () => {
    const { scannerEnv } = await import('../server.mjs');
    const env = scannerEnv({
      PATH: '/usr/bin', HOME: '/h', CW_TARGET_URL: 'http://x', DYLD_FALLBACK_LIBRARY_PATH: '/l',
      SOCKET_CLI_ORG_SLUG: 'org',
      VELD_API_KEY: 'sk-veld-secret', VELD_API_URL: 'http://127.0.0.1:3030',
      CLAUDE_CODE_MESSAGING_TOKEN: 't', CLAUDE_CODE_ENTRYPOINT: 'cli',
      ANTHROPIC_API_KEY: 'k', SUBSTRATE_TASKS_DB: '/db', SPINE_AGENT: 'a',
    });
    for (const k of ['VELD_API_KEY', 'VELD_API_URL', 'CLAUDE_CODE_MESSAGING_TOKEN', 'CLAUDE_CODE_ENTRYPOINT',
      'ANTHROPIC_API_KEY', 'SUBSTRATE_TASKS_DB', 'SPINE_AGENT']) {
      assert.equal(env[k], undefined, `${k} must not reach a scanner`);
    }
    for (const k of ['PATH', 'HOME', 'CW_TARGET_URL', 'DYLD_FALLBACK_LIBRARY_PATH', 'SOCKET_CLI_ORG_SLUG']) {
      assert.ok(env[k], `${k} is read by bundled checks and must survive`);
    }
  });

  test('the spawn uses the stripped environment, not process.env', async () => {
    const src = (await import('node:fs')).readFileSync(SERVER, 'utf8');
    // The runner argv lives in runArgv and its env in runEnv; every spawn of one must carry the other.
    assert.match(src, /const runEnv = \(reportDir\) => \(\{ \.\.\.scannerEnv\(process\.env\), CW_REPORT_DIR: reportDir \}\)/);
    const spawns = src.split('\n').filter((l) => /\bspawn(Sync)?\('node', runArgv\(/.test(l));
    assert.equal(spawns.length, 2, 'run_checks and the job runner each spawn the runner once');
    for (const l of spawns) assert.match(l, /env: runEnv\(reportDir\)/, l.trim());
  });
});

describe('resources/read containment', () => {
  test('a symlink under the evidence root that points outside it is refused', async () => {
    const { handleRequest } = await import('../server.mjs');
    const { symlinkSync, mkdirSync } = await import('node:fs');
    const base = mkdtempSync(join(tmpdir(), 'cw-res-'));
    const out = join(base, 'cra');
    mkdirSync(out);
    writeFileSync(join(base, 'outside.txt'), 'must not be served');
    writeFileSync(join(out, 'inside.json'), '{"ok":true}');
    symlinkSync(join(base, 'outside.txt'), join(out, 'escape.txt'));
    const ctx = { paths: { out, products: join(base, 'products.json'), controls: join(base, 'controls.json') } };
    const ok = handleRequest({ jsonrpc: '2.0', id: 1, method: 'resources/read', params: { uri: 'commitwork:///cra/inside.json' } }, ctx);
    const served = ok.result.contents[0].text;
    assert.ok(served.split('\n').includes('{"ok":true}'), 'control: a real file inside the root is served');
    assert.match(served, /^<<<UNTRUSTED-DATA [0-9a-f]{12} origin="commitwork-resource:cra\/inside\.json">>>\n/, 'and served fenced');
    const esc = handleRequest({ jsonrpc: '2.0', id: 2, method: 'resources/read', params: { uri: 'commitwork:///cra/escape.txt' } }, ctx);
    assert.ok(esc.error, 'the link target is outside the root');
    assert.ok(!JSON.stringify(esc).includes('must not be served'));
    rmSync(base, { recursive: true, force: true });
  });
});

describe('turn_efficiency default transcript directory', () => {
  test('is derived from the checkout, not a hard-coded home directory', () => {
    const src = readFileSync(SERVER, 'utf8');
    assert.doesNotMatch(src, /-Users-[a-z]+-/, 'no operator path baked into the server');
  });
});
