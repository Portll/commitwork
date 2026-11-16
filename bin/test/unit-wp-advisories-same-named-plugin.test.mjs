// A plugin repository's slug is accepted only when the advisory source names the same plugin
// (bin/wp-advisories.mjs sameNamedPlugin). Cases are synthetic, each shaped like a name pair the lane has met.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sameNamedPlugin } from '../wp-advisories.mjs';

test('the wordpress.org name is the header name plus a tagline', () => {
  assert.equal(sameNamedPlugin('Acme Code Box &#8211; Beautiful Syntax Highlighting', 'Acme Code Box'), true);
  assert.equal(sameNamedPlugin('Acme SEO – AI SEO Tools', 'Acme SEO'), true);
  assert.equal(sameNamedPlugin('Acme Shop &#8211; Payments for Shops', 'Acme Shop - Payments for Shops'), true);
  assert.equal(sameNamedPlugin('Acme Forms', 'acme  forms'), true);
});

test('a fork or a different plugin under a guessed slug is refused', () => {
  assert.equal(sameNamedPlugin('Acme Player ', 'Acme Player X'), false);
  assert.equal(sameNamedPlugin('Acme Player X', 'Acme Player'), false);
  assert.equal(sameNamedPlugin('Acme Image Fetch', 'Acme Image Fetch 2'), false);
  assert.equal(sameNamedPlugin('WP Acme Monitor', 'Acme Monitor for WordPress'), false);
  assert.equal(sameNamedPlugin('Acme Formsmith', 'Acme Forms'), false);
});

test('a missing name on either side is never a match', () => {
  assert.equal(sameNamedPlugin(null, 'Acme'), false);
  assert.equal(sameNamedPlugin('Acme', ''), false);
});
