#!/usr/bin/env node
// bin/judge.mjs — the judge call, runnable on its own. Put one finding in front of a backend and
// print the structured verdict. The orchestrator (bin/disclosure-review.mjs) calls judge() directly;
// this CLI is the smallest end-to-end way to see a single judgement.
//
//   echo '{"rule":"path-traversal","file":"a.js:12","description":"user path reaches fs.readFile"}' \
//     | node bin/judge.mjs --backend claude
//   node bin/judge.mjs --finding finding.json --mode analysis --question "what chains to this?"
//
// --backend claude (default) | model      model routes via lib/model-provider.mjs (CW_MODEL_PROVIDER).
// --mode verdict (default) | analysis     verdict parses VERDICT/CONFIDENCE; analysis returns prose.
// Exit 0 = a reply was produced (even `undetermined`); 1 = bad input; 2 = the backend errored.

import { readFileSync } from 'node:fs';
import { judge } from '../lib/judge.mjs';

function arg(name, def = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : def;
}

function readFinding() {
  const file = arg('finding');
  const raw = file ? readFileSync(file, 'utf8') : readFileSync(0, 'utf8');
  if (!raw.trim()) { process.stderr.write('judge: no finding on stdin or --finding\n'); process.exit(1); }
  try { return JSON.parse(raw); } catch (e) { process.stderr.write(`judge: finding is not JSON: ${e.message}\n`); process.exit(1); }
}

const finding = readFinding();
const backend = arg('backend', 'claude');
const mode = arg('mode', 'verdict');
const question = arg('question', null);
const timeoutMs = Number(arg('timeout', '180000'));

const result = await judge({ finding, backend, mode, question, timeoutMs });
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
process.exit(result.error ? 2 : 0);
