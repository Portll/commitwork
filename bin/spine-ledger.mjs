#!/usr/bin/env node
// PostToolUse hook — record WHICH SESSION filed WHICH external development task ledger task.
// tasks.db has no session column: attribution is recorded at the moment of the call or not at all.
// Hot path: every error exits 0 in silence. Store FULL session ids — truncation is a display concern.
// Registered as: PostToolUse matcher "mcp__(spine|substrate)__(create_task|update_task|create_plan|set_status)".
// Both prefixes: the server was re-registered spine <- substrate on 2026-09-10, and a session that
// connected before that still calls the old name. Matching only the new one records nothing for them.

import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { spineLedger, treeId } from './lib/store-paths.mjs';
import { rotateIfLarge } from './lib/ledger-rotate.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ledgerPath = () => spineLedger();
const SPINE_TOOL = /^mcp__(?:spine|substrate)__/;
const maxBytes = () => Number(process.env.CW_LEDGER_MAX_BYTES) || 2_000_000;

function main() {
  let raw = '';
  try { raw = readFileSync(0, 'utf8'); } catch { return; }        // no stdin: nothing to record
  let ev;
  try { ev = JSON.parse(raw || '{}'); } catch { return; }

  const session = ev?.session_id;
  const tool = ev?.tool_name || '';
  if (!session || !SPINE_TOOL.test(tool)) return;

  // Task id lives in the RESPONSE, plan id in the request; read defensively — a shape change must
  // cost an attribution field, never an exception on a hot path.
  const inp = ev?.tool_input || {};
  const out = ev?.tool_response ?? ev?.tool_result ?? {};
  // MCP envelope is a bare array of content blocks `[{type:'text', text:'<json>'}]` — unwrap it,
  // then fall back to the raw object.
  const blocks = (o) => (Array.isArray(o) ? o : (Array.isArray(o?.content) ? o.content : null));
  const unwrap = (o) => {
    if (!o) return {};
    if (typeof o === 'string') { try { return JSON.parse(o); } catch { return {}; } }
    const b = blocks(o);
    if (b) {
      const t = b.find((c) => c && typeof c.text === 'string');
      if (t) { try { return JSON.parse(t.text); } catch { /* not json */ } }
    }
    return typeof o === 'object' && !Array.isArray(o) ? o : {};
  };
  const parsed = unwrap(out);

  // Id location varies per tool: create_plan → plan id in input/response, no task;
  // create_task → task id assigned in the RESPONSE; update_task/set_status → caller names it `id`.
  const kind = tool.replace(SPINE_TOOL, '');
  const isPlan = kind === 'create_plan';
  const rec = {
    s: String(session),                                            // FULL id — see header
    r: treeId(REPO),                                               // which working tree
    kind,
    plan: inp.planId || parsed.plan_id || (isPlan ? (inp.id || parsed.id) : null) || null,
    task: isPlan ? null : (parsed.id ?? inp.id ?? null),
    at: new Date().toISOString(),
  };

  // A missing task id records the response's key names (never values) so a shape change announces itself.
  if (!rec.task && !isPlan) {
    try { rec.shape = Object.keys(parsed).slice(0, 8); } catch { rec.shape = ['unreadable']; }
  }

  try {
    const p = ledgerPath();
    mkdirSync(dirname(p), { recursive: true });
    // Shifts generations rather than overwriting `.1`; see bin/lib/ledger-rotate.mjs.
    try { rotateIfLarge(p, maxBytes()); } catch { /* hot path: never throw */ }
    appendFileSync(p, `${JSON.stringify(rec)}\n`);
  } catch { /* an attribution record is worth less than the tool call it would interrupt */ }
}

try { main(); } catch { /* never fail a tool call */ }
process.exit(0);
