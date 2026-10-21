// The off-box fetch agent accepts an UNAVAILABLE attestation (a private repo has none) and nothing
// looser. The flag once lived only in the installed plist, and a regeneration dropped it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { AGENTS, plist } from '../install-agents.mjs';

const fetchAgent = AGENTS.find((a) => a.label === 'com.portll.commitwork-offbox-fetch');

test('the generator, not the installed plist, carries CW_OFFBOX_ATTEST_OPTIONAL', () => {
  assert.ok(fetchAgent, 'the off-box fetch agent is no longer generated');
  assert.equal(fetchAgent.env?.CW_OFFBOX_ATTEST_OPTIONAL, '1');
  assert.match(plist(fetchAgent), /<key>CW_OFFBOX_ATTEST_OPTIONAL<\/key>\s*<string>1<\/string>/, 'the rendered plist does not carry the flag');
});

test('the blanket unattested bypass is never generated for it', () => {
  assert.equal(fetchAgent.env?.CW_OFFBOX_ALLOW_UNATTESTED, undefined, 'ALLOW_UNATTESTED would accept a tampered attestation too');
  assert.doesNotMatch(plist(fetchAgent), /CW_OFFBOX_ALLOW_UNATTESTED/);
});
