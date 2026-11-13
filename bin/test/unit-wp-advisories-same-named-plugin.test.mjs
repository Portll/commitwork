// A plugin repository's slug is accepted only when the advisory source names the same plugin
// (bin/wp-advisories.mjs sameNamedPlugin). Cases are names measured on a 116-plugin sample, 2026-11-12.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameNamedPlugin } from '../wp-advisories.mjs';

test('the wordpress.org name is the header name plus a tagline', () => {
  assert.equal(sameNamedPlugin('Code Block Pro &#8211; Beautiful Syntax Highlighting', 'Code Block Pro'), true);
  assert.equal(sameNamedPlugin('Rank Math SEO – AI SEO Tools', 'Rank Math SEO'), true);
  assert.equal(sameNamedPlugin('Woo Viet &#8211; WooCommerce for Vietnam', 'Woo Viet - WooCommerce for Vietnam'), true);
  assert.equal(sameNamedPlugin('Acme Forms', 'acme  forms'), true);
});

test('a fork or a different plugin under a guessed slug is refused', () => {
  assert.equal(sameNamedPlugin('Hermit ', 'Hermit X'), false);
  assert.equal(sameNamedPlugin('Hermit X', 'Hermit'), false);
  assert.equal(sameNamedPlugin('Import External Images', 'Import External Images 2'), false);
  assert.equal(sameNamedPlugin('WP Sentry', 'Sentry for WordPress'), false);
  assert.equal(sameNamedPlugin('Acme Formsmith', 'Acme Forms'), false);
});

test('a missing name on either side is never a match', () => {
  assert.equal(sameNamedPlugin(null, 'Acme'), false);
  assert.equal(sameNamedPlugin('Acme', ''), false);
});
