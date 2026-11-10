// Computes whether a capability is unreachable for a given caller context (lib/memory-port.mjs unreachableReason).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { unreachableReason } from '../memory-port.mjs';

test('throws for an unknown caller context', () => {
  assert.throws(() => unreachableReason({ name: 'cap', reachability: 'x' }, 'bogus'), { name: "Error", message: "unknown caller context \"bogus\" \u2014 declare one of headless | interactive | agent-session; defaulting here would let an agent-tool adapter be called from cron" });
});

test('returns null when reachability is not agent-tool and caller is headless', () => {
  assert.equal(unreachableReason({ name: 'cap', reachability: 'direct' }, 'headless'), null);
});

test('returns null when reachability is agent-tool and caller is agent-session', () => {
  assert.equal(unreachableReason({ name: 'cap', reachability: 'agent-tool' }, 'agent-session'), null);
});

test('returns a message when reachability is agent-tool and caller is headless', () => {
  assert.equal(unreachableReason({ name: 'cap', reachability: 'agent-tool' }, 'headless'), "cap is reachable only through an attached MCP client (reachability: agent-tool) and the caller is 'headless', which has none. This is a design fact, not an outage \u2014 retrying will never succeed.");
});

test('returns a message when reachability is agent-tool and caller is interactive', () => {
  assert.equal(unreachableReason({ name: 'cap', reachability: 'agent-tool' }, 'interactive'), "cap is reachable only through an attached MCP client (reachability: agent-tool) and the caller is 'interactive', which has none. This is a design fact, not an outage \u2014 retrying will never succeed.");
});

test('returns null when reachability is direct and caller is agent-session', () => {
  assert.equal(unreachableReason({ name: 'cap', reachability: 'direct' }, 'agent-session'), null);
});
