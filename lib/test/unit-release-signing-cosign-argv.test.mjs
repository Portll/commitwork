// Builds the cosign verify-blob argument vector for a signing record (lib/release-signing.mjs cosignArgv).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cosignArgv } from '../release-signing.mjs';

test('returns the full argv array for a standard signing record', () => {
  const signing = { checksums: 'abc123', identity: 'dev@example.com', issuer: 'https://oidc.example.com' };
  const r = cosignArgv(signing, '/tmp/dir');
  assert.deepEqual(r, ["cosign", "verify-blob", "--certificate", "/tmp/dir/abc123.pem", "--signature", "/tmp/dir/abc123.sig", "--certificate-identity-regexp", "dev@example.com", "--certificate-oidc-issuer", "https://oidc.example.com", "/tmp/dir/abc123"]);
});

test('returns the full argv array when checksums is an empty string', () => {
  const signing = { checksums: '', identity: 'user@host', issuer: 'https://issuer.example' };
  const r = cosignArgv(signing, '/data');
  assert.deepEqual(r, ["cosign", "verify-blob", "--certificate", "/data/.pem", "--signature", "/data/.sig", "--certificate-identity-regexp", "user@host", "--certificate-oidc-issuer", "https://issuer.example", "/data"]);
});

test('returns the full argv array when identity and issuer are empty strings', () => {
  const signing = { checksums: 'sha256:deadbeef', identity: '', issuer: '' };
  const r = cosignArgv(signing, '/var/tmp');
  assert.deepEqual(r, ["cosign", "verify-blob", "--certificate", "/var/tmp/sha256:deadbeef.pem", "--signature", "/var/tmp/sha256:deadbeef.sig", "--certificate-identity-regexp", "", "--certificate-oidc-issuer", "", "/var/tmp/sha256:deadbeef"]);
});

test('returns the full argv array when dir is an empty string', () => {
  const signing = { checksums: 'hash001', identity: 'a@b.c', issuer: 'https://idp' };
  const r = cosignArgv(signing, '');
  assert.deepEqual(r, ["cosign", "verify-blob", "--certificate", "hash001.pem", "--signature", "hash001.sig", "--certificate-identity-regexp", "a@b.c", "--certificate-oidc-issuer", "https://idp", "hash001"]);
});

test('returns the full argv array when dir contains a trailing slash', () => {
  const signing = { checksums: 'x'.repeat(64), identity: 'long-identity@provider.example', issuer: 'https://deep/path/issuer' };
  const r = cosignArgv(signing, '/nested/dir/');
  assert.deepEqual(r, ["cosign", "verify-blob", "--certificate", "/nested/dir/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.pem", "--signature", "/nested/dir/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.sig", "--certificate-identity-regexp", "long-identity@provider.example", "--certificate-oidc-issuer", "https://deep/path/issuer", "/nested/dir/xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"]);
});

test('returns the full argv array when checksums contains path separator characters', () => {
  const signing = { checksums: 'a/b/c', identity: 'id', issuer: 'iss' };
  const r = cosignArgv(signing, '/base');
  assert.deepEqual(r, ["cosign", "verify-blob", "--certificate", "/base/a/b/c.pem", "--signature", "/base/a/b/c.sig", "--certificate-identity-regexp", "id", "--certificate-oidc-issuer", "iss", "/base/a/b/c"]);
});
