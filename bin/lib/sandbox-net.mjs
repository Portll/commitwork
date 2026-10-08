#!/usr/bin/env node
/**
 * The network half of the Linux host sandbox for a lane whose egress is not `none`. bwrap alone
 * either severs the network (--unshare-net) or shares the host's network namespace, and a shared
 * namespace cannot filter destinations: repo code reached host loopback, every port of it, and
 * abstract unix sockets (review 2026-10-07 D1). This gives the lane its own network namespace and
 * connects it to the internet through pasta (package passt), a user-mode stack that opens ordinary
 * sockets on the host for the lane's traffic and maps nothing local unless told to.
 *
 * Invoked by hostSandboxArgv, never by hand:
 *   node sandbox-net.mjs [--loopback 8080,8443] -- bwrap … --unshare-net --info-fd 3 --block-fd 4 … -- sh -c CMD
 *
 * bwrap creates the namespaces and holds the command at --block-fd; pasta attaches to the sandbox's
 * pid and configures the namespace; only then is the command released. If pasta is absent or fails,
 * the command never runs and this exits NOT_RUN with the reason on stderr, which is what the
 * runner's preflight reports as a refusal. There is no fallback to the host network.
 *
 * fact: pasta forwards ns loopback to host loopback for EVERY host-bound port unless -T says otherwise / its -T default is `auto`, so each forwarding option is spelled out as `none` (expiry: never, prev: broken)
 * fact: pasta and not slirp4netns / under slirp4netns --disable-host-loopback a lane still connected to the host's own address, measured 2026-10-07 in a bookworm container; pasta copies the host address into the namespace, where it is local (expiry: never, prev: unknown)
 * fact: outbound sockets are bound to the default-route interface / without it a lane connected to the host's address on a second interface (a docker bridge), measured 2026-10-07 (expiry: never, prev: broken)
 * fact: DNS goes through pasta's --dns-forward and a resolv.conf naming that address / a host resolver on loopback (systemd-resolved 127.0.0.53, Docker 127.0.0.11) is unreachable from a separate namespace, and pasta 0.0~git20230309 and 20240220 both forwarded the query to it, measured 2026-10-07 (expiry: never, prev: missing)
 */
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, constants } from 'node:os';
import { join } from 'node:path';
import { isMainModule } from '../../lib/is-main.mjs';

/** The namespace-side resolver address; pasta answers it by querying the host's resolver. */
export const DNS_FORWARD = '169.254.1.1';
/** Exit status when the command was never started. */
export const NOT_RUN = 125;
const READY_MS = 10_000;

/** -> {loopback:number[], bwrap:string[]}; throws on anything it was not built to receive. */
export function parseArgs(argv) {
  const sep = argv.indexOf('--');
  if (sep < 0) throw new Error('sandbox-net: usage: sandbox-net.mjs [--loopback PORTS] -- bwrap …');
  const own = argv.slice(0, sep); const bwrap = argv.slice(sep + 1);
  let loopback = [];
  for (let i = 0; i < own.length; i++) {
    if (own[i] === '--loopback' && i + 1 < own.length) {
      loopback = own[++i].split(',').map(Number);
      if (!loopback.length || loopback.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) throw new Error(`sandbox-net: --loopback takes ports 1-65535, got ${JSON.stringify(own[i])}`);
    } else throw new Error(`sandbox-net: unknown option ${JSON.stringify(own[i])}`);
  }
  const has = (...seq) => bwrap.some((_, i) => seq.every((s, j) => bwrap[i + j] === s));
  if (!/(^|\/)bwrap$/.test(bwrap[0] || '') || !has('--unshare-net') || !has('--info-fd', '3') || !has('--block-fd', '4')) {
    throw new Error('sandbox-net: the wrapped argv must be bwrap with --unshare-net --info-fd 3 --block-fd 4, or the command could start before its network exists');
  }
  return { loopback, bwrap };
}

/** The interfaces carrying the default routes, read from /proc/net/route and /proc/net/ipv6_route text. */
export function defaultRouteIfaces({ route = '', route6 = '' } = {}) {
  let v4 = null; let v6 = null;
  for (const line of route.split('\n').slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length >= 8 && f[1] === '00000000' && f[7] === '00000000' && (parseInt(f[3], 16) & 1) && f[0] !== 'lo') { v4 = f[0]; break; }
  }
  for (const line of route6.split('\n')) {
    const f = line.trim().split(/\s+/);
    if (f.length >= 10 && /^0{32}$/.test(f[0]) && f[1] === '00' && (parseInt(f[8], 16) & 1) && f[9] !== 'lo') { v6 = f[9]; break; }
  }
  return { v4, v6 };
}

/** pasta's argv: attach to `pid`, forward nothing in, forward to host loopback only the declared ports. */
export function pastaArgs({ pid, loopback = [], v4 = null, v6 = null, pidFile }) {
  return [
    '--config-net', '--quiet', '--foreground', '--no-map-gw',
    '--tcp-ports', 'none', '--udp-ports', 'none',
    '--tcp-ns', loopback.length ? loopback.join(',') : 'none', '--udp-ns', 'none',
    '--dns-forward', DNS_FORWARD,
    ...(v4 ? ['--outbound-if4', v4] : []), ...(v6 ? ['--outbound-if6', v6] : []),
    '--pid', pidFile, String(pid),
  ];
}

/** The lane's resolv.conf: the host's, with every nameserver replaced by the forwarded address. */
export function resolvConf(hostText = '') {
  const kept = hostText.split('\n').filter((l) => /^\s*(search|domain|options)\s/.test(l));
  return [`nameserver ${DNS_FORWARD}`, ...kept, ''].join('\n');
}

const readOr = (p) => { try { return readFileSync(p, 'utf8'); } catch { return ''; } };

function main() {
  const say = (msg) => process.stderr.write(`${msg}\n`);
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { say(e.message); process.exitCode = NOT_RUN; return; }
  const dir = mkdtempSync(join(tmpdir(), 'cw-netns-'));
  const pidFile = join(dir, 'pasta.pid');
  const data = opts.bwrap.some((a, i) => a === '--ro-bind-data' && opts.bwrap[i + 1] === '5');
  const b = spawn(opts.bwrap[0], opts.bwrap.slice(1), { stdio: ['inherit', 'inherit', 'inherit', 'pipe', 'pipe', data ? 'pipe' : 'ignore'] });
  let pasta = null; let refused = null; let poll = null; let released = false; let child = null;
  // fact: a refusal kills the held child by pid as well as bwrap / bwrap's --die-with-parent takes effect only after --block-fd, so a child still held there outlived a SIGKILLed bwrap, kept the pipes open and hung this helper, measured 2026-10-07 under bwrap 0.8 (expiry: never, prev: broken)
  // Closing --block-fd instead would RELEASE it: EOF reads as ready.
  // Only a pid whose parent is this bwrap is killed: the info fd is the only witness to it.
  const ownChild = () => { try { return Number(readFileSync(`/proc/${child}/stat`, 'utf8').replace(/^.*\)\s+\S+\s+/s, '').split(' ')[0]) === b.pid; } catch { return false; } };
  const killHeld = () => { if (child && !released && ownChild()) { try { process.kill(child, 'SIGKILL'); } catch { /* already gone */ } } };
  const refuse = (why) => {
    if (refused || released) return;
    refused = why;
    say(`sandbox-net: ${why}; the lane was not run, and never on the host network`);
    killHeld();
    b.kill('SIGKILL');
  };
  b.on('error', (e) => { refused = refused || `${opts.bwrap[0]}: ${e.code || e.message}`; say(`sandbox-net: ${refused}`); process.exitCode = NOT_RUN; });
  if (data) b.stdio[5].end(resolvConf(readOr('/etc/resolv.conf')));
  let info = '';
  b.stdio[3].on('data', (d) => {
    info += d;
    const m = /"child-pid"\s*:\s*(\d+)/.exec(info);
    if (!m || pasta) return;
    child = Number(m[1]);
    const ifs = defaultRouteIfaces({ route: readOr('/proc/net/route'), route6: readOr('/proc/net/ipv6_route') });
    let err = '';
    pasta = spawn('pasta', pastaArgs({ pid: child, loopback: opts.loopback, ...ifs, pidFile }), { stdio: ['ignore', 'ignore', 'pipe'] });
    pasta.stderr.on('data', (x) => { err += x; });
    pasta.on('error', (e) => refuse(e.code === 'ENOENT'
      ? 'pasta is not installed (package passt), so an open lane has no network namespace of its own'
      : `pasta: ${e.code || e.message}`));
    pasta.on('exit', (code, sig) => {
      if (!released) refuse(`pasta exited ${code ?? sig} before the namespace was ready: ${err.trim().split('\n').filter((l) => !/syslog/.test(l)).pop() || 'no stderr'}`);
    });
    // fact: pasta writes its pid file only after it has configured the namespace, in foreground mode too / measured on both packaged versions 2026-10-07, with the routes already present when it appeared (expiry: never, prev: missing)
    const t0 = Date.now();
    poll = setInterval(() => {
      if (refused) { clearInterval(poll); return; }
      if (readOr(pidFile).trim()) { clearInterval(poll); released = true; b.stdio[4].end('1'); return; }
      if (Date.now() - t0 > READY_MS) { clearInterval(poll); refuse(`pasta did not configure the namespace within ${READY_MS / 1000}s`); }
    }, 5);
  });
  for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(s, () => { killHeld(); b.kill(s); });
  b.on('close', (code, sig) => {
    if (poll) clearInterval(poll);
    if (pasta && pasta.exitCode === null && pasta.signalCode === null) pasta.kill('SIGTERM');
    for (const i of [3, 4, 5]) if (b.stdio[i]) b.stdio[i].destroy();
    rmSync(dir, { recursive: true, force: true });
    process.exitCode = refused ? NOT_RUN : (code ?? 128 + (constants.signals[sig] || 0));
    for (const s of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.removeAllListeners(s);
  });
}

if (isMainModule(import.meta.url)) main();
