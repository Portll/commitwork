import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const html = readFileSync(new URL('../demo.html', import.meta.url), 'utf8');
const handler = html.indexOf("stage.addEventListener('mousemove'");
const start = html.indexOf('if(!hoverKind){', handler);
const end = html.indexOf("if(hoverKind==='glow')", start);
assert.ok(handler >= 0 && start > handler && end > start, 'production mesh selection is present');
const selection = html.slice(start, end);

function pick(hits, { absent = [], initialKind = null, onSelected = () => {} } = {}) {
  const objects = { ap: {}, fn: {}, file: {} };
  const rows = hits.map(([kind, distance, instanceId]) => ({ object: objects[kind], distance, instanceId }));
  const context = {
    apMesh: absent.includes('ap') ? null : objects.ap,
    fnMesh: absent.includes('fn') ? null : objects.fn,
    instMesh: absent.includes('file') ? null : objects.file,
    hoverKind: initialKind, hoverId: -1,
    ray: {
      intersectObject: object => rows.filter(r => r.object === object).sort((a, b) => a.distance - b.distance),
      intersectObjects: meshes => {
        assert.ok(meshes.every(Boolean), 'absent meshes must not be raycast');
        return rows.filter(r => meshes.includes(r.object)).sort((a, b) => a.distance - b.distance);
      },
    },
  };
  runInNewContext(selection, context, { timeout: 1000 });
  onSelected(context);
  return { kind: context.hoverKind, id: context.hoverId };
}

test('the nearest file wins even when aperture and function meshes exist', () => {
  assert.deepEqual(pick([['ap', 10, 4], ['fn', 8, 2], ['file', 2, 0]]), { kind: 'file', id: 0 });
});

test('the nearest function and aperture retain their metadata kinds and zero IDs', () => {
  assert.deepEqual(pick([['ap', 10, 4], ['fn', 1, 0], ['file', 2, 7]]), { kind: 'fn', id: 0 });
  assert.deepEqual(pick([['ap', 1, 0], ['fn', 8, 2], ['file', 2, 7]]), { kind: 'ap', id: 0 });
});

test('missing layers and empty intersections produce the expected selection', () => {
  assert.deepEqual(pick([['file', 1, 0]], { absent: ['ap', 'fn'] }), { kind: 'file', id: 0 });
  assert.deepEqual(pick([]), { kind: null, id: -1 });
  assert.deepEqual(pick([], { absent: ['ap', 'fn', 'file'] }), { kind: null, id: -1 });
});

test('a glow selection keeps its explicit priority over mesh hits', () => {
  assert.deepEqual(pick([['file', 1, 0]], { initialKind: 'glow' }), { kind: 'glow', id: -1 });
});

test('a non-instance intersection does not hide the next eligible hit', () => {
  assert.deepEqual(pick([['ap', 1, undefined], ['fn', 2, 0], ['file', 3, 1]]), { kind: 'fn', id: 0 });
});

test('click dispatch receives the metadata belonging to the nearest selected mesh', () => {
  const clickStart = html.indexOf("stage.addEventListener('click'", end);
  const clickEnd = html.indexOf('// vuln DETAIL', clickStart);
  assert.ok(clickStart > end && clickEnd > clickStart, 'production click handler is present');
  for (const kind of ['ap', 'fn', 'file']) {
    const aperture = { svc: { id: 'service-fixture' } };
    const fn = { node: { path: 'function-fixture.mjs' } };
    const file = { node: { path: 'file-fixture.mjs' } };
    let dispatched;
    pick([[kind, 1, 0], ...['ap', 'fn', 'file'].filter(k => k !== kind).map(k => [k, 10, 0])], {
      onSelected: context => {
        Object.assign(context, {
          apMeta: [aperture], fnMeta: [fn], fileMeta: [file],
          showServiceIO: meta => { dispatched = meta; },
          showFile: meta => { dispatched = meta; },
          stage: { addEventListener: (name, callback) => {
            assert.equal(name, 'click');
            callback({});
          } },
        });
        runInNewContext(html.slice(clickStart, clickEnd), context, { timeout: 1000 });
      },
    });
    assert.equal(dispatched, kind === 'ap' ? aperture.svc : kind === 'fn' ? fn : file, kind);
  }
});
