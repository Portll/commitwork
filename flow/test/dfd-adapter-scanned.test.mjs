// The pure halves of drawing a scanned repository (flow/dfd-adapter.mjs): what the static pass could
// not read, as a model's source.unknown, and the merge of its model with a CodeQL one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unknownOf, repoRelative, mergeModels, fromCodeFlows } from '../dfd-adapter.mjs';
import { validateDfd } from '../../lib/dfd.mjs';

const record = (repo, rule, src, sink) => ({ repo, rule, file: sink, reachability: 'reachable',
  path: { steps: 3, flows: 1, source: { file: src, line: 1, expr: 'input' }, sink: { file: sink, line: 2, expr: 'sink()' } } });
const staticModel = () => ({
  v: 1, kind: 'dfd', title: 'static',
  source: { producer: 'flow-graph', graph: { v: 1, nodes: 3, edges: 2 }, options: { merged: { storesRenamed: 0 } }, omitted: { importEdges: 1 }, unknown: { files: 2 } },
  nodes: [
    { id: 'node:module:src/a.ts', kind: 'process', label: 'src/a.ts', group: 'src' },
    { id: 'node:module:main.js', kind: 'process', label: 'main.js' },
    { id: 'node:artifact:out/x.json', kind: 'store', subtype: 'file', label: 'out/x.json' },
  ],
  flows: [
    { from: 'node:module:src/a.ts', to: 'node:artifact:out/x.json', label: 'writes', mode: 'sync', existence: 'unknown' },
    { from: 'node:artifact:out/x.json', to: 'node:module:main.js', label: 'reads', mode: 'sync', existence: 'unknown' },
  ],
});

test('unknownOf: nothing to say about a hand-made graph', () => {
  // arrange
  const graphs = [null, { nodes: [], edges: [] }];

  // act
  const got = graphs.map(unknownOf);

  // assert
  assert.deepEqual(got, [null, null]);
});

test('unknownOf takes the summary\'s counts and names each unread module with its first reason line', () => {
  // arrange
  const graph = {
    summary: { filesInput: 3, analysed: 1, unanalysable: 2, unanalysableByReason: { unparseable: 1, 'too-large': 1 },
      unsupportedLanguages: { go: 2 }, unanalysableSites: 4, unanalysableSitesByKind: { 'endpoint: computed call': 4 } },
    modules: [{ path: 'a.js', state: 'analysed' }, { path: 'b.js', state: 'unparseable', reason: 'SyntaxError: x\n  at y' }, { path: 'c.js', state: 'too-large' }],
  };

  // act
  const u = unknownOf(graph);

  // assert
  assert.deepEqual(u, { files: 3, analysed: 1, unanalysable: 2, byState: { unparseable: 1, 'too-large': 1 },
    filesUnread: ['b.js: unparseable (SyntaxError: x)', 'c.js: too-large'], filesUnreadNotListed: 0,
    unsupportedLanguages: { go: 2 }, computedSites: 4, computedSitesByKind: { 'endpoint: computed call': 4 } });
});

test('unknownOf counts from the modules alone when there is no summary, and lists at most 200 by name', () => {
  // arrange
  const modules = [{ path: 'ok.js', state: 'analysed' }, ...Array.from({ length: 205 }, (_, i) => ({ path: `m${i}.js`, state: 'lexer-bailed' }))];

  // act
  const u = unknownOf({ modules });

  // assert
  assert.equal(u.files, 206);
  assert.equal(u.analysed, 1);
  assert.equal(u.unanalysable, 205);
  assert.deepEqual(u.byState, { 'lexer-bailed': 205 });
  assert.equal(u.filesUnread.length, 200);
  assert.equal(u.filesUnreadNotListed, 5);
  assert.deepEqual([u.unsupportedLanguages, u.computedSites, u.computedSitesByKind], [{}, 0, {}]);
});

test('repoRelative: file URLs, ./ prefixes, Windows separators and absolute paths under the root', () => {
  // arrange
  const cases = [['file:///r/src/a.ts', '/r'], ['./src/a.ts', null], ['src\\a.ts', null], ['/r/src/a.ts', '/r/'], ['/other/a.ts', '/r'], ['file://%E0%A4%A', null], [undefined, null]];

  // act
  const got = cases.map(([p, root]) => repoRelative(p, root));

  // assert
  assert.deepEqual(got, ['src/a.ts', 'src/a.ts', 'src/a.ts', 'src/a.ts', '/other/a.ts', '%E0%A4%A', '']);
});

test('mergeModels: a traced file that is a module becomes that module, the rest is kept, and the result is valid', () => {
  // arrange
  const code = fromCodeFlows([record('r', 'js/sql-injection', './src/a.ts', 'main.js'), record('r', 'js/xss', 'web/b.ts', 'web/b.ts')]);

  // act
  const m = mergeModels(staticModel(), code, { root: '/r' });

  // assert
  assert.equal(validateDfd(m).ok, true, validateDfd(m).errors?.join('\n'));
  assert.equal(m.title, 'static');
  assert.equal(m.source.producer, 'flow-graph+codeql-code-flows');
  assert.deepEqual(m.source.options.merged, { storesRenamed: 0, codeqlProcessesMatched: 2, codeqlProcessesUnmatched: 1 });
  assert.deepEqual(m.source.omitted, { importEdges: 1, 'codeql noPath': 0, 'codeql unreadable': 0 });
  assert.deepEqual(m.source.unknown, { files: 2 });
  assert.deepEqual(m.source.graph, { v: 1, nodes: 3, edges: 2 });
  assert.ok(m.flows.some((f) => f.from === 'node:module:src/a.ts' && f.to === 'node:module:main.js' && /sql-injection/.test(f.label)));
  assert.ok(!m.nodes.some((n) => n.id === 'code:r:src/a.ts'));
  assert.ok(m.nodes.some((n) => n.id === 'code:r:web/b.ts'));
  assert.deepEqual(m.groups.map((g) => g.id).sort(), ['repo:r', 'src', 'untrusted']);
});

test('mergeModels with a bare static model and no match: everything kept, titled as asked', () => {
  // arrange
  const bare = { v: 1, kind: 'dfd', nodes: [{ id: 'p', kind: 'process', label: 'x.js' }, { id: 's', kind: 'store', label: 's' }], flows: [{ from: 'p', to: 's', label: 'w', mode: 'sync' }] };
  const code = { v: 1, kind: 'dfd', nodes: [{ id: 'q', kind: 'process', label: 'y.js' }, { id: 'e', kind: 'external', label: 'e' }], flows: [{ from: 'e', to: 'q', label: 'i', mode: 'sync' }] };

  // act
  const m = mergeModels(bare, code, { title: 'both' });

  // assert
  assert.equal(validateDfd(m).ok, true);
  assert.equal(m.title, 'both');
  assert.equal(m.groups, undefined);
  assert.equal(m.layers, undefined);
  assert.deepEqual(m.source.omitted, {});
  assert.deepEqual(m.source.options, { merged: { codeqlProcessesMatched: 0, codeqlProcessesUnmatched: 1 } });
  assert.equal(m.nodes.length, 4);
  assert.equal(m.flows.length, 2);
});

test('mergeModels keeps the static model\'s declared layers', () => {
  // arrange
  const layered = { ...staticModel(), layers: ['core'] };

  // act
  const m = mergeModels(layered, fromCodeFlows([]));

  // assert
  assert.deepEqual(m.layers, ['core']);
});
