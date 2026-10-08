#!/usr/bin/env node

import { stableStringify } from '../cra/lib.mjs';
import { loadIssues, verifyChain } from '../monitor/issue-store.mjs';
import { loadPolicy } from '../monitor/remediation-policy.mjs';
import { learningPath, loadLearning, rebuildLearning, saveLearning } from '../monitor/learning.mjs';

const args = new Set(process.argv.slice(2));
const allowed = new Set(['--dry', '--verify']);
const unknown = [...args].filter((arg) => !allowed.has(arg));
if (unknown.length || (args.has('--dry') && args.has('--verify'))) {
  console.error('usage: node bin/learning-rebuild.mjs [--dry|--verify]');
  process.exitCode = 2;
} else {
  try {
    const issuesDoc = loadIssues();
    const chainProblems = verifyChain(issuesDoc);
    if (chainProblems.length) throw new Error(`issue-store chain is invalid:\n  - ${chainProblems.join('\n  - ')}`);
    const current = args.has('--verify') ? loadLearning() : null;
    if (args.has('--verify') && !current) throw new Error(`learning view is absent at ${learningPath()}`);
    const now = process.env.CW_NOW || current?.generatedAt || new Date().toISOString();
    const rebuilt = rebuildLearning({ issuesDoc, now, policy: loadPolicy() });
    if (args.has('--dry')) process.stdout.write(`${JSON.stringify(rebuilt, null, 2)}\n`);
    else if (args.has('--verify')) {
      if (stableStringify(current) !== stableStringify(rebuilt)) {
        throw new Error(`learning view at ${learningPath()} does not match its event source; rebuild it`);
      }
      console.log(`learning view verified (${Object.keys(rebuilt.patterns).length} patterns)`);
    } else {
      saveLearning(rebuilt);
      console.log(`learning view rebuilt at ${learningPath()} (${Object.keys(rebuilt.patterns).length} patterns)`);
    }
  } catch (error) {
    console.error(`learning rebuild failed: ${error.message}`);
    process.exitCode = 1;
  }
}
