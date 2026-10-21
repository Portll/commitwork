// monitor/mcp-tools-probe.mjs — what the MCP servers a developer has configured TELL the model.
// agent-config.mjs judges a server's declaration (command, host, env); this starts each stdio
// server under the host sandbox with no network, asks it tools/list, and runs the instruction rules
// over every tool description and parameter description it returns. A tool description is read by
// the model on every turn, so a directive planted there is indirect injection with nothing in the
// repository to find.

// Servers are launched with the environment they declare, inside the host sandbox: the credential
// stores are denied, egress is `none` unless --egress names a class, and the cwd is a fresh scratch
// directory. A server that needs the network to start (npx with nothing cached) is `not-probed`
// with its reason, never a clean one; so is every server when the sandbox is unavailable.
// CW_MCP_PROBE_UNCONFINED=1 runs them bare and says so on every row. A server a scanned
// repository declares (--root) runs that repository's command, so it is not-probed unless
// --trust-repo-servers is passed, as a repo-local manifest needs --trust-repo-manifest.

//   node monitor/mcp-tools-probe.mjs [--root <repo> [--trust-repo-servers]] [--egress none|registry] [--json]
//
// env (read at call time): CW_AGENT_CONFIG_HOME (default the home directory), CW_MCP_PROBE_TIMEOUT_MS
//   (default 20000 per server), CW_MCP_PROBE_UNCONFINED, CW_NOW
// exit: 0 probed and clean · 21 findings · 2 nothing probed
import { readFileSync, existsSync, mkdtempSync, realpathSync, rmSync, mkdirSync, statSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { homedir, tmpdir } from 'node:os';
import { join, dirname, basename, resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMainModule } from '../lib/is-main.mjs';
import { nowISO } from '../lib/clock.mjs';
import { parseJsonc, shownName } from '../bin/agent-config.mjs';
import { scanText } from '../bin/agent-instructions.mjs';
import { detectInjection } from '../lib/untrusted-text.mjs';
import { hostSandboxArgv, probeHostSandbox, preflightHostSandbox, shellQuote, assertMountAllowed } from '../bin/lib/sandbox.mjs';
import { userFileDocs } from './agent-config-host.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const EXIT = Object.freeze({ clean: 0, findings: 21, nothingProbed: 2 });
const timeoutMs = (env) => { const n = Number(env.CW_MCP_PROBE_TIMEOUT_MS); return Number.isFinite(n) && n > 0 ? n : 20_000; };
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

const serversIn = (doc, source) => {
  const out = [];
  for (const block of ['mcpServers', 'servers']) {
    if (!isObj(doc[block])) continue;
    for (const [name, srv] of Object.entries(doc[block])) {
      if (!isObj(srv)) continue;
      const kind = typeof srv.command === 'string' ? 'stdio' : srv.url ? 'remote' : 'unknown';
      out.push({ name, source, kind, command: srv.command, args: Array.isArray(srv.args) ? srv.args.map(String) : [], env: isObj(srv.env) ? srv.env : {} });
    }
  }
  return out;
};
const readJson = (p) => { try { return existsSync(p) ? parseJsonc(readFileSync(p, 'utf8')) : null; } catch (e) { return { error: e.code || e.message }; } };

/** Every MCP server declared in the user scope and, when given, a repository. */
export function enumerateServers({ home = homedir(), repo = null } = {}) {
  const servers = []; const unreadable = [];
  const user = join(home, '.claude.json');
  if (existsSync(user)) {
    let text = null;
    try { text = readFileSync(user, 'utf8'); } catch (e) { unreadable.push({ file: '.claude.json', why: e.code || 'ERROR' }); }
    if (text !== null) {
      const u = userFileDocs(text);
      if (u.error !== undefined) unreadable.push({ file: '.claude.json', why: 'unparseable' });
      else for (const d of u.docs) servers.push(...serversIn(d.doc, `~/${d.rel}`));
    }
  }
  const files = [[home, '.cursor/mcp.json', '~/'], ...(repo ? [[repo, '.mcp.json', ''], [repo, '.cursor/mcp.json', ''], [repo, '.vscode/mcp.json', ''], [repo, '.claude/settings.json', ''], [repo, '.claude/settings.local.json', '']] : [])];
  for (const [base, rel, prefix] of files) {
    const parsed = readJson(join(base, rel));
    if (!parsed) continue;
    if (parsed.error !== undefined || !isObj(parsed.value)) { unreadable.push({ file: `${prefix}${rel}`, why: 'unparseable' }); continue; }
    servers.push(...serversIn(parsed.value, `${prefix}${rel}`).map((s) => (base === repo ? { ...s, fromRepo: true } : s)));
  }
  return { servers: servers.sort((a, b) => a.source.localeCompare(b.source) || a.name.localeCompare(b.name)), unreadable };
}

const which = (cmd) => {
  if (isAbsolute(cmd)) return cmd;
  const r = spawnSync('which', [cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim().split('\n')[0] : null;
};
const realOr = (p) => { try { return realpathSync(p); } catch { return p; } };

// guard: an argument opens a read only below home's level and outside every credential store / `"args": ["/"]` would make the whole disk readable to the server (expiry: never, prev: broken)
export function argReadAllowed(p, home) {
  const h = realOr(home);
  if (p === h || h.startsWith(`${p}/`)) return false;
  try { assertMountAllowed(p); return true; } catch { return false; }
}
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** The sandbox spec for one server: scratch cwd, the command's own directory readable, nothing else of the user's. */
export function sandboxSpec(server, { scratch, home, egress }) {
  const bin = which(server.command);
  const reads = new Set([join(home, '.npm'), join(home, '.local', 'bin'), join(home, '.cache')]);
  if (bin) reads.add(dirname(realOr(bin)));
  for (const a of server.args) {
    if (!isAbsolute(a) || !existsSync(a)) continue;
    const p = realOr(isDir(a) ? a : dirname(a));
    if (argReadAllowed(p, home)) reads.add(p);
  }
  return {
    egress, repoPath: scratch, reportDir: join(scratch, 'report'), tmpDir: realOr(tmpdir()), home, platform: process.platform,
    cwRoot: realOr(ROOT), nodePrefix: dirname(dirname(realOr(process.execPath))), toolPrefixes: [], extraReads: [...reads].filter(existsSync).sort(), extraWrites: [],
  };
}

const RPC = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'commitwork-mcp-tools-probe', version: '1' } } },
  { jsonrpc: '2.0', method: 'notifications/initialized' },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
];

/** Start argv, speak the three frames, resolve with the tools/list result or a reason. */
export function speak(argv, { env, cwd, timeout }) {
  return new Promise((done) => {
    let child;
    try { child = spawn(argv[0], argv.slice(1), { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] }); } catch (e) { return done({ ok: false, why: `spawn: ${e.message}` }); }
    let out = ''; let err = ''; let settled = false;
    const finish = (r) => { if (settled) return; settled = true; clearTimeout(timer); try { child.kill('SIGKILL'); } catch { /* gone */ } done(r); };
    // a server's stderr is its own text and can carry what it read, so only its size is reported
    const said = () => (err.length ? ` (stderr: ${Buffer.byteLength(err)} bytes, not reproduced)` : '');
    const timer = setTimeout(() => finish({ ok: false, why: `no tools/list answer within ${timeout}ms${said()}` }), timeout);
    child.on('error', (e) => finish({ ok: false, why: `spawn: ${e.code || e.message}` }));
    // a server's log colours its stderr; the reason line is read by a person and by a JSON consumer
    child.stderr.on('data', (d) => { if (err.length < 65536) err += String(d).replace(/\x1b\[[0-9;]*[A-Za-z]/g, ''); });
    child.stdout.on('data', (d) => {
      out += d;
      let i;
      while ((i = out.indexOf('\n')) >= 0) {
        const line = out.slice(0, i); out = out.slice(i + 1);
        let m; try { m = JSON.parse(line); } catch { continue; }
        if (m && m.id === 2) {
          if (m.error) return finish({ ok: false, why: `tools/list error: ${String(m.error.message || m.error.code).slice(0, 160)}` });
          const tools = m.result && Array.isArray(m.result.tools) ? m.result.tools : null;
          return tools ? finish({ ok: true, tools }) : finish({ ok: false, why: 'tools/list answered without a tools array' });
        }
      }
    });
    child.on('exit', (code, signal) => finish({ ok: false, why: `exited ${signal || code} before answering tools/list${said()}` }));
    for (const f of RPC) child.stdin.write(`${JSON.stringify(f)}\n`);
  });
}

/** Judge one server's tool list: instruction rules over every description, injection signals beside them. */
export function judgeTools(server, tools) {
  const findings = []; const signals = [];
  for (const t of tools) {
    const name = shownName(String(t.name || '?'));
    const texts = [String(t.description || '')];
    const props = t.inputSchema && isObj(t.inputSchema.properties) ? t.inputSchema.properties : {};
    for (const [k, v] of Object.entries(props)) if (isObj(v) && typeof v.description === 'string') texts.push(`${k}: ${v.description}`);
    const text = texts.join('\n');
    for (const f of scanText(`${name}.md`, text, { addressed: true })) findings.push({ tool: name, rule: f.rule, sev: f.sev, cwe: f.cwe, detail: f.detail });
    for (const s of detectInjection(text).signals) signals.push({ tool: name, id: s.id, why: s.why });
  }
  return { tools: tools.length, toolNames: tools.map((t) => shownName(String(t.name || '?'))).sort(), findings, signals };
}

export async function runProbe({ home = null, repo = null, trustRepo = false, egress = 'none', env = process.env } = {}) {
  const now = nowISO(env);
  const h = home || env.CW_AGENT_CONFIG_HOME || homedir();
  const { servers, unreadable } = enumerateServers({ home: h, repo });
  const unconfined = env.CW_MCP_PROBE_UNCONFINED === '1';
  const sandbox = unconfined ? { available: false, why: 'CW_MCP_PROBE_UNCONFINED=1', developerDir: null } : probeHostSandbox();
  const rows = [];
  for (const s of servers) {
    const row = { name: s.name, source: s.source, kind: s.kind, probed: false, confined: false };
    if (s.kind !== 'stdio') { rows.push({ ...row, why: `${s.kind} server: only stdio servers are probed` }); continue; }
    if (s.fromRepo && !trustRepo) { rows.push({ ...row, why: 'declared by the scanned repository; pass --trust-repo-servers to run its command' }); continue; }
    if (!sandbox.available && !unconfined) { rows.push({ ...row, why: `host sandbox unavailable: ${sandbox.why}; set CW_MCP_PROBE_UNCONFINED=1 to run the server bare` }); continue; }
    const scratch = realpathSync(mkdtempSync(join(tmpdir(), 'cw-mcp-probe-')));
    mkdirSync(join(scratch, 'report'));
    try {
      const cmd = shellQuote([s.command, ...s.args]);
      let argv = ['sh', '-c', cmd];
      if (!unconfined) {
        try {
          const spec = { ...sandboxSpec(s, { scratch, home: h, egress }), developerDir: sandbox.developerDir || null };
          const wrap = hostSandboxArgv({ ...spec, cmd });
          const pre = preflightHostSandbox(wrap);
          if (!pre.ok) { rows.push({ ...row, why: `sandbox profile not applied: ${pre.why}` }); continue; }
          argv = wrap.argv;
        } catch (e) { rows.push({ ...row, why: `sandbox refused: ${e.message}` }); continue; }
      }
      const childEnv = { PATH: process.env.PATH, HOME: h, TMPDIR: scratch, LANG: process.env.LANG || 'C.UTF-8', ...s.env };
      const r = await speak(argv, { env: childEnv, cwd: scratch, timeout: timeoutMs(env) });
      if (!r.ok) { rows.push({ ...row, confined: !unconfined, why: r.why }); continue; }
      rows.push({ ...row, probed: true, confined: !unconfined, ...judgeTools(s, r.tools) });
    } finally { rmSync(scratch, { recursive: true, force: true }); }
  }
  const probed = rows.filter((r) => r.probed);
  const byRule = {};
  for (const r of probed) for (const f of r.findings) byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  return {
    generated: now, egress, unconfined, sandbox: sandbox.available ? 'available' : sandbox.why, unreadable,
    summary: { servers: rows.length, probed: probed.length, notProbed: rows.length - probed.length, tools: probed.reduce((n, r) => n + r.tools, 0), findings: probed.reduce((n, r) => n + r.findings.length, 0), signals: probed.reduce((n, r) => n + r.signals.length, 0), byRule },
    servers: rows,
  };
}

export const exitCodeFor = (r) => (r.summary.probed === 0 ? EXIT.nothingProbed : r.summary.findings > 0 ? EXIT.findings : EXIT.clean);

if (isMainModule(import.meta.url)) {
  const argv = process.argv.slice(2);
  const take = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined; };
  const r = await runProbe({ repo: take('--root') || null, trustRepo: argv.includes('--trust-repo-servers'), egress: take('--egress') || 'none' });
  if (argv.includes('--json')) console.log(JSON.stringify(r, null, 2));
  else {
    const s = r.summary;
    console.log(`mcp-tools-probe: ${s.probed} of ${s.servers} server(s) probed${r.unconfined ? ' UNCONFINED' : ` under the host sandbox (egress ${r.egress})`}, ${s.tools} tool(s) read — ${s.findings} finding(s) ${JSON.stringify(s.byRule)}, ${s.signals} signal(s)`);
    for (const row of r.servers) {
      if (!row.probed) { console.log(`  not probed  ${row.name.padEnd(20)} ${row.source}  ${row.why}`); continue; }
      console.log(`  probed      ${row.name.padEnd(20)} ${row.source}  ${row.tools} tool(s)${row.findings.length ? '' : row.signals.length ? `, ${row.signals.length} signal(s)` : ', clean'}`);
      for (const f of row.findings) console.log(`    ${f.sev.padEnd(6)} ${f.rule.padEnd(28)} tool ${f.tool}  ${f.detail}`);
      for (const g of row.signals) console.log(`    signal ${g.id.padEnd(28)} tool ${g.tool}  ${g.why}`);
    }
    for (const u of r.unreadable) console.log(`  unreadable: ${u.file} — ${u.why}`);
    if (!s.probed) console.log('  nothing probed: no server answered, which is not a clean set');
  }
  process.exitCode = exitCodeFor(r);
}
