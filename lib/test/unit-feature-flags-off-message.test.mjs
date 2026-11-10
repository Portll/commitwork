// Human-readable explanation of why an experimental feature is off (lib/feature-flags.mjs offMessage).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offMessage } from '../feature-flags.mjs';

test('returns the env-var message when the source env var matches the flag env var', () => {
  const f = { id: 'dark-mode', label: 'Dark Mode', source: 'env:DARK_MODE', envVar: 'DARK_MODE' };
  assert.equal(offMessage(f), "experimental feature \"dark-mode\" (Dark Mode) is switched off \u2014 set by DARK_MODE; set DARK_MODE=on or unset it");
});

test('returns the unset-source message when the source env var differs from the flag env var', () => {
  const f = { id: 'beta-ui', label: 'Beta UI', source: 'env:OLD_BETA', envVar: 'BETA_UI' };
  assert.equal(offMessage(f), "experimental feature \"beta-ui\" (Beta UI) is switched off \u2014 set by OLD_BETA; set BETA_UI=on, or unset OLD_BETA");
});

test('returns the panel message when the source is not an env var', () => {
  const f = { id: 'new-search', label: 'New Search', source: 'panel', envVar: 'NEW_SEARCH' };
  assert.equal(offMessage(f), "experimental feature \"new-search\" (New Search) is switched off \u2014 switch it on in the panel (Settings, Experimental features), POST /api/features {\"flag\":\"new-search\",\"on\":true}, or set NEW_SEARCH=on");
});

test('returns the env-var message when the source env var is empty and matches an empty env var', () => {
  const f = { id: 'x', label: 'X', source: 'env:', envVar: '' };
  assert.equal(offMessage(f), "experimental feature \"x\" (X) is switched off \u2014 set by ; set =on or unset it");
});

test('returns the unset-source message when the source env var is empty and the env var is non-empty', () => {
  const f = { id: 'y', label: 'Y', source: 'env:', envVar: 'Y' };
  assert.equal(offMessage(f), "experimental feature \"y\" (Y) is switched off \u2014 switch it on in the panel (Settings, Experimental features), POST /api/features {\"flag\":\"y\",\"on\":true}, or set Y=on");
});

test('returns the panel message when the source is exactly the env prefix with no var name', () => {
  const f = { id: 'z', label: 'Z', source: 'env:', envVar: 'Z' };
  assert.equal(offMessage(f), "experimental feature \"z\" (Z) is switched off \u2014 switch it on in the panel (Settings, Experimental features), POST /api/features {\"flag\":\"z\",\"on\":true}, or set Z=on");
});
