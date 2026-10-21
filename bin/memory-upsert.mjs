#!/usr/bin/env node
// bin/memory-upsert.mjs — THE WRITE SURFACE for agent sessions, the counterpart to memory-query.mjs.
//
// WHY THIS EXISTS, measured 2026-10-08. /close told sessions to import lib/memory-layer-client.mjs
// inline. With no fixed command to run, a session went looking for the key instead: it sed'd
// api_key out of veld's config.toml and probed three endpoints with empty bodies. The auto-mode
// classifier denied that as Credential Exploration, correctly, and the handoff was never stored.
// A fixed command with the credential resolved INSIDE the client (env -> keychain) gives the
// session nothing to explore and gives the permission layer one exact path to allow.
//
// The key and the content never reach stdout. The receipt carries hashes, ids and state only.
// Content is read from a file, never argv: a shell-quoted body had its backticks executed by zsh
// on 2026-08-09 and the client stored the wreckage.

import { readFileSync } from 'node:fs';
import { isMainModule } from '../lib/is-main.mjs';
import { upsert, VERIFIED } from '../lib/memory-layer-client.mjs';

export const USAGE = `memory-upsert — write one memory to veld through the contract-tested client

  node bin/memory-upsert.mjs --file <path> --external-id <commitwork/kind/id> --scope <project>
                             [--project <name>] [--tags a,b] [--type Context] [--json]

  --file          the body; "-" reads stdin
  --external-id   identity; the same id updates in place (version 1 -> 2)
  --scope         the writer scope, e.g. the project name
  --project       the project tag (default CW_VELD_PROJECT, else commitwork — wrong from any other repo)
  --tags          extra tags; project and scope tags are added by the client
  --type          memory_type (default Context)
  --json          machine output

Exit 0 only when the receipt is verified (stored content matched what was sent). Any other
state exits 1 with its reason: accepted-unverified is not durable, and failed is not stored.
The credential is resolved by the client from VELD_API_KEY or the keychain; never pass it here.
`;

// The client's 5s default is sized for sweep lanes that tolerate a miss. The first live handoff
// write on 2026-10-08 timed out at 5s and was stored anyway (the retry came back version 2). A
// session cannot raise it with an env prefix, since that stops the allow rule from matching.
export const WRITE_TIMEOUT_MS = '30000';

export const writeEnv = (env) => (env.VELD_TIMEOUT_MS ? env : { ...env, VELD_TIMEOUT_MS: WRITE_TIMEOUT_MS });

const VALUED = { '--file': 'file', '--external-id': 'externalId', '--scope': 'scope', '--project': 'project', '--tags': 'tags', '--type': 'type' };

export function parseArgs(argv) {
  const a = { file: null, externalId: null, scope: null, project: null, tags: '', type: 'Context', json: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--json') a.json = true;
    else if (t === '--help' || t === '-h') a.help = true;
    else if (VALUED[t]) {
      const v = argv[++i];
      if (v === undefined || (v.startsWith('--') && v !== '-')) throw new Error(`${t} needs a value`);
      a[VALUED[t]] = v;
    } else throw new Error(`unknown argument ${JSON.stringify(t)}`);
  }
  return a;
}

function readBody(file, { stdin }) {
  const content = file === '-' ? stdin() : readFileSync(file, 'utf8');
  if (!content.trim()) throw new Error(`--file ${file} is empty — refusing to store a blank memory over a real one`);
  return content;
}

export function render(r) {
  const L = [`state ${r.state}`, `external_id ${r.external_id}`];
  if (r.id) L.push(`id ${r.id}  version ${r.version}  was_update ${r.was_update}`);
  L.push(`sha256 sent ${r.contentSha256 ?? '-'}  stored ${r.storedSha256 ?? '-'}  form ${r.storedForm}`);
  if (r.reason) L.push(`reason: ${r.reason}`);
  return `${L.join('\n')}\n`;
}

export async function run(argv, { env = process.env, fetchImpl = fetch, stdin = () => readFileSync(0, 'utf8') } = {}) {
  const a = parseArgs(argv);
  if (a.help) return { text: USAGE, exitCode: 0, receipt: null };
  const missing = ['file', 'externalId', 'scope'].filter((k) => !a[k]);
  if (missing.length) return { text: `missing ${missing.map((k) => `--${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`).join(', ')}\n\n${USAGE}`, exitCode: 2, receipt: null };

  const content = readBody(a.file, { stdin });
  const tags = a.tags.split(',').map((s) => s.trim()).filter(Boolean);
  const receipt = await upsert(
    { content, memory_type: a.type, tags, external_id: a.externalId },
    { scope: a.scope, project: a.project, env: writeEnv(env), fetchImpl },
  );
  const text = a.json ? `${JSON.stringify(receipt, null, 2)}\n` : render(receipt);
  return { text, exitCode: receipt.state === VERIFIED ? 0 : 1, receipt };
}

export async function main(argv, { out = process.stdout, err = process.stderr, env = process.env, fetchImpl = fetch } = {}) {
  let r;
  try {
    r = await run(argv, { env, fetchImpl });
  } catch (e) {
    err.write(`memory-upsert: ${e && e.message ? e.message : e}\n`);
    process.exitCode = 2;
    return;
  }
  out.write(r.text);
  // process.exitCode, never process.exit(): exit() truncates a piped write (see memory-query.mjs).
  process.exitCode = r.exitCode;
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2));
