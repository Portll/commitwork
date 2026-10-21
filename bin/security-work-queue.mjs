#!/usr/bin/env node
// Operator CLI for a dedicated Spine queue. Credentials and run artefacts stay outside the tree.
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { execFileSync, execFile, spawn } from 'node:child_process';
import { PLAN_ID, ROUTE, QUEUE, CORE_PHASES, readyJob, completionText } from './lib/security-work-queue.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { scannedGitOut } from './lib/git-env.mjs';
import { isMainModule } from '../lib/is-main.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => args.includes(name) ? args[args.indexOf(name) + 1] : fallback;
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const spine = resolve(opt('--spine', process.env.CW_SPINE_ROOT || join(root, '..', 'spine')));
const load = p => import(pathToFileURL(join(spine, p)).href);
const git = (cwd, ...a) => scannedGitOut(cwd, a).trim();
const wait = ms => new Promise(r => setTimeout(r, ms));
const betterleaksProducerContext = {
  'betterleaks-report': ['bin/lib/report-parsers/secrets.mjs', 'monitor/extractors/secrets.mjs'],
  'betterleaks-wire': ['bin/lib/sandbox.mjs', 'bin/test/scanner-canary.test.mjs', 'bin/lib/report-parsers/secrets.mjs', 'monitor/secret-verify.mjs', 'manifests/gitleaks.toml', 'bin/test/gitleaks-config.test.mjs'],
  'betterleaks-scoped-sources': ['lib/secrets.mjs', 'bin/lib/sandbox.mjs', 'monitor/secret-verify.mjs', 'monitor/extractors/secrets.mjs'],
};
const producerContextForBetterleaks = key => betterleaksProducerContext[key] || [];
const integration = {
  'betterleaks-wire': ['bin/betterleaks-run.mjs', 'bin/commitwork.mjs', 'bin/lib/report-parsers/secrets.mjs', 'manifests/betterleaks.toml', 'manifests/install-catalog.json', 'manifests/tool-pins.json', 'bin/scanner-preflight.mjs', 'manifests/security-baseline.json', 'monitor/extractors.mjs', 'monitor/extractors/secrets.mjs', 'monitor/scanner-checks.mjs', 'monitor/rollup.mjs', 'bin/test/security-betterleaks-wire.test.mjs'],
  'betterleaks-scoped-sources': ['bin/betterleaks-sources.mjs', 'bin/betterleaks-run.mjs', 'bin/test/security-betterleaks-scoped-sources.test.mjs'],
  'lane-trust-wire': ['monitor/lane-capability.mjs', 'bin/test/security-lane-trust-wire.test.mjs'],
  'agent-config-wire': ['bin/agent-config.mjs', 'bin/test/security-agent-config-wire.test.mjs'],
  'authz-wire': ['bin/bola-run.mjs', 'bin/test/security-authz-wire.test.mjs'],
  'drift-wire': ['monitor/dep-provenance.mjs', 'bin/test/security-drift-wire.test.mjs'],
  'isolation-effects': ['bin/lib/isolation.mjs', 'bin/test/security-isolation-effects.test.mjs'],
  'ledger-wire': ['bin/chain-guard.mjs', 'bin/test/security-ledger-wire.test.mjs'],
  'digest-wire': ['monitor/sweep-health.mjs', 'bin/test/security-digest-wire.test.mjs'],
  'sarif-wire': ['bin/commitwork.mjs', 'bin/test/security-sarif-wire.test.mjs'],
  'mcp-jobs-wire': ['mcp/server.mjs', 'bin/test/security-mcp-jobs-wire.test.mjs'],
  'lane-fixture-completion': ['docs/SECURITY-LANE-FIXTURE-PLAN.md'],
  'machine-history-feed': ['monitor/machine-history-feed.mjs', 'bin/test/security-machine-history-feed.test.mjs'],
  'machine-history-view': ['lib/machine-history-view.mjs', 'bin/test/security-machine-history-view.test.mjs'],
  'machine-history-panel': ['admin/routes/machine-history.mjs', 'admin/serve.mjs', 'admin/menus/navigation.js', 'bin/test/security-machine-history-panel.test.mjs'],
  'agent-permission-effects': ['monitor/agent-permission-effects.mjs', 'bin/agent-config.mjs', 'bin/test/security-agent-permission-effects.test.mjs'],
  'history-behaviour-wire': ['monitor/security-history-comparison.mjs', 'bin/test/security-history-behaviour-wire.test.mjs'],
  'malicious-content-wire': ['monitor/malicious-content-evidence.mjs', 'bin/test/security-malicious-content-wire.test.mjs'],
  'machinery-health-wire': ['monitor/security-machinery-health.mjs', 'bin/test/security-machinery-health-wire.test.mjs'],
};

async function runtime() {
  const dbApi = await load('db.mjs');
  const { loadConfig } = await load('lane/config.mjs');
  const cfg = loadConfig();
  const db = dbApi.open(cfg.store || undefined);
  const repo = cfg.repos.commitwork;
  if (!repo) throw new Error('Spine lane config has no commitwork repository');
  const data = join(cfg.dataDir, 'commitwork-defense');
  return { dbApi, cfg, db, repo, data };
}

function command(binary, argv, options, input) {
  return new Promise((resolvePromise, reject) => {
    const child = execFile(binary, argv, { ...options, maxBuffer: 32 << 20 }, (error, stdout) => {
      if (error) return reject(new Error(`launcher failed (${error.killed ? 'timeout' : error.code})`));
      try { resolvePromise(JSON.parse(stdout)); } catch { reject(new Error('launcher returned malformed JSON')); }
    });
    child.stdin.end(input);
  });
}

export async function localDraft(host, text, ctx) {
  const launcher = await load('spine-qwen/lib/profiles.mjs');
  const { keychainSecret } = await load('prompt-runner.mjs');
  const h = ctx.cfg.hosts[host];
  if (!h) throw new Error(`no configured LM Studio host ${host}`);
  const key = process.env[h.keychain] || keychainSecret(h.keychain);
  if (!key) throw new Error(`no credential for ${host} (Keychain item ${h.keychain})`);
  // Use the Qwen launcher's profile/bootstrap/context preflight, in a worker-owned config directory.
  const profile = launcher.loadProfile('qwen');
  profile.configDir = join(ctx.data, 'profiles', host);
  profile.server = { ...profile.server, baseUrl: h.url.replace(/\/v1\/?$/, '') };
  const oldKey = process.env.SPINE_LLM_API_KEY;
  process.env.SPINE_LLM_API_KEY = key;
  let launched;
  try { launched = await launcher.launchEnv(profile); }
  finally {
    if (oldKey === undefined) delete process.env.SPINE_LLM_API_KEY;
    else process.env.SPINE_LLM_API_KEY = oldKey;
  }
  const settings = JSON.parse(readFileSync(join(profile.configDir, 'settings.json'), 'utf8'));
  settings.env.ANTHROPIC_BASE_URL = profile.server.baseUrl;
  delete settings.env.ANTHROPIC_AUTH_TOKEN;
  writeFileSync(join(profile.configDir, 'settings.json'), JSON.stringify(settings, null, 2) + '\n', { mode: 0o600 });
  const binary = launcher.resolveBinary('claude');
  if (!binary) throw new Error('Claude Code harness not installed');
  const scratch = mkdtempSync(join(tmpdir(), 'cw-defense-prompt-'));
  const envelope = await command(binary, [...launched.args, '-p', '--model', profile.model,
    '--output-format', 'json', '--max-turns', '1', '--tools', '',
    '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', 'user'],
    { cwd: scratch, timeout: 75 * 60 * 1000, env: { ...launched.env,
      ANTHROPIC_AUTH_TOKEN: key, ANTHROPIC_BASE_URL: profile.server.baseUrl } }, text);
  return { text: completionText(envelope), model: profile.model, usage: envelope.usage || null };
}

async function hostedDraft(provider, text, ctx) {
  const { runPrompt, keychainSecret } = await load('prompt-runner.mjs');
  if (provider === 'groq') {
    const r = await runPrompt({ tool: 'lane', context: text, provider: 'groq',
      model: opt('--model', null), reasoning: 'none', env: { ...process.env,
        SPINE_PROMPTS_DIR: join(spine, 'prompts'), VELD_API_KEY: '',
        SPINE_LLM_MAX_TOKENS: '3500', SPINE_LLM_RATE_WAIT_MS: '60000' } });
    return { text: r.response, model: r.model, usage: r.usage };
  }
  const key = process.env.XAI_API_KEY || process.env.GROK_API_KEY ||
    keychainSecret('XAI_API_KEY') || keychainSecret('GROK_API_KEY');
  if (!key) throw new Error('no Grok credential: XAI_API_KEY or GROK_API_KEY');
  const request = async (path, body) => {
    const r = await fetch(`https://api.x.ai/v1/${path}`, { method: body ? 'POST' : 'GET',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(300000) });
    if (!r.ok) throw new Error(`Grok ${path}: HTTP ${r.status}`);
    return r.json();
  };
  const listed = (await request('models')).data?.map(m => m.id) || [];
  const model = opt('--model', process.env.CW_GROK_MODEL || listed.filter(m => /^grok-/.test(m) && !/image|video|vision/.test(m)).sort()[0]);
  if (!model || !listed.includes(model)) throw new Error('requested Grok model is not listed by provider');
  const r = await request('chat/completions', { model, messages: [{ role: 'user', content: text }], max_tokens: 8000 });
  return { text: completionText(r), model, usage: r.usage || null };
}

async function runWorker(worker, ctx) {
  if (!['qwen-local', 'qwen-m4', 'groq', 'grok'].includes(worker)) throw new Error(`unknown worker ${worker}`);
  const bank = await load('lane/bank.mjs');
  const gates = await load('lane/gate.mjs');
  const prompts = await load('lane/prompts.mjs');
  mkdirSync(ctx.data, { recursive: true });
  const lock = await load('lane/run.mjs');
  if (!lock.lockName(join(ctx.data, 'locks'), worker)) throw new Error(`${worker} already running`);
  const statusFile = join(ctx.data, `${worker}.json`);
  const record = state => writeAtomic(statusFile, JSON.stringify({ worker, pid: process.pid, at: new Date().toISOString(), ...state }, null, 2) + '\n');
  const once = args.includes('--once');
  bank.reclaim(ctx.db, [PLAN_ID]);
  while (!existsSync(join(ctx.data, 'STOP'))) {
    const tasks = ctx.dbApi.listTasks(ctx.db, PLAN_ID);
    const taken = bank.claimNext(ctx.db, [PLAN_ID], worker, { kind: ROUTE,
      accept: job => readyJob(job, tasks) && (worker.startsWith('qwen-') || (job.stage === 'component' && job.workerPool !== 'local')) });
    if (!taken) {
      record({ state: 'waiting', reason: 'no ready task; dependencies require review and landing' });
      if (once) return;
      await wait(30000); continue;
    }
    const task = taken.task;
    const job = task.state.job;
    let dir;
    let reply;
    try {
      // Dependency code must be reachable from the base actually gated, never just a passed draft.
      job.base = git(ctx.repo.path, 'rev-parse', 'HEAD');
      for (const dep of job.deps || []) {
        const landed = tasks.find(t => (t.state?.job?.programmeKey || t.state?.job?.key) === dep && t.state?.review === 'accepted' && t.state?.landed)?.state.landed;
        git(ctx.repo.path, 'merge-base', '--is-ancestor', landed, job.base);
      }
      const text = prompts.draftPrompt(job, ctx.repo, ctx.cfg);
      record({ state: 'drafting', task: task.id, key: job.key });
      reply = worker.startsWith('qwen-') ? await localDraft(worker.slice(5), text, ctx) : await hostedDraft(worker, text, ctx);
      const files = prompts.extractFiles(reply.text, job.targets);
      const outDir = join(ctx.data, 'out', worker, task.id, String(Date.now()));
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, 'reply.md'), reply.text, { mode: 0o600 });
      writeFileSync(join(outDir, 'files.json'), JSON.stringify(files, null, 2), { mode: 0o600 });
      record({ state: 'gating', task: task.id, key: job.key });
      dir = gates.worktreeFor(`${ROUTE}-${worker}`, job, ctx.repo);
      const gate = gates.gateDraft(job, files, dir, ctx.cfg);
      writeFileSync(join(outDir, 'gate.txt'), gate.report.join('\n') || 'all declared gates passed');
      // Keep the actual gated base on the task for review.
      ctx.dbApi.updateTask(ctx.db, PLAN_ID, task.id, { statePatch: { job } });
      bank.finishJob(ctx.db, PLAN_ID, task, { ok: gate.ok,
        summary: gate.ok ? 'draft passed declared gates; awaiting review' : 'draft failed gates',
        report: gate.report.join('\n'), patch: { checks: gate.checks,
          run: { worker, model: reply.model, usage: reply.usage, outDir } } });
      if (!gate.ok) {
        const repair = bank.queueRepair(ctx.db, PLAN_ID, task, { gateReport: gate.report.join('\n'), prevFile: JSON.stringify(files) });
        if (!repair && !worker.startsWith('qwen-') && !job.localFallback) {
          bank.bankJob(ctx.db, PLAN_ID, { ...job, key: `${job.programmeKey}:local-fallback`,
            title: `${job.title} (local fallback)`, stage: 'local-fallback', workerPool: 'local', localFallback: true,
            repairOf: null, round: 0, priority: job.priority + 1,
            spec: `${job.spec}\n\nA hosted attempt exhausted its repair budget. Its last gate failure was:\n${gate.report.join('\n').slice(-3000)}\nWrite fresh files; use node:test and node:assert/strict, with ASCII only.` });
        }
      }
      record({ state: gate.ok ? 'awaiting-review' : 'gate-failed', task: task.id, key: job.key });
    } catch (e) {
      bank.returnJob(ctx.db, PLAN_ID, task, { error: String(e.message), count: false });
      record({ state: 'blocked', task: task.id, key: job.key, reason: String(e.message).slice(0, 300) });
      console.error(`${worker}: ${String(e.message).slice(0, 300)}`);
      if (once) { process.exitCode = 1; return; }
      await wait(60000);
    } finally { if (dir) gates.resetWorktree(dir, job); }
    if (once) return;
  }
}

async function main() {
  const cmd = args[0] || 'list';
  if (cmd === 'list') { for (const q of [...QUEUE].sort((a,b) => b.priority-a.priority)) console.log(`[${q.priorityClass}${q.corePhase ? ` ${q.corePhase}` : ''}] ${q.key}: ${q.title}${q.deps.length ? ` [after ${q.deps.join(', ')}]` : ''}`); return; }
  if (cmd === 'credentials') {
    const { keychainSecret } = await load('prompt-runner.mjs');
    for (const name of ['XAI_API_KEY','GROK_API_KEY','GROQ_API_KEY','LMSTUDIO_LOCAL_API_KEY','LMSTUDIO_M4PRO_API_KEY']) {
      console.log(`${name}: ${process.env[name] || keychainSecret(name) ? 'configured' : 'missing'}`);
    }
    return;
  }
  const ctx = await runtime();
  if (cmd === 'bank') {
    const { ensurePlan, bankJob } = await load('lane/bank.mjs');
    ensurePlan(ctx.db, PLAN_ID, 'CommitWork: measured defensive security', { project: 'commitwork', cwd: ctx.repo.path });
    const base = git(ctx.repo.path, 'rev-parse', 'HEAD');
    const betterleaksContext = { title: 'Betterleaks integration assessment', text: readFileSync(join(root, 'docs/BETTERLEAKS-SUPPORT.md'), 'utf8') };
    let made = 0;
    for (const q of QUEUE) {
      const targets = q.module ? [q.module, q.test] : integration[q.key];
      const context = q.module ? [] : targets.filter(p => !p.includes('/test/') && !p.startsWith('docs/')).filter(file => {
        try { git(ctx.repo.path, 'cat-file', '-e', `${base}:${file}`); return true; }
        catch { return false; }
      }).map(file => ({ file }));
      if (q.key.startsWith('betterleaks-')) context.push(betterleaksContext);
      if (q.key === 'machine-history-feed') {
        for (const file of ['monitor/timeline2.mjs','monitor/runtime-report.mjs','monitor/scanner-delta.mjs']) context.push({ file, max: 18000 });
      }
      if (q.key === 'machine-history-view') {
        for (const file of ['lib/house-css.mjs','lib/theme-follower.mjs']) context.push({ file });
      }
      if (q.key.startsWith('machine-history-')) {
        context.push({ title: 'Product destination', text: 'A living interactive history and future of the machine: observed past, current activity, and explicitly planned or conditional futures, with evidence, causes and dependencies. No invented past events or predicted certainty.' });
      }
      const producerContext = {
        ...betterleaksProducerContext,
        'agent-permission-effects': ['bin/lib/sandbox.mjs','bin/agent-config.mjs','bin/test/sandbox-effects.test.mjs'],
        'history-behaviour-wire': ['monitor/dep-provenance.mjs','bin/commit-provenance.mjs','bin/commit-velocity.mjs','monitor/freshness.mjs'],
        'malicious-content-wire': ['bin/deps-content.mjs','bin/vendor-scan.mjs','bin/model-artefacts.mjs'],
        'machinery-health-wire': ['monitor/sweep-health.mjs','monitor/lane-capability.mjs','bin/lib/pattern-core.mjs','monitor/detector-bindings.json'],
      };
      for (const file of producerContext[q.key] || []) context.push({ file, max: 22000 });
      for (const dep of q.deps) {
        const d = QUEUE.find(x => x.key === dep);
        if (d?.module) context.push({ file: d.module });
        else if (dep === 'machine-history-feed') context.push({ file: 'monitor/machine-history-feed.mjs' });
        else if (dep === 'machine-history-view') context.push({ file: 'lib/machine-history-view.mjs' });
      }
      const job = { ...q, programmeKey: q.key, family: 'draft', route: ROUTE, repo: 'commitwork', base, targets, context,
        gates: q.test ? [{ name: 'behavioural tests', cmd: `node --test ${q.test}` }] :
          targets.some(p => p.endsWith('.test.mjs')) ? [{ name: 'integration tests', cmd: `node --test ${targets.find(p => p.endsWith('.test.mjs'))}` }] :
          [{ name: 'plan present', cmd: `test -s ${targets[0]}` }],
        allow: q.stage === 'integration' ? ['process'] : [], acceptance: q.spec };
      if (bankJob(ctx.db, PLAN_ID, job)) made++;
    }
    let tasks = ctx.dbApi.listTasks(ctx.db, PLAN_ID);
    for (const t of tasks.filter(t => t.state?.job)) {
      const q = QUEUE.find(q => q.key === (t.state.job.programmeKey || t.state.job.key));
      if (!q) continue;
      const job = { ...t.state.job, programmeKey: q.key, priorityClass: q.priorityClass,
        corePhase: q.corePhase, coreArea: q.coreArea, deps: q.deps,
        priority: q.priority + Math.min(5, t.state.job.round || 0), route: ROUTE };
      if (q.key.startsWith('betterleaks-')) {
        job.spec = q.spec;
        job.acceptance = q.spec;
        if (integration[q.key]) job.targets = integration[q.key];
        job.context = (job.context || []).filter(c => c.file !== 'docs/BETTERLEAKS-SUPPORT.md' && c.title !== betterleaksContext.title);
        for (const file of producerContextForBetterleaks(q.key)) {
          if (!job.context.some(c => c.file === file)) job.context.push({ file, max: 22000 });
        }
        job.context.push(betterleaksContext);
      }
      ctx.dbApi.updateTask(ctx.db, PLAN_ID, t.id, { statePatch: { job, buildOrderRevision: '2026-10-05-core-order-v1' } });
    }
    tasks = ctx.dbApi.listTasks(ctx.db, PLAN_ID);
    for (const t of tasks.filter(t => t.state?.job)) {
      const job = t.state.job;
      const barriers = CORE_PHASES.filter(p => job.priorityClass === 'secondary' || p.phase < job.corePhase).flatMap(p => p.keys);
      const deps = [...new Set([...(job.deps || []), ...barriers])].map(key => {
        const dep = tasks.find(x => x.state?.job?.key === key);
        if (!dep) throw new Error(`missing dependency ${key}`);
        return dep.id;
      });
      if (JSON.stringify(t.depends_on) !== JSON.stringify(deps)) {
        ctx.db.prepare('UPDATE tasks SET depends_on=? WHERE plan_id=? AND id=?').run(JSON.stringify(deps), PLAN_ID, t.id);
        ctx.dbApi.journalAppend(ctx.db, { kind: 'task.dependencies', planId: PLAN_ID, subject: t.id, detail: { dependsOn: deps } });
      }
    }
    console.log(`${made} tasks added to ${PLAN_ID}; ${QUEUE.length} programme tasks declared`);
  } else if (cmd === 'status') {
    const tasks = ctx.dbApi.listTasks(ctx.db, PLAN_ID);
    for (const phase of CORE_PHASES) {
      const remaining = phase.keys.filter(key => !tasks.some(t => t.state?.job?.programmeKey === key && t.status === 'completed' && t.state?.review === 'accepted' && /^[a-f0-9]{40,64}$/.test(t.state?.landed || '')));
      console.log(`CORE ${phase.phase} ${phase.name}: ${remaining.length ? `awaiting ${remaining.join(', ')}` : 'reviewed and landed'}`);
    }
    for (const t of ctx.dbApi.listTasks(ctx.db, PLAN_ID)) console.log(`${t.id} ${t.state.job?.key} ${t.status} ${t.state.review || ''} ${t.state.landed ? 'landed' : ''}`);
    for (const w of ['qwen-local','qwen-m4','groq','grok']) {
      const p = join(ctx.data, `${w}.json`);
      if (existsSync(p)) {
        const s = JSON.parse(readFileSync(p));
        console.log(JSON.stringify({ ...s, processAlive: ctx.dbApi.processAlive(s.pid) }));
      }
    }
  } else if (cmd === 'run') await runWorker(opt('--worker', 'qwen-local'), ctx);
  else if (cmd === 'retry-local') {
    const { bankJob } = await load('lane/bank.mjs');
    const tasks = ctx.dbApi.listTasks(ctx.db, PLAN_ID);
    for (const t of tasks.filter(t => t.status === 'pending' && t.state?.job?.localFallback)) {
      ctx.dbApi.updateTask(ctx.db, PLAN_ID, t.id, { statePatch: { job: { ...t.state.job, stage: 'local-fallback', workerPool: 'local' } } });
    }
    let made = 0;
    for (const q of QUEUE) {
      const attempts = tasks.filter(t => t.state?.job?.programmeKey === q.key);
      if (!attempts.length || attempts.some(t => t.status !== 'abandoned')) continue;
      const last = attempts.sort((a,b) => (b.state.job.round || 0) - (a.state.job.round || 0))[0];
      const job = last.state.job;
      if (bankJob(ctx.db, PLAN_ID, { ...job, key: `${q.key}:local-fallback`, programmeKey: q.key,
        title: `${q.title} (local fallback)`, stage: 'local-fallback', workerPool: 'local', localFallback: true,
        repairOf: null, round: 0, priority: q.priority + 1,
        spec: `${q.spec}\n\nA hosted attempt exhausted its repair budget. Write fresh files using node:test and node:assert/strict. ASCII only. Last failure: ${last.abandon_reason || 'unknown'}` })) made++;
    }
    console.log(`${made} exhausted programme tasks queued for local fallback`);
  }
  else if (cmd === 'stop') {
    const worker = opt('--worker', 'grok');
    if (!['qwen-local','qwen-m4','groq','grok'].includes(worker)) throw new Error(`unknown worker ${worker}`);
    const path = join(ctx.data, `${worker}.json`);
    if (!existsSync(path)) throw new Error(`no status for ${worker}`);
    const state = JSON.parse(readFileSync(path));
    if (ctx.dbApi.processAlive(state.pid)) {
      const commandLine = execFileSync('ps', ['-p', String(state.pid), '-o', 'command='], { encoding: 'utf8' });
      if (!commandLine.includes(fileURLToPath(import.meta.url)) || !commandLine.includes(`--worker ${worker}`)) {
        throw new Error(`pid ${state.pid} no longer identifies this queue worker; refusing to signal it`);
      }
      // Workers start as detached process-group leaders. Include their headless model harness
      // when reloading policy so it cannot continue spending inference on superseded work.
      if (process.platform !== 'win32') {
        const group = Number(execFileSync('ps', ['-p', String(state.pid), '-o', 'pgid='], { encoding: 'utf8' }).trim());
        if (group !== state.pid) throw new Error('worker no longer owns its process group; refusing group signal');
        process.kill(-group, 'SIGTERM');
      } else process.kill(state.pid, 'SIGTERM');
    }
    writeFileSync(path, JSON.stringify({ ...state, state: 'stopped', at: new Date().toISOString() }, null, 2) + '\n');
    console.log(`${worker} stopped`);
  }
  else if (cmd === 'start') {
    mkdirSync(ctx.data, { recursive: true });
    for (const worker of opt('--workers', 'qwen-local,qwen-m4,groq').split(',')) {
      if (!['qwen-local','qwen-m4','groq','grok'].includes(worker)) throw new Error(`unknown worker ${worker}`);
      const { openSync, closeSync } = await import('node:fs');
      const fd = openSync(join(ctx.data, `${worker}.log`), 'a', 0o600);
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'run', '--spine', spine, '--worker', worker], { cwd: root, detached: true, stdio: ['ignore', fd, fd], env: process.env });
      closeSync(fd); child.unref();
      console.log(`${worker} started pid ${child.pid}`);
    }
  } else throw new Error('usage: security-work-queue.mjs list|bank|status|start|run [--worker qwen-local|qwen-m4|grok|groq] [--once] [--spine PATH]');
  ctx.db.close();
}

if (isMainModule(import.meta.url)) {
  main().catch(e => { console.error(e.message); process.exitCode = 1; });
}
