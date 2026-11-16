// lib/dfd-map-client.js — the drawing and wiring of the map view. lib/dfd-map-render.mjs inlines
// this file after lib/dfd-map-core.mjs and calls mountMapView(document, createMapCore); the tests
// call it with a stand-in document. Every decision is the core's; this file turns its answers into
// markup and a reader's clicks into its calls.

/**
 * Put text on the clipboard: the asynchronous clipboard where the page has one, else by selecting
 * it in `field` and asking the document to copy. -> a promise of whether it was copied.
 */
export function copyText(document, clipboard, field, text) {
  const byHand = () => { field.value = text; field.select(); try { return document.execCommand('copy') === true; } catch { return false; } };
  if (clipboard && typeof clipboard.writeText === 'function') return clipboard.writeText(text).then(() => true, byHand);
  return Promise.resolve(byHand());
}

export function mountMapView(document, createMapCore, env = {}) {
  const timers = env.timers || { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) };
  const copy = env.copy || ((text) => copyText(document, globalThis.navigator && globalThis.navigator.clipboard, document.getElementById('brief-text'), text));
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const core = createMapCore(JSON.parse($('dfd-data').textContent));
  const { S, SEV } = core;
  const pct = (v) => `${Math.round(v * 100)}%`;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const STATE_WORD = { open: 'open', thin: 'dismissed, under two axes', held: 'held on two axes', fixed: 'fixed, not rescanned' };
  const statePill = (st) => `<span class="st is-${st}">${STATE_WORD[st]}</span>`;
  const sevPills = (sev) => SEV.filter((s) => sev[s] > 0).map((s) => `<span class="st sev-${s}">${sev[s]} ${s}</span>`).join(' ');

  function drawMap() {
    const L = core.layout();
    const at = new Map(L.boxes.map((b) => [b.id, b]));
    let out = `<svg class="dfd map${S.open.length ? '' : ' fit'}" viewBox="0 0 ${L.w} ${L.h}" width="${L.w}" height="${L.h}" role="img" aria-label="Map: ${L.boxes.filter((b) => !b.open).length} boxes drawn, ${L.edges.length} flows drawn">`;
    for (const b of L.boxes.filter((x) => x.open)) {
      out += `<g class="mb open${S.focus === b.id ? ' on' : ''}${core.isChanged(b.id) ? ' chg' : ''}" data-id="${esc(b.id)}" data-open="1"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="4"/>`
        + `<text class="hd" x="${b.x + 10}" y="${b.y + 17}">− ${esc(core.clipText(b.it.label, Math.max(12, Math.floor(b.w / 7) - 14)))} · ${b.it.roll.elements}${b.it.roll.issues.size ? ` · ${plural(b.it.roll.issues.size, 'issue', 'issues')}` : ''}</text></g>`;
    }
    for (const e of L.edges) {
      out += `<g class="me ${e.level}${e.taint ? ' taint' : ''}${e.hot ? ' hot' : ''}"><path d="${e.d}" stroke-width="${Math.min(4, 1 + Math.log2(e.count) / 3).toFixed(1)}" marker-end="url(#map-a${e.taint ? '-t' : ''})"/>`
        + `${S.labels && e.count > 1 && (e.hot || e.level === 'detail' || e.count >= 10) ? `<text x="${e.lx}" y="${e.ly - 3}" text-anchor="middle">×${e.count}</text>` : ''}</g>`;
    }
    for (const b of L.boxes.filter((x) => !x.open)) {
      if (b.more) {
        out += `<g class="mb more" data-id="${esc(b.id)}" data-more="1"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="4"/><text x="${b.x + b.w / 2}" y="${b.y + 25}" text-anchor="middle">+ ${b.more} more</text></g>`;
        continue;
      }
      const it = b.it; const r = it.roll;
      const group = it.kind === 'group';
      const n = core.sizeOf(it);
      const cov = core.coverageOf(r);
      const cls = ['mb', group ? 'grp' : 'el', group && r.elements === 0 && !S.leaves ? 'sum' : '', it.leaf ? 'leaf' : '', core.lensClass(it), core.isChanged(b.id) ? 'chg' : '', S.focus === b.id || L.focusBox === b.id ? 'on' : ''].filter(Boolean).join(' ');
      const name = group ? `${core.kidsOf(it).length ? '+ ' : ''}${core.clipText(it.label, 17)}` : core.clipText(it.label.split('/').pop(), 23);
      out += `<g class="${cls}" data-id="${esc(b.id)}"${group ? ' data-group="1"' : ''}><title>${esc(it.label)}</title><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${group ? 4 : 10}"/>`
        + `<text class="lb" x="${b.x + 9}" y="${b.y + 18}">${esc(name)}</text>`
        + `${group ? `<text class="ct" x="${b.x + 9}" y="${b.y + 32}">${n} ${r.elements === 0 && !S.leaves ? 'folded' : n === 1 ? 'element' : 'elements'}${cov === null ? '' : ` · ${pct(cov)}`}</text>` : ''}`
        + `${r.issues.size ? `<g class="bd sev-${r.worst}"><rect x="${b.x + b.w - 30}" y="${b.y - 7}" width="26" height="15" rx="7"/><text x="${b.x + b.w - 17}" y="${b.y + 4}" text-anchor="middle">${r.issues.size}</text></g>` : ''}`
        + `${r.thin.size ? `<g class="bd thin"><rect x="${b.x + b.w - 30 - (r.issues.size ? 30 : 0)}" y="${b.y - 7}" width="26" height="15" rx="7"/><text x="${b.x + b.w - 17 - (r.issues.size ? 30 : 0)}" y="${b.y + 4}" text-anchor="middle">${r.thin.size}</text></g>` : ''}`
        + `${r.done.size ? `<g class="bd done"><rect x="${b.x + b.w - 30 - (r.issues.size ? 30 : 0) - (r.thin.size ? 30 : 0)}" y="${b.y - 7}" width="26" height="15" rx="7"/><text x="${b.x + b.w - 17 - (r.issues.size ? 30 : 0) - (r.thin.size ? 30 : 0)}" y="${b.y + 4}" text-anchor="middle">${r.done.size}</text></g>` : ''}`
        + `${r.traced ? `<circle class="tr" cx="${b.x + b.w - 40}" cy="${b.y}" r="4"/>` : ''}`
        + `${cov === null ? (r.unmeasured ? `<rect class="cv-none" x="${b.x + 9}" y="${b.y + b.h - 10}" width="${b.w - 18}" height="3"/>` : '')
          : `<rect class="cv-track" x="${b.x + 9}" y="${b.y + b.h - 10}" width="${b.w - 18}" height="3"/><rect class="cv-fill${cov < core.FLOOR ? ' low' : ''}" x="${b.x + 9}" y="${b.y + b.h - 10}" width="${((b.w - 18) * cov).toFixed(1)}" height="3"/>`}`
        + '</g>';
    }
    $('wrap').innerHTML = `${out}</svg>`;
    const st = core.stats();
    $('status').textContent = `${st.drawn} boxes drawn (budget ${st.budget}) · ${plural(st.open, 'group', 'groups')} open · ${L.edges.length} merged flows drawn`
      + `${L.hidden ? `, ${L.hidden} inside open groups not drawn (select a box, or tick "all flows")` : ''}`;
  }

  function drawTiles() {
    const st = core.stats();
    $('tiles').innerHTML = `<div class="tile"><b>${st.elements}</b><span>code elements (${st.leaves} files, variables and programs folded into counts)</span></div>`
      + `<div class="tile${st.states.open ? ' live' : ''}"><b>${st.states.open}</b><span>open issues${st.states.open ? `: ${SEV.filter((s) => st.sev[s] > 0).map((s) => `${st.sev[s]} ${s}`).join(', ')}` : ''} (of ${st.issues})</span></div>`
      + `${st.issues - st.states.open ? `<div class="tile grey"><b>${st.states.thin}</b><span>judged not a defect on fewer than two tested axes: not closed</span></div><div class="tile closed"><b>${st.states.held + st.states.fixed}</b><span>closed: ${st.states.fixed} fixed (not rescanned), ${st.states.held} held on two or more axes</span></div>` : ''}`
      + `<div class="tile"><b>${st.coverage === null ? 'n/a' : pct(st.coverage)}</b><span>line coverage over ${st.measured} measured elements (${st.unmeasured} not measured)</span></div>`
      + `<div class="tile"><b>${st.flows}</b><span>flows in the document</span></div>`;
  }

  function drawIssues() {
    const rows = core.issues();
    $('issues').innerHTML = rows.length ? rows.map((i) => `<tr data-row data-node="${esc(i.node)}"${i.note ? ` title="${esc(i.note)}"` : ''}><td>${statePill(i.state)}</td><td><span class="st sev-${i.severity}">${i.severity}</span></td><td class="m">${esc(i.id)}</td><td>${esc(i.title)}</td><td class="m">${esc(i.cwe)}</td><td>${esc(i.where)}</td><td class="m">${i.controls ? `${i.tested}/${i.axes}` : ''}</td><td class="acts">${acts(i.id)}</td></tr>`).join('')
      : '<tr><td colspan="8">The document carries no issues.</td></tr>';
    for (const id of ['copy-all', 'fix-all']) $(id).hidden = !rows.length;
  }

  const acts = (id) => `<button type="button" class="btn" data-copy="${esc(id)}">copy</button> <button type="button" class="btn fix" data-fix="${esc(id)}">remediate</button>`;
  const link = (x, extra = '') => `<button type="button" class="lk" data-go="${esc(x.id)}">${esc(x.label)}</button>${extra}`;
  function drawPanel() {
    const d = S.focus === null ? null : core.detail(S.focus);
    if (!d) { $('panel').innerHTML = '<p class="sub">Nothing selected. Select a box, an issue or a search result to see what it holds and what it touches.</p>'; return; }
    const cov = d.coverage === null ? (d.unmeasured ? 'coverage not measured' : 'nothing to cover') : `${pct(d.coverage)} of ${d.total} lines covered${d.unmeasured ? ` (${d.unmeasured} elements not measured)` : ''}`;
    let h = `<h3>${esc(d.label)}</h3><p class="sub">${d.path.length ? `${d.path.map(esc).join(' › ')} · ` : ''}${d.kind === 'group' ? `${plural(d.elements, 'element', 'elements')}, ${d.leaves} folded` : esc(d.subtype)}${d.traced ? ' · on a traced flow' : ''} · ${cov}</p>`;
    if (d.kind === 'group') h += `<p><button type="button" class="btn" data-act="toggle">${d.open ? 'close' : 'open'}</button> <button type="button" class="btn" data-act="pin" aria-pressed="${d.pinned}">${d.pinned ? 'unpin' : 'pin open'}</button></p>`;
    if (d.note) h += `<p class="sub">${esc(d.note)}</p>`;
    if (d.issues.length) h += `<h4>Issues ${sevPills(d.sev)}</h4><ul>${d.issues.map((i) => `<li>${i.state === 'open' ? '' : `${statePill(i.state)} `}<span class="st sev-${i.severity}">${i.severity}</span> <span class="m">${esc(i.id)}</span> ${esc(i.title)} ${acts(i.id)}${i.note ? `<br><span class="sub">${esc(i.note)}</span>` : ''}</li>`).join('')}</ul>`;
    if (d.kind === 'node') {
      if (d.peers.length) h += `<h4>Flows with ${plural(d.peers.length, 'element', 'elements')}</h4><ul>${d.peers.map((p) => `<li>${link(p, p.count > 1 ? ` ×${p.count}` : '')}</li>`).join('')}</ul>`;
      for (const t of d.touches) h += `<h4>${esc(t.kind)}: ${t.count}</h4><ul class="cols3">${t.list.map((x) => `<li>${link(x)}</li>`).join('')}${t.count > t.list.length ? `<li>and ${t.count - t.list.length} more</li>` : ''}</ul>`;
      if (d.users.length) h += `<h4>Used by ${plural(d.users.length, 'element', 'elements')}</h4><ul>${d.users.map((p) => `<li>${link(p, p.count > 1 ? ` ×${p.count}` : '')}</li>`).join('')}</ul>`;
      if (!d.peers.length && !d.touches.length && !d.users.length) h += '<p class="sub">No flow in the document touches it.</p>';
    } else if (d.children.length) {
      h += `<h4>Inside</h4><ul class="cols3">${d.children.map((c) => `<li>${link(c, c.issues ? ` <span class="st sev-high">${c.issues}</span>` : '')}</li>`).join('')}</ul>`;
    }
    $('panel').innerHTML = h;
  }

  function drawHits(q) {
    const hits = core.search(q);
    $('hits').hidden = !String(q || '').trim();
    $('hits').innerHTML = hits.length ? hits.map((x) => `<li>${link(x)} <span class="sub">${esc(x.kind)}</span></li>`).join('') : '<li class="sub">No element, group or issue matches (two characters at least).</li>';
  }

  // ---- playback against pull requests
  let playing = null;
  function drawPlayback() {
    const i = core.stepInfo();
    $('play-bar').hidden = i.total === 0;
    if (i.total === 0) return;
    $('pb-scrub').max = i.total;
    $('pb-scrub').value = i.step;
    $('pb-play').textContent = playing === null ? '▶ play' : '❚❚ pause';
    const did = i.pr ? [i.pr.patches.length ? `${plural(i.pr.patches.length, 'patch', 'patches')}: ${i.pr.patches.join(', ')}` : '', i.fixes.length ? `fixes ${i.fixes.join(', ')}` : '', i.rules.length ? `rules on ${i.rules.join(', ')}` : '', `touches ${plural(i.touched, 'element', 'elements')} on the map${i.pr.files ? ` (${plural(i.pr.files, 'file', 'files')} changed)` : ''}`].filter(Boolean).join(' · ') : '';
    $('pb-out').innerHTML = i.pr ? `<b>${i.step} of ${i.total}</b> · <span class="m">${esc(i.pr.id)}</span>${i.pr.state ? ` <span class="st">${esc(i.pr.state)}</span>` : ''} ${esc(i.pr.title)}<br><span class="sub">${esc(did)}</span>`
      : `<b>0 of ${i.total}</b> · the original position, before any ${i.unit}: every issue as the scanner left it`;
  }
  function goStep(k) { core.setStep(k); drawTiles(); drawIssues(); drawPlayback(); drawStory(); draw(); }
  function stop() { if (playing !== null) { timers.clear(playing); playing = null; } }
  function tick() {
    const i = core.stepInfo();
    if (i.step >= i.total) { stop(); drawPlayback(); return; }
    goStep(i.step + 1);
    playing = core.stepInfo().step >= i.total ? null : timers.set(tick, Number($('pb-speed').value) || 1500);
    drawPlayback();
  }
  $('play-bar').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-pb]');
    if (!b) return;
    const i = core.stepInfo();
    const act = b.dataset.pb;
    if (act === 'play') {
      if (playing !== null) { stop(); drawPlayback(); return; }
      if (i.step >= i.total) goStep(0);
      playing = timers.set(tick, Number($('pb-speed').value) || 1500);
      drawPlayback();
      return;
    }
    stop();
    goStep(act === 'first' ? 0 : act === 'last' ? i.total : act === 'prev' ? i.step - 1 : i.step + 1);
  });
  $('pb-scrub').addEventListener('input', (ev) => { stop(); goStep(ev.target.value); });

  // ---- the plain account: no symbols, no ids without words around them
  const LEVEL = { critical: 'critical', high: 'serious', medium: 'moderate', low: 'minor' };
  const outcome = (h) => (h.impacts.length ? `worst outcome: <b>${esc(h.impacts[0].label)}</b> (${LEVEL[h.impacts[0].level]})${h.impacts.length > 1 ? `, also ${h.impacts.slice(1).map((x) => esc(x.label)).join(', ')}` : ''}` : 'no route from it to a named harm is drawn');
  const origin = (h) => (h.sources.length ? `Reached from ${h.sources.map(esc).join(' or ')}. ` : '');
  const hazardLine = (h) => `<b>${esc(h.id)}</b>${h.title ? ` ${esc(h.title)}` : ''}, in ${esc(h.where)}. ${origin(h)}${outcome(h)[0].toUpperCase()}${outcome(h).slice(1)}.`;
  const list = (items, each, max = 8) => `<ul>${items.slice(0, max).map((h) => `<li>${each(h)}</li>`).join('')}${items.length > max ? `<li class="sub">and ${items.length - max} more, in the table below</li>` : ''}</ul>`;
  function drawStory() {
    $('story').hidden = !S.story;
    if (!S.story) return;
    const st = core.story();
    const c = st.counts;
    const closed = c.fixed + c.held;
    const share = (n) => (c.total ? ((n / c.total) * 100).toFixed(1) : '0');
    let h = `<h2>What is going on</h2><p class="lead">${c.total ? `<b>${c.total}</b> ${c.total === 1 ? 'hazard was' : 'hazards were'} found. <b class="ok">${closed}</b> dealt with` : 'No hazard is recorded in this document'}`
      + `${c.total ? `, <b class="bad">${c.open}</b> still open${c.thin ? `, <b class="thin">${c.thin}</b> judged harmless on too little evidence to close` : ''}.` : '.'}</p>`;
    // drawn as SVG: the page's policy admits no inline style, so a width cannot be set on a span
    if (c.total) { const w = [closed, c.thin, c.open].map((n) => Number(share(n))); h += `<svg class="meter" viewBox="0 0 100 4" preserveAspectRatio="none" role="img" aria-label="${closed} dealt with, ${c.thin} not closed, ${c.open} open"><rect class="ok" x="0" y="0" width="${w[0]}" height="4"/><rect class="thin" x="${w[0]}" y="0" width="${w[1]}" height="4"/><rect class="bad" x="${w[0] + w[1]}" y="0" width="${w[2]}" height="4"/></svg>`; }
    if (st.total) {
      h += st.set ? `<h3>Step ${st.step} of ${st.total}: ${esc(st.set.title || st.set.id)}</h3>` : `<h3>Step 0 of ${st.total}: the starting position</h3><p>Nothing has been changed yet. Every hazard is as it was found.</p>`;
      if (st.set) {
        h += st.dealt.length ? `<p>This change dealt with ${plural(st.dealt.length, 'hazard', 'hazards')}:</p>${list(st.dealt, (x) => `${hazardLine(x)} <span class="now ${x.state}">Now: ${x.state === 'fixed' ? 'fixed' : x.state === 'held' ? 'held' : x.state === 'thin' ? 'not closed' : 'open'}, ${esc(x.how)}.</span>`
          + `${x.done.length ? `<br><span class="sub">What was changed: ${x.done.map((k) => `${esc(k.title)}${k.note ? `: ${esc(k.note)}` : ''}`).join(' ')}</span>` : x.note ? `<br><span class="sub">${esc(x.note)}</span>` : ''}`)}`
          : '<p>This change closed no hazard. The ringed boxes on the map are what it touched.</p>';
        if (st.beyond.length) h += `<p>The same weakness also sits where this change does not reach, and stays open there:</p>${list(st.beyond, (x) => hazardLine(x))}`;
      }
    }
    h += st.open.length ? `<h3>Still open${st.total ? ' after this step' : ''}: ${st.open.length}</h3>${list(st.open, (x) => `${hazardLine(x)} <span class="now ${x.state}">${x.state === 'thin' ? `${x.how[0].toUpperCase()}${esc(x.how.slice(1))}` : 'Nobody has ruled on it'}.</span>`)}`
      : c.total ? '<h3>Nothing is left open.</h3>' : '';
    $('story').innerHTML = h;
  }

  function drawControls() {
    for (const b of document.querySelectorAll('#lens button')) b.setAttribute('aria-pressed', String(b.dataset.lens === S.lens));
    for (const i of document.querySelectorAll('#opts input')) i.checked = i.dataset.opt === 'edges' ? S.edges === 'all' : !!S[i.dataset.opt];
  }
  function draw() { drawMap(); drawPanel(); drawControls(); }

  $('wrap').addEventListener('click', (ev) => {
    const g = ev.target.closest('[data-id]');
    if (!g) { S.focus = null; draw(); return; }
    const id = g.dataset.id;
    if (g.dataset.more) core.more(id);
    else if (g.dataset.open) { core.close(id); S.focus = id; }
    else if (g.dataset.group) { core.expand(id); S.focus = id; }
    else S.focus = id;
    draw();
  });
  /** Copy text and say whether it worked; a failure leaves the text selected in the brief for copying by hand. */
  const copyAnd = (text, what) => copy(text).then((ok) => { $('copied').textContent = ok ? `Copied ${what}.` : `Could not copy ${what}: it is in the brief below, select it and copy it by hand.`; if (!ok) showBrief(text, what); return ok; });
  function showBrief(text, what) {
    $('brief').hidden = false;
    $('brief-title').textContent = what;
    $('brief-text').value = text;
    $('brief').scrollIntoView({ block: 'start' });
  }
  /** A copy or remediate button anywhere on the page. -> whether the click was one. */
  const issueAct = (ev) => {
    const c = ev.target.closest('[data-copy]');
    if (c) { copyAnd(core.issueText(c.dataset.copy), c.dataset.copy); return true; }
    const f = ev.target.closest('[data-fix]');
    if (f) { showBrief(core.remediationPrompt([f.dataset.fix]), `Remediation brief for ${f.dataset.fix}`); return true; }
    return false;
  };
  $('issues').addEventListener('click', (ev) => {
    if (issueAct(ev)) return;
    const tr = ev.target.closest('tr[data-node]');
    if (!tr) return;
    core.reveal(tr.dataset.node);
    draw();
    $('wrap').scrollIntoView({ block: 'start' });
  });
  const go = (ev) => {
    const b = ev.target.closest('[data-go]');
    if (b) { core.reveal(b.dataset.go); draw(); return true; }
    return false;
  };
  $('panel').addEventListener('click', (ev) => {
    if (issueAct(ev) || go(ev)) return;
    const b = ev.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'pin') core.pin(S.focus); else core.toggle(S.focus);
    draw();
  });
  $('hits').addEventListener('click', (ev) => { if (go(ev)) { $('q').value = ''; drawHits(''); } });
  $('q').addEventListener('input', (ev) => drawHits(ev.target.value));
  $('lens').addEventListener('click', (ev) => { const b = ev.target.closest('button'); if (b) { S.lens = b.dataset.lens; draw(); } });
  $('opts').addEventListener('change', (ev) => {
    const o = ev.target.dataset.opt;
    if (o === 'edges') S.edges = ev.target.checked ? 'all' : 'focus'; else S[o] = ev.target.checked;
    if (o === 'leaves') drawTiles();
    if (o === 'follow' || o === 'leaves') core.setStep(core.stepInfo().step);
    if (o === 'story') drawStory();
    draw();
  });
  $('copy-all').addEventListener('click', () => copyAnd(core.issues().map((i) => core.issueText(i.id)).join('\n\n'), `${core.issues().length} issues`));
  $('fix-all').addEventListener('click', () => { const n = core.issues().filter((i) => i.state === 'open' || i.state === 'thin').length; showBrief(core.remediationPrompt(), `Remediation brief for the ${n} issues not closed`); });
  $('brief-copy').addEventListener('click', () => copyAnd($('brief-text').value, 'the brief'));
  $('brief-close').addEventListener('click', () => { $('brief').hidden = true; });
  $('close-all').addEventListener('click', () => { S.open = []; S.focus = null; draw(); });

  drawTiles(); drawIssues(); drawHits(''); drawPlayback(); drawStory(); draw();
  return { core, draw, copyAnd, goStep };
}
