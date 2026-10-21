#!/usr/bin/env node
// Grades the in-tree Actions expression and workflow parsers against GitHub's own packages over workflow files.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { findWorkflowFiles, loadActionsOracle } from './lib/actions-oracle-load.mjs';
import { expressionSites, parseExpression, splitAllowedContext } from '../lib/actions-expressions.mjs';
import { writeAtomic } from '../monitor/lockfile.mjs';

const ALLOWED = ['github', 'env', 'vars', 'job', 'jobs', 'steps', 'runner', 'secrets', 'strategy', 'matrix', 'needs', 'inputs',
  'always(0,0)', 'failure(0,MAX)', 'cancelled(0,0)', 'success(0,MAX)', 'hashFiles(1,255)'];
const STATUSES = ['agree', 'disagree', 'mine-refused', 'oracle-refused', 'both-refused'];

function parseArgs(argv) {
  const opts = { roots: [], out: null, limit: Infinity };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') opts.roots.push(argv[++i]);
    else if (a === '--out') opts.out = argv[++i];
    else if (a === '--limit') opts.limit = Number(argv[++i]);
    else throw new Error(`unknown argument ${a}`);
  }
  if (!opts.roots.length || opts.roots.some((r) => !r)) throw new Error('at least one --root <dir> is required');
  if (Number.isNaN(opts.limit) || opts.limit < 1) throw new Error('--limit needs a positive number');
  return opts;
}

async function loadCompare() {
  const file = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'lib', 'actions-oracle-compare.mjs');
  if (!fs.existsSync(file)) return null;
  return (await import(pathToFileURL(file).href)).compareWorkflow;
}

async function main() {
  let opts;
  try { opts = parseArgs(process.argv.slice(2)); } catch (e) { console.error(`actions-grade: ${e.message}`); return 2; }
  const oracle = await loadActionsOracle();
  if (oracle.absent) { console.error(`actions-grade: ${oracle.absent}`); return 2; }
  const compareWorkflow = await loadCompare();
  const { Lexer, Parser } = oracle.expressions;
  const { contexts, functions } = splitAllowedContext(ALLOWED);

  const roots = opts.roots.map((r) => path.resolve(r));
  const files = findWorkflowFiles(roots);
  const exprCounts = { agree: 0, disagree: 0 };
  const wfCounts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
  const disagreements = [];
  let expressions = 0;

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const site of expressionSites(text)) {
      if (site.expression === null || expressions >= opts.limit) continue;
      expressions++;
      let mine = true; let theirs = true;
      try { parseExpression(site.expression, { contexts, functions }); } catch { mine = false; }
      try { new Parser(new Lexer(site.expression).lex().tokens, contexts, functions).parse(); } catch { theirs = false; }
      if (mine === theirs) exprCounts.agree++;
      else {
        exprCounts.disagree++;
        disagreements.push(`${file}:${site.expression} (mine ${mine ? 'accepts' : 'refuses'}, oracle ${theirs ? 'accepts' : 'refuses'})`);
      }
    }
    if (compareWorkflow) {
      const r = await compareWorkflow(text, path.basename(file), oracle);
      wfCounts[r.status] = (wfCounts[r.status] || 0) + 1;
      if (r.status === 'disagree') disagreements.push(`${file}:${r.detail}`);
    }
  }

  const rows = [['files', files.length], ['expressions', expressions], ['agree', exprCounts.agree], ['disagree', exprCounts.disagree]];
  if (compareWorkflow) for (const s of STATUSES) rows.push([`workflow ${s}`, wfCounts[s]]);
  else rows.push(['workflow comparison', 'unavailable']);
  for (const [k, v] of rows) console.log(`${k.padEnd(22)}${v}`);
  if (disagreements.length) {
    console.log(`first ${Math.min(20, disagreements.length)} disagreements:`);
    for (const d of disagreements.slice(0, 20)) console.log(`  ${d}`);
  }
  if (opts.out) {
    const report = {
      generatedBy: 'bin/actions-grade.mjs',
      oracleVersions: oracle.versions,
      roots,
      files: files.length,
      expressions: { total: expressions, ...exprCounts },
      workflows: compareWorkflow ? wfCounts : null,
      disagreements,
    };
    writeAtomic(opts.out, `${JSON.stringify(report, null, 2)}\n`);
  }
  return 0;
}

process.exitCode = await main();
