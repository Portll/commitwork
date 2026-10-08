<!-- verified-against: 2026-10-04 -->
# commitwork brand

The logo is the seal: a disc, a ring, and a key of two nodes joined by a line, on a 32-unit square.
Its geometry is drawn once, in [`lib/brand-tokens.mjs`](../../lib/brand-tokens.mjs), and every
surface takes the mark from there. The full visual reference, with the mark and the lockup drawn
in both themes, is [docs/THEME.md](../../docs/THEME.md).

## The mark

| Variant | Use | Disc | Ring | Key | In `lib/brand-tokens.mjs` |
|---|---|---|---|---|---|
| Default mark | Light grounds, and every tab icon | `#FFFFFF` | `#101011` | `#C9A227` | `MARK_SVG`, `MARK_IMG`, `MARK_URI`, `MARK_ICON` |
| Dark-ground seal | Dark grounds | `#14161A` | `#C9A227` | `#C9A227` | `SEAL_SVG`, `SEAL_IMG`, `SEAL_FAVICON` |
| Key | The `cw:key` specimen only; no surface wears it | `#101011` | `#c9a227` | `#c9a227` | `KEY_SVG`, `KEY_FAVICON` |

The default mark is the logo. On white its disc meets the page, and the black ring is its edge.

Geometry, in a `0 0 32 32` viewBox:

- disc: circle, r16, centred;
- ring: circle, r14.5, centred, stroke 1, no fill;
- filled node: circle, r2.4, at (12,20);
- hollow node: circle, r2.4, at (21,11), stroke 1.3, no fill;
- connector: a line from (13.7,18.3) to (19.3,12.7), stroke 1.3.

## The lockup

The seal and the wordmark on one line:

- **Seal.** A 1.5rem square (24px at a 16px root).
- **Gap.** .31rem (5px) between the seal and the wordmark.
- **Wordmark.** "commitwork" set as live text in IBM Plex Sans 700, uppercase, with .16em tracking,
  at .78rem, in the theme's ink (`--ink`). It is never an image.
- **Phones.** A 1.25rem seal, and the wordmark at .7rem with .13em tracking.

## Rules

- **Recolour, never redraw.** Every variant is the same geometry with different fills and strokes.
  `MARK_SVG` is derived from `SEAL_SVG` in code, so the two cannot disagree.
- **Inline copies match `SEAL_SVG` byte for byte.** `bin/test/brand-tokens-parity.test.mjs` holds
  the copies in the panel, `/config`, the panel server and the docsite editor to it. On a light
  ground their stylesheets recolour the copy to the default mark.
- **Pages rendered from user-editable source take the mark as an image** (`MARK_IMG`, or
  `SEAL_IMG` on a dark ground), never as live `<svg>`. A standalone SVG needs `xmlns`, which the
  wrappers add.
- **Every tab icon is the default mark.** The panel and the sitemap serve it as files
  (`cw-favicon.svg`, `cw-favicon-32.png`, `favicon.ico`). The docsite, the public origin's pages
  and the build-box landing page carry `MARK_ICON`, a data URI. `lib/test/brand-marks.test.mjs`
  holds the SVG files and every tracked page under a `public/` directory to the mark.
- **The smallest placement is the 1.25rem phone bar.**
