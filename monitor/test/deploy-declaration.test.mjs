// node --test monitor/test/  — DEPLOYMENT DECLARATION: validation + the bin/deploy.mjs refusal.
// deploy.mjs runs as a subprocess against fixture registries (its --registry seam).

import { describe, test, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, existsSync, rmSync, symlinkSync } from 'node:fs';
import { createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateRegistry, loadRegistry, HOSTNAME_RE, registryPath, isExampleRegistry } from '../registry.mjs';
import { registryPathFor } from '../store-paths.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CW = resolve(HERE, '../..');
const DEPLOY = join(CW, 'bin', 'deploy.mjs');

// minimal zero-error registry: one public https area, one declared-but-not-public area behind auth
const base = () => ({
  reportsRoot: 'reports',
  areas: [
    {
      slug: 'app',
      label: 'App',
      deploy: {
        hostnames: ['app.example.com', 'alias.example.com'],
        service: 'https://127.0.0.1:59443',
        public: true, requiresAuth: false,
        caPool: '/x/origin ca.pem', // a space, deliberately: the YAML emitter must quote it
      },
    },
    { slug: 'panel', deploy: { hostnames: ['panel.example.com'], service: 'http://127.0.0.1:59878', public: false, requiresAuth: true } },
  ],
  projects: [{ name: 'app-core', area: 'app', path: '~/x/app', manifest: 'm' }],
});

const errorsOf = (reg) => validateRegistry(reg).errors;
const assertDies = (reg, re, what) => {
  const errors = errorsOf(reg);
  assert.ok(errors.length > 0, `${what}: expected a fatal error, got none (registry accepted)`);
  assert.ok(errors.some((e) => re.test(e)), `${what}: no error matched ${re}\n  actual: ${JSON.stringify(errors, null, 2)}`);
  return errors;
};

let scratch;
const fixture = (name, reg) => {
  scratch ??= mkdtempSync(join(tmpdir(), 'cw-deploy-'));
  const p = join(scratch, name);
  writeFileSync(p, JSON.stringify(reg, null, 2));
  return p;
};
after(() => { if (scratch) rmSync(scratch, { recursive: true, force: true }); });

// runs bin/deploy.mjs; probe warnings land on stderr of a successful run, so stderr survives exit 0
function runDeploy(argv) {
  const r = spawnSync(process.execPath, [DEPLOY, ...argv],
    { cwd: CW, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return { code: r.status ?? -1, stdout: String(r.stdout || ''), stderr: String(r.stderr || '') };
}

describe('deploy block validation — control cases', () => {
  test('the base fixture validates with zero errors and zero warnings', () => {
    const { errors, warnings } = validateRegistry(base());
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, []);
  });

  // The panel is declared only in the private registry; without it loadRegistry() reads the example.
  const LIVE_SKIP = isExampleRegistry(registryPath())
    ? `private registry absent: ${registryPathFor(CW)} does not exist, so loadRegistry() reads the example and the live panel declaration is not measured`
    : undefined;

  test('the LIVE registry declares the admin panel as published-and-authenticated, never naked', { skip: LIVE_SKIP }, () => {
    const live = loadRegistry({ quiet: true });
    const admin = (live.areas || []).find((a) => a.deploy && /:7878$/.test(a.deploy.service));
    assert.ok(admin, 'the live registry must declare the admin panel origin (…:7878)');
    assert.equal(admin.deploy.requiresAuth, true, 'the panel triggers sweeps and installs — it always requires auth');
    if (admin.deploy.public) {
      assert.ok(admin.deploy.authAt, 'a PUBLISHED panel must name where its auth layer lives (authAt)');
      assert.ok(['origin', 'edge'].includes(admin.deploy.authAt), `authAt must be origin|edge, got ${admin.deploy.authAt}`);
    }
  });

  test('every LIVE deploy hostname passes HOSTNAME_RE (they reach the YAML verbatim)', () => {
    const live = loadRegistry({ quiet: true });
    const hosts = (live.areas || []).flatMap((a) => a.deploy?.hostnames || []);
    assert.ok(hosts.length >= 1, 'the live registry declares at least one deploy hostname');
    for (const h of hosts) assert.ok(HOSTNAME_RE.test(h), `live hostname ${h} fails HOSTNAME_RE`);
  });
});

describe('deploy block validation — negatives (these must DIE)', () => {
  test('a non-object deploy dies', () => {
    for (const bad of ['https://127.0.0.1:8099', 42, ['app.example.com'], null]) {
      const reg = base();
      reg.areas[0].deploy = bad;
      assertDies(reg, /^areas\[0\] \(app\) deploy must be an object$/, `deploy=${JSON.stringify(bad)}`);
    }
  });

  test('missing/empty/wrong-typed hostnames die', () => {
    for (const bad of [undefined, [], 'app.example.com', ['app.example.com', 7]]) {
      const reg = base();
      if (bad === undefined) delete reg.areas[0].deploy.hostnames;
      else reg.areas[0].deploy.hostnames = bad;
      assertDies(reg, /^areas\[0\] \(app\) deploy: hostnames must be a non-empty array of strings$/, `hostnames=${JSON.stringify(bad)}`);
    }
  });

  test('a hostname that is not a real DNS name dies (and HOSTNAME_RE is what rejects it)', () => {
    const bads = ['App.Example.Com', 'under_score.example.com', '-lead.example.com', 'trail-.example.com',
      'no-dot', 'a..b', 'evil.example.com/../x', 'host name.example.com', '', 'a.' + 'x'.repeat(64) + '.com'];
    for (const bad of bads) {
      assert.equal(HOSTNAME_RE.test(bad), false, `HOSTNAME_RE must reject ${JSON.stringify(bad)}`);
      const reg = base();
      reg.areas[0].deploy.hostnames = [bad];
      assertDies(reg, /is not a valid lowercase DNS name$/, `hostname=${JSON.stringify(bad)}`);
    }
    assert.equal(HOSTNAME_RE.test('ad.portll.net'), true, 'control: a legitimate hostname still passes');
  });

  test('a hostname claimed by TWO areas dies — one hostname routes to one origin', () => {
    const reg = base();
    reg.areas[1].deploy.hostnames = ['panel.example.com', 'app.example.com'];
    assertDies(reg, /^areas\[1\] \(panel\) deploy: hostname 'app.example.com' is already claimed by area 'app'$/, 'cross-area duplicate');
    const dup = base();
    dup.areas[0].deploy.hostnames = ['app.example.com', 'app.example.com'];
    assertDies(dup, /already claimed by area 'app'/, 'same-area duplicate');
  });

  test('a service that is not an http(s) origin URL dies', () => {
    for (const bad of [undefined, 42, '127.0.0.1:8099', 'tcp://127.0.0.1:22', 'unix:/run/app.sock', 'http_status:404', 'https://']) {
      const reg = base();
      if (bad === undefined) delete reg.areas[0].deploy.service;
      else reg.areas[0].deploy.service = bad;
      assertDies(reg, /^areas\[0\] \(app\) deploy: service must be an http\(s\):\/\/ origin URL$/, `service=${JSON.stringify(bad)}`);
    }
  });

  test('absent or non-boolean public/requiresAuth die — never defaulted', () => {
    for (const k of ['public', 'requiresAuth']) {
      for (const bad of [undefined, 'true', 1]) {
        const reg = base();
        if (bad === undefined) delete reg.areas[0].deploy[k];
        else reg.areas[0].deploy[k] = bad;
        assertDies(reg, new RegExp(`^areas\\[0\\] \\(app\\) deploy: ${k} \\(boolean\\) is required$`), `${k}=${JSON.stringify(bad)}`);
      }
    }
  });

  test('wrong-typed optional strings die (originServerName, caPool, note)', () => {
    for (const k of ['originServerName', 'caPool', 'note']) {
      const reg = base();
      reg.areas[0].deploy[k] = 7;
      assertDies(reg, new RegExp(`^areas\\[0\\] \\(app\\) deploy: ${k} must be a string$`), `${k}=7`);
    }
  });

  // deploy is the one block whose contents become applied ingress, so a dropped-key warning is a silent-green
  test('an unknown deploy key DIES — this is the one block where forward-compat is the wrong default', () => {
    for (const [key, value] of [['tunnelId', 'abc123'], ['noTLSVerify', true], ['httpHostHeader', 'localhost']]) {
      const reg = base();
      reg.areas[0].deploy[key] = value;
      const { errors, warnings } = validateRegistry(reg);
      assert.deepEqual(warnings, [], `${key} must not be downgraded to a warning`);
      assert.equal(errors.length, 1, `${key}: expected exactly one error, got ${JSON.stringify(errors)}`);
      assert.match(errors[0], new RegExp(`^areas\\[0\\] \\(app\\) deploy: unknown key ${key} — `));
      assert.match(errors[0], /ingress an operator applies/, 'the message must say WHY this block is stricter');
      assert.match(errors[0], /known: hostnames, service/, 'and list the accepted keys, because the failure being closed is a typo');
    }
  });

  test('a misspelt requiresAuth cannot become an absent one — the refusal key fails loud, twice', () => {
    const reg = base();
    reg.areas[0].deploy.requireAuth = true;
    delete reg.areas[0].deploy.requiresAuth;
    const { errors } = validateRegistry(reg);
    assert.equal(errors.length, 2, JSON.stringify(errors, null, 2));
    assert.ok(errors.some((e) => /unknown key requireAuth/.test(e)));
    assert.ok(errors.some((e) => /requiresAuth \(boolean\) is required/.test(e)));
  });

  test('the OTHER blocks keep forward-compat warnings — the flip is scoped to deploy, not global', () => {
    const reg = base();
    reg.areas[0].racesEngines = 'semgrep';
    reg.futureFeatureFlag = true;
    reg.projects[0].profile = 'java';
    const { errors, warnings } = validateRegistry(reg);
    assert.deepEqual(errors, []);
    assert.deepEqual(warnings, [
      'unknown top-level key: futureFeatureFlag',
      'areas[0] (app): unknown key racesEngines',
      'projects[0] (app-core): unknown key profile',
    ]);
  });
});


// Skip where ~/.cloudflared does not exist — the directory whose protection this suite asserts.
// undefined, NOT null: node:test reads `{ skip: null }` as SKIP.
const NO_CLOUDFLARED = existsSync(join(homedir(), '.cloudflared')) ? undefined
  : `${join(homedir(), '.cloudflared')} does not exist, so the directory whose protection this `
    + 'suite asserts is not present. Meaningful only on a machine running the tunnel.';

describe('bin/deploy.mjs — the refusal, and the dry run that writes nothing', { skip: NO_CLOUDFLARED }, () => {
  test('public:true + requiresAuth:true is WITHHELD per area: exit 3, area named, safe areas still emitted', () => {
    const reg = base();
    reg.areas[1].deploy.public = true; // the panel area now claims public while still requiring auth
    const r = runDeploy(['--registry', fixture('refuse.json', reg)]);
    assert.equal(r.code, 3, `expected exit 3 (incomplete), got ${r.code}\nstdout:${r.stdout}\nstderr:${r.stderr}`);
    assert.match(r.stderr, /WITHHELD/, 'the refusal must be loud');
    assert.match(r.stderr, /area 'panel' \(panel\.example\.com\): public:true \+ requiresAuth:true, no authAt/, 'must name the area and its hostnames');
    assert.match(r.stderr, /missing: a declared auth layer/, 'must say what is missing');
    assert.match(r.stderr, /INCOMPLETE/, 'a partial fragment must say so — a partial emit that reads as complete is the defect');
    // scoped to the fragment — the table above must still list the withheld hostname
    const fragment = r.stdout.split('--- generated ingress fragment ---')[1] || '';
    assert.ok(fragment.includes('ingress:'), 'the safe areas must still generate — they are not collateral');
    assert.doesNotMatch(fragment, /panel\.example\.com/, 'the withheld hostname must never reach the ingress rules');
    assert.match(r.stdout, /panel\.example\.com/, 'but it must still be VISIBLE in the table, as withheld');
  });

  test('the refusal also blocks --write: exit 2 and the target file is never created', () => {
    const reg = base();
    reg.areas[1].deploy.public = true;
    const target = join(scratch, 'refused-fragment.yml');
    const r = runDeploy(['--registry', fixture('refuse-write.json', reg), '--write', target]);
    assert.equal(r.code, 2);
    assert.equal(existsSync(target), false, 'the refusal must fire before any write');
  });

  test('a dry run emits the fragment and table but writes NOTHING', () => {
    const p = fixture('dry.json', base());
    const before = readdirSync(scratch).sort();
    const r = runDeploy(['--registry', p]);
    assert.equal(r.code, 0, `dry run failed:\n${r.stderr}`);
    assert.deepEqual(readdirSync(scratch).sort(), before, 'a dry run created a file');
    // both hostnames of the shared origin, with per-hostname originServerName defaulting
    assert.match(r.stdout, /- hostname: app\.example\.com/);
    assert.match(r.stdout, /- hostname: alias\.example\.com/);
    assert.match(r.stdout, /originServerName: app\.example\.com/);
    assert.match(r.stdout, /originServerName: alias\.example\.com/);
    assert.match(r.stdout, /caPool: '\/x\/origin ca\.pem'/, 'a path with a space must come out quoted');
    assert.match(r.stdout, /dry run — pass --write/);
    // the non-public panel is in the TABLE (visible) but not in the YAML (not routed)
    assert.match(r.stdout, /panel\.example\.com\s+panel\s+http:\/\/127\.0\.0\.1:59878\s+no \(not emitted\)\s+required/);
    assert.ok(!/- hostname: panel\.example\.com/.test(r.stdout), 'a non-public hostname must never reach the fragment');
  });

  test('--write refuses ~/.cloudflared/ — writing where the daemon reads IS applying', () => {
    // never touches ~/.cloudflared: the refusal is asserted precisely by the file NOT appearing
    const target = join(homedir(), '.cloudflared', `cw-test-refuse-${process.pid}-${Date.now()}.yml`);
    const r = runDeploy(['--registry', fixture('forbid.json', base()), '--write', target]);
    assert.equal(r.code, 2, 'a --write into ~/.cloudflared must be refused');
    assert.match(r.stderr, /REFUSED/);
    assert.match(r.stderr, /APPLYING, which stays human/);
    assert.equal(existsSync(target), false, 'and the file must not exist');
    // if the guard regresses the file IS created — clean up unconditionally
    if (existsSync(target)) rmSync(target, { force: true });
  });

  // symlink and case-change each defeat a lexical path check on their own
  test('--write cannot reach ~/.cloudflared through a SYMLINKED parent', function (t) {
    if (!existsSync(join(homedir(), '.cloudflared'))) return t.skip('no ~/.cloudflared on this machine');
    const link = join(scratch, `cf-link-${process.pid}`);
    symlinkSync(join(homedir(), '.cloudflared'), link);
    const target = join(link, `cw-test-symlink-${process.pid}-${Date.now()}.yml`);
    const r = runDeploy(['--registry', fixture('forbid.json', base()), '--write', target]);
    const landed = join(homedir(), '.cloudflared', basename(target));
    if (existsSync(landed)) rmSync(landed, { force: true }); // clean up before asserting, so a failure litters nothing
    assert.equal(r.code, 2, 'a symlinked parent must not defeat the containment check');
    assert.match(r.stderr, /REFUSED/);
  });

  test('--write cannot reach ~/.cloudflared by CHANGING CASE on a case-insensitive volume', function (t) {
    if (process.platform !== 'darwin' && process.platform !== 'win32') return t.skip('case-sensitive platform');
    if (!existsSync(join(homedir(), '.CloudFlared'))) return t.skip('volume is case-sensitive — .CloudFlared does not resolve');
    const target = join(homedir(), '.CloudFlared', `cw-test-case-${process.pid}-${Date.now()}.yml`);
    const r = runDeploy(['--registry', fixture('forbid.json', base()), '--write', target]);
    const landed = join(homedir(), '.cloudflared', basename(target));
    if (existsSync(landed)) rmSync(landed, { force: true });
    assert.equal(r.code, 2, 'case alone must not defeat the containment check');
    assert.match(r.stderr, /REFUSED/);
  });

  test('--write to an operator-named path works (so the refusals are not vacuous)', () => {
    const target = join(scratch, 'out', 'fragment.yml');
    // parent does not exist -> refused (deploy.mjs creates no directories)
    const missing = runDeploy(['--registry', fixture('write.json', base()), '--write', target]);
    assert.equal(missing.code, 2);
    const flat = join(scratch, 'fragment.yml');
    const r = runDeploy(['--registry', join(scratch, 'write.json'), '--write', flat]);
    assert.equal(r.code, 0, `--write failed:\n${r.stderr}`);
    assert.ok(existsSync(flat));
    const body = readFileSync(flat, 'utf8');
    assert.match(body, /^# GENERATED by bin\/deploy\.mjs/, 'the fragment must declare its generator');
    assert.match(body, /- hostname: app\.example\.com/);
    rmSync(flat);
  });

  test('a not-listening origin WARNS on stderr but exits 0 — stale declarations are visible, not fatal', async () => {
    // find a port that is provably closed: bind, read it, release it
    const port = await new Promise((res) => {
      const srv = createServer();
      srv.listen(0, '127.0.0.1', () => { const p = srv.address().port; srv.close(() => res(p)); });
    });
    const reg = base();
    reg.areas[0].deploy.service = `https://127.0.0.1:${port}`;
    const r = runDeploy(['--registry', fixture('stale.json', reg)]);
    assert.equal(r.code, 0, 'not-listening is a WARN, never a failure');
    assert.match(r.stderr, new RegExp(`WARN origin https://127\\.0\\.0\\.1:${port} \\(area 'app'\\) is not listening`));
  });

  test('a LISTENING origin produces no warning (the probe is a probe, not noise)', async () => {
    const srv = createServer(() => {});
    const port = await new Promise((res) => srv.listen(0, '127.0.0.1', () => res(srv.address().port)));
    try {
      const reg = base();
      reg.areas[0].deploy.service = `https://127.0.0.1:${port}`;
      reg.areas[1].deploy.service = `http://127.0.0.1:${port}`; // both areas share the live port: zero expected warnings
      const r = runDeploy(['--registry', fixture('live.json', reg)]);
      assert.equal(r.code, 0);
      assert.ok(!/not listening/.test(r.stderr), `unexpected warning:\n${r.stderr}`);
    } finally { srv.close(); }
  });
});

// ── --verify: DECLARATION vs the applied tunnel config ─────────────────────────────────────────
// Hostnames end in .invalid (RFC 2606): never resolve, so DNS is deterministic offline.
describe('bin/deploy.mjs --verify — drift between the registry and the tunnel', () => {
  const cfg = (body) => { scratch ??= mkdtempSync(join(tmpdir(), 'cw-deploy-')); const p = join(scratch, `cfg-${Math.random().toString(36).slice(2)}.yml`); writeFileSync(p, body); return p; };
  const reg = (areas) => fixture(`vreg-${Math.random().toString(36).slice(2)}.json`, { reportsRoot: 'reports', areas });
  const pub = (slug, hosts) => ({ slug, deploy: { hostnames: hosts, service: 'http://127.0.0.1:59901', public: true, requiresAuth: false } });
  const priv = (slug, hosts) => ({ slug, deploy: { hostnames: hosts, service: 'http://127.0.0.1:59902', public: false, requiresAuth: true } });

  test('a hostname the tunnel serves but no area declares is DRIFT', () => {
    const c = cfg('ingress:\n  - hostname: rogue.example.invalid\n    service: http://127.0.0.1:59901\n  - service: http_status:404\n');
    const r = runDeploy(['--registry', reg([pub('app', ['app.example.invalid'])]), '--verify', '--config', c]);
    assert.equal(r.code, 1, 'drift must exit nonzero so it can gate');
    assert.match(r.stdout, /ROUTED-NOT-DECLARED/);
    assert.match(r.stdout, /rogue\.example\.invalid — served by the tunnel .* but NO area declares it/);
  });

  test('a declared-public hostname missing from the config is DRIFT (it serves nothing)', () => {
    const c = cfg('ingress:\n  - service: http_status:404\n');
    const r = runDeploy(['--registry', reg([pub('app', ['app.example.invalid'])]), '--verify', '--config', c]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /DECLARED-NOT-ROUTED/);
  });

  // A pages-hosted area is served by Cloudflare, not this tunnel. bin/deploy.mjs already filtered
  // these when EMITTING; --verify did not, so a correct configuration reported drift and exited 1.
  // Measured on the live fleet 2026-08-28: i.commitwork.online served fine and read as
  // DECLARED-NOT-ROUTED, "it serves nothing". Both directions are asserted, because the fix is only
  // half done if the dangerous one — a pages host ALSO routed through the tunnel — stops being drift.
  const pages = (slug, hosts) => ({ slug, deploy: { hostnames: hosts, public: true, requiresAuth: false, hosting: 'pages' } });

  test("a hosting:'pages' hostname absent from the tunnel is correct, not drift", () => {
    const c = cfg('ingress:\n  - service: http_status:404\n');
    const r = runDeploy(['--registry', reg([pages('site', ['site.example.invalid'])]), '--verify', '--config', c]);
    assert.equal(r.code, 0, 'Cloudflare serves it; the tunnel is not meant to');
    assert.match(r.stdout, /pages \(correct\)/);
    assert.doesNotMatch(r.stdout, /DECLARED-NOT-ROUTED/);
  });

  test("a hosting:'pages' hostname the tunnel ALSO routes is drift — two origins, one hostname", () => {
    const c = cfg('ingress:\n  - hostname: site.example.invalid\n    service: http://127.0.0.1:59901\n  - service: http_status:404\n');
    const r = runDeploy(['--registry', reg([pages('site', ['site.example.invalid'])]), '--verify', '--config', c]);
    assert.equal(r.code, 1, 'a pages host routed through the tunnel is the defect the fix must keep catching');
    assert.match(r.stdout, /PAGES-BUT-ROUTED/);
  });

  test('a declared-PRIVATE hostname absent from the config is correct, not drift', () => {
    const c = cfg('ingress:\n  - service: http_status:404\n');
    const r = runDeploy(['--registry', reg([priv('panel', ['panel.example.invalid'])]), '--verify', '--config', c]);
    assert.equal(r.code, 0, 'withholding a private hostname is the intended state');
    assert.match(r.stdout, /withheld \(correct\)/);
    assert.match(r.stdout, /no drift/);
  });

  test('a COMMENTED-OUT ingress rule does not count as routed', () => {
    // the live config withholds panel.portll.net exactly this way
    const c = cfg('ingress:\n  # - hostname: panel.example.invalid\n  #   service: http://127.0.0.1:59902\n  - service: http_status:404\n');
    const r = runDeploy(['--registry', reg([priv('panel', ['panel.example.invalid'])]), '--verify', '--config', c]);
    assert.equal(r.code, 0, 'a commented rule routes nothing');
    assert.match(r.stdout, /withheld \(correct\)/);
  });

  test('a declared-private hostname the tunnel DOES route is drift — the dangerous direction', () => {
    const c = cfg('ingress:\n  - hostname: panel.example.invalid\n    service: http://127.0.0.1:59902\n  - service: http_status:404\n');
    const r = runDeploy(['--registry', reg([priv('panel', ['panel.example.invalid'])]), '--verify', '--config', c]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /ROUTED-BUT-DECLARED-PRIVATE/);
  });

  test('an unreadable tunnel config refuses (exit 2) rather than reporting "no drift"', () => {
    const r = runDeploy(['--registry', reg([pub('app', ['app.example.invalid'])]), '--verify', '--config', join(tmpdir(), 'definitely-absent-cw.yml')]);
    assert.equal(r.code, 2, 'a missing config must not read as a clean bill of health');
    assert.match(r.stderr, /cannot read the tunnel config/);
  });

  test('--verify writes nothing', () => {
    const c = cfg('ingress:\n  - hostname: rogue.example.invalid\n    service: http://127.0.0.1:59901\n');
    const before = readdirSync(scratch).sort();
    runDeploy(['--registry', reg([pub('app', ['app.example.invalid'])]), '--verify', '--config', c]);
    // the fixture registry + config just created are expected; nothing ELSE may appear
    const after = readdirSync(scratch).sort().filter((f) => !f.startsWith('vreg-') && !f.startsWith('cfg-'));
    assert.deepEqual(after, before.filter((f) => !f.startsWith('vreg-') && !f.startsWith('cfg-')), '--verify must be read-only');
  });
});

// ── authAt: declaring WHERE the auth layer lives ────────────────────────────────────────────────
// Setting authAt unlocks emission, so it is an attestation and --verify re-checks it.
describe('deploy authAt — the attestation, and the refusal it narrows', () => {
  const withAuth = (extra) => {
    const reg = base();
    reg.areas[1].deploy = { hostnames: ['panel.example.invalid'], service: 'http://127.0.0.1:59903',
      public: true, requiresAuth: true, ...extra };
    return reg;
  };

  test('public + requiresAuth + NO authAt is still WITHHELD — absence must not read as "auth exists"', () => {
    // exit 3 (incomplete), not 2 (nothing generated) — different facts for callers
    const r = runDeploy(['--registry', fixture('noauthat.json', withAuth({}))]);
    assert.equal(r.code, 3, 'absence of authAt must still withhold the area and still gate');
    assert.match(r.stderr, /WITHHELD/);
    assert.match(r.stderr, /no authAt/);
  });

  test("public + requiresAuth + authAt:'origin' IS emitted — the truth is now expressible", () => {
    const r = runDeploy(['--registry', fixture('authat.json', withAuth({ authAt: 'origin' }))]);
    assert.equal(r.code, 0, `expected emission, got:\n${r.stderr}`);
    assert.match(r.stdout, /- hostname: panel\.example\.invalid/);
  });

  test('an unrecognised authAt value dies rather than passing as an attestation', () => {
    for (const bad of ['yes', 'true', 'Origin', '', 1]) {
      const reg = withAuth({ authAt: bad });
      assertDies(reg, /authAt must be 'origin' .* or 'edge'/, `authAt=${JSON.stringify(bad)}`);
    }
  });

  // the fake origin must live in its own process — spawnSync blocks this event loop, so an
  // in-process server can never answer the child's probe
  const startOrigin = async (status) => {
    const { spawn } = await import('node:child_process');
    const child = spawn(process.execPath, ['-e',
      `const http=require('node:http');const s=http.createServer((q,r)=>{r.writeHead(${status});r.end('{}')});` +
      `s.listen(0,'127.0.0.1',()=>process.stdout.write(String(s.address().port)+'\\n'));`],
      { stdio: ['ignore', 'pipe', 'ignore'] });
    const port = await new Promise((resolve, reject) => {
      let buf = '';
      child.stdout.on('data', (d) => { buf += d; if (buf.includes('\n')) resolve(Number(buf.trim())); });
      child.on('error', reject);
      setTimeout(() => reject(new Error('origin did not start')), 5000);
    });
    return { port, stop: () => child.kill() };
  };

  test('--verify FAILS the attestation when the origin answers 200 to an unauthenticated request', async () => {
    const origin = await startOrigin(200);
    try {
      const reg = base();
      reg.areas[1].deploy = { hostnames: ['open.example.invalid'], service: `http://127.0.0.1:${origin.port}`,
        public: true, requiresAuth: true, authAt: 'origin' };
      const cfgPath = join(scratch, 'attest.yml');
      writeFileSync(cfgPath, `ingress:\n  - hostname: open.example.invalid\n    service: http://127.0.0.1:${origin.port}\n  - service: http_status:404\n`);
      const r = runDeploy(['--registry', fixture('attest.json', reg), '--verify', '--config', cfgPath]);
      assert.equal(r.code, 1, 'a false attestation is drift');
      assert.match(r.stdout, /asserting protection the service does not provide/);
      assert.match(r.stdout, /answered HTTP 200/);
    } finally { origin.stop(); }
  });

  test('--verify PASSES the attestation when the origin refuses (401)', async () => {
    const origin = await startOrigin(401);
    try {
      const reg = base();
      reg.areas[1].deploy = { hostnames: ['closed.example.invalid'], service: `http://127.0.0.1:${origin.port}`,
        public: true, requiresAuth: true, authAt: 'origin' };
      const cfgPath = join(scratch, 'attest-ok.yml');
      writeFileSync(cfgPath, `ingress:\n  - hostname: closed.example.invalid\n    service: http://127.0.0.1:${origin.port}\n  - service: http_status:404\n`);
      const r = runDeploy(['--registry', fixture('attest-ok.json', reg), '--verify', '--config', cfgPath]);
      assert.ok(!/asserting protection/.test(r.stdout), `a refusing origin must not be flagged:\n${r.stdout}`);
    } finally { origin.stop(); }
  });
});
