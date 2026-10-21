#!/usr/bin/env node
// deploy.mjs — per-area DEPLOYMENT DECLARATION → cloudflared ingress FRAGMENT. Dry run by default.
//
// Declaration is split from authority: reads monitor/projects.json and emits ingress rules; never
// holds Cloudflare credentials, mutates DNS, restarts a tunnel, or calls cloudflared. Applying
// stays a human step.
//
// A tunnel is PER-BOX while commitwork's unit is the PER-AREA declaration, so this emits a
// FRAGMENT of a box-level config it does not own — no default output path.
//
//   node bin/deploy.mjs                    # dry run: hostname table + generated fragment, writes NOTHING
//   node bin/deploy.mjs --verify           # DECLARATION vs REALITY: compare the registry against the
//                                          # applied tunnel config + DNS + origin liveness. Read-only;
//                                          # exits 1 on drift so it can gate. --config <path> to point
//                                          # at another cloudflared config.
//   node bin/deploy.mjs --write <path>     # write the fragment to a file the OPERATOR names
//   node bin/deploy.mjs --registry <path>  # read an alternate registry (tests/fixtures)
//
// --write refuses ~/.cloudflared/, cloudflared's system config dirs (including Homebrew's) and
// ~/Library/LaunchAgents: writing where the daemon or launchd reads IS applying. The tunnel is
// launchd-managed with KeepAlive:true, so nothing catches a bad file.
//
// --verify's implementation lives in lib/deploy-core.mjs (returns lines + a code, so the panel can
// run it in-process); generate and stage stay here at module scope.

import { writeFileSync, existsSync, lstatSync, realpathSync } from 'node:fs';
import { connect } from 'node:net';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { loadRegistry, registryPath } from '../monitor/registry.mjs';

const args = process.argv.slice(2);
const flagValue = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return undefined;
  const v = args[i + 1];
  if (v === undefined || v.startsWith('--')) { console.error(`deploy: ${name} needs a value`); process.exit(2); }
  return v;
};
const WRITE = args.includes('--write') ? flagValue('--write') : undefined;
const REG_PATH = flagValue('--registry') ?? registryPath();
const VERIFY = args.includes('--verify');
const CONFIG_PATH = flagValue('--config') ?? join(homedir(), '.cloudflared', 'config.yml');

// Registry warnings stay visible; an invalid registry throws before we emit anything.
const reg = loadRegistry({ path: REG_PATH });
const declared = (reg.areas || []).filter((a) => a.deploy);
if (!declared.length) { console.log('deploy: no area declares a deploy block — nothing to emit'); process.exit(0); }

// Pages-hosted areas: declared, in the table below, watched by probe-public — and deliberately
// absent from the fragment (Cloudflare serves their hostnames; a tunnel rule would fight the DNS)
// and from the not-listening probe (there is no local origin to dial). Named, never silent.
const pagesHosted = declared.filter((a) => a.deploy.hosting === 'pages');
const tunnelDeclared = declared.filter((a) => a.deploy.hosting !== 'pages');
if (pagesHosted.length) {
  console.log(`deploy: NOTE ${pagesHosted.length} pages-hosted area(s), no ingress emitted for: ${pagesHosted.map((a) => `'${a.slug}' (${a.deploy.hostnames.join(', ')})`).join('; ')}`);
}

// ── --verify: DECLARATION vs REALITY ────────────────────────────────────────────────────────────
// The rest of this file GENERATES from the declaration; this mode compares it against reality.
// READ-ONLY: reads the cloudflared config, resolves DNS, writes nothing, reloads no tunnel.
if (VERIFY) {
  // Imported dynamically so the generate path never loads the comparison or its DNS/HTTP deps.
  const { verify } = await import('../lib/deploy-core.mjs');
  const r = await verify({ registry: reg, configPath: CONFIG_PATH });
  for (const l of r.stdout) console.log(l);
  for (const l of r.stderr) console.error(l);
  process.exit(r.code);
}

// ── THE CENTRAL SAFETY PROPERTY, checked before ANY output ──────────────────────────────────────
// public:true + requiresAuth:true is refused unless the area declares `authAt` — generated ingress
// carries no auth layer, so emitting such a rule would publish an unauthenticated origin. `authAt`
// ('edge' | 'origin') names where the layer lives; an unset authAt must never read as "auth exists".
// Refused PER-AREA, not as a global abort: one unattested area must not take the rest of the fleet
// down, and a blank fleet pressures the operator into declaring a false authAt.
// Exit 3, not 2: still gates, but distinct from "nothing could be generated at all".
const withheld = tunnelDeclared.filter((a) => a.deploy.public && a.deploy.requiresAuth && !a.deploy.authAt);
const emit = tunnelDeclared.filter((a) => !withheld.includes(a));
if (withheld.length) {
  console.error('deploy: WITHHELD — these areas declare public + requiresAuth with no authAt, so');
  console.error('their hostnames are NOT in the output below. Everything else still generated.');
  for (const a of withheld) {
    console.error(`  - area '${a.slug}' (${a.deploy.hostnames.join(', ')}): public:true + requiresAuth:true, no authAt`);
  }
  console.error("missing: a declared auth layer. Set authAt:'edge' once an Access policy (or equivalent");
  console.error("proxy) is applied in front, or authAt:'origin' if the service authenticates its own");
  console.error('requests. Both are attestations — `--verify` re-checks them against the live origin,');
  console.error('so declaring one that is not true is caught rather than believed.');
}

// ── rules ───────────────────────────────────────────────────────────────────────────────────────
// One rule per hostname, registry order — deterministic, so a re-run diffs clean.
const rules = [];
for (const a of emit) {
  if (!a.deploy.public) continue; // declared but not routed: in the table, absent here
  const d = a.deploy;
  const origin = new URL(d.service); // validated http(s) by the registry
  for (const hostname of d.hostnames) {
    const rule = { hostname, service: d.service };
    if (origin.protocol === 'https:') {
      // Per-hostname originServerName by default; a declared one pins a single name for every rule.
      rule.originRequest = { originServerName: d.originServerName || hostname };
      if (d.caPool) rule.originRequest.caPool = d.caPool;
    }
    rules.push({ area: a.slug, ...rule });
  }
}

// ── stale-declaration probe: WARN, never fail ───────────────────────────────────────────────────
// An origin not listening is not an error (the fleet may be down) but must be visible. A TCP
// connect is enough — "something answers on that port", not a handshake.
function listening(host, port, timeoutMs = 600) {
  return new Promise((res) => {
    const sock = connect({ host, port });
    const done = (ok) => { sock.destroy(); res(ok); };
    sock.once('connect', () => done(true));
    sock.once('error', () => done(false));
    sock.setTimeout(timeoutMs, () => done(false));
  });
}
for (const a of tunnelDeclared) { // every declared local origin, public or not (pages areas have none)
  const u = new URL(a.deploy.service);
  const port = Number(u.port || (u.protocol === 'https:' ? 443 : 80));
  if (!(await listening(u.hostname, port))) {
    console.error(`deploy: WARN origin ${a.deploy.service} (area '${a.slug}') is not listening — stale declaration, or the service is down`);
  }
}

// ── the table: every declared hostname, including the ones deliberately NOT emitted ─────────────
const rows = declared.flatMap((a) => a.deploy.hostnames.map((h) => [
  h, a.slug, a.deploy.hosting === 'pages' ? '(cloudflare pages)' : a.deploy.service,
  a.deploy.public ? 'yes' : 'no (not emitted)',
  a.deploy.requiresAuth ? 'required' : 'none',
]));
const head = ['hostname', 'area', 'service', 'public', 'auth'];
const width = head.map((h, c) => Math.max(h.length, ...rows.map((r) => r[c].length)));
const line = (r) => r.map((v, c) => v.padEnd(width[c])).join('  ').trimEnd();
console.log(`deploy: ${declared.length} areas declare deployments · ${rows.length} hostnames · ${rules.length} public rules emitted\n`);
console.log(line(head));
for (const r of rows) console.log(line(r));

// ── the fragment ────────────────────────────────────────────────────────────────────────────────
// Hand-rolled YAML (zero-dep); values constrained at source, anything else quoted defensively.
const y = (s) => (/^[A-Za-z0-9./:_-]+$/.test(s) ? s : `'${String(s).replace(/'/g, "''")}'`);
const fragment = [
  '# GENERATED by bin/deploy.mjs from monitor/projects.json — cloudflared ingress FRAGMENT.',
  '# NOT a complete config: the tunnel itself (credentials-file, tunnel id, catch-all rule) is',
  '# box-level and operator-owned. Merge these rules into that config\'s ingress list ABOVE the',
  '# final catch-all. commitwork declares; applying (config merge, DNS, tunnel reload) stays a',
  '# human step. Regenerate rather than hand-editing.',
  'ingress:',
  ...rules.flatMap((r) => [
    `  - hostname: ${y(r.hostname)}   # area: ${r.area}`,
    `    service: ${y(r.service)}`,
    ...(r.originRequest ? [
      '    originRequest:',
      `      originServerName: ${y(r.originRequest.originServerName)}`,
      ...(r.originRequest.caPool ? [`      caPool: ${y(r.originRequest.caPool)}`] : []),
    ] : []),
  ]),
  '',
].join('\n');

console.log('\n--- generated ingress fragment ---');
console.log(fragment);

// Exit 3 when anything was withheld: "output is incomplete", distinct from 2 ("nothing generated").
const DONE = withheld.length ? 3 : 0;
if (WRITE === undefined) {
  console.log('(dry run — pass --write <path> to save the fragment; merging it into the box config');
  console.log(' and reloading the tunnel stays yours)');
  if (withheld.length) console.error(`deploy: ${withheld.length} area(s) withheld — the fragment above is INCOMPLETE.`);
  process.exit(DONE);
}

// The write path stays fail-closed: the per-area skip applies to LOOKING, not to producing an
// artifact. An incomplete fragment merged wholesale drops the withheld hostname. Seeing is safe;
// writing is not, so --write refuses until the withheld area is resolved.
if (withheld.length) {
  console.error(`deploy: REFUSING --write — ${withheld.length} area(s) are withheld, so this fragment is INCOMPLETE.`);
  console.error('Writing it risks a merge that drops the withheld hostname(s) from a tunnel launchd');
  console.error('reloads unattended. Resolve the authAt declaration, or write nothing.');
  console.error('(The dry run above still shows every rule that WOULD be emitted.)');
  process.exit(2);
}

if (!rules.length) { console.log('deploy: no public rules — nothing to write'); process.exit(DONE); }

// The operator names the destination. The containment check runs on REAL paths, not the typed
// string: `resolve()` folds `.`/`..` but resolves no symlinks and no case, both of which have been
// used to land a file in ~/.cloudflared. So: realpath the existing parent, refuse a symlinked
// final component, rebuild the landing name, and compare against every forbidden dir — resolved
// AND literal, case-folded per platform. Every step fails CLOSED.
const refuse = (...lines) => { for (const l of lines) console.error(l); process.exit(2); };
const target = resolve(WRITE);
const parentDir = dirname(target);
if (!existsSync(parentDir)) refuse(`deploy: REFUSED — parent directory ${parentDir} does not exist (not creating directories for you)`);
// An unresolvable parent is refused, never waved through on the literal string.
let realParent;
try { realParent = realpathSync.native(parentDir); }
catch (e) { refuse(`deploy: REFUSED — cannot resolve ${parentDir} (${e.code || e.message}); refusing rather than trusting the literal path`); }

// A symlinked TARGET is refused outright: the final component is a link the resolved parent knows
// nothing about, and it may dangle. A fragment has no reason to be written through a link.
let targetLink = null;
try { targetLink = lstatSync(target); }
catch (e) { if (e.code !== 'ENOENT') refuse(`deploy: REFUSED — cannot stat ${target} (${e.code || e.message}); refusing rather than writing blind`); }
if (targetLink?.isSymbolicLink()) {
  refuse(`deploy: REFUSED — ${target} is a symlink, and a link's far end is not covered by the`,
    'containment check above. Writing through it could be APPLYING, which stays human. Name the real',
    'path you want the fragment at.');
}
// The landing name, resolved: real parent + literal last component. Checking this also catches
// `--write ~/.cloudflared` itself.
const realTarget = join(realParent, basename(target));

const caseless = process.platform === 'darwin' || process.platform === 'win32';
const norm = (p) => (caseless ? p.toLowerCase() : p);
// LaunchAgents is here because installing a plist there is scheduling, not generating; the
// Homebrew dir is absent until someone `brew install cloudflared`s.
const FORBIDDEN = [
  { path: join(homedir(), '.cloudflared'), why: 'where the cloudflared daemon reads its config' },
  { path: join(homedir(), 'Library', 'LaunchAgents'), why: 'where launchd reads the jobs it starts at login' },
  { path: '/etc/cloudflared', why: 'where the cloudflared daemon reads its config' },
  { path: '/usr/local/etc/cloudflared', why: 'where the cloudflared daemon reads its config' },
  { path: '/opt/homebrew/etc/cloudflared', why: 'where the cloudflared daemon reads its config' },
];
const inside = (child, parent) => {
  const rel = relative(norm(parent), norm(child));
  return rel === '' || (!rel.startsWith('..' + sep) && rel !== '..' && !isAbsolute(rel));
};
// A forbidden dir that does not exist YET is still enforced: resolve the deepest existing ancestor
// and re-join the missing tail (on macOS /etc is a symlink to /private/etc). The literal string is
// compared too — the union can only refuse more.
const canonical = (p) => {
  const tail = [];
  let cur = resolve(p);
  for (let i = 0; i < 64; i++) {
    if (existsSync(cur)) { try { return join(realpathSync.native(cur), ...tail); } catch { return resolve(p); } }
    const up = dirname(cur);
    if (up === cur) return resolve(p); // walked to the root without finding anything that exists
    tail.unshift(basename(cur));
    cur = up;
  }
  return resolve(p);
};
for (const f of FORBIDDEN) {
  for (const dir of new Set([canonical(f.path), resolve(f.path)])) {
    if (inside(realTarget, dir)) {
      refuse(`deploy: REFUSED — ${target} resolves inside ${dir},`,
        `${f.why}. Writing there is APPLYING, which stays human. Name a path of your own and`,
        'merge the fragment into the box config yourself.');
    }
  }
}
writeFileSync(target, fragment);
console.log(`wrote ${target} (fragment only — the merge into the tunnel config and the reload are yours)`);
