#!/usr/bin/env node
// SessionStart hook: ask the agent to bind its own name into the roster.
//
// WHY A PROMPT AND NOT A WRITE. The roster's whole subject is the cwNN <-> session binding, and the
// NAME half of it exists only in the harness session registry, which is reachable by ONE thing: an
// agent calling the ListAgents tool. A hook is a shell command. It receives session_id, cwd and
// source on stdin and cannot see a name at any price. So a hook that wrote a row unaided could only
// ever write the half nobody was missing — `bin/session-roster.mjs --record` already refuses a
// nameless row for that reason, and duplicating its append logic here to get around that would
// duplicate the trailing-newline repair its comment says once ate a row.
//
// What a hook CAN do is put the request in front of the one actor able to answer it, once, at the
// point the answer is cheapest. That is this file. It is a PROMPT, and its limitation is therefore
// agent compliance, which is stated here rather than papered over: if the agent ignores the
// injected context, no row is written and the roster stays as silent as it was. The mitigation is
// that this fires once per session at start rather than per turn, so it is a start-of-work item and
// not the standing instruction that becomes wallpaper.
//
// WHY IT DOES NOT CALL session-title.mjs. That walks and parses every transcript in the project
// directory per call — measured by a peer at seven lookups timing out against a 120s budget. A
// SessionStart hook runs before the session is usable, so it must stay cheap: this reads one small
// JSONL and nothing else.
//
// NEVER FAILS THE SESSION. Every path exits 0. A hook that can break session startup for a
// bookkeeping store is a worse defect than the missing bookkeeping.

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { livePids } from './lib/peer-headers.mjs';
import { isMainModule } from '../lib/is-main.mjs';

// Read at CALL time, never at module load — a `const` here silently defeats any test that sets it.
const rosterPath = () => process.env.CW_SESSION_ROSTER
  || join(process.env.CW_STORE_DIR || join(process.env.CW_ROOT || process.cwd(), '.claude', 'store'),
    'sessions.jsonl');

/** stdin, or '' if it is closed/empty. Never throws — a hook with no input still exits clean. */
async function readStdin() {
  try {
    if (process.stdin.isTTY) return '';
    const chunks = [];
    for await (const c of process.stdin) chunks.push(c);
    return Buffer.concat(chunks).toString('utf8');
  } catch { return ''; }
}

/**
 * Is this session id already bound to a NAME in the roster?
 *
 * Uncertainty prompts. A read fault, a torn file, an absent store — none of them are evidence that
 * the session IS bound, and the cost of asking twice is nil because `--record` is idempotent for an
 * identical observation. So only a positive, parsed, named row suppresses the prompt.
 */
export function alreadyBound(sessionId, raw) {
  if (!sessionId || typeof raw !== 'string') return false;
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let row; try { row = JSON.parse(line); } catch { continue; }   // a torn line is not a binding
    if (row && row.id === sessionId && row.name) return true;
  }
  return false;
}

/**
 * The session's own claude pid, or null when it cannot be established.
 *
 * A ROW WITHOUT A PID IS NOT AN ADDRESS. `freshness()` returns 'live' only for a row whose pid still
 * holds a session socket, and a `ref` is a harness handle that resolves nowhere on this machine — so
 * a name recorded without a pid is filed 'unverifiable' the moment it lands, and `--resolve` refuses
 * to publish it as an address. The hook could not supply the name; it CAN supply this.
 *
 * The walk is a second witness, not a guess. A hook is spawned by the claude process, so the session
 * is one of this process's ancestors — but "my ancestor" alone would happily return the shell, or
 * VS Code. The socket set decides: exactly one ancestor holds a `<pid>.sock` in the messaging
 * directory, and that one IS the session. An ancestor chain that produces no such pid returns null
 * and the instruction simply omits the argument, because a pid this hook merely SUSPECTS would mint
 * the confidently-wrong row the store exists to prevent.
 */
/**
 * One hop of the walk. Returns `{ parent }`, `{ parent: null }` for a pid with no readable parent,
 * or `{ failed, why }` when `ps` ITSELF could not run.
 *
 * THAT THIRD CASE USED TO BE THE SECOND. The walk read ps's OUTPUT and never its STATUS, so a ps
 * that could not run at all — missing binary, denied, exec failure — produced an empty stdout, a
 * NaN parent and a null return byte-identical to "walked the chain and found no socket ancestor"
 * (C2, exit code with no subscriber; found 2026-09-06 by a detector added that day).
 *
 * The two outcomes agree and both fail closed, which is why it survived and why this repair does not
 * change what any caller sees. What differs is everything else: the instrument failure repeated the
 * failing spawn once per hop, twelve times per session start across every session on the box, and
 * nothing anywhere could tell an operator that ps was broken here rather than that no session owned
 * this process. A fleet-wide roster outage would have looked exactly like normal operation.
 */
export const psPpid = (pid) => {
  const r = spawnSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' });
  if (r.error) return { failed: true, why: r.error.code || String(r.error.message) };
  // EMPTY IS ITS OWN ANSWER, and saying so is not cosmetic: `Number('')` is 0, not NaN, so the
  // previous form turned "ps answered nothing" into the integer 0 and depended on a later
  // `parent <= 1` bound to absorb it. That worked, and it worked by accident of a coercion nobody
  // states. A pid ps declined to report is `null` here, and the walk terminates on the answer.
  const text = String(r.stdout || '').trim();
  if (!text) return { parent: null };
  const parent = Number(text);
  return Number.isInteger(parent) ? { parent } : { parent: null };
};

export function sessionPid({ live = livePids(), start = process.pid, maxHops = 12, ppidOf = psPpid } = {}) {
  if (!live || live.size === 0) return null;
  let pid = start;
  for (let i = 0; i < maxHops; i++) {
    if (live.has(String(pid))) return String(pid);
    const step = ppidOf(pid);
    // An instrument that cannot run will not run any better on the next hop.
    if (step.failed) return null;
    const parent = step.parent;
    if (!Number.isInteger(parent) || parent <= 1 || parent === pid) return null;
    pid = parent;
  }
  return null;
}

/** The context injected into the session. Kept short: a start-of-work item, not an essay. */
export const bindingRequest = (sessionId, pid = null) => [
  'SESSION ROSTER — unbound session.',
  '',
  `This session's transcript id is ${sessionId || '(not supplied by the hook payload)'}, and no roster row binds it to a`,
  'peer-facing name yet. The name (commitwork-NN) lives ONLY in the harness session registry, so you',
  'are the only thing that can read it — a hook cannot.',
  '',
  'Early in this session, call ListAgents, take the name and [ref] it reports for THIS session, and run:',
  '',
  '  node bin/session-roster.mjs --record <NN> <ref> ' + (sessionId || '<uuid>') + (pid ? ` ${pid}` : ''),
  '',
  ...(pid ? [
    `The trailing ${pid} is this session's pid, and it is what makes the row an ADDRESS rather than a`,
    'record: --resolve corroborates a name against the live socket set, and a row with no pid can',
    'never be corroborated, so it is filed unverifiable the moment it lands. Do not substitute a pid',
    'you inferred — omit the argument instead.', '',
  ] : []),
  'Why it matters: handoffs, commit messages and the failure taxonomy cite these names as if they were',
  'stable identifiers, and an unrecorded name does not degrade to unknown — a stale row answers with',
  'full confidence about a session that no longer holds that name (taxonomy L8: contended name used as',
  'an address). Recording takes one command; not recording is what made two sessions both answer to',
  'one name and a commit land against the wrong one.',
  '',
  'Do NOT derive the name from the session id or from the transcript title — both have been measured',
  'disagreeing with the registry. ListAgents is the only authority.',
].join('\n');

async function main() {
  let payload = {};
  try { payload = JSON.parse(await readStdin()) || {}; } catch { payload = {}; }
  const sessionId = typeof payload.session_id === 'string' ? payload.session_id : '';

  let raw = '';
  try { raw = readFileSync(rosterPath(), 'utf8'); } catch { raw = ''; }   // absent/unreadable: prompt

  // A bound session gets silence. Re-asking a session that already answered is how a prompt becomes
  // wallpaper, and this one only earns its place by being rare.
  if (alreadyBound(sessionId, raw)) return;

  // Never let the pid walk break a session start: a bookkeeping nicety that throws here would cost
  // more than the missing argument it is trying to supply.
  let pid = null;
  try { pid = sessionPid(); } catch { pid = null; }

  process.stdout.write(`${JSON.stringify({
    hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: bindingRequest(sessionId, pid) },
  })}\n`);
}

if (isMainModule(import.meta.url)) {
  main().then(() => process.exit(0), () => process.exit(0));   // never fail a session start
}
