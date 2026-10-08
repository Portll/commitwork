#!/usr/bin/env node
// Keep the legacy entry complete while an already-running server still reads index.html directly.
import { writeFileSync, renameSync } from 'node:fs';
import { readPanelDocument } from '../admin/lib/panel-document.mjs';

const output = new URL('../admin/index.html', import.meta.url);
const temporary = new URL('../admin/.index-build.html', import.meta.url);
const banner = '<!-- Generated compatibility entry. Edit panel.html and menus/*; run node bin/build-admin-panel.mjs. -->\n';
writeFileSync(temporary, banner + readPanelDocument());
renameSync(temporary, output);
console.log('Built admin/index.html from panel.html and menu components.');
