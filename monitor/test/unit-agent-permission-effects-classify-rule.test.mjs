// Classifies a permission rule string into a security effect class (monitor/agent-permission-effects.mjs classifyRule).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyRule } from '../agent-permission-effects.mjs';

test('returns unrecognised for non-string input', () => {
  assert.equal(classifyRule(123), 'unrecognised');
  assert.equal(classifyRule(null), 'unrecognised');
  assert.equal(classifyRule(undefined), 'unrecognised');
});

test('returns mcp-tool for tools with mcp__ prefix', () => {
  assert.equal(classifyRule('mcp__server__tool'), 'mcp-tool');
  assert.equal(classifyRule('mcp__foo(bar)'), 'mcp-tool');
});

test('returns any-read for Read tool with empty or wildcard path', () => {
  assert.equal(classifyRule('Read'), 'any-read');
  assert.equal(classifyRule('Read()'), 'any-read');
  assert.equal(classifyRule('Read(*)'), 'any-read');
  assert.equal(classifyRule('Read(/**)'), "repo-read");
});

test('returns credential-read for Read tool accessing home credential store', () => {
  assert.equal(classifyRule('Read(~/.ssh)'), 'credential-read');
  assert.equal(classifyRule('Read(~/.aws)'), 'credential-read');
  assert.equal(classifyRule('Read(~/.gnupg)'), 'credential-read');
  assert.equal(classifyRule('Read(~/.docker)'), 'credential-read');
  assert.equal(classifyRule('Read(~/.kube)'), 'credential-read');
  assert.equal(classifyRule('Read(~/.netrc)'), 'credential-read');
  assert.equal(classifyRule('Read(~/Library/Keychains)'), 'credential-read');
});

test('returns outside-read for Read tool accessing non-credential home paths', () => {
  assert.equal(classifyRule('Read(~/Documents)'), 'outside-read');
  assert.equal(classifyRule('Read(~/projects)'), 'outside-read');
});

test('returns repo-read for Read tool with relative path', () => {
  assert.equal(classifyRule('Read(src/index.js)'), 'repo-read');
  assert.equal(classifyRule('Read(config.json)'), 'repo-read');
});

test('returns tmp-write for Write tool with double-slash tmp path', () => {
  assert.equal(classifyRule('Write(//tmp/file.txt)'), 'tmp-write');
  assert.equal(classifyRule('Write(//private/tmp/file.txt)'), 'tmp-write');
  assert.equal(classifyRule('Write(//var/folders/abc/file.txt)'), 'tmp-write');
});

test('returns outside-write for Write tool with double-slash non-tmp path', () => {
  assert.equal(classifyRule('Write(//etc/passwd)'), 'outside-write');
  assert.equal(classifyRule('Write(//usr/local/bin)'), 'outside-write');
});

test('returns repo-write for Write tool with relative path', () => {
  assert.equal(classifyRule('Write(src/new.js)'), 'repo-write');
  assert.equal(classifyRule('Write(output.txt)'), 'repo-write');
});

test('returns egress for network tools and Bash commands', () => {
  assert.equal(classifyRule('WebFetch'), 'egress');
  assert.equal(classifyRule('WebSearch'), 'egress');
  assert.equal(classifyRule('Bash(curl http://example.com)'), 'egress');
  assert.equal(classifyRule('Bash(wget http://example.com)'), 'egress');
  assert.equal(classifyRule('Bash(ssh user@host)'), 'egress');
  assert.equal(classifyRule('Bash(git push origin main)'), 'egress');
  assert.equal(classifyRule('Bash(npm install)'), 'egress');
  assert.equal(classifyRule('Bash(pip install requests)'), 'egress');
});

test('returns credential-read for Bash commands accessing home credential stores', () => {
  assert.equal(classifyRule('Bash(cat ~/.ssh/id_rsa)'), 'credential-read');
  assert.equal(classifyRule('Bash(ls $HOME/.aws)'), 'credential-read');
  assert.equal(classifyRule('Bash(cat ${HOME}/.gnupg)'), 'credential-read');
});

test('returns command-exec for Bash commands that are not network or credential access', () => {
  assert.equal(classifyRule('Bash(ls -la)'), 'command-exec');
  assert.equal(classifyRule('Bash(echo hello)'), 'command-exec');
  assert.equal(classifyRule('Bash(git status)'), 'command-exec');
});

test('returns tool for unknown tools', () => {
  assert.equal(classifyRule('CustomTool'), 'tool');
  assert.equal(classifyRule('CustomTool(args)'), 'tool');
});

test('returns unresolved for paths with variables, backslashes, or parent references', () => {
  assert.equal(classifyRule('Read(${HOME}/file)'), 'unresolved');
  assert.equal(classifyRule('Read($HOME/file)'), 'unresolved');
  assert.equal(classifyRule('Read(%USERPROFILE%\\file)'), 'unresolved');
  assert.equal(classifyRule('Read(C:\\Users\\file)'), 'unresolved');
  assert.equal(classifyRule('Read(../secret)'), 'unresolved');
  assert.equal(classifyRule('Read(a\\b)'), 'unresolved');
});
