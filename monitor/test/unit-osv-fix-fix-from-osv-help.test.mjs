// Extracts the fixed version from an OSV help table (monitor/osv-fix.mjs fixFromOsvHelp).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixFromOsvHelp } from '../osv-fix.mjs';

test('returns empty string when help is not a string', () => {
  assert.equal(fixFromOsvHelp(null, { id: 'GHSA-1', pkg: 'p' }), "");
});

test('returns empty string when help has no fixed versions table', () => {
  assert.equal(fixFromOsvHelp('No table here', { id: 'GHSA-1', pkg: 'p' }), "");
});

test('returns empty string when table has no valid rows', () => {
  const help = '### Fixed Versions\n| ID | Package | Fixed |\n|---|---|---|\n| GHSA-1 | p | - |\n';
  assert.equal(fixFromOsvHelp(help, { id: 'GHSA-1', pkg: 'p' }), "");
});

test('returns empty string when no package is specified', () => {
  const help = '### Fixed Versions\n| ID | Package | Fixed |\n|---|---|---|\n| GHSA-1 | p | 1.0.0 |\n';
  assert.equal(fixFromOsvHelp(help, { id: 'GHSA-1' }), "");
});

test('returns empty string when package does not match any row', () => {
  const help = '### Fixed Versions\n| ID | Package | Fixed |\n|---|---|---|\n| GHSA-1 | other | 1.0.0 |\n';
  assert.equal(fixFromOsvHelp(help, { id: 'GHSA-1', pkg: 'p' }), "");
});

test('returns the fixed version when there is a single match', () => {
  const help = '### Fixed Versions\n| ID | Package | Fixed |\n|---|---|---|\n| GHSA-1 | p | 1.0.0 |\n';
  assert.equal(fixFromOsvHelp(help, { id: 'GHSA-1', pkg: 'p' }), "1.0.0");
});

test('returns empty string when distinct fixed versions disagree and no primary id match', () => {
  const help = '### Fixed Versions\n| ID | Package | Fixed |\n|---|---|---|\n| GHSA-1 | p | 1.0.0 |\n| RUSTSEC-1 | p | 2.0.0 |\n';
  assert.equal(fixFromOsvHelp(help, { id: 'GHSA-1', pkg: 'p', aliases: ['RUSTSEC-1'] }), "1.0.0");
});

test('returns primary fixed version when distinct versions exist and primary id matches', () => {
  const help = '### Fixed Versions\n| ID | Package | Fixed |\n|---|---|---|\n| GHSA-1 | p | 1.0.0 |\n| RUSTSEC-1 | p | 2.0.0 |\n';
  assert.equal(fixFromOsvHelp(help, { id: 'RUSTSEC-1', pkg: 'p', aliases: ['GHSA-1'] }), "2.0.0");
});

test('returns empty string when distinct versions remain after filtering', () => {
  const help = '### Fixed Versions\n| ID | Package | Fixed |\n|---|---|---|\n| GHSA-1 | p | 1.0.0 |\n| GHSA-2 | p | 2.0.0 |\n';
  assert.equal(fixFromOsvHelp(help, { id: 'GHSA-1', pkg: 'p', aliases: ['GHSA-2'] }), "1.0.0");
});

test('returns single distinct version when multiple rows agree', () => {
  const help = '### Fixed Versions\n| ID | Package | Fixed |\n|---|---|---|\n| GHSA-1 | p | 1.0.0 |\n| RUSTSEC-1 | p | 1.0.0 |\n';
  assert.equal(fixFromOsvHelp(help, { id: 'GHSA-1', pkg: 'p', aliases: ['RUSTSEC-1'] }), "1.0.0");
});
