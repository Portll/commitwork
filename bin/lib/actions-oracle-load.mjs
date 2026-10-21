// Loads GitHub's own expression and workflow-parser packages from outside the repo, as a grading oracle.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { lexExpression, parseExpression, evaluateExpression, toPlain } from '../../lib/actions-expressions.mjs';

const oracleDir = (env) => env.CW_ACTIONS_ORACLE_DIR || path.join(os.homedir(), '.commitwork', 'oracles', 'actions');

export async function loadActionsOracle(env = process.env) {
  const dir = oracleDir(env);
  const pkgRoot = (name) => path.join(dir, 'node_modules', '@actions', name);
  try {
    const expressions = await import(pathToFileURL(path.join(pkgRoot('expressions'), 'dist', 'index.js')).href);
    const workflowParser = await import(pathToFileURL(path.join(pkgRoot('workflow-parser'), 'dist', 'index.js')).href);
    const version = (name) => JSON.parse(fs.readFileSync(path.join(pkgRoot(name), 'package.json'), 'utf8')).version;
    return { dir, expressions, workflowParser, versions: { expressions: version('expressions'), workflowParser: version('workflow-parser') } };
  } catch (e) {
    if (e?.code === 'ERR_IMPORT_ATTRIBUTE_MISSING') {
      return { dir, absent: `The oracle at ${dir} is installed but needs its JSON imports patched with \`with { type: "json" }\`.` };
    }
    if (e?.code === 'ERR_MODULE_NOT_FOUND' || e?.code === 'ENOENT') {
      return { dir, absent: `No oracle installed at ${dir} (${e.code}).` };
    }
    return { dir, absent: `The oracle at ${dir} failed to load: ${e?.code || ''} ${String(e?.message || e).split('\n')[0]}`.replace('  ', ' ') };
  }
}

// functions: [{ name, minArgs, maxArgs, call }], call taking and returning oracle data objects.
export function oracleEvaluate(oracle, src, contextPlain, functions = []) {
  const { Lexer, Parser, Evaluator, data } = oracle.expressions;
  let tokens; let ast;
  try { tokens = new Lexer(src).lex().tokens; } catch (e) { return { error: e.message, phase: 'lex' }; }
  try {
    ast = new Parser(tokens, Object.keys(contextPlain), functions.map(({ name, minArgs, maxArgs }) => ({ name, minArgs, maxArgs }))).parse();
  } catch (e) { return { error: e.message, phase: 'parse' }; }
  try {
    const dict = JSON.parse(JSON.stringify(contextPlain), data.reviver);
    const impls = new Map(functions.map((f) => [f.name.toLowerCase(), f]));
    const result = new Evaluator(ast, dict, impls).evaluate();
    return { json: JSON.stringify(result, data.replacer) };
  } catch (e) { return { error: e.message, phase: 'evaluate' }; }
}

// functions: same shape, with call taking and returning the in-tree module's plain values.
export function mineEvaluate(src, contextPlain, functions = []) {
  const specs = functions.map(({ name, minArgs, maxArgs }) => ({ name, minArgs, maxArgs }));
  let tokens; let ast;
  try { tokens = lexExpression(src); } catch (e) { return { error: e.message, phase: 'lex' }; }
  try { ast = parseExpression(tokens, { contexts: Object.keys(contextPlain), functions: specs }); } catch (e) { return { error: e.message, phase: 'parse' }; }
  try {
    const value = evaluateExpression(ast, contextPlain, { functions });
    return { json: JSON.stringify(toPlain(value)) };
  } catch (e) { return { error: e.message, phase: 'evaluate' }; }
}

const absentOk = (e) => e.code === 'ENOENT' || e.code === 'ENOTDIR';

function workflowFilesIn(repo) {
  const dir = path.join(repo, '.github', 'workflows');
  let names;
  try { names = fs.readdirSync(dir); } catch (e) { if (absentOk(e)) return []; throw e; }
  return names.filter((n) => /\.ya?ml$/.test(n)).sort().map((n) => path.join(dir, n));
}

function walkForWorkflows(dir, depth) {
  const out = workflowFilesIn(dir);
  if (depth === 0) return out;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { if (absentOk(e)) return out; throw e; }
  const names = entries.filter((x) => x.isDirectory() && x.name !== '.git' && x.name !== 'node_modules').map((x) => x.name).sort();
  for (const n of names) out.push(...walkForWorkflows(path.join(dir, n), depth - 1));
  return out;
}

// Each root is a repository or a folder of repositories, searched two levels down; the result is sorted and unique.
export function findWorkflowFiles(roots) {
  return [...new Set(roots.flatMap((r) => walkForWorkflows(r, 2)))].sort();
}
