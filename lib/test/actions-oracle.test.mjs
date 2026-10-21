// Parity of the in-tree Actions expression language with GitHub's own packages, installed outside the repo.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { findWorkflowFiles, loadActionsOracle, oracleEvaluate, mineEvaluate } from '../../bin/lib/actions-oracle-load.mjs';
import { expressionSites, parseExpression, splitAllowedContext } from '../actions-expressions.mjs';
import { compareWorkflow } from '../actions-oracle-compare.mjs';

let oracle;
before(async () => { oracle = await loadActionsOracle(); });

const CONTEXT = {
  github: {
    event_name: 'push', ref: 'refs/heads/main', sha: 'abc123', empty: '', zero: 0, one: 1, pi: 3.5, neg: -2, yes: true, no: false, nothing: null,
    num_str: '42', hex_str: '0x1F', blank: ' ', turkish: 'ıi', upper_i: 'I', big: 1e21,
    list: [1, 2, 3, 'x', null], nested: [[1, 2], [3, [4, 5]]], names: ['Alpha', 'beta', 'GAMMA'],
    rows: [{ y: 1, k: 'a' }, { y: 2, k: 'b' }, { z: 3 }, 5, null], empty_list: [],
    obj: { a: { b: { c: 'deep' } }, A: 'upper', list: [{ n: 1 }, { n: 2 }] }, empty_obj: {},
    Case: 'mixed', case: 'lower',
  },
  env: { EMPTY: '', FOO: 'bar', Num: '7', JSON: '{"a":[1,2,{"b":null}]}', ARR: '[1,"two",true]' },
  matrix: { node: 20, os: 'linux', include: [{ node: 18 }, { node: 22 }] },
  job: { status: 'success' }, runner: { os: 'Linux' },
};

const STATUS = [
  { name: 'always', minArgs: 0, maxArgs: 0 }, { name: 'cancelled', minArgs: 0, maxArgs: 0 },
  { name: 'success', minArgs: 0, maxArgs: Number.MAX_SAFE_INTEGER }, { name: 'failure', minArgs: 0, maxArgs: Number.MAX_SAFE_INTEGER },
];
const functionsFor = (side) => {
  const { BooleanData, StringData } = oracle.expressions.data;
  const yes = side === 'oracle' ? () => new BooleanData(true) : () => true;
  const empty = side === 'oracle' ? () => new StringData('') : () => '';
  return [...STATUS.map((f) => ({ ...f, call: yes })), { name: 'hashFiles', minArgs: 1, maxArgs: 255, call: empty }];
};

const BATTERY = [
  // literals and number lexing
  '1', '-1', '+1', '.5', '1.5', '1e3', '1E3', '1e-2', '0x1F', '0xff', '0X10', '-0x1F', '1e400', '-1e400', 'NaN', 'Infinity', '-Infinity', '0', '-0', '0.0',
  'true', 'false', 'null', "'abc'", "''", "'it''s'", "'a''''b'", "'ünï'", "'line\\n'",
  // equality coercions
  '1 == 1', "1 == '1'", "'1' == 1", "1 == '1.0'", "1 == ' 1 '", "1 == ''", "0 == ''", '0 == null', 'null == 0', "null == ''", "'' == null", 'null == null', 'null == false',
  'true == 1', "true == '1'", 'false == 0', "false == ''", "true == 'true'", 'false == null', '1 != 1', "'abc' == 'ABC'", "'abc' != 'ABC'", "'ı' == 'I'", "'i' == 'I'", "'ı' == 'i'", "'İ' == 'i'",
  'NaN == NaN', 'NaN != NaN', 'Infinity == Infinity', '-Infinity == Infinity', "'NaN' == NaN", "'Infinity' == Infinity", "'0x1F' == 31", "31 == '0x1F'", "'1e3' == 1000", "'abc' == 0",
  'github.obj == github.obj', 'github.list == github.list', 'github.obj == 1', 'github.list == null', 'github.rows == github.rows', 'github.empty_obj == github.empty_obj',
  // ordering
  '1 < 2', '2 < 1', '1 <= 1', '1 >= 2', '1 > 0', "'a' < 'b'", "'a' < 'B'", "'B' < 'a'", "'a' <= 'A'", "'a' >= 'A'", "'abc' < 'abd'", "'10' < '9'", "'10' < 9", "10 > '9'", "'x' < 1", "1 < 'x'",
  'null < 1', 'null > -1', 'null >= 0', 'null <= null', 'null < null', 'true > false', 'true > 0', 'true >= 1', 'false < 1', 'null < true', "'' < 1", "'' >= 0",
  'NaN < 1', 'NaN > 1', 'NaN >= NaN', 'NaN <= NaN', 'Infinity > 1', '1 < Infinity', '-Infinity < Infinity', "'0x10' > 15", "'1e2' > 99", "'ı' < 'j'", "'İ' > 'a'",
  'github.list < 1', 'github.obj > github.obj', 'github.list <= github.list', '1 < github.obj',
  // logical and negation
  '!true', '!false', '!null', "!''", "!'a'", '!0', '!1', '!NaN', '!github.list', '!github.empty_list', '!github.obj', '!!github.obj', '!!0',
  '1 && 2', '0 && 2', "'' && 1", 'null && 1', '1 && 0', '1 && null && 2', 'true && false || true', "false || 'b'", "'' || 'b'", '0 || null', "null || ''", '1 || 2',
  'false || null || 0', "github.nothing || github.empty || 'x'", 'github.yes && github.pi', 'github.no && github.pi', "!github.no && !github.yes || 'z'",
  "NaN || 'nan'", 'NaN && 1', 'github.obj && 1', 'github.empty_obj || 2',
  // grouping and depth
  '(1)', '((1))', '(1 == 1) == true', '!(1 == 2)', '(1 || 2) && 3', '1 || (2 && 3)', '(github.obj).a.b.c', '(github.list)[0]', '(((((((((((((((((((1)))))))))))))))))))',
  `${'('.repeat(60)}1${')'.repeat(60)}`, `${'('.repeat(20)}1${')'.repeat(20)}`,
  // functions
  "contains('Hello', 'ell')", "contains('Hello', 'ELL')", "contains('Hello', '')", "contains('', '')", "contains('', 'a')", 'contains(123, 2)', "contains(1.5, '.')", "contains(null, '')", "contains(true, 'RUE')",
  'contains(github.list, 2)', "contains(github.list, '2')", "contains(github.list, 'X')", 'contains(github.list, null)', 'contains(github.list, 4)', "contains(github.names, 'alpha')", "contains(github.names, 'GAMMA')",
  'contains(github.nested, 1)', 'contains(github.rows, 5)', 'contains(github.empty_list, 1)', "contains(github.obj, 'a')", 'contains(github.list, true)', 'contains(github.list, 1.0)',
  "startsWith('Hello', 'he')", "startsWith('Hello', 'x')", "startsWith('', '')", 'startsWith(123, 1)', 'startsWith(github.list, 1)', "startsWith(null, '')", "startsWith('abc', null)",
  "endsWith('Hello', 'LLO')", "endsWith('Hello', 'x')", "endsWith('', '')", "endsWith(1.5, '5')", "endsWith(github.obj, 'a')", "endsWith('abc', '')",
  "format('{0}', 1)", "format('{0}-{1}', 'a', 'b')", "format('{1}{0}', 'a', 'b')", "format('{{0}}', 1)", "format('{{{0}}}', 1)", "format('{0}{0}', 'x')", "format('}}')", "format('{{')", "format('plain')",
  "format('{0}', null)", "format('{0}', true)", "format('{0}', 1.5)", "format('{0}', 1e21)", "format('{0}', NaN)", "format('{0}', Infinity)", "format('{0}', -Infinity)", "format('{0}', -0)", "format('{0}', 0.1)",
  "format('{0}', github.list)", "format('{0}', github.obj)", "format('{0}', github.nothing)", "format('{0:x}', 1)", "format('{0 }', 1)", "format('{ 0}', 1)", "format('{a}', 1)",
  "format('{0}')", "format('{1}', 'a')", "format('{', 1)", "format('}', 1)", "format('{0', 1)", "format('0}', 1)", "format('{}', 1)", "format('{{}}')", "format('{10}', 1)", "format('{00}', 1)", "format('{0}', 1, 2, 3)",
  'format()', 'format(1)', "format('{0}{1}{2}{3}{4}{5}{6}{7}{8}{9}{10}', 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10)",
  'join(github.list)', "join(github.list, '-')", "join(github.names, ', ')", "join(github.names, '')", "join('abc')", "join('abc', '-')", 'join(123)', 'join(null)', 'join(github.empty_list)', 'join(github.nested)', "join(github.rows, ',')",
  'join(github.list, null)', 'join(github.list, 1)', 'join(github.obj)', "join(github.obj, ',')", 'join(true)', 'join(github.list, github.list)',
  'toJSON(1)', "toJSON('a')", 'toJSON(null)', 'toJSON(true)', 'toJSON(github.list)', 'toJSON(github.nested)', 'toJSON(github.obj)', 'toJSON(github.empty_obj)', 'toJSON(github.empty_list)', 'toJSON(github.rows)', 'toJSON(NaN)', 'toJSON(1.5)', 'toJSON(github.big)', 'toJSON(github.obj.list)', 'toJSON(github.rows.*.y)', "toJSON('a\"b')", 'toJSON(github)', 'toJSON(env)', 'toJSON(matrix)',
  "fromJSON('[1,2,3]')", "fromJSON('[1,2,3]')[1]", "fromJSON('{\"a\":1}').a", "fromJSON('{\"a\":{\"b\":[true,null]}}').a.b[0]", "fromJSON('1')", "fromJSON('\"s\"')", "fromJSON('null')", "fromJSON('true')", "fromJSON('')", "fromJSON(' ')", "fromJSON('{')", "fromJSON('[1,]')", "fromJSON('nope')", 'fromJSON(null)', 'fromJSON(1)', 'fromJSON(github.list)',
  'fromJSON(env.JSON)', 'fromJSON(env.JSON).a[2].b', 'fromJSON(env.ARR)', 'fromJSON(env.ARR)[1]', 'fromJSON(env.ARR)[*]', "fromJSON('{\"a\":1,\"A\":2}')", "fromJSON('1e3')", "fromJSON('0x10')", "fromJSON('-0')", "fromJSON('123456789012345678901234567890')", "fromJSON('{\"__proto__\":1}')", "toJSON(fromJSON('{\"b\":[],\"c\":{}}'))", "fromJSON('NaN')",
  "case(true, 'a', 'z')", "case(false, 'a', 'z')", "case(false, 'a', true, 'b', 'z')", 'case(1 == 1, 1, 2)', "case(1, 'a', 'z')", "case('true', 'a', 'z')", "case(null, 'a', 'z')", "case(true, 'a')", "case('z')", "case(true, 'a', false, 'b')", 'case(github.yes, github.obj, null)',
  'success()', 'failure()', 'always()', 'cancelled()', 'success(1)', "failure('a', 'b')", 'always(1)', 'cancelled(1)', '!cancelled() && success()', "hashFiles('**/*.lock')", 'hashFiles()', "hashFiles('a', 'b')", "always() && github.event_name == 'push'", "format('{0}', hashFiles('x'))",
  'CONTAINS(github.list, 1)', "Format('{0}', 1)", 'ToJson(1)', "fromjson('[1]')[0]", 'SUCCESS()',
  // contexts and property access
  'github', 'env', 'matrix', 'github.event_name', 'GITHUB.EVENT_NAME', 'Github.Ref', 'github.missing', 'github.missing.deep', 'github.missing[0]', 'github.missing.*', 'github.obj.a.b.c', 'github.obj.a.b.missing.c', 'github.obj.a', 'github.obj.A', 'github.case', 'github.Case', 'github.CASE',
  'github.event_name.length', 'github.list.length', 'github.nothing.x', 'github.yes.x', 'github.one.x', 'github.empty.x',
  // index access
  "github['event_name']", "github['EVENT_NAME']", "github['missing']", "github.obj['a']['b']['c']", "github.obj['a'].b['c']", "github['obj']['list'][1]['n']",
  'github.list[0]', 'github.list[4]', 'github.list[5]', 'github.list[-1]', 'github.list[1.5]', 'github.list[1.0]', "github.list['1']", "github.list['x']", "github.list[' 1 ']", "github.list['0x1']", 'github.list[true]', 'github.list[null]', 'github.list[NaN]', 'github.list[Infinity]', 'github.list[1e0]', 'github.list[github.one]', 'github.list[github.one + 1]',
  'github.list[github.zero]', 'github.list[github.num_str]', 'github.list[github.pi]', 'github.list[github.neg]', 'github.list[github.list]', 'github.list[github.obj]', 'github.list[github.nothing]', 'github.list[github.empty]',
  'github.nested[1][1][0]', 'github.nested[1][1][2]', 'github.nested[0][0]', 'github.empty_list[0]', 'github.empty_obj.a', "github.empty_obj['a']", 'github.empty_obj[0]', 'github.obj[0]', 'github.obj[1.5]', 'github.obj[null]', 'github.obj[true]', "github.obj['A']", 'github.obj[github.empty]',
  'github.event_name[0]', "github.event_name['length']", 'github.sha[1]', 'github.one[0]', 'github.yes[0]', 'github.nothing[0]', 'github.empty[0]', 'github.event_name[*]', 'github.one[*]', 'github.nothing[*]', 'github.yes.*',
  "'abc'[0]", "'abc'.length", "'abc'[*]", "fromJSON('[1]')[0][0]", 'toJSON(github.list)[0]', '(1 || 2)[0]', 'github.obj.list[0].n', 'github.obj.list[2]', 'github.obj.list[-1]',
  // object filters
  'github.rows.*.y', 'github.rows[*].y', 'github.rows.*.k', 'github.rows[*].z', 'github.rows.*.missing', 'github.rows.*', 'github.rows[*]', 'github.rows.*.y.*', 'github.rows.*.*', 'github.rows[*].*',
  'github.obj.*', 'github.obj.*.b', 'github.obj.*.b.c', 'github.obj.a.*', 'github.obj.a.*.c', 'github.obj.*.*', 'github.obj.*.*.*', 'github.obj.list.*.n', 'github.obj[*].list[*].n', 'github.obj.list[*].n[0]',
  'github.nested.*', 'github.nested.*.*', 'github.nested[*][*]', 'github.nested[*][0]', 'github.nested[*][1]', 'github.nested.*.*.*', 'github.nested[*][1][*]', 'github.nested[*][1][1]', 'github.nested[*][1][0]',
  'github.list.*', 'github.list.*.x', 'github.empty_list.*', 'github.empty_list.*.x', 'github.empty_obj.*', 'github.empty_obj.*.x', 'github.event_name.*', 'github.yes.*.x', 'github.nothing.*', 'github.missing.*.x',
  'matrix.include.*.node', 'matrix.include[*].node', 'matrix.*', 'matrix.*.*', 'env.*', 'github.*.event_name', 'github.*.a', 'github.*.*.b', 'github.*.list.*.n', 'github.*.*.*.c',
  'contains(github.rows.*.y, 2)', 'contains(matrix.include.*.node, 22)', "join(github.rows.*.y, ',')", "join(github.obj.*.b.c, ',')", 'toJSON(github.rows.*.y)', 'toJSON(github.nested.*.*)', 'toJSON(github.*.a)', "format('{0}', github.rows.*.y)", 'github.rows.*.y == github.rows.*.y', 'github.rows.*.y == 1', '!github.rows.*.zz', '!github.empty_list.*',
  'github.rows.*.y[0]', 'github.rows.*.y[1]', "github.rows.*['y']", "github.rows['*']", "github.rows[*]['y']", "github.rows.*.y || 'none'", "github.empty_list.* || 'none'", "github.rows.*.zz || 'none'",
  // refusals: both sides must reject in the same phase
  'unknown', 'unknown.x', 'unknownfn()', 'contains()', 'contains(1)', 'contains(1, 2, 3)', 'startsWith(1)', 'endsWith(1, 2, 3)', 'fromJSON()', 'fromJSON(1, 2)', 'toJSON()', 'toJSON(1, 2)', 'join()', 'join(1, 2, 3)', 'success', 'format',
  '=', '1 = 1', "'a' = 'a'", "'unterminated", "'a''", '1 +', '1 + 1', '1 - 1', '1 * 2', '1 / 2', '1 % 2', '1 & 1', '1 | 1', '1 ^ 1', '~1', '1 ? 2 : 3', '1 <> 2', '1 === 1', '1 !== 1', '1 && ', '|| 1', '&& 1', '1 ||', '!', '()', '(', ')', '(1', '1)', '((1)',
  'a.1', 'github.1', 'github.0', 'github.1a', 'github..a', 'github.', '.github', 'github.[0]', 'github[', 'github[]', 'github[0', 'github[0]]', 'github[*', 'github.*.', 'github[0].', 'github.list[*', '1.2.3', '1e', '1ee1', '0x', '0xG', '0x1.5', '1_0', '1a', '--1', '- 1', '+ 1',
  '1 1', "'a' 'b'", 'true false', 'null null', '1,2', 'contains(1,)', 'contains(,1)', 'contains(1 2)', 'contains(1;2)', 'a b', 'github event_name', '${{ 1 }}', '{1}', '[1]', '1 // 2', '# 1', '@', '$', '"double"', '`tick`',
  'github.event-name', 'github.event name', 'github.$x', 'github._x', 'github.x_', 'github.-x', 'github.x-y-z', 'github.Ünï', 'github.a.true', 'github.null', 'github.NaN', 'github.Infinity', 'true.x', 'null.x', 'null[0]', 'null.*', '1.x', '1[0]', "'a'.x", 'true[0]',
  'contains', 'contains(', 'contains(1', 'contains(1,', 'contains(1, 2', 'contains 1', 'contains (1, 2)', "format ('{0}', 1)", 'success ()', 'github .ref', 'github. ref', 'github [0]', 'github.list [0]', 'github.list[ 0 ]', 'github . ref',
  'NAN', 'nan', 'infinity', 'INFINITY', 'TRUE', 'False', 'NULL', 'Null', '+Infinity', '-NaN', '+NaN', '- Infinity', '1e+3', '1e+', '.', '.e1', '5.', '5.e1', '0.5.5', '00', '007', '1e0x1',
  '!!', '!(', '! true', '!  !true', '!github', '!-1', '-!1', 'true!', '!true!', '1 == == 1', '1 != != 1', '1 < < 2', '< 1', '1 >', '1 > > 2', '1 == ', '== 1', '1 <= <= 1',
  'case()', 'case(1)', 'case(1, 2)', 'case(true, 1, 2, 3)', 'case(true, 1, false, 2, 3, 4)', "hashFiles('a'", "format('{0}', 1,)", 'format(,)', 'toJSON(,)', 'join(,)',
];
const EXPRESSIONS = [...new Set(BATTERY)];

test('the battery holds at least 150 distinct expressions', () => {
  assert.ok(EXPRESSIONS.length >= 150, `only ${EXPRESSIONS.length}`);
});

test('expression parity: the in-tree evaluator agrees with the oracle', (t) => {
  if (oracle.absent) return t.skip(oracle.absent);
  const oracleFns = functionsFor('oracle'); const mineFns = functionsFor('mine');
  const mismatches = [];
  let evaluated = 0; let refused = 0;
  for (const src of EXPRESSIONS) {
    const theirs = oracleEvaluate(oracle, src, CONTEXT, oracleFns);
    const mine = mineEvaluate(src, CONTEXT, mineFns);
    if (theirs.error !== undefined) refused++; else evaluated++;
    const same = theirs.error !== undefined
      ? mine.error !== undefined && mine.phase === theirs.phase
      : mine.error === undefined && mine.json === theirs.json;
    if (!same) mismatches.push(`${JSON.stringify(src)}\n    mine:   ${JSON.stringify(mine)}\n    oracle: ${JSON.stringify(theirs)}`);
  }
  console.log(`expression parity: ${EXPRESSIONS.length} expressions, ${evaluated} evaluated, ${refused} refused by the oracle, ${mismatches.length} mismatches`);
  assert.equal(mismatches.length, 0, `${mismatches.length} mismatch(es):\n  ${mismatches.join('\n  ')}`);
});

// ── corpus: parse acceptance only ────────────────────────────────────────────────────────────────
const CAP = 200000;
const ALLOWED = ['github', 'env', 'vars', 'job', 'jobs', 'steps', 'runner', 'secrets', 'strategy', 'matrix', 'needs', 'inputs',
  'always(0,0)', 'failure(0,MAX)', 'cancelled(0,0)', 'success(0,MAX)', 'hashFiles(1,255)'];

test('corpus parity: parse acceptance matches the oracle on real workflows', (t) => {
  if (oracle.absent) return t.skip(oracle.absent);
  const raw = process.env.CW_ACTIONS_CORPUS_ROOTS;
  if (!raw) return t.skip('CW_ACTIONS_CORPUS_ROOTS is not set');
  const { contexts, functions } = splitAllowedContext(ALLOWED);
  const { Lexer, Parser } = oracle.expressions;
  let files = 0; let expressions = 0; let agree = 0; const disagreements = [];
  outer:
  for (const root of raw.split(path.delimiter).filter(Boolean)) {
    for (const file of findWorkflowFiles([root])) {
      let text;
      try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
      files++;
      for (const site of expressionSites(text)) {
        if (site.expression === null) continue;
        if (expressions >= CAP) break outer;
        expressions++;
        let mine = true; let theirs = true;
        try { parseExpression(site.expression, { contexts, functions }); } catch { mine = false; }
        try { new Parser(new Lexer(site.expression).lex().tokens, contexts, functions).parse(); } catch { theirs = false; }
        if (mine === theirs) agree++;
        else disagreements.push(`${file}:${site.expression} (mine ${mine ? 'accepts' : 'refuses'}, oracle ${theirs ? 'accepts' : 'refuses'})`);
      }
    }
  }
  console.log(`corpus parity: ${files} files, ${expressions} expressions, ${agree} agree, ${disagreements.length} disagree`);
  assert.equal(disagreements.length, 0, `first 20 of ${disagreements.length}:\n  ${disagreements.slice(0, 20).join('\n  ')}`);
});

const WORKFLOWS = {
  'matrix-and-steps.yml': `name: ci
on:
  push:
    branches: [main]
  pull_request:
  schedule:
    - cron: '0 3 * * 1'
env:
  A: 1
jobs:
  build:
    runs-on: \${{ matrix.os }}
    strategy:
      matrix:
        os: [ubuntu-latest]
        node: [18, 20]
        include:
          - node: 22
            extra: yes
    steps:
      - uses: actions/checkout@v4
      - name: "n-\${{ github.sha }}"
        run: |
          echo \${{ github.sha }}
          echo done
        env:
          N: \${{ matrix.node }}
      - run: echo
        id: given
      - uses: ./local/action
      - uses: docker://alpine:3
      - run: echo
        if: failure()
      - run: echo
        if: github.ref == 'x' && !cancelled()
      - run: echo
        if: \${{ github.event_name == 'push' }}
  release:
    needs: build
    if: github.ref == 'refs/heads/main'
    runs-on: ubuntu-latest
    container: { image: node:20, env: { X: y } }
    services:
      db: { image: postgres, ports: ['5432:5432'] }
    environment: { name: prod, url: "\${{ steps.x.outputs.url }}" }
    concurrency: { group: rel, cancel-in-progress: true }
    outputs: { v: "\${{ steps.given.outputs.v }}" }
    steps: [{ run: echo }]
  call:
    uses: ./.github/workflows/x.yml
    with: { a: 1 }
    secrets: inherit
`,
  'dispatch.yml': `on:
  workflow_dispatch:
    inputs:
      level: { type: choice, options: [a, b], default: a }
      flag: { type: boolean, default: true }
  workflow_call:
    inputs:
      who: { type: string, required: true }
    secrets:
      token: { required: true }
permissions: read-all
concurrency: grp
defaults:
  run:
    shell: bash
jobs:
  a:
    runs-on: [self-hosted, linux]
    timeout-minutes: 5
    continue-on-error: \${{ inputs.flag }}
    steps:
      - run: echo "\${{ inputs.who }}"
        working-directory: \${{ github.workspace }}
        continue-on-error: true
        timeout-minutes: 2
      - parallel:
          - run: one
          - run: two
`,
  'unexpected-key.yml': 'on: push\njobs:\n  a:\n    runs-on: x\n    nope: 1\n    steps: [{ run: echo }]\n',
  'bad-expression.yml': 'on: push\njobs:\n  a:\n    runs-on: x\n    steps: [{ run: "\${{ nope.x }}" }]\n',
};

test('workflow parity: fixtures model identically or are refused by both', async (t) => {
  if (oracle.absent) return t.skip(oracle.absent);
  const expected = { 'matrix-and-steps.yml': 'agree', 'dispatch.yml': 'agree', 'unexpected-key.yml': 'both-refused', 'bad-expression.yml': 'both-refused' };
  for (const [name, text] of Object.entries(WORKFLOWS)) {
    const r = await compareWorkflow(text, name, oracle);
    assert.equal(r.status, expected[name], `${name}: ${r.detail}`);
  }
});

test('workflow parity: real workflows are modelled as the oracle models them', async (t) => {
  if (oracle.absent) return t.skip(oracle.absent);
  const raw = process.env.CW_ACTIONS_CORPUS_ROOTS;
  if (!raw) return t.skip('CW_ACTIONS_CORPUS_ROOTS is not set');
  const counts = {}; const problems = [];
  for (const file of findWorkflowFiles(raw.split(path.delimiter).filter(Boolean))) {
    let text;
    try { text = fs.readFileSync(file, 'utf8'); } catch (e) { if (e.code === 'ENOENT') continue; throw e; }
    const r = await compareWorkflow(text, path.basename(file), oracle);
    counts[r.status] = (counts[r.status] || 0) + 1;
    if (r.status === 'disagree' || r.status === 'oracle-refused') problems.push(`${file}: ${r.status} ${r.detail}`);
  }
  console.log(`workflow parity: ${JSON.stringify(counts)}`);
  assert.equal(problems.length, 0, `first 20 of ${problems.length}:\n  ${problems.slice(0, 20).join('\n  ')}`);
});
