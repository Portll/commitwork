// Inserts credential-read deny rules into a settings permissions block (monitor/agent-config-harden.mjs addCredentialDeny).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addCredentialDeny } from '../agent-config-harden.mjs';

const SSH = '"Read(~/.ssh/**)"';
const AWS = '"Read(~/.aws/**)"';
const ENV = '"Read(./.env)"';
const ENVS = '"Read(./.env.*)"';
const ALL = ['Read(~/.ssh/**)', 'Read(~/.aws/**)', 'Read(./.env)', 'Read(./.env.*)'];
const wrap = (body) => ['{', '  "permissions": {', ...body, '  }', '}'].join('\n');

test('unparseable text and a non-object top level are returned unchanged with reason unparseable', () => {
  assert.deepEqual(addCredentialDeny('not json'), { text: 'not json', added: [], reason: 'unparseable' });
  assert.deepEqual(addCredentialDeny('[1]'), { text: '[1]', added: [], reason: 'unparseable' });
});

test('a permissions object without an allow array is left alone', () => {
  const t = '{"permissions":{"deny":[]}}';
  assert.deepEqual(addCredentialDeny(t), { text: t, added: [], reason: 'no permissions.allow' });
  const u = '{"permissions":["Bash"]}';
  assert.deepEqual(addCredentialDeny(u), { text: u, added: [], reason: 'no permissions.allow' });
});

test('no Bash grant or a deny list already covering ssh and aws reads needs no change', () => {
  const t = '{"permissions":{"allow":["Read"]}}';
  assert.deepEqual(addCredentialDeny(t), { text: t, added: [], reason: 'no Bash grant to bound' });
  const u = '{"permissions":{"allow":["Bash"],"deny":["Read(~/.ssh/**)","Read(~/.aws/**)"]}}';
  assert.deepEqual(addCredentialDeny(u), { text: u, added: [], reason: 'permissions.deny already covers credential reads' });
});

test('a deny key split from its bracket across lines reports the literal as not found', () => {
  const t = '{"permissions":{"allow":["Bash"],"deny"\n:[]}}';
  assert.deepEqual(addCredentialDeny(t), { text: t, added: [], reason: 'literal not found in text' });
});

test('a one-line deny array gets the missing entries spliced in at its start', () => {
  assert.deepEqual(addCredentialDeny('{"permissions":{"allow":["Bash"],"deny":[]}}'), { text: "{\"permissions\":{\"allow\":[\"Bash\"],\"deny\":[\"Read(~/.ssh/**)\", \"Read(~/.aws/**)\", \"Read(~/.netrc)\", \"Read(~/.npmrc)\", \"Read(~/.git-credentials)\", \"Read(~/.docker/config.json)\", \"Read(~/.kube/config)\", \"Read(~/.gnupg/**)\", \"Bash(cat ~/.ssh/*)\", \"Bash(cat ~/.aws/*)\"]}}", added: ["Read(~/.ssh/**)", "Read(~/.aws/**)", "Read(~/.netrc)", "Read(~/.npmrc)", "Read(~/.git-credentials)", "Read(~/.docker/config.json)", "Read(~/.kube/config)", "Read(~/.gnupg/**)", "Bash(cat ~/.ssh/*)", "Bash(cat ~/.aws/*)"] });
  assert.deepEqual(addCredentialDeny('{"permissions":{"allow":["Bash"],"deny":["Read(./.env)"]}}'), { text: "{\"permissions\":{\"allow\":[\"Bash\"],\"deny\":[\"Read(./.env)\"]}}", added: [], reason: "permissions.deny already covers credential reads" });
});

test('a multi-line non-empty deny array gets comma-terminated entries at the first element indent', () => {
  const t = wrap(['    "allow": ["Bash"],', '    "deny": [', `      ${SSH}`, '    ]']);
  assert.deepEqual(addCredentialDeny(t), { text: "{\n  \"permissions\": {\n    \"allow\": [\"Bash\"],\n    \"deny\": [\n      \"Read(~/.ssh/**)\"\n    ]\n  }\n}", added: [], reason: "permissions.deny already covers credential reads" });
});

test('a multi-line empty deny array gets entries with no comma after the last one', () => {
  const t = wrap(['    "allow": ["Bash"],', '    "deny": [', '    ]']);
  assert.deepEqual(addCredentialDeny(t), { text: "{\n  \"permissions\": {\n    \"allow\": [\"Bash\"],\n    \"deny\": [\n    \"Read(~/.ssh/**)\",\n    \"Read(~/.aws/**)\",\n    \"Read(~/.netrc)\",\n    \"Read(~/.npmrc)\",\n    \"Read(~/.git-credentials)\",\n    \"Read(~/.docker/config.json)\",\n    \"Read(~/.kube/config)\",\n    \"Read(~/.gnupg/**)\",\n    \"Bash(cat ~/.ssh/*)\",\n    \"Bash(cat ~/.aws/*)\"\n    ]\n  }\n}", added: ["Read(~/.ssh/**)", "Read(~/.aws/**)", "Read(~/.netrc)", "Read(~/.npmrc)", "Read(~/.git-credentials)", "Read(~/.docker/config.json)", "Read(~/.kube/config)", "Read(~/.gnupg/**)", "Bash(cat ~/.ssh/*)", "Bash(cat ~/.aws/*)"] });
  const u = '{"permissions":{"allow":["Bash"],\n"deny": [\n]}}';
  assert.deepEqual(addCredentialDeny(u), { text: "{\"permissions\":{\"allow\":[\"Bash\"],\n\"deny\": [\n  \"Read(~/.ssh/**)\",\n  \"Read(~/.aws/**)\",\n  \"Read(~/.netrc)\",\n  \"Read(~/.npmrc)\",\n  \"Read(~/.git-credentials)\",\n  \"Read(~/.docker/config.json)\",\n  \"Read(~/.kube/config)\",\n  \"Read(~/.gnupg/**)\",\n  \"Bash(cat ~/.ssh/*)\",\n  \"Bash(cat ~/.aws/*)\"\n]}}", added: ["Read(~/.ssh/**)", "Read(~/.aws/**)", "Read(~/.netrc)", "Read(~/.npmrc)", "Read(~/.git-credentials)", "Read(~/.docker/config.json)", "Read(~/.kube/config)", "Read(~/.gnupg/**)", "Bash(cat ~/.ssh/*)", "Bash(cat ~/.aws/*)"] });
});

test('without a deny key a closing allow bracket followed by more text gets an inline deny array', () => {
  assert.deepEqual(addCredentialDeny('{"permissions":{"allow":["Bash"]}}'), { text: "{\"permissions\":{\"allow\":[\"Bash\"], \"deny\": [\"Read(~/.ssh/**)\", \"Read(~/.aws/**)\", \"Read(~/.netrc)\", \"Read(~/.npmrc)\", \"Read(~/.git-credentials)\", \"Read(~/.docker/config.json)\", \"Read(~/.kube/config)\", \"Read(~/.gnupg/**)\", \"Bash(cat ~/.ssh/*)\", \"Bash(cat ~/.aws/*)\"]}}", added: ["Read(~/.ssh/**)", "Read(~/.aws/**)", "Read(~/.netrc)", "Read(~/.npmrc)", "Read(~/.git-credentials)", "Read(~/.docker/config.json)", "Read(~/.kube/config)", "Read(~/.gnupg/**)", "Bash(cat ~/.ssh/*)", "Bash(cat ~/.aws/*)"] });
});

test('a multi-line allow array ending its line gets a comma and a deny block at the allow indent', () => {
  const t = wrap(['    "allow": [', '      "Bash"', '    ]']);
  assert.deepEqual(addCredentialDeny(t), { text: "{\n  \"permissions\": {\n    \"allow\": [\n      \"Bash\"\n    ],\n    \"deny\": [\n      \"Read(~/.ssh/**)\",\n      \"Read(~/.aws/**)\",\n      \"Read(~/.netrc)\",\n      \"Read(~/.npmrc)\",\n      \"Read(~/.git-credentials)\",\n      \"Read(~/.docker/config.json)\",\n      \"Read(~/.kube/config)\",\n      \"Read(~/.gnupg/**)\",\n      \"Bash(cat ~/.ssh/*)\",\n      \"Bash(cat ~/.aws/*)\"\n    ]\n  }\n}", added: ["Read(~/.ssh/**)", "Read(~/.aws/**)", "Read(~/.netrc)", "Read(~/.npmrc)", "Read(~/.git-credentials)", "Read(~/.docker/config.json)", "Read(~/.kube/config)", "Read(~/.gnupg/**)", "Bash(cat ~/.ssh/*)", "Bash(cat ~/.aws/*)"] });
});

test('an allow array already followed by a comma keeps it and the deny block ends with a comma', () => {
  const t = wrap(['    "allow": ["Bash(git *)"],', '    "model": "x"']);
  assert.deepEqual(addCredentialDeny(t), { text: "{\n  \"permissions\": {\n    \"allow\": [\"Bash(git *)\"],\n    \"deny\": [\n      \"Read(~/.ssh/**)\",\n      \"Read(~/.aws/**)\",\n      \"Read(~/.netrc)\",\n      \"Read(~/.npmrc)\",\n      \"Read(~/.git-credentials)\",\n      \"Read(~/.docker/config.json)\",\n      \"Read(~/.kube/config)\",\n      \"Read(~/.gnupg/**)\",\n      \"Bash(cat ~/.ssh/*)\",\n      \"Bash(cat ~/.aws/*)\"\n    ],\n    \"model\": \"x\"\n  }\n}", added: ["Read(~/.ssh/**)", "Read(~/.aws/**)", "Read(~/.netrc)", "Read(~/.npmrc)", "Read(~/.git-credentials)", "Read(~/.docker/config.json)", "Read(~/.kube/config)", "Read(~/.gnupg/**)", "Bash(cat ~/.ssh/*)", "Bash(cat ~/.aws/*)"] });
});
