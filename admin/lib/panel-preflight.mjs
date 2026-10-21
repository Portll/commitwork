// usage: node admin/lib/panel-preflight.mjs <entry> — exit 0 safe to restart, 1 not
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { extract, importBindings } from '../../codegraph/lexical.mjs';
import { isMainModule } from '../../lib/is-main.mjs';
import { importClosure } from './panel-closure.mjs';

const READY = /^cw-panel-preflight: ready (.*)$/m;

// contract: every store the boot writes resolves inside scratch; ports are the OS's ephemeral pick
export function bootEnv(scratch, base = process.env) {
  const env = { ...base };
  delete env.CW_PANEL_SUPERVISED;
  const tmp = join(scratch, 'tmp');
  return Object.assign(env, {
    CW_PANEL_PREFLIGHT: '1', CW_ADMIN_PORT: '0', CW_ADMIN_LOCAL_PORT: '0',
    HOME: scratch, USERPROFILE: scratch, TMPDIR: tmp, TMP: tmp, TEMP: tmp,
    CW_AUTH_STORE: join(scratch, 'users.json'),
    CW_SESSION_STORE: join(scratch, 'sessions.json'),
    CW_HEALTH_RUNS_STORE: join(scratch, 'health-runs.json'),
    CW_PANEL_CODE_STAMP: join(scratch, 'code-stamp.json'),
    DOCKER_CONFIG: join(scratch, 'docker'), CW_DOCKER_CONFIG: join(scratch, 'docker'),
  });
}

// fact: node reports an uncaught throw as `<Name>: <message>` then `    at <frame>` lines
function exitReason(stderr, code) {
  const lines = stderr.split(/\r?\n/);
  const listen = lines.find((l) => /listener failed:/.test(l));
  if (listen) return `listen failure: ${listen.replace(/^.*listener failed:\s*/, '')}`;
  const at = lines.findIndex((l) => /^\s+at /.test(l));
  if (at > 0) {
    let msg = at - 1;
    while (msg > 0 && !/^[\w.$]+( \[\w+\])?:/.test(lines[msg])) msg--;
    return `threw at top level: ${lines[msg].trim()} (${lines[at].trim()})`;
  }
  const said = lines.find((l) => /refus|error|fail/i.test(l)) || lines.filter((l) => l.trim()).pop();
  return `exited ${code}${said ? `: ${said.trim()}` : ' with no output'}`;
}

// contract: booted under bootEnv, the entry prints the ready line and exits 0 within timeoutMs
export function bootCheck(entry, { timeoutMs = +(process.env.CW_PANEL_PREFLIGHT_TIMEOUT_MS || 20_000), base = process.env } = {}) {
  const scratch = mkdtempSync(join(tmpdir(), 'cw-panel-preflight-'));
  const env = bootEnv(scratch, base);
  mkdirSync(env.TMPDIR);
  const started = Date.now();
  return new Promise((done) => {
    let out = '', err = '', timedOut = false, settled = false;
    const child = spawn(process.execPath, [resolve(entry)], { cwd: scratch, env, stdio: ['ignore', 'pipe', 'pipe'] });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    const finish = (verdict) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rmSync(scratch, { recursive: true, force: true });
      done({ ...verdict, ms: Date.now() - started, scratch, env });
    };
    const verdict = (code, signal) => {
      const ready = READY.exec(out);
      if (ready && code === 0) {
        try { return { ok: true, ports: JSON.parse(ready[1]).ports }; }
        catch (e) { return { ok: false, reason: `malformed ready line (${e.message})` }; }
      }
      if (ready) return { ok: false, reason: timedOut ? `bound both listeners but did not exit within ${timeoutMs}ms` : `bound both listeners, then exited ${code ?? signal}` };
      if (timedOut) return { ok: false, reason: `timed out: no ready signal and no exit within ${timeoutMs}ms` };
      if (signal) return { ok: false, reason: `killed by ${signal}` };
      if (code === 0) return { ok: false, reason: 'exited 0 without binding both listeners' };
      return { ok: false, reason: exitReason(err, code) };
    };
    child.on('error', (e) => finish({ ok: false, reason: `could not start: ${e.message}` }));
    // an orphan holding the child's stdio would keep 'close' from ever firing
    child.on('exit', (code, signal) => {
      const grace = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); finish(verdict(code, signal)); }, 500);
      child.once('close', () => { clearTimeout(grace); finish(verdict(code, signal)); });
    });
  });
}

// contract: every closure module loads; entry's named imports exist; then the entry boots
export async function preflight(entry, bootOpts) {
  const abs = resolve(entry);
  const problems = [];
  const syntax = spawnSync(process.execPath, ['--check', abs], { encoding: 'utf8' });
  if (syntax.status !== 0) problems.push(`${abs}: does not parse — ${(syntax.stderr || '').trim().split('\n')[0]}`);
  const { files, unknown } = importClosure(abs);
  for (const u of unknown) problems.push(`${u.file}: could not be read (${u.reason})`);
  for (const f of files) {
    if (f === abs) continue;
    try { await import(pathToFileURL(f).href); } catch (e) { problems.push(`${f}: ${e.message}`); }
  }
  const src = readFileSync(abs, 'utf8');
  const lexed = extract(src);
  if (!lexed.ok) problems.push(`${abs}: could not be lexed (${lexed.reason})`);
  else {
    for (const b of importBindings(lexed.masked, src)) {
      if (b.kind !== 'named' && b.kind !== 'default') continue;
      const target = /^\.\.?\//.test(b.spec) ? pathToFileURL(resolve(dirname(abs), b.spec)).href : b.spec;
      let ns;
      try { ns = await import(target); } catch (e) { problems.push(`${b.spec}: ${e.message}`); continue; }
      if (!(b.exported in ns)) problems.push(`${b.spec} does not export '${b.exported}'`);
    }
  }
  if (problems.length) return { ok: false, checked: files.length, problems, boot: null };
  const boot = await bootCheck(abs, bootOpts);
  if (!boot.ok) problems.push(`${abs}: does not boot — ${boot.reason}`);
  return { ok: problems.length === 0, checked: files.length, problems, boot };
}

if (isMainModule(import.meta.url)) {
  const r = await preflight(process.argv[2]);
  const msg = r.ok
    ? `preflight: ${r.checked} modules link; booted on ports ${r.boot.ports} in ${r.boot.ms}ms\n`
    : `${r.problems.join('\n')}\n`;
  // exit only once the pipe has the verdict; the restart route reads it
  (r.ok ? process.stdout : process.stderr).write(msg, () => process.exit(r.ok ? 0 : 1));
}
