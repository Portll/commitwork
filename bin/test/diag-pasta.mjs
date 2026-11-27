// Diagnostic branch only, never merged: a networked lane's name resolution under pasta argument variants.
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostSandboxArgv } from '../lib/sandbox.mjs';

const CW = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const T = realpathSync(mkdtempSync(join(tmpdir(), 'cw-diag-')));
const repo = join(T, 'repo'); const report = join(T, 'report');
mkdirSync(repo); mkdirSync(report);
const spec = {
  egress: 'registry', repoPath: repo, reportDir: report, platform: 'linux', cwRoot: realpathSync(CW),
  nodePrefix: dirname(dirname(realpathSync(process.execPath))), tmpDir: realpathSync(tmpdir()), home: homedir(),
};
const PROBE = `import dns from 'node:dns';
import net from 'node:net';
import { readFileSync } from 'node:fs';
const out = {};
out.resolv = readFileSync('/etc/resolv.conf', 'utf8').split('\\n').filter((l) => /^nameserver/.test(l)).join(';');
for (const s of JSON.parse(process.argv[2])) {
  const r = new dns.promises.Resolver({ timeout: 2500, tries: 1 });
  r.setServers([s]);
  const t0 = Date.now();
  out['udp ' + s] = await r.resolve4('semgrep.dev').then(() => 'OK ' + (Date.now() - t0) + 'ms', (e) => e.code + ' ' + (Date.now() - t0) + 'ms');
}
const t1 = Date.now();
out.lookup = await Promise.race([dns.promises.lookup('semgrep.dev').then(() => 'OK ' + (Date.now() - t1) + 'ms', (e) => e.code), new Promise((r) => setTimeout(() => r('TIMEOUT'), 8000).unref())]);
out.tcp = await new Promise((r) => {
  const s = net.connect({ host: '1.1.1.1', port: 443 });
  s.once('connect', () => { s.destroy(); r('CONNECTED'); });
  s.once('error', (e) => r(e.code));
  setTimeout(() => { s.destroy(); r('TIMEOUT'); }, 4000).unref();
});
console.log(JSON.stringify(out));
`;
const probe = join(report, 'probe.mjs');
writeFileSync(probe, PROBE);

const up = (() => {
  try { return readFileSync('/run/systemd/resolve/resolv.conf', 'utf8').split('\n').map((l) => /^nameserver\s+(\S+)/.exec(l)?.[1]).filter((a) => a && !a.startsWith('127.') && !a.includes(':'))[0] || null; } catch { return null; }
})();
const servers = ['169.254.1.1', ...(up ? [up] : []), '1.1.1.1'];
const cmd = `"${process.execPath}" "${probe}" '${JSON.stringify(servers)}'`;
const go = (argv, env) => new Promise((r) => {
  const c = spawn(argv[0], argv.slice(1), { env }); let o = ''; let e = '';
  c.stdout.on('data', (d) => { o += d; }); c.stderr.on('data', (d) => { e += d; });
  c.on('close', (status) => r({ status, out: o.trim(), err: e.trim() }));
});

const VARIANTS = {
  'A product': {},
  'B without --outbound-if4': { DIAG_DROP: '--outbound-if4' },
  'C with --dns-host upstream': up ? { DIAG_ADD: `--dns-host ${up}` } : null,
  'D without --no-map-gw': { DIAG_DROP: '--no-map-gw' },
  'E resolv.conf names the upstream': up ? { DIAG_RESOLV: up } : null,
  'F with --outbound 127.0.0.1': { DIAG_ADD: '--outbound 127.0.0.1' },
};
console.log(`upstream=${up} servers=${servers.join(',')}`);
const { argv } = hostSandboxArgv({ ...spec, cmd });
console.log(`argv: ${argv.slice(0, 6).join(' ')} …`);
for (const [name, env] of Object.entries(VARIANTS)) {
  if (!env) { console.log(`== ${name}: skipped, no upstream resolver known`); continue; }
  const log = join(T, `${name[0]}.log`);
  writeFileSync(log, '');
  const r = await go(argv, { ...process.env, ...env, DIAG_LOG: log });
  console.log(`== ${name}: exit=${r.status} ${r.out || `(no output) ${r.err.split('\n').slice(-3).join(' | ')}`}`);
  const lines = readFileSync(log, 'utf8').split('\n');
  const hits = lines.filter((l) => /dns|resolv|:53\b|bind|fail|error|warn|unreach|invalid|outbound|NAT|Flow \d+ \(/i.test(l));
  for (const l of hits.slice(0, name[0] === 'A' ? 90 : 25)) console.log(`   ${l}`);
  console.log(`   (${lines.length} debug lines, ${hits.length} matched)`);
}
