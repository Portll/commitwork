#!/usr/bin/env node
// bin/issue-loop.mjs — headless auto-remediate driver over the issue store.
// Staleness gate first (no fresh rollup ⇒ exit 4, touch nothing); the loop never closes issues
// (closure waits for the next sweep's evidence); authorityRequired work is never claimed.
// Dry-run is the default: without --apply, nothing is claimed, written, or spawned.
//
// usage:
//   node bin/issue-loop.mjs --area <slug> [--apply] [--max N] [--max-attempts N]
//                           [--timeout-min N] [--budget-min N]
//                           [--gate-manifest <bundled name>] [--gate-group G]
//
// flags: --area (required) · --apply (mutate; default is dry-run) · --max issues per run (1)
//        · --max-attempts before an issue is blocked (2) · --timeout-min per agent (30)
//        · --budget-min wall-clock for the whole run (30) · --gate-manifest bundled manifest to
//        run after the agent (no flag = declared skip, never a silent one) · --gate-group (quick)
//
// exit: 0 ok (including 'nothing ready') · 2 usage · 4 stale or missing evidence
//
// env: CW_ISSUES (store) · CW_NOW (deterministic clock) · CW_ISSUE_STALE_HOURS ·
//      CW_ROLLUP (rollup override via cra/lib resolvePaths) · CW_MONITOR_OUT (handoff dir root) ·
//      CW_ISSUE_AGENT_CMD — agent argv (whitespace-split, handoff path appended last, no shell;
//      unset ⇒ `claude -p` built by lib/claude-spawn.mjs PROFILES.issueLoop).

import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  loadIssues, saveIssues, withIssuesLock, nowISO, STALE_HOURS,
  gcIssues, readyIssues, claimIssue, releaseIssue, mutateIssue, claimExpired,
} from '../monitor/issue-store.mjs';
import { outDirFor, registry, CW } from '../monitor/area.mjs';
import { resolvePaths, loadJSON, writeTextAtomic } from '../cra/lib.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { claudeArgs, claudeSpawnPlan, PROFILES } from '../lib/claude-spawn.mjs';
import { llmEnv } from './lib/scanner-env.mjs';

const args = process.argv.slice(2);
const flag = (n, def) => { const i = args.indexOf(n); return i === -1 ? def : args[i + 1]; };
const has = (k) => args.includes(k);

const die = (msg, code = 2) => { process.stderr.write(msg + '\n'); process.exitCode = code; };
const say = (msg) => process.stdout.write(msg + '\n');

// Numeric flags fail loudly — never fall back to the default on a bad value.
function num(name, def) {
  const raw = flag(name, null);
  if (raw === null) return def;
  const v = Number(raw);
  if (!Number.isFinite(v) || v <= 0) { die(`${name} needs a positive number, got '${raw}'`); return null; }
  return v;
}

// Identity stamps derive from nowISO() (never Date.now()) so CW_NOW keeps runs deterministic.
const compactStamp = (iso) => iso.replace(/[-:TZ.]/g, '').slice(0, 14);

// Async spawn + progress ticker; status === null means timed out/killed.
const OUT_CAP = 32 * 1024 * 1024;
function runAgent({ argv, env }, file, cwd, timeoutMin, label) {
  return new Promise((done) => {
    const child = spawn(argv[0], [...argv.slice(1), file], { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '', timedOut = false;
    child.stdout.on('data', (d) => { if (out.length < OUT_CAP) out += d; });
    child.stderr.on('data', (d) => { if (err.length < OUT_CAP) err += d; });
    const started = Date.now();
    const fmt = (ms) => { const s = Math.floor(ms / 1000); return `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`; };
    const tty = !!process.stderr.isTTY;
    const tick = setInterval(() => {
      const line = `⏳ ${label} — agent running ${fmt(Date.now() - started)} / ${timeoutMin}m`;
      if (tty) process.stderr.write(`\r${line} `);
      else process.stderr.write(`${line}\n`);
    }, tty ? 1000 : 60_000);
    const killer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMin * 60_000);
    const finish = (status) => {
      clearInterval(tick); clearTimeout(killer);
      if (tty) process.stderr.write('\r' + ' '.repeat(78) + '\r');
      done({ status, stdout: out, stderr: err });
    };
    child.on('close', (code, signal) => finish(timedOut || signal ? null : code));
    child.on('error', (e) => { err += `\nspawn failed: ${e.message}`; finish(127); });
  });
}

// CW_HANDOFF_CMD contract: whitespace-split argv, file appended last, no shell.
// guard: the agent edits the repo, so it runs there, with no settings from it (review 2026-10-07 D2)
function agentCommand(cwd) {
  if (process.env.CW_ISSUE_AGENT_CMD) return { argv: process.env.CW_ISSUE_AGENT_CMD.trim().split(/\s+/), env: llmEnv(process.env) };
  const plan = claudeSpawnPlan(PROFILES.issueLoop, { repo: cwd });
  return { argv: [plan.file, ...plan.args], env: plan.env };
}

function composeHandoff(iss, area) {
  return [
    `# commitwork issue-loop handoff — ${iss.id}`,
    '',
    `- id: ${iss.id}`,
    `- title: ${iss.title}`,
    `- severity: ${iss.severity}`,
    `- area: ${area}`,
    `- repo: ${iss.repo ?? '(none recorded)'}`,
    `- source: ${JSON.stringify(iss.source)}`,
    `- anchor: ${iss.anchor ? JSON.stringify(iss.anchor) : '(none)'}`,
    '',
    '## body',
    iss.body ?? '(none)',
    '',
    '## remediation hint',
    iss.remediation ?? '(none)',
    '',
    '## instructions',
    'Fix the issue described above, then run the repo\'s own tests, then STOP.',
    "Do NOT close the issue yourself; the loop verifies and the next sweep's evidence closes it.",
    'If you cannot fix it, say BLOCKED: <reason> as your last line.',
    '',
  ].join('\n');
}

// Resolution failure degrades to the commitwork root, never a crash.
async function cwdForRepo(repoName, reg) {
  if (!repoName) return CW;
  try {
    const { resolveRepos } = await import('../monitor/discover.mjs');
    const hit = resolveRepos(reg, {}).repos.find((r) => r.name === repoName);
    return (hit?.path && existsSync(hit.path)) ? hit.path : CW;
  } catch { return CW; }
}

// Re-load the doc and refuse to record over a live claim that is no longer ours.
function recordOutcome(issueId, sessionId, fn) {
  withIssuesLock(() => {
    const doc = loadIssues();
    const iss = doc.issues[issueId];
    if (!iss) { say(`${issueId} vanished from the store while the agent ran — outcome not recorded`); return; }
    if (iss.claim && iss.claim.sessionId !== sessionId && !claimExpired(iss.claim, nowISO())) {
      say(`${issueId} claim was taken over by ${iss.claim.by} (${iss.claim.sessionId}) — outcome not recorded`);
      return;
    }
    fn(doc, iss);
    saveIssues(doc);
  });
}

// last BLOCKED: line in the agent's output — the handoff tells the agent to make it its last line.
function blockedMarker(out) {
  const lines = String(out || '').split('\n').map((l) => l.trim()).filter((l) => l.startsWith('BLOCKED:'));
  return lines.length ? lines[lines.length - 1].slice('BLOCKED:'.length).trim() : null;
}

// Fail closed: only exit 0 passes — timeout, signal, and spawn failure are FAIL.
function runGate({ manifest, group, repoPath }) {
  const r = spawnSync('node', [join(CW, 'bin', 'commitwork.mjs'), 'run', group, '--manifest', manifest, '--repo', repoPath],
    { encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 32 * 1024 * 1024 });
  const pass = r.status === 0;
  return { pass, note: pass ? 'pass' : `fail (${r.status === null ? 'runner did not complete (timeout or signal)' : `exit ${r.status}`})` };
}

async function main() {
  const area = flag('--area', null);
  // --issue pins the run to one issue; ready rules still apply — it narrows, never overrides.
  const onlyIssue = flag('--issue', null);
  const pickReady = (doc, a) => (onlyIssue
    ? readyIssues(doc, { area: a, now: nowISO() }).filter((i) => i.id === onlyIssue).slice(0, 1)
    : readyIssues(doc, { area: a, now: nowISO(), limit: 1 }));
  if (!area) return die('issue-loop requires --area <slug>');
  const apply = has('--apply');
  const maxIssues = num('--max', 1);
  const maxAttempts = num('--max-attempts', 2);
  const timeoutMin = num('--timeout-min', 30);
  const budgetMin = num('--budget-min', 30);
  if ([maxIssues, maxAttempts, timeoutMin, budgetMin].some((v) => v === null)) return;
  const gateManifest = flag('--gate-manifest', null);
  const gateGroup = flag('--gate-group', 'quick');

  // ── STALENESS GATE FIRST — before any lock, claim, or event ────────────────────────────────
  // Fail closed: unreadable rollup or NaN age counts as stale, never as fresh.
  const staleHours = STALE_HOURS();
  const rollupPath = resolvePaths({ area }).rollup;
  const rollup = loadJSON(rollupPath, null);
  if (!rollup || typeof rollup !== 'object' || !rollup.generated) {
    return die(`stale gate: no readable rollup with a 'generated' stamp at ${rollupPath} — refusing to act without evidence`, 4);
  }
  const ageMs = new Date(nowISO()).getTime() - new Date(rollup.generated).getTime();
  if (!(ageMs <= staleHours * 3600_000)) {
    return die(`stale gate: rollup generated ${rollup.generated} is older than ${staleHours}h — acting on stale evidence manufactures conclusions (exit 4)`, 4);
  }

  const reg = registry();
  const startedMs = Date.now(); // elapsed-time budget ONLY — never identity/stamps

  // Allocate the tag once per launch, and only when applying — a dry run must not burn one.
  // CW_AGENT_MODEL undeclared ⇒ UNKNOWN-nnn, never a guessed model.
  let agentTag = 'issue-loop';
  if (apply) {
    try {
      const { allocate } = await import('./agent-tag.mjs');
      agentTag = allocate({ model: process.env.CW_AGENT_MODEL, context: area, sessionId: process.env.CLAUDE_SESSION_ID || null }).tag;
      say(`agent ${agentTag}`);
    } catch (e) {
      // Allocation failure must not stop remediation, but must be visible.
      say(`agent designation unavailable (${e.message}) — claiming as '${agentTag}'`);
    }
  }
  let processed = 0;

  while (processed < maxIssues) {
    if ((Date.now() - startedMs) / 60_000 >= budgetMin) { say(`budget: ${budgetMin} min wall-clock exceeded — stopping early`); break; }
    const stamp = compactStamp(nowISO());
    const sessionId = `loop-${process.pid}-${stamp}`;

    if (!apply) {
      // Dry-run: simulate on the in-memory doc only — nothing saved, written, or spawned.
      const doc = loadIssues();
      gcIssues(doc, { at: nowISO() });
      let pick = null;
      for (;;) {
        const [cand] = pickReady(doc, area);
        if (!cand) break;
        if (cand.attemptCount >= maxAttempts) {
          say(`(dry) ${cand.id} would be blocked: attempt cap reached (${cand.attemptCount}/${maxAttempts})`);
          cand.state = 'blocked'; // in-memory only, so the scan advances
          continue;
        }
        pick = cand;
        cand.state = 'claimed'; // in-memory only, so --max > 1 advances
        break;
      }
      if (!pick) { say(`nothing ready in area '${area}' (dry-run)`); break; }
      const argv = process.env.CW_ISSUE_AGENT_CMD ? process.env.CW_ISSUE_AGENT_CMD.trim().split(/\s+/) : ['claude', ...claudeArgs(PROFILES.issueLoop)];
      say(`(dry) would claim ${pick.id} [${pick.severity}] "${pick.title}" and spawn: ${argv.join(' ')} <handoff> (timeout ${timeoutMin}m)`);
      processed += 1;
      continue;
    }

    // ── claim under lock; keep the section to load→mutate→save ───────────────────────────────
    const claimed = withIssuesLock(() => {
      const doc = loadIssues();
      gcIssues(doc, { at: nowISO() }); // expired claims back to the pool first
      let pick = null;
      for (;;) {
        const [cand] = pickReady(doc, area);
        if (!cand) break;
        if (cand.attemptCount >= maxAttempts) {
          mutateIssue(doc, cand.id, (i) => {
            i.state = 'blocked';
            i.blockedReason = 'attempt cap reached';
            i.claim = null;
          }, 'issue-blocked', { reason: 'attempt cap reached', attempts: cand.attemptCount, cap: maxAttempts }, nowISO());
          say(`${cand.id} blocked: attempt cap reached (${cand.attemptCount}/${maxAttempts})`);
          continue; // next ready issue
        }
        claimIssue(doc, cand.id, { by: agentTag, sessionId, at: nowISO() });
        pick = structuredClone(doc.issues[cand.id]);
        break;
      }
      saveIssues(doc); // persists gc + any cap-blocks even when nothing was claimable
      return pick;
    });
    if (!claimed) { say(`nothing ready in area '${area}'`); break; }

    // ── handoff + spawn happen OUTSIDE the lock — the agent may run for minutes ───────────────
    const handoffFile = join(outDirFor(area, reg), 'handoff', `${claimed.id}-${stamp}.md`);
    writeTextAtomic(handoffFile, composeHandoff(claimed, area));
    const cwd = await cwdForRepo(claimed.repo, reg);
    const cmd = agentCommand(cwd);
    say(`${claimed.id} claimed — agent starting in ${cwd} (timeout ${timeoutMin}m)`);
    const r = await runAgent(cmd, handoffFile, cwd, timeoutMin, claimed.id);
    const at = nowISO();

    if (r.status === null) {
      // timeout or kill: release, issue stays open for a later attempt
      recordOutcome(claimed.id, sessionId, (doc) => {
        releaseIssue(doc, claimed.id, { at, reason: 'agent timeout' });
      });
      say(`${claimed.id} agent timed out after ${timeoutMin}m — claim released, issue stays open`);
      processed += 1;
      continue;
    }

    const blocked = blockedMarker(`${r.stdout || ''}\n${r.stderr || ''}`);
    if (r.status !== 0 || blocked) {
      const reason = blocked || `agent exited ${r.status}`;
      recordOutcome(claimed.id, sessionId, (doc) => {
        mutateIssue(doc, claimed.id, (i) => {
          i.state = 'blocked';
          i.blockedReason = reason;
          i.claim = null;
        }, 'issue-blocked', { reason, agentExit: r.status }, at);
      });
      say(`${claimed.id} blocked: ${reason}`);
      processed += 1;
      continue;
    }

    // No --gate-manifest is a declared skip, never a silent one.
    const gate = gateManifest
      ? runGate({ manifest: gateManifest, group: gateGroup, repoPath: cwd })
      : { pass: true, note: 'skipped (no --gate-manifest)' };

    if (!gate.pass) {
      recordOutcome(claimed.id, sessionId, (doc) => {
        mutateIssue(doc, claimed.id, (i) => {
          i.state = 'blocked';
          i.blockedReason = 'gate failed';
          i.claim = null;
        }, 'issue-blocked', { reason: 'gate failed', gate: gate.note, manifest: gateManifest, group: gateGroup }, at);
      });
      say(`${claimed.id} blocked: gate failed (${gate.note})`);
      processed += 1;
      continue;
    }

    // The loop never closes — closure waits for the next sweep's evidence.
    recordOutcome(claimed.id, sessionId, (doc) => {
      mutateIssue(doc, claimed.id, (i) => {
        i.evidence.push({ at, tier: 'fix-applied', detail: `agent run ${stamp}; gate ${gateManifest ? 'pass' : 'skipped'}` });
      }, 'issue-updated', { evidence: 'fix-applied', gate: gate.note }, at);
      releaseIssue(doc, claimed.id, { at, reason: 'fix applied; closure awaits sweep evidence' });
    });
    say(`${claimed.id} fix applied (gate: ${gate.note}) — released; closure awaits the next sweep's evidence`);
    processed += 1;
  }

  say(`issue-loop done: ${processed} issue(s) processed in area '${area}'${apply ? '' : ' (dry-run — nothing was mutated)'}`);
}

const isMain = isMainModule(import.meta.url);
if (isMain) await main();
