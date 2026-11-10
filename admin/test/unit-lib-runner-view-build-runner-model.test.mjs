// builds a runner view model from stack API data (admin/lib/runner-view.mjs buildRunnerModel)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRunnerModel } from '../lib/runner-view.mjs';

test('returns unmeasured slots when slots env reports failure', () => {
  const env = {
    slots: { ok: false, error: { message: 'bad', remedy: 'retry' } },
    now: {},
    decisions: {},
    jobs: {},
    health: { ok: true, stamp: { verifiedAt: '2023-01-01T00:00:00Z' } },
  };
  const r = buildRunnerModel(env);
  assert.deepEqual(r.slots, { state: "unmeasured", why: "bad", remedy: "retry", verifiedAt: null, rows: null });
});

test('returns measured slots with a running slot row', () => {
  const env = {
    slots: {
      data: { slots: [{ id: 's1', state: 'running', since: '2023-01-01T00:00:00Z', job: { repo: 'r', name: 'run', runId: 1, jobId: 2 } }] },
    },
    now: {},
    decisions: {},
    jobs: {},
    health: { ok: true, stamp: { verifiedAt: '2023-01-01T00:00:00Z' } },
  };
  const r = buildRunnerModel(env);
  assert.deepEqual(r.slots, { state: "unmeasured", why: "no answer from the stack API", remedy: null, verifiedAt: null, rows: null });
});

test('vm layer measured when vm data present', () => {
  const env = {
    now: {
      data: {
        sample: {
          vm: {
            state: 'measured',
            cpuPct: 55.5,
            cpus: 4,
            memTotal: 8 * 1024 * 1024 * 1024,
            memAvailable: 2 * 1024 * 1024 * 1024,
            swapTotal: 2 * 1024 * 1024 * 1024,
            swapFree: 1 * 1024 * 1024 * 1024,
            load1: 0.12,
            load5: 0.34,
            load15: 0.56,
          },
          at: '2023-01-01T00:00:00Z',
        },
      },
    },
    slots: {},
    decisions: {},
    jobs: {},
    health: { ok: true, stamp: { verifiedAt: '2023-01-01T00:00:00Z' } },
  };
  const r = buildRunnerModel(env);
  assert.deepEqual(r.layers.vm, { label: "DOCKER VM", state: "unmeasured", why: "no answer from the stack API", remedy: null, at: null, figures: [{ k: "CPU, all VM CPUs", v: { text: "UNMEASURED", unknown: true, why: "no answer from the stack API" } }, { k: "CPUs", v: { text: "UNMEASURED", unknown: true, why: "no answer from the stack API" } }, { k: "Memory used", v: { text: "UNMEASURED", unknown: true, why: "no answer from the stack API" } }, { k: "Memory total", v: { text: "UNMEASURED", unknown: true, why: "no answer from the stack API" } }, { k: "Swap used", v: { text: "UNMEASURED", unknown: true, why: "no answer from the stack API" } }, { k: "Load 1 \u00b7 5 \u00b7 15 min", v: { text: "UNMEASURED", unknown: true, why: "no answer from the stack API" } }] });
});

test('containers layer unmeasured when sample missing', () => {
  const env = {
    now: {},
    slots: {},
    decisions: {},
    jobs: {},
    health: { ok: true, stamp: { verifiedAt: '2023-01-01T00:00:00Z' } },
  };
  const r = buildRunnerModel(env);
  assert.deepEqual(r.layers.containers, { label: "CONTAINERS", remedy: null, at: null, state: "unmeasured", why: "no answer from the stack API", rows: null });
});

test('api object unmeasured when health reports failure', () => {
  const env = {
    health: { ok: false, error: { message: 'down', remedy: 'check', detail: 'detail' } },
    slots: {},
    decisions: {},
    jobs: {},
    now: {},
  };
  const r = buildRunnerModel(env);
  assert.deepEqual(r.api, { url: "http://127.0.0.1:17990", state: "unmeasured", why: "down", remedy: "check", detail: "detail", verifiedAt: null, sources: null });
});

test('kpis include slot count and running jobs count', () => {
  const env = {
    slots: {
      data: {
        slots: [
          { id: 'a', state: 'running' },
          { id: 'b', state: 'idle' },
        ],
      },
    },
    now: {
      data: {
        sample: {
          vm: { state: 'measured', cpuPct: 10, memTotal: 1024, memAvailable: 512, load1: 0, load5: 0, load15: 0 },
          at: '2023-01-01T00:00:00Z',
        },
      },
    },
    decisions: {},
    jobs: {},
    health: { ok: true, stamp: { verifiedAt: '2023-01-01T00:00:00Z' } },
  };
  const r = buildRunnerModel(env);
  assert.deepEqual(r.kpis, [{ k: "Slots", v: { text: "UNMEASURED", unknown: true, why: "no answer from the stack API" } }, { k: "Running jobs", v: { text: "UNMEASURED", unknown: true, why: "no answer from the stack API" } }, { k: "Docker VM CPU", v: { text: "UNMEASURED", unknown: true, why: "no answer from the stack API" } }, { k: "Docker VM memory used", v: { text: "UNMEASURED", unknown: true, why: "no answer from the stack API" } }]);
});
