// monitor/test/sitemap-overlays-units.test.mjs — case tests for attachOverlays.
import test from 'node:test';
import assert from 'node:assert/strict';
import { attachOverlays } from '../sitemap-overlays.mjs';

test('attachOverlays: empty manifest returns empty arrays and named skip reasons', () => {
  const manifest = { project: 'proj', services: [] };
  const res = attachOverlays(manifest, { reportsDir: '/nonexistent' });
  assert.equal(res.manifest.logSinks.length, 0);
  assert.equal(res.manifest.airBridges.length, 0);
  assert.equal(res.stats.area, 'proj');
  assert.equal(res.stats.trivy.scanned, false);
  assert.equal(res.stats.races.scanned, false);
  assert.equal(res.stats.authz.scanned, false);
  assert.equal(res.stats.vulns, 0);
  assert.equal(res.stats.droppedVulns, 0);
});

test('attachOverlays: builds logSinks from service tree logging', () => {
  const manifest = {
    project: 'proj',
    services: [{
      id: 'svc1',
      tree: [{ path: 'a.js', logging: { count: 5, category: 'audit' } }]
    }]
  };
  const res = attachOverlays(manifest, { reportsDir: '/nonexistent' });
  assert.equal(res.manifest.logSinks.length, 1);
  assert.equal(res.manifest.logSinks[0].service, 'svc1');
  assert.equal(res.manifest.logSinks[0].count, 5);
  assert.equal(res.manifest.logSinks[0].files, 1);
  assert.equal(res.manifest.logSinks[0].audit, true);
});

test('attachOverlays: builds airBridges for client io', () => {
  const manifest = {
    project: 'proj',
    services: [
      { id: 'svc-a', io: [{ kind: 'client', detail: 'svc-b', count: 2 }] },
      { id: 'svc-b', io: [] }
    ]
  };
  const res = attachOverlays(manifest, { reportsDir: '/nonexistent' });
  assert.equal(res.manifest.airBridges.length, 1);
  assert.equal(res.manifest.airBridges[0].from, 'svc-a');
  assert.equal(res.manifest.airBridges[0].to, 'svc-b');
  assert.equal(res.manifest.airBridges[0].kind, 'client');
  assert.equal(res.manifest.airBridges[0].count, 2);
  assert.equal(res.manifest.airBridges[0].resolved, true);
});

test('attachOverlays: dangling airBridge when target not found', () => {
  const manifest = {
    project: 'proj',
    services: [
      { id: 'svc-a', io: [{ kind: 'client', detail: 'unknown-svc', count: 1 }] }
    ]
  };
  const res = attachOverlays(manifest, { reportsDir: '/nonexistent' });
  assert.equal(res.manifest.airBridges.length, 1);
  assert.equal(res.manifest.airBridges[0].to, null);
  assert.equal(res.manifest.airBridges[0].resolved, false);
});

test('attachOverlays: oauth bridge resolves to buildout if present', () => {
  const manifest = {
    project: 'proj',
    services: [
      { id: 'svc-a', io: [{ kind: 'oauth', detail: 'idp', count: 1 }] },
      { id: 'buildout', io: [] }
    ]
  };
  const res = attachOverlays(manifest, { reportsDir: '/nonexistent' });
  assert.equal(res.manifest.airBridges.length, 1);
  assert.equal(res.manifest.airBridges[0].to, 'buildout');
  assert.equal(res.manifest.airBridges[0].resolved, true);
});

test('attachOverlays: amqp publisher resolves to listener', () => {
  const manifest = {
    project: 'proj',
    services: [
      { id: 'svc-pub', io: [{ kind: 'amqp', detail: 'publisher', count: 1 }] },
      { id: 'svc-list', io: [{ kind: 'amqp', detail: 'listener', count: 1 }] }
    ]
  };
  const res = attachOverlays(manifest, { reportsDir: '/nonexistent' });
  assert.equal(res.manifest.airBridges.length, 1);
  assert.equal(res.manifest.airBridges[0].from, 'svc-pub');
  assert.equal(res.manifest.airBridges[0].to, 'svc-list');
  assert.equal(res.manifest.airBridges[0].kind, 'amqp');
});
