import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// The theme a page the panel serves outside its shell carries (docs/THEME.md §2.1): the panel's
// tokens, the light overlay behind its media switch, the colour-vision palettes, and the switch
// script that applies the stored choice before first paint. One copy, so a page cannot link the
// light sheet and forget the colour-vision one that has to move in lockstep with it.
export const THEME_LINKS = '<link rel="stylesheet" href="/static/panel.css">'
  + '<link id="theme-light" rel="stylesheet" href="/static/panel-light.css" media="(prefers-color-scheme: light)">'
  + '<link rel="stylesheet" href="/static/panel-cvd.css">'
  + '<link id="cvd-light" rel="stylesheet" href="/static/panel-cvd-light.css" media="(prefers-color-scheme: light)">';

// After the links and after any <style data-light> of the page's own, which it must find in place.
export const THEME_SCRIPT = '<script src="/static/theme-switch.js"></script>';

export const THEME_HEAD = THEME_LINKS + THEME_SCRIPT;

export const THEME_SWITCH = '<div data-theme-switch></div>';

const staticDir = () => process.env.CW_ADMIN_STATIC || join(dirname(fileURLToPath(import.meta.url)), '..', 'static');

// The switch as an inline script, for a document that must still work saved to disk and so links
// nothing. A missing file throws: a page that silently lost its theme control would still render.
export const themeSwitchInline = () => `<script>${readFileSync(join(staticDir(), 'theme-switch.js'), 'utf8')}</script>`;
