// Evaluates an oracle expression source against a context and function implementations (bin/lib/actions-oracle-load.mjs oracleEvaluate).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { oracleEvaluate } from '../lib/actions-oracle-load.mjs';

test('returns lex phase error when source is not valid for the lexer', () => {
  const oracle = {
    expressions: {
      Lexer: class {
        constructor(src) { this.src = src; }
        lex() {
          if (this.src.includes('bad')) throw new Error('lex fail');
          return { tokens: [] };
        }
      },
      Parser: class {
        constructor(tokens, names, fns) {}
        parse() { return { type: 'num', value: 1 }; }
      },
      Evaluator: class {
        constructor(ast, dict, impls) {}
        evaluate() { return 1; }
      },
      data: { reviver: undefined, replacer: undefined }
    }
  };
  const result = oracleEvaluate(oracle, 'bad', {});
  assert.deepEqual(result, { error: 'lex fail', phase: 'lex' });
});

test('returns parse phase error when tokens are not valid for the parser', () => {
  const oracle = {
    expressions: {
      Lexer: class {
        constructor(src) { this.src = src; }
        lex() { return { tokens: ['tok'] }; }
      },
      Parser: class {
        constructor(tokens, names, fns) {
          if (tokens[0] === 'tok') throw new Error('parse fail');
        }
        parse() { return { type: 'num', value: 1 }; }
      },
      Evaluator: class {
        constructor(ast, dict, impls) {}
        evaluate() { return 1; }
      },
      data: { reviver: undefined, replacer: undefined }
    }
  };
  const result = oracleEvaluate(oracle, 'anything', {});
  assert.deepEqual(result, { error: 'parse fail', phase: 'parse' });
});

test('returns evaluate phase error when evaluation throws', () => {
  const oracle = {
    expressions: {
      Lexer: class {
        constructor(src) { this.src = src; }
        lex() { return { tokens: [] }; }
      },
      Parser: class {
        constructor(tokens, names, fns) {}
        parse() { return { type: 'num', value: 1 }; }
      },
      Evaluator: class {
        constructor(ast, dict, impls) {}
        evaluate() { throw new Error('eval fail'); }
      },
      data: { reviver: undefined, replacer: undefined }
    }
  };
  const result = oracleEvaluate(oracle, 'x', {});
  assert.deepEqual(result, { error: 'eval fail', phase: 'evaluate' });
});

test('returns json stringified result on successful evaluation', () => {
  const oracle = {
    expressions: {
      Lexer: class {
        constructor(src) { this.src = src; }
        lex() { return { tokens: [] }; }
      },
      Parser: class {
        constructor(tokens, names, fns) {}
        parse() { return { type: 'num', value: 42 }; }
      },
      Evaluator: class {
        constructor(ast, dict, impls) {}
        evaluate() { return { a: 1, b: 2 }; }
      },
      data: { reviver: undefined, replacer: undefined }
    }
  };
  const result = oracleEvaluate(oracle, 'expr', { x: 1 });
  assert.deepEqual(result, { json: '{"a":1,"b":2}' });
});

test('passes context keys and function signatures to parser', () => {
  let parserArgs;
  const oracle = {
    expressions: {
      Lexer: class {
        constructor(src) { this.src = src; }
        lex() { return { tokens: [] }; }
      },
      Parser: class {
        constructor(tokens, names, fns) {
          parserArgs = { names, fns };
        }
        parse() { return { type: 'num', value: 0 }; }
      },
      Evaluator: class {
        constructor(ast, dict, impls) {}
        evaluate() { return 0; }
      },
      data: { reviver: undefined, replacer: undefined }
    }
  };
  const fns = [
    { name: 'Add', minArgs: 2, maxArgs: 2, call: () => 0 },
    { name: 'Sub', minArgs: 1, maxArgs: 3, call: () => 0 }
  ];
  oracleEvaluate(oracle, 'expr', { alpha: 1, beta: 2 }, fns);
  assert.deepEqual(parserArgs.names, ['alpha', 'beta']);
  assert.deepEqual(parserArgs.fns, [
    { name: 'Add', minArgs: 2, maxArgs: 2 },
    { name: 'Sub', minArgs: 1, maxArgs: 3 }
  ]);
});

test('lowercases function names when building evaluator impl map', () => {
  let implsMap;
  const oracle = {
    expressions: {
      Lexer: class {
        constructor(src) { this.src = src; }
        lex() { return { tokens: [] }; }
      },
      Parser: class {
        constructor(tokens, names, fns) {}
        parse() { return { type: 'num', value: 0 }; }
      },
      Evaluator: class {
        constructor(ast, dict, impls) {
          implsMap = impls;
        }
        evaluate() { return 0; }
      },
      data: { reviver: undefined, replacer: undefined }
    }
  };
  const fns = [
    { name: 'MyFunc', minArgs: 0, maxArgs: 1, call: () => 0 },
    { name: 'Other', minArgs: 1, maxArgs: 2, call: () => 0 }
  ];
  oracleEvaluate(oracle, 'expr', {}, fns);
  assert.ok(implsMap.has('myfunc'));
  assert.ok(implsMap.has('other'));
  assert.equal(implsMap.get('myfunc').name, 'MyFunc');
  assert.equal(implsMap.get('other').name, 'Other');
});

test('uses data reviver and replacer for context and result serialization', () => {
  let dictSeen;
  let replacerSeen;
  const oracle = {
    expressions: {
      Lexer: class {
        constructor(src) { this.src = src; }
        lex() { return { tokens: [] }; }
      },
      Parser: class {
        constructor(tokens, names, fns) {}
        parse() { return { type: 'num', value: 0 }; }
      },
      Evaluator: class {
        constructor(ast, dict, impls) {
          dictSeen = dict;
        }
        evaluate() { return { val: 99 }; }
      },
      data: {
        reviver: (key, value) => {
          if (key === 'special') return 'REVIVED';
          return value;
        },
        replacer: (key, value) => {
          if (key === 'val') return 'REPLACED';
          return value;
        }
      }
    }
  };
  const result = oracleEvaluate(oracle, 'expr', { special: 'orig', other: 5 });
  assert.equal(dictSeen.special, 'REVIVED');
  assert.equal(dictSeen.other, 5);
  assert.equal(result.json, '{"val":"REPLACED"}');
});

test('defaults functions to empty array when not provided', () => {
  let parserFns;
  const oracle = {
    expressions: {
      Lexer: class {
        constructor(src) { this.src = src; }
        lex() { return { tokens: [] }; }
      },
      Parser: class {
        constructor(tokens, names, fns) {
          parserFns = fns;
        }
        parse() { return { type: 'num', value: 0 }; }
      },
      Evaluator: class {
        constructor(ast, dict, impls) {}
        evaluate() { return null; }
      },
      data: { reviver: undefined, replacer: undefined }
    }
  };
  const result = oracleEvaluate(oracle, 'expr', { k: 1 });
  assert.deepEqual(parserFns, []);
  assert.deepEqual(result, { json: 'null' });
});
