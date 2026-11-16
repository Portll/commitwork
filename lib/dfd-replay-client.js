// lib/dfd-replay-client.js — the drawing and wiring of the replay view. lib/dfd-replay-render.mjs
// inlines this file after lib/dfd-replay-core.mjs and calls mountReplayView(document,
// createReplayCore); the tests call it with a stand-in document. Every decision is the core's: this
// file turns its answers into markup and a reader's clicks and keys into its calls. Its own state
// (the playback timer) lives in one object made per mount.

export function mountReplayView(document, createReplayCore, env = {}) {
  const timers = env.timers || { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const clip = (s, n) => { const t = String(s); return t.length <= n ? t : `${t.slice(0, Math.max(1, n - 1))}…`; };
  const lines = (s, n, max) => {
    const out = [];
    for (const w of String(s).split(/\s+/).filter(Boolean)) { const last = out.length - 1; if (last >= 0 && `${out[last]} ${w}`.length <= n) out[last] = `${out[last]} ${w}`; else out.push(w); }
    if (out.length > max) { out.length = max; out[max - 1] = clip(`${out[max - 1]} …`, n); }
    return out.map((l) => clip(l, n));
  };
  const core = createReplayCore(JSON.parse($('dfd-data').textContent));
  const { S } = core;
  const V = { playing: null };
  const pct = (v) => `${Math.round(v * 100)}%`;
  const pill = (st) => `<span class="pill st-${st}">${esc(core.STATE_WORD[st])}</span>`;
  const link = (kind, id, text) => `<button type="button" class="lk" data-sel="${kind}" data-id="${esc(id)}">${esc(text)}</button>`;

  // ---- canvas
  function shape(s, R) {
    const { x, y } = s;
    if (s.shape === 'circle') return `<circle class="shp" cx="${x}" cy="${y}" r="${R - 1}"/>`;
    if (s.shape === 'square') return `<rect class="shp" x="${x - R + 2}" y="${y - R + 2}" width="${2 * R - 4}" height="${2 * R - 4}"/>`;
    if (s.shape === 'store') return `<rect class="fill" x="${x - R - 2}" y="${y - 10}" width="${2 * R + 4}" height="20"/><path class="shp" d="M${x + R + 2},${y - 10} H${x - R - 2} V${y + 10} H${x + R + 2}"/>`;
    return `<rect class="shp" x="${x - R - 6}" y="${y - 12}" width="${2 * R + 12}" height="24" rx="6"/><text class="ct" x="${x}" y="${y + 4}" text-anchor="middle">${s.shape === 'more' ? `+${s.loc.split(' ')[0]}` : esc(s.loc.split(' ')[0])}</text>`;
  }
  function drawCanvas() {
    const L = core.layout();
    const st = core.stations();
    const em = core.emphasis();
    const R = L.R;
    const off = core.LAYERS.filter((l) => !S.facets.layers.has(l)).map((l) => ` off-${l}`).join('');
    let h = `<svg class="rp${off}${em.units.size ? ' has-em' : ''}" viewBox="0 0 ${L.w} ${L.h}" width="${L.w}" height="${L.h}" role="img" aria-label="Process flow at step ${S.step} of ${core.sets.length}: ${st.length} stations, ${L.edges.length} flows">`
      + '<defs><marker id="rp-a" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="9" markerHeight="7" orient="auto" markerUnits="userSpaceOnUse"><path class="mk" d="M0,0 L10,4 L0,8 z"/></marker>'
      + '<marker id="rp-a-live" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="9" markerHeight="7" orient="auto" markerUnits="userSpaceOnUse"><path class="mk live" d="M0,0 L10,4 L0,8 z"/></marker>'
      + '<marker id="rp-a-fixed" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="11" markerHeight="9" orient="auto" markerUnits="userSpaceOnUse"><path class="mk fixed" d="M0,0 L10,4 L0,8 z"/></marker></defs>';
    for (const l of L.lanes) h += `<g class="L-structure lane${l.trust ? ' trust' : ''}"><line x1="${L.trunk ? L.trunk.x + 14 : 20}" y1="${l.y}" x2="${L.w - 10}" y2="${l.y}"/><text class="ln-h" x="${L.trunk ? L.trunk.x + 20 : 24}" y="${l.y + 18}">${esc(l.label)}</text></g>`;
    for (const b of L.boundaries) h += `<g class="L-trust tb"><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="8"/><text x="${b.x + 8}" y="${b.y + b.h - 6}">${esc(clip(b.label, 40))} · trust boundary</text></g>`;
    if (L.trunk) h += `<g class="L-trigger"><line class="trunk" x1="${L.trunk.x}" y1="${L.trunk.y1}" x2="${L.trunk.x}" y2="${L.trunk.y2}"/><text class="ln-h" x="${L.trunk.x - 76}" y="${L.trunk.y1 - 34}">Sources</text></g>`;
    for (const e of L.edges) {
      h += `<g class="e L-flows${e.src ? ' L-trigger' : ''}${e.cls ? ` ${e.cls}` : ''}${e.taint ? ' taint' : ''}${em.edges.has(e.key) ? ' em' : ''}" data-key="${esc(e.key)}"><title>${esc(e.full)}</title>`
        + `<path d="${e.d}" marker-end="url(#rp-a${e.cls === 'live' ? '-live' : e.cls === 'fixed' ? '-fixed' : ''})"/>${e.hide ? '' : `<text class="el" x="${e.lx}" y="${e.ly}">${esc(clip(e.text, e.max))}</text>`}</g>`;
    }
    for (const e of L.edges) {
      for (const g of e.guards) {
        h += `<g class="L-controls gd ${g.landed ? 'set' : g.missing ? 'missing' : 'pending'}"${g.patch ? ` data-patch="${esc(g.patch)}"` : ''}><title>${esc(g.missing ? 'check missing' : `${g.patch} ${g.name}${g.landed ? '' : ', not yet landed'}`)}</title>`
          + `<path d="M${g.x},${g.y - 9} L${g.x + 9},${g.y} L${g.x},${g.y + 9} L${g.x - 9},${g.y} Z"/>`
          + `${g.missing ? `<text class="gm" x="${g.x}" y="${g.ty}" text-anchor="middle">no check</text>` : `<rect class="chip" x="${g.x - 14}" y="${g.y - 25}" width="28" height="13" rx="2"/><text class="cp" x="${g.x}" y="${g.y - 15}" text-anchor="middle">${esc(clip(g.patch, 5))}</text><text class="L-evidence ev" x="${g.x}" y="${g.ty}" text-anchor="middle">${esc(g.level)}</text>`}</g>`;
      }
    }
    for (const s of st) {
      const cls = ['sn', s.shape, s.type === 'source' ? 'L-trigger' : 'L-structure', s.state ? `st-${s.state}` : '', s.covCls, s.touched ? 'chg' : '', s.on ? 'on' : '', s.hit ? 'hit' : ''].filter(Boolean).join(' ');
      h += `<g class="${cls}" data-uid="${esc(s.uid)}" tabindex="0" role="button" aria-label="${esc(`${s.num}. ${s.name}`)}"><title>${esc(`${s.num}. ${s.name}${s.loc ? ` · ${s.loc}` : ''}`)}</title>`
        + `${s.touched ? `<circle class="ring" cx="${s.x}" cy="${s.y}" r="${R + 6}"/>` : ''}${shape(s, R)}<text class="no" x="${s.x - R - 6}" y="${s.y - R + 2}" text-anchor="end">${s.num}</text>`;
      lines(s.name, 26, 2).forEach((l, i) => { h += `<text class="nm" x="${s.x}" y="${s.y + R + 15 + i * 13}" text-anchor="middle">${esc(l)}</text>`; });
      if (s.loc && s.type !== 'group' && s.type !== 'more') h += `<text class="loc" x="${s.x}" y="${s.y + R + 15 + lines(s.name, 26, 2).length * 13}" text-anchor="middle">${esc(clip(s.loc, 32))}</text>`;
      if (s.sev) h += `<g class="sev L-weakness"><rect x="${s.x + R + 2}" y="${s.y - R - 8}" width="${s.sev.length * 6 + 8}" height="13" rx="2"/><text x="${s.x + R + 6}" y="${s.y - R + 2}">${esc(s.sev)}</text></g>`;
      h += '</g>';
    }
    for (const c of core.outcomeChips()) {
      h += `<g class="oc${c.state ? ` st-${c.state}` : ''}${c.on ? ' on' : ''}" data-uid="${esc(c.uid)}" tabindex="0" role="button" aria-label="${esc(`${c.num}. ${c.name}: ${c.word}`)}"><title>${esc(`${c.num}. ${c.name}: ${c.word}`)}</title>`
        + `<rect x="${c.x}" y="${c.y - 11}" width="270" height="22" rx="2"/><text class="no" x="${c.x - 4}" y="${c.y + 4}" text-anchor="end">${c.num}</text>`
        + `<text class="oc-l" x="${c.x + 6}" y="${c.y + 4}">${esc(clip(c.name, 26))}${c.impact ? ` <tspan class="oc-i">${esc(c.impact)}</tspan>` : ''}</text>`
        + `<text class="oc-s" x="${c.x + 264}" y="${c.y + 4}" text-anchor="end">${esc(clip(c.word, 24))}</text></g>`;
    }
    $('canvas').innerHTML = `${h}</svg>`;
  }

  // ---- overview
  function drawOverview() {
    const em = core.emphasis();
    const st = core.stations();
    const ov = core.overview();
    $('overview').innerHTML = `<span class="ov-k">Sources ${st.filter((s) => s.type === 'source').length}</span>`
      + ov.map((l) => `<button type="button" class="ov${l.touched ? ' chg' : ''}${l.trust ? ' trust' : ''}${st.some((s) => em.units.has(s.uid) && s.lane === l.id) ? ' on' : ''}" data-lane="${esc(l.id)}" aria-pressed="${st.some((s) => em.units.has(s.uid) && s.lane === l.id)}">${esc(clip(l.label, 28))}`
        + `${l.open ? ` <span class="n bad">${l.open} open</span>` : ''}${l.dealt ? ` <span class="n ok">${l.dealt} dealt</span>` : ''}</button>`).join('')
      + `<span class="ov-k">Outcomes ${new Set(core.layout().chips.map((c) => c.uid)).size}</span>`;
  }

  // ---- file tree
  function drawTree() {
    const rows = core.treeRows();
    const anyCur = rows.some((r) => r.cur);
    $('tree').innerHTML = rows.length ? rows.map((r, i) => {
      const x = r.roll;
      const meta = [x.touched ? '<span class="b chg">changed</span>' : '', x.open ? `<span class="b bad">${x.open} open</span>` : '', x.fixed ? `<span class="b ok">${x.fixed} fixed</span>` : '', x.cov === null ? '' : `<span class="b">${pct(x.cov)} cov</span>`, x.elements ? `<span class="b">${x.elements} el</span>` : ''].filter(Boolean).join('');
      return `<div role="treeitem" aria-level="${r.depth + 1}"${r.dir ? ` aria-expanded="${r.open}"` : ''} aria-selected="${r.on}" tabindex="${r.cur || (!anyCur && i === 0) ? 0 : -1}" class="tr d${Math.min(r.depth, 15)}${r.dir ? ' dir' : ' file'}${x.touched ? ' chg' : ''}${r.on ? ' on' : ''}${r.cur ? ' cur' : ''}" data-key="${esc(r.key)}">`
        + `<span class="tw">${r.dir ? (r.open ? '▾' : '▸') : ''}</span><span class="fn">${esc(r.name)}${r.dir ? '/' : ''}</span>${meta}</div>`;
    }).join('') : '<p class="sub">No file paths</p>';
  }
  function focusTree() { const t = $('tree'); const cur = t.querySelector ? t.querySelector('.cur') : null; if (cur && cur.focus) cur.focus(); }

  // ---- detail: plain account, search results, selection
  const hazardItem = (x) => `<li><p class="hz-h">${link('finding', x.id, x.id)} ${esc(x.risk)} <span class="sv sev-${x.severity}">${esc(x.severity)}</span></p><dl>`
    + `${x.outcome ? `<dt>Risk</dt><dd>${esc(x.outcome)}</dd>` : ''}<dt>Location</dt><dd class="m">${esc(x.where)}</dd><dt>State now</dt><dd>${pill(x.state)}</dd><dt>Basis</dt><dd>${esc(x.basis)}</dd>`
    + `${x.change.length ? `<dt>Change</dt><dd>${x.change.map((k) => `${esc(k.title)}${k.note ? `: ${esc(k.note)}` : ''}`).join('<br>')}</dd>` : ''}`
    + `${x.planned && x.planned.length ? `<dt>Planned</dt><dd>${x.planned.map((k) => `${esc(k.title)} (step ${k.step})`).join('<br>')}</dd>` : ''}</dl></li>`;
  const list = (xs, max = 12) => `<ul class="hz">${xs.slice(0, max).map(hazardItem).join('')}${xs.length > max ? `<li class="sub">${xs.length - max} more via search</li>` : ''}</ul>`;
  function drawAccount() {
    const a = core.account();
    const c = a.counts;
    const w = c.found ? [c.dealt, c.thin, c.open - c.thin].map((n) => (n / c.found) * 100) : [0, 0, 0];
    let h = `<h2>Step ${a.step} of ${a.total}</h2><p class="set">${a.set ? `${esc(a.set.title)} <span class="sub">${esc(a.set.kind)}${a.set.state ? ` · ${esc(a.set.state)}` : ''} · ${a.set.files} files · ${a.set.elements} elements</span>` : 'Original position, unfixed'}</p>`
      + `<dl class="tally"><div><dt>Hazards found</dt><dd>${c.found}</dd></div><div><dt>Dealt with</dt><dd class="ok">${c.dealt}</dd></div><div><dt>Still open</dt><dd class="bad">${c.open}</dd></div></dl>`
      + `<svg class="meter" viewBox="0 0 100 4" preserveAspectRatio="none" role="img" aria-label="${c.dealt} dealt with, ${c.open} still open"><rect class="ok" x="0" y="0" width="${w[0].toFixed(2)}" height="4"/><rect class="thin" x="${w[0].toFixed(2)}" y="0" width="${w[1].toFixed(2)}" height="4"/><rect class="bad" x="${(w[0] + w[1]).toFixed(2)}" y="0" width="${w[2].toFixed(2)}" height="4"/></svg>`;
    if (a.set) {
      h += `<h3>Dealt with here: ${a.dealt.length}</h3>${a.dealt.length ? list(a.dealt) : '<p class="sub">No hazard closed</p>'}`;
      if (a.beyond.length) h += `<h3>Named here, still open: ${a.beyond.length}</h3>${list(a.beyond)}`;
    }
    h += a.open.length ? `<h3>Still open: ${a.open.length}</h3>${list(a.open)}` : '<h3>Nothing left open</h3>';
    $('account').innerHTML = h;
  }
  function drawChecks() {
    const rows = core.checks();
    $('checks').innerHTML = rows.length ? `<h2>Checks and tests</h2><table class="ck"><thead><tr><th>Step</th><th>Check</th><th>Location</th><th>What it does</th><th>Test</th><th>Proof</th><th>State</th></tr></thead><tbody>`
      + rows.map((r) => `<tr${r.now ? ' class="now"' : ''}><td>${r.step}</td><td><span class="cpill">${esc(r.id)}</span> ${esc(r.title)}</td><td class="m">${esc(r.where)}</td><td>${esc(r.what)}</td><td class="m">${esc(r.test)}</td><td>${esc(r.proof)}</td><td>${r.landed ? '<span class="pill st-fixed">landed</span>' : `planned, step ${r.step}`}</td></tr>`).join('')
      + '</tbody></table>' : '';
  }
  function drawHits() {
    const hits = core.search(S.q);
    $('hits').hidden = S.q.trim().length < 2;
    $('hits').innerHTML = hits.length ? `<h3>Search results: ${hits.length}</h3><ul>${hits.map((x) => `<li>${link(x.kind, x.id, x.label)} <span class="sub">${esc(x.kind)}${x.sub ? ` · ${esc(x.sub)}` : ''}</span></li>`).join('')}</ul>` : '<p class="sub">No match</p>';
  }
  const fRow = (f) => `<li>${pill(f.state)} <span class="sv sev-${f.severity}">${esc(f.severity)}</span> ${link('finding', f.id, f.id)} ${esc(f.title)}</li>`;
  function drawSel() {
    const d = core.detail();
    if (!d) { $('sel').innerHTML = '<h3>Selection</h3><p class="sub">No selection</p>'; return; }
    let h = '';
    if (d.kind === 'node') {
      h = `<h3>${esc(d.name)}</h3><p class="sub">${esc(d.type)}${d.group.length ? ` · ${d.group.map(esc).join(' › ')}` : ''}${d.impact ? ` · impact ${esc(d.impact)}` : ''}</p>`
        + `${d.file ? `<p>${link('file', d.file, d.file)}${d.coverage === null ? '' : ` <span class="sub">${pct(d.coverage)} line coverage</span>`}</p>` : ''}${d.label !== d.name ? `<p class="m">${esc(d.label)}</p>` : ''}${d.note ? `<p class="sub">${esc(d.note)}</p>` : ''}`
        + `${d.findings.length ? `<h4>Issues: ${d.findings.length}</h4><ul>${d.findings.map(fRow).join('')}</ul>` : ''}`
        + `${d.guards.length ? `<h4>Inbound checks</h4><ul>${d.guards.map((g) => `<li><span class="cpill">${esc(g.id)}</span> ${esc(g.name)} <span class="sub">${g.landed ? 'patch landed' : 'patch not landed'} · ${esc(g.level)}</span></li>`).join('')}</ul>` : ''}`
        + `${d.into.length ? `<h4>Data in</h4><ul>${d.into.map((x) => `<li>${esc(x.data)} from ${link('node', x.id, x.name)}</li>`).join('')}</ul>` : ''}`
        + `${d.out.length ? `<h4>Data out</h4><ul>${d.out.map((x) => `<li>${esc(x.data)} to ${link('node', x.id, x.name)}</li>`).join('')}</ul>` : ''}`;
    } else if (d.kind === 'file') {
      const r = d.roll;
      h = `<h3 class="m">${esc(d.id)}</h3><p class="sub">${r.touched ? 'changed this step · ' : ''}${r.open} open · ${r.fixed} fixed${r.cov === null ? '' : ` · ${pct(r.cov)} line coverage`} · ${r.elements} elements</p>`
        + `${d.elements.length ? `<h4>Elements: ${d.elements.length}</h4><ul>${d.elements.map((x) => `<li>${link('node', x.id, x.name)}</li>`).join('')}</ul>` : ''}`
        + `${d.findings.length ? `<h4>Issues: ${d.findings.length}</h4><ul>${d.findings.map(fRow).join('')}</ul>` : ''}`
        + `${d.traced.length ? `<h4>Traced paths</h4><p>${d.traced.map((id) => link('finding', id, id)).join(' ')}</p>` : ''}`
        + `${d.sets.length ? `<h4>Change sets</h4><ul>${d.sets.map((x) => `<li>step ${x.step} · ${esc(x.id)}</li>`).join('')}</ul>` : ''}`;
    } else if (d.kind === 'finding') {
      h = `<h3>${esc(d.id)} ${esc(d.title)}</h3><p>${pill(d.state)} <span class="sv sev-${d.severity}">${esc(d.severity)}</span>${d.cwe ? ` <span class="m">${esc(d.cwe)}</span>` : ''}${d.rule ? ` <span class="m">${esc(d.rule)}</span>` : ''}</p>`
        + `<dl><dt>Location</dt><dd class="m">${esc(d.where)}</dd><dt>Basis</dt><dd>${esc(d.basis)}</dd><dt>Ruled at</dt><dd>${d.step ? `step ${d.step}` : 'no ruling'}</dd>${d.impacts.length ? `<dt>Outcomes reached</dt><dd>${d.impacts.map((x) => `${esc(x.label)} (${esc(x.level)})`).join(', ')}</dd>` : ''}</dl>`
        + `${d.message ? `<p class="sub">${esc(d.message)}</p>` : ''}${d.note ? `<p class="sub">${esc(d.note)}</p>` : ''}`
        + `${d.path.length ? `<h4>Canvas path</h4><p>${d.path.map(esc).join(' → ')}</p>` : ''}`
        + `${d.controls.length ? `<h4>Controls</h4><ul>${d.controls.map((c) => `<li>${esc(c.axis)}: ${esc(c.what)}${c.test ? ` · ${esc(c.test)}` : ' · no test'}</li>`).join('')}</ul>` : ''}`
        + `${d.change.length ? `<h4>Change</h4><ul>${d.change.map((k) => `<li><span class="cpill">${esc(k.id)}</span> ${esc(k.title)}</li>`).join('')}</ul>` : ''}`
        + `${d.planned && d.planned.length ? `<h4>Planned</h4><ul>${d.planned.map((k) => `<li><span class="cpill">${esc(k.id)}</span> ${esc(k.title)} · step ${k.step}</li>`).join('')}</ul>` : ''}`;
    } else {
      h = `<h3>${esc(d.name)}</h3><p class="sub">${d.type === 'more' ? 'elements outside scope' : d.type === 'lane' ? 'lane' : 'closed group'} · ${d.count} elements</p>`
        + `${d.findings.length ? `<h4>Issues: ${d.findings.length}</h4><ul>${d.findings.map(fRow).join('')}</ul>` : ''}<h4>Elements</h4><ul>${d.elements.map((x) => `<li>${link('node', x.id, x.name)}</li>`).join('')}</ul>`;
    }
    $('sel').innerHTML = h;
  }

  // ---- header controls
  function drawControls() {
    const steps = core.steps();
    $('m-asof').innerHTML = steps.map((s) => `<option value="${s.step}"${s.step === S.step ? ' selected' : ''}>${s.step} · ${esc(clip(s.title, 40))} · ${s.open} open</option>`).join('');
    const fsel = S.sel && S.sel.kind === 'finding' ? S.sel.id : '';
    $('m-path').innerHTML = `<option value=""${fsel ? '' : ' selected'}>none</option>${core.findingList().map((f) => `<option value="${esc(f.id)}"${f.id === fsel ? ' selected' : ''}>${esc(clip(`${f.id} · ${f.title}`, 44))}</option>`).join('')}`;
    $('m-scope').value = S.scope;
    $('m-colour').value = S.colour;
    const fc = core.facets();
    const group = (facet, keys, counts, words = {}) => keys.map((k) => `<label><input type="checkbox" data-facet="${facet}" data-value="${k}"${S.facets[facet].has(k) ? ' checked' : ''}> ${esc(words[k] || k)} <span class="n">${counts[k]}</span></label>`).join('');
    $('f-layers').innerHTML = `<legend>Layers</legend>${group('layers', core.LAYERS, fc.layers)}`;
    $('f-state').innerHTML = `<legend>State</legend>${group('state', core.STATES, fc.state, core.STATE_WORD)}`;
    $('f-sev').innerHTML = `<legend>Severity</legend>${group('sev', core.SEV, fc.sev)}`;
    $('f-ev').innerHTML = `<legend>Evidence</legend>${group('ev', core.LEVELS, fc.ev)}`;
  }
  function drawPlay() {
    const n = core.sets.length;
    $('pb').hidden = n === 0;
    $('pb-scrub').max = String(n);
    $('pb-scrub').value = String(S.step);
    $('pb-play').textContent = V.playing === null ? 'Play' : 'Pause';
    $('pb-play').setAttribute('aria-pressed', String(V.playing !== null));
    $('pb-follow').checked = S.follow;
    $('pb-tree').checked = S.treeFollow;
    const a = core.account();
    $('pb-out').textContent = a.set ? `Step ${a.step} of ${a.total} · ${a.set.title}` : `Step 0 of ${a.total} · original position, unfixed`;
  }
  function draw() { drawControls(); drawPlay(); drawOverview(); drawCanvas(); drawTree(); drawAccount(); drawChecks(); drawHits(); drawSel(); }

  // ---- playback
  function goStep(k) { core.setStep(k); draw(); }
  function stop() { if (V.playing !== null) { timers.clear(V.playing); V.playing = null; } }
  function tick() {
    if (S.step >= core.sets.length) { stop(); drawPlay(); return; }
    goStep(S.step + 1);
    V.playing = S.step >= core.sets.length ? null : timers.set(tick, Number($('pb-speed').value) || 1500);
    drawPlay();
  }
  $('pb').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-pb]');
    if (!b) return;
    const act = b.dataset.pb;
    if (act === 'play') {
      if (V.playing !== null) { stop(); drawPlay(); return; }
      if (S.step >= core.sets.length) goStep(0);
      V.playing = timers.set(tick, Number($('pb-speed').value) || 1500);
      drawPlay();
      return;
    }
    stop();
    goStep(act === 'first' ? 0 : act === 'last' ? core.sets.length : act === 'prev' ? S.step - 1 : S.step + 1);
  });
  $('pb-scrub').addEventListener('input', (ev) => { stop(); goStep(ev.target.value); });
  $('pb-follow').addEventListener('change', (ev) => { S.follow = !!ev.target.checked; core.setStep(S.step); draw(); });
  $('pb-tree').addEventListener('change', (ev) => { S.treeFollow = !!ev.target.checked; core.setStep(S.step); draw(); });

  // ---- selection, from any region
  const pick = (kind, id) => { core.select(kind, id); draw(); };
  const onStation = (g) => {
    const s = core.stations().find((x) => x.uid === g.dataset.uid);
    if (!s) { if (core.outcomeChips().some((c) => c.uid === g.dataset.uid)) pick('unit', g.dataset.uid); return; }
    if (s.type === 'group') { core.toggleGroup(s.gid); pick('lane', s.lane); return; }
    if (s.type === 'more') { core.more(s.gid); draw(); return; }
    pick('unit', s.uid);
  };
  $('canvas').addEventListener('click', (ev) => {
    const g = ev.target.closest('[data-uid]');
    if (g) { onStation(g); return; }
    const p = ev.target.closest('[data-patch]');
    if (p) { const f = core.patchFinding(p.dataset.patch); if (f) pick('finding', f); return; }
    pick(null);
  });
  $('canvas').addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    const g = ev.target.closest('[data-uid]');
    if (!g) return;
    if (ev.preventDefault) ev.preventDefault();
    onStation(g);
  });
  $('overview').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-lane]');
    if (!b) return;
    const id = b.dataset.lane;
    if (id !== '' && !core.isOpen(id)) core.toggleGroup(id);
    pick('lane', id);
  });
  $('detail').addEventListener('click', (ev) => { const b = ev.target.closest('[data-sel]'); if (b) pick(b.dataset.sel, b.dataset.id); });
  $('tree').addEventListener('click', (ev) => {
    const r = ev.target.closest('[data-key]');
    if (!r) return;
    const key = r.dataset.key;
    if (key.startsWith('d:')) { core.toggleDir(key.slice(2)); S.treeCur = key; drawTree(); focusTree(); return; }
    pick('file', key.slice(2));
    focusTree();
  });
  $('tree').addEventListener('keydown', (ev) => {
    const did = core.treeKey(ev.key);
    if (did === null) return;
    if (ev.preventDefault) ev.preventDefault();
    if (did === 'select') draw(); else drawTree();
    focusTree();
  });
  $('q').addEventListener('input', (ev) => { S.q = String(ev.target.value || ''); drawCanvas(); drawTree(); drawHits(); });
  $('m-scope').addEventListener('change', (ev) => { core.setMode('scope', ev.target.value); draw(); });
  $('m-colour').addEventListener('change', (ev) => { core.setMode('colour', ev.target.value); draw(); });
  $('m-asof').addEventListener('change', (ev) => { stop(); goStep(ev.target.value); });
  $('m-path').addEventListener('change', (ev) => pick(ev.target.value ? 'finding' : null, ev.target.value));
  $('facets').addEventListener('change', (ev) => { const t = ev.target; if (t.dataset && t.dataset.facet) { core.setFacet(t.dataset.facet, t.dataset.value, !!t.checked); draw(); } });

  draw();
  return { core, draw, goStep, V };
}
