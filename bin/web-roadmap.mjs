#!/usr/bin/env node
// usage: web-roadmap.mjs [--write] [--work]
// exit: 0 written, or the page is current · 1 the page differs from its data (without --write) ·
//       2 the data or the page cannot be read, the data is malformed, the page has no markers, or
//       --work met a commit the source repository does not hold
// env, read at call time: CW_WEB_ROOT, CW_WEB_ROADMAP, CW_RELEASE_SOURCE (the repository --work reads
//      commits from; default this checkout)
// output: we/public/roadmap/index.html in the commitwork-web repository (CW_WEB_ROOT) — its cards between <!-- roadmap: … --> and
//         <!-- /roadmap -->, and its "Current:" line — written tmp+rename. --work first rewrites each
//         item's "work" list in roadmap.json from its "commits", one entry per commit, in order
//
// pins: the data and the markup are cobolwork-web's (data/roadmap/*.json, tools/roadmap.mjs); its
//       copy of commitwork-web's we/roadmap.json is held byte-equal by bin/test/web-roadmap.test.mjs
// guard: every key is checked, since a misspelt one drops its text from the page without a word
// guard: a page without markers refuses, never passes as current
// fact: a planned pill is "pill plan" here; cobolwork-web's sheet colours a bare "pill"

import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeAtomic } from '../monitor/lockfile.mjs';
import { isMainModule } from '../lib/is-main.mjs';
import { webRoot, missingWebRoot } from '../lib/web-root.mjs';

export { webRoot };
export const dataPath = () => process.env.CW_WEB_ROADMAP || join(dirname(webRoot()), 'roadmap.json');
export const pagePath = () => join(webRoot(), 'roadmap', 'index.html');
export const sourceRepo = () => resolve(process.env.CW_RELEASE_SOURCE || join(dirname(fileURLToPath(import.meta.url)), '..'));

const ITEM_KEYS = new Set(['name', 'lead', 'ben', 'fact', 'sub', 'note', 'limit', 'pill', 'added', 'spine', 'commits', 'work']);
const CARD_KEYS = new Set(['title', 'status', 'sub', 'items']);

export function validateRoadmap(data, source) {
  const fail = (where, why) => { throw new Error(`${source}: ${where}: ${why}`); };
  if (typeof data?.current !== 'string') fail('current', 'missing');
  if (!Array.isArray(data.cards)) fail('cards', 'missing');
  data.cards.forEach((card, c) => {
    const at = `card ${c + 1} (${card.title})`;
    for (const k of Object.keys(card)) if (!CARD_KEYS.has(k)) fail(at, `unknown key "${k}"`);
    for (const k of ['title', 'status', 'sub']) if (typeof card[k] !== 'string') fail(at, `"${k}" missing`);
    if (!Array.isArray(card.items)) fail(at, '"items" missing');
    card.items.forEach((item, i) => {
      const where = `${at}, item ${i + 1}`;
      for (const k of Object.keys(item)) if (!ITEM_KEYS.has(k)) fail(where, `unknown key "${k}"`);
      if ((item.name === undefined) === (item.lead === undefined)) fail(where, 'needs exactly one of "name" and "lead"');
      if (item.fact !== undefined && item.ben === undefined) fail(where, '"fact" needs "ben"');
      if (item.added !== undefined && typeof item.added !== 'boolean') fail(where, '"added" is not true or false');
      if (item.spine !== undefined && !/^[a-z-]+-roadmap \d+(\.\d+)*$/.test(item.spine)) fail(where, '"spine" is not "<plan id> <task id>"');
      if (item.commits !== undefined && !(Array.isArray(item.commits) && item.commits.length && item.commits.every((s) => /^[0-9a-f]{7,40}$/.test(s)))) fail(where, '"commits" is not a list of hex shas');
      if (item.work !== undefined) {
        if (!Array.isArray(item.work) || item.work.length !== item.commits?.length) fail(where, '"work" needs one entry per commit');
        item.work.forEach((w, n) => {
          if (Object.keys(w).join() !== 'date,what' || !/^\d{4}-\d{2}-\d{2}$/.test(w.date) || typeof w.what !== 'string' || !w.what) {
            fail(where, `"work" entry ${n + 1} is not {date: YYYY-MM-DD, what}`);
          }
        });
      }
    });
  });
  return data;
}

export function pillClass(text) {
  if (/^(in |released$|done$|shipped$|on main$)/.test(text)) return 'pill live';
  if (/^started\b/.test(text)) return 'pill part';
  if (text === 'decision') return 'pill sev';
  if (text === 'planned') return 'pill plan';
  throw new Error(`no pill class for "${text}"`);
}

const pill = (text) => `<span class="${pillClass(text)}">${text}</span>`;

export function renderItem(item) {
  const lead = item.lead ?? `<b>${item.name}</b>`;
  let html = item.ben === undefined ? lead : `${lead}: <span class="ben">${item.ben}</span>${item.fact ? ` ${item.fact}` : ''}`;
  if (item.sub) html += `<ul class="sub">${item.sub.map((s) => `<li>${s}</li>`).join('')}</ul>`;
  if (item.note !== undefined || item.limit !== undefined) {
    const limit = item.limit === undefined ? '' : `<b>Limit:</b> ${item.limit}`;
    html += `<span class="limit">${[item.note, limit].filter(Boolean).join(' ')}</span>`;
  }
  if (item.pill) html += pill(item.pill);
  if (item.added) html += '<span class="pill add">additional</span>';
  if (item.work) {
    const rows = item.work.map((w) => `<li><time datetime="${w.date}">${w.date}</time> ${w.what}</li>`).join('');
    html += `<details class="work"><summary>${changes(item.work.length)}</summary><ul>${rows}</ul></details>`;
  }
  return `<li>${html}</li>`;
}

const changes = (n) => `${n} change${n === 1 ? '' : 's'}`;

// The release reads as its features, then the work under each one.
export function tally(card) {
  const live = card.items.filter((i) => i.pill && pillClass(i.pill) === 'pill live').length;
  const work = card.items.reduce((n, i) => n + (i.work?.length ?? 0), 0);
  return `${live} of ${card.items.length} feature${card.items.length === 1 ? '' : 's'} done${work ? ` · ${changes(work)}` : ''}`;
}

export function renderCards(cards, indent = '    ') {
  const lines = [];
  for (const card of cards) {
    lines.push(`${indent}<div class="card">`);
    lines.push(`${indent}  <h3>${card.title}${pill(card.status)}</h3>`);
    lines.push(`${indent}  <p class="sub">${card.sub}</p>`);
    if (card.items.some((i) => i.work)) lines.push(`${indent}  <p class="tally">${tally(card)}</p>`);
    lines.push(`${indent}  <ul class="feats">`);
    for (const item of card.items) lines.push(`${indent}    ${renderItem(item)}`);
    lines.push(`${indent}  </ul>`);
    lines.push(`${indent}</div>`);
  }
  return lines.join('\n');
}

const BEGIN = /^([ \t]*)<!-- roadmap: (\S+) -->$/m;
const END = '<!-- /roadmap -->';

export function renderPage(html, data) {
  const begin = BEGIN.exec(html);
  if (!begin) throw new Error('the page has no <!-- roadmap: … --> marker');
  const [marker, indent] = begin;
  const start = begin.index + marker.length;
  const end = html.indexOf(END, start);
  if (end < 0) throw new Error(`the page has no ${END}`);
  const page = `${html.slice(0, start)}\n${renderCards(data.cards, indent)}\n${indent}${html.slice(end)}`;
  return page.replace(/<li><b>Current:<\/b> [^<]*<\/li>/, `<li><b>Current:</b> ${data.current}</li>`);
}

// A conventional subject without its type and scope, as a sentence, escaped for the page.
export function workText(subject) {
  const text = subject.replace(/^[a-z]+(\([^)]*\))?!?:\s*/, '');
  return (text.charAt(0).toUpperCase() + text.slice(1)).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function deriveWork(data, repo = sourceRepo()) {
  for (const card of data.cards) {
    for (const item of card.items) {
      if (!item.commits) { delete item.work; continue; }
      item.work = item.commits.map((sha) => {
        const r = spawnSync('git', ['-C', repo, 'log', '-1', '--format=%cs%x00%s', `${sha}^{commit}`, '--'], { encoding: 'utf8' });
        if (r.status !== 0 || !r.stdout.includes('\0')) throw new Error(`${item.name ?? item.lead}: commit ${sha} is not in ${repo}`);
        const [date, subject] = r.stdout.trim().split('\0');
        return { date, what: workText(subject) };
      });
    }
  }
  return data;
}

function main(argv) {
  const missing = missingWebRoot();
  if (missing) { console.error(`web-roadmap: ${missing} -- nothing written`); process.exit(2); }
  let page, rendered;
  try {
    const text = readFileSync(dataPath(), 'utf8');
    const work = argv.includes('--work');
    const data = validateRoadmap(work ? deriveWork(JSON.parse(text)) : JSON.parse(text), dataPath());
    if (work) {
      const out = `${JSON.stringify(data, null, 2)}\n`;
      if (out !== text) { writeAtomic(dataPath(), out); console.log(`web-roadmap: wrote the work lists in ${dataPath()}`); }
    }
    page = readFileSync(pagePath(), 'utf8');
    rendered = renderPage(page, data);
  } catch (e) {
    console.error(`web-roadmap: ${e.message} -- nothing written`);
    process.exit(2);
  }
  if (rendered === page) { console.log(`web-roadmap: ${pagePath()} is current`); return; }
  if (!argv.includes('--write')) {
    console.log(`web-roadmap: ${pagePath()} differs from ${dataPath()}; run node bin/web-roadmap.mjs --write`);
    process.exit(1);
  }
  writeAtomic(pagePath(), rendered);
  console.log(`web-roadmap: wrote ${pagePath()}`);
}

if (isMainModule(import.meta.url)) main(process.argv.slice(2));
