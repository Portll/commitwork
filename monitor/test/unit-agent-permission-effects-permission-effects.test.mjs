// Computes per-agent permission effects from host-sandbox evidence and declarations (monitor/agent-permission-effects.mjs permissionEffects).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { permissionEffects } from '../agent-permission-effects.mjs';

test('returns not-run state when agents array is empty', () => {
  const result = permissionEffects({ agents: [] });
  assert.equal(result.state, 'not-run');
  assert.equal(result.reason, 'no-agent-configuration');
  assert.equal(result.findingSource, null);
  assert.equal(result.agents.length, 0);
  assert.equal(result.postures.length, 0);
  assert.equal(result.gaps.length, 0);
  assert.equal(result.breaches.length, 0);
  assert.equal(result.adapters.length, 2);
  assert.equal(result.adapters[0].adapter, 'host-sandbox');
  assert.equal(result.adapters[0].state, 'unmeasured');
  assert.equal(result.adapters[1].adapter, 'agent-runtime');
});

test('returns unmeasured state with malformed-input reason when agents is not an array', () => {
  const result = permissionEffects({ agents: 'not-an-array' });
  assert.equal(result.state, 'unmeasured');
  assert.equal(result.reason, 'malformed-input');
  assert.equal(result.findingSource, null);
  assert.equal(result.agents.length, 0);
  assert.equal(result.postures.length, 0);
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].reason, 'malformed-input');
  assert.equal(result.gaps[0].agent, null);
  assert.equal(result.gaps[0].adapter, null);
  assert.equal(result.gaps[0].scope, 'input');
  assert.equal(result.gaps[0].subject, 'input');
  assert.equal(result.gaps[0].declarations, null);
  assert.equal(result.breaches.length, 0);
});

test('returns unmeasured state with malformed-input reason when input is not a record', () => {
  const result = permissionEffects(null);
  assert.equal(result.state, 'unmeasured');
  assert.equal(result.reason, 'malformed-input');
  assert.equal(result.findingSource, null);
  assert.equal(result.agents.length, 0);
  assert.equal(result.postures.length, 0);
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].reason, 'malformed-input');
  assert.equal(result.breaches.length, 0);
});

test('returns unmeasured state with no-evidence reason when agents exist but no evidence', () => {
  const result = permissionEffects({ agents: [{ agent: 'test-agent', configuration: 'complete', declarations: [] }] });
  assert.equal(result.state, 'unmeasured');
  assert.equal(result.reason, 'no-evidence');
  assert.equal(result.findingSource, null);
  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0].agent, 'test-agent');
  assert.equal(result.agents[0].state, 'unmeasured');
  assert.equal(result.postures.length, 1);
  assert.equal(result.postures[0].network, 'open');
  assert.equal(result.postures[0].state, 'unmeasured');
  assert.equal(result.postures[0].reason, 'no-evidence');
  assert.equal(result.breaches.length, 0);
});

test('returns finding state with measured-breach reason when a control is not-contained', () => {
  const evidence = {
    schemaVersion: 1,
    adapter: 'host-sandbox',
    platform: 'linux',
    byPosture: {
      open: {
        probes: [
          { probe: 'permitted-read', outcome: 'allowed' },
          { probe: 'credential-read', outcome: 'allowed' },
          { probe: 'forbidden-read', outcome: 'allowed' },
          { probe: 'write-escape', outcome: 'allowed' },
          { probe: 'hook-exec', outcome: 'allowed' },
          { probe: 'hook-script-outside', outcome: 'allowed' },
          { probe: 'hook-binary-outside', outcome: 'allowed' },
          { probe: 'egress', outcome: 'allowed' },
          { probe: 'loopback', outcome: 'allowed' }
        ]
      }
    }
  };
  const result = permissionEffects({
    evidence,
    agents: [{ agent: 'test-agent', configuration: 'complete', declarations: [] }]
  });
  assert.equal(result.state, 'finding');
  assert.equal(result.reason, 'measured-breach');
  assert.equal(result.findingSource, 'measured');
  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0].state, 'finding');
  assert.equal(result.breaches.length, 3);
  assert.deepEqual(result.breaches, [
    { network: 'open', control: 'credential-read' },
    { network: 'open', control: 'write-escape' },
    { network: 'open', control: 'loopback' }
  ]);
});

test('returns unmeasured state with no-adapter-applies-to-the-agents reason when all controls are contained', () => {
  const evidence = {
    schemaVersion: 1,
    adapter: 'host-sandbox',
    platform: 'linux',
    byPosture: {
      open: {
        probes: [
          { probe: 'permitted-read', outcome: 'allowed' },
          { probe: 'credential-read', outcome: 'denied' },
          { probe: 'forbidden-read', outcome: 'allowed' },
          { probe: 'write-escape', outcome: 'denied' },
          { probe: 'hook-exec', outcome: 'allowed' },
          { probe: 'hook-script-outside', outcome: 'allowed' },
          { probe: 'hook-binary-outside', outcome: 'allowed' },
          { probe: 'egress', outcome: 'allowed' },
          { probe: 'loopback', outcome: 'denied' }
        ]
      }
    }
  };
  const result = permissionEffects({
    evidence,
    agents: [{ agent: 'test-agent', configuration: 'complete', declarations: [] }]
  });
  assert.equal(result.state, 'unmeasured');
  assert.equal(result.reason, 'no-adapter-applies-to-the-agents');
  assert.equal(result.findingSource, null);
  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0].state, 'unmeasured');
  assert.equal(result.breaches.length, 0);
});

test('returns unmeasured state with malformed-input reason when agent name is invalid', () => {
  const result = permissionEffects({ agents: [{ agent: 'INVALID_NAME', configuration: 'complete', declarations: [] }] });
  assert.equal(result.state, 'unmeasured');
  assert.equal(result.reason, 'malformed-input');
  assert.equal(result.findingSource, null);
  assert.equal(result.agents.length, 0);
  assert.equal(result.postures.length, 0);
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].reason, 'malformed-agent');
  assert.equal(result.gaps[0].agent, null);
  assert.equal(result.gaps[0].adapter, null);
  assert.equal(result.gaps[0].scope, 'input');
  assert.equal(result.gaps[0].subject, 'input');
  assert.equal(result.gaps[0].declarations, null);
  assert.equal(result.breaches.length, 0);
});

test('returns unmeasured state with malformed-input reason when agent name is too long', () => {
  const longName = 'a'.repeat(33);
  const result = permissionEffects({ agents: [{ agent: longName, configuration: 'complete', declarations: [] }] });
  assert.equal(result.state, 'unmeasured');
  assert.equal(result.reason, 'malformed-input');
  assert.equal(result.findingSource, null);
  assert.equal(result.agents.length, 0);
  assert.equal(result.postures.length, 0);
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].reason, 'malformed-agent');
  assert.equal(result.gaps[0].agent, null);
  assert.equal(result.gaps[0].adapter, null);
  assert.equal(result.gaps[0].scope, 'input');
  assert.equal(result.gaps[0].subject, 'input');
  assert.equal(result.gaps[0].declarations, null);
  assert.equal(result.breaches.length, 0);
});

test('returns unmeasured state with no-evidence reason when agent name is exactly 32 characters', () => {
  const name32 = 'a'.repeat(32);
  const result = permissionEffects({ agents: [{ agent: name32, configuration: 'complete', declarations: [] }] });
  assert.equal(result.state, 'unmeasured');
  assert.equal(result.reason, 'no-evidence');
  assert.equal(result.findingSource, null);
  assert.equal(result.agents.length, 1);
  assert.equal(result.agents[0].agent, name32);
  assert.equal(result.postures.length, 1);
  assert.equal(result.breaches.length, 0);
});

test('returns unmeasured state with malformed-input reason when agent name is exactly 33 characters', () => {
  const name33 = 'a'.repeat(33);
  const result = permissionEffects({ agents: [{ agent: name33, configuration: 'complete', declarations: [] }] });
  assert.equal(result.state, 'unmeasured');
  assert.equal(result.reason, 'malformed-input');
  assert.equal(result.findingSource, null);
  assert.equal(result.agents.length, 0);
  assert.equal(result.postures.length, 0);
  assert.equal(result.gaps.length, 1);
  assert.equal(result.gaps[0].reason, 'malformed-agent');
  assert.equal(result.gaps[0].agent, null);
  assert.equal(result.gaps[0].adapter, null);
  assert.equal(result.gaps[0].scope, 'input');
  assert.equal(result.gaps[0].subject, 'input');
  assert.equal(result.gaps[0].declarations, null);
  assert.equal(result.breaches.length, 0);
});
