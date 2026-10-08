#!/usr/bin/env node
// usage: node bin/commit-msg.mjs <message-file>   (git's commit-msg hook; bin/install-commit-msg.mjs installs it)
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { isMainModule } from '../lib/is-main.mjs';
import { validateConventional, formatErrors, rulesFor, SUBJECT_MAX } from './lib/conventional-commit.mjs';
import { hasForbiddenTrailer } from './commit-phase.mjs';

function gitConfig(key) {
  try {
    return execFileSync('git', ['config', '--get', key], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { return null; }
}

// fact: git hands the hook the message before cleanup, so comment lines and a `commit -v` diff below the scissors are still in it
export function cleanMessage(text, commentChar = '#') {
  const lines = String(text ?? '').replace(/\r\n?/g, '\n').split('\n');
  const scissors = lines.findIndex((l) => l === `${commentChar} ------------------------ >8 ------------------------`);
  const kept = (scissors === -1 ? lines : lines.slice(0, scissors)).filter((l) => !l.startsWith(commentChar));
  return `${kept.join('\n').replace(/^\n+/, '').replace(/\s+$/, '')}\n`;
}

/** { ok } or { ok: false, lines } for a cleaned message under the named rule set. */
export function checkMessage(message, rulesName) {
  if (hasForbiddenTrailer(message)) {
    return { ok: false, lines: ['commit-msg: REFUSED. The message carries a Co-Authored-By trailer, which is forbidden here.'] };
  }
  const subject = message.split('\n')[0];
  if (/^(?:fixup|squash|amend)! /.test(subject)) return { ok: true };
  const rules = rulesFor(rulesName);
  if (!rules.ok) return { ok: false, lines: [`commit-msg: REFUSED. ${rules.why}.`] };
  const verdict = validateConventional(message, rules.opts);
  if (verdict.ok) return { ok: true };
  return {
    ok: false,
    lines: [
      `commit-msg: REFUSED. The message does not meet the ${rules.name} commit rules.`,
      formatErrors(verdict, { subject }),
      `  Shape: <type>(<scope>)[!]: <imperative verb> … (≤${SUBJECT_MAX} chars), blank line, body, blank line, footers.`,
    ],
  };
}

function main(argv) {
  const file = argv[0];
  if (!file) {
    console.error('commit-msg: REFUSED. git passed no message file.');
    return 1;
  }
  let text;
  try { text = readFileSync(file, 'utf8'); } catch (e) {
    console.error(`commit-msg: REFUSED. ${file} could not be read (${e.code || e.message}).`);
    return 1;
  }
  const char = gitConfig('core.commentChar');
  const result = checkMessage(cleanMessage(text, char && char.length === 1 ? char : '#'), gitConfig('commitwork.rules'));
  if (result.ok) return 0;
  for (const line of result.lines) console.error(line);
  console.error(`  Nothing was committed. The message is kept in ${file}; edit it and commit again: git commit -e -F ${file}`);
  return 1;
}

if (isMainModule(import.meta.url)) process.exit(main(process.argv.slice(2)));
