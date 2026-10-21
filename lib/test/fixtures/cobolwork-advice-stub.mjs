#!/usr/bin/env node
// A stand-in for cobolwork's `capabilities --json` and `advise`, for the advice tests. CW_TEST_ADVICE_CAPS
// picks what its capabilities state: `advise` (the default), `none` (cobolwork 0.9.0, which has no
// advise), `v2` (an advice document at schemaVersion 2) or `no-ironwork` (advise without --ironwork).
// advise prints CW_TEST_ADVICE_DOC, else the stored document beside this file, and appends its argv
// to CW_TEST_ADVICE_ARGV when that is set. Exit 2 with a reason on stderr when it cannot answer.
import { appendFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.env.CW_TEST_ADVICE_CAPS || 'advise';
const [command] = process.argv.slice(2);
const refuse = (msg) => { process.stderr.write(`cobolwork: ${msg}\n`); process.exitCode = 2; };

const commands = { capabilities: { args: [], options: ['--json'], documents: ['cobolwork-capabilities'] } };
const documents = { cobolwork: 3, 'cobolwork-capabilities': 1 };
if (mode !== 'none') {
  commands.advise = { args: ['<path>'], options: ['--format', ...(mode === 'no-ironwork' ? [] : ['--ironwork'])], documents: ['cobolwork-advice', 'sarif', 'markdown'] };
  documents['cobolwork-advice'] = mode === 'v2' ? 2 : 1;
}

if (command === 'capabilities') {
  process.stdout.write(JSON.stringify({ tool: 'cobolwork-capabilities', schemaVersion: 1, toolVersion: mode === 'none' ? '0.9.0' : 'stand-in',
    commands, documents, identity: { version: 'cobolwork/v1' } }) + '\n');
} else if (command === 'advise' && commands.advise) {
  if (process.env.CW_TEST_ADVICE_ARGV) appendFileSync(process.env.CW_TEST_ADVICE_ARGV, JSON.stringify(process.argv.slice(2)) + '\n');
  process.stdout.write(readFileSync(process.env.CW_TEST_ADVICE_DOC || join(dirname(fileURLToPath(import.meta.url)), 'cobolwork-advice-001.json'), 'utf8'));
} else refuse(`unknown command ${command}`);
