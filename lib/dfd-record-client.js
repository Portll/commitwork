// lib/dfd-record-client.js — record view drawing and wiring; every decision is createRecordCore's.

export function mountRecordView(document, createRecordCore, env = {}) {
  const timers = env.timers || { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const clip = (s, n) => { const t = String(s); return t.length <= n ? t : `${t.slice(0, Math.max(1, n - 1))}…`; };
  const many = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`;
  const link = (kind, id, text) => `<button type="button" class="lk" data-sel="${kind}" data-id="${esc(id)}">${esc(text)}</button>`;
  const option = (value, text, on) => `<option value="${esc(value)}"${on ? ' selected' : ''}>${esc(text)}</option>`;
  const core = createRecordCore(JSON.parse($('dfd-data').textContent));
  const GLYPH = {
    actor: 'M8 2.2 L14.4 13.6 L1.6 13.6 Z',
    store: 'M2.8 2.8 H13.2 V13.2 H2.8 Z',
    log: 'M2.8 4 Q8 1 13.2 4 V12 Q8 15 2.8 12 Z',
    process: 'M8 1.4 L14.6 8 L8 14.6 L1.4 8 Z',
    external: 'M4.6 2 H11.4 L14.8 8 L11.4 14 H4.6 L1.2 8 Z',
    outcome: 'M8 1 L11.2 8 L8 15 L4.8 8 Z',
    route: 'M3 2.6 H13 V8.6 L8 13.8 L3 8.6 Z',
    drain: 'M1.8 2.6 H14.2 L9.6 8.6 V14 L6.4 12.4 V8.6 Z',
  };
  const PRIM_WORD = { actor: 'actor that starts flows', store: 'data store', log: 'log store', process: 'process', external: 'external system', outcome: 'outcome', route: 'route test without a node', drain: 'log drain' };
  const V = { mode: 'group', order: 'sets', dim: 'changeset', active: new Set(core.orders.sets.map((k) => k.id)), k: core.orders.sets.length, sel: null, tab: 'findings', playing: null };

  const order = () => core.orders[V.order].filter((k) => V.active.has(k.id));
  const state = () => core.step(V.order, V.active, V.k);
  const glyph = (prim, x, y, cls = '') => `<path class="gl p-${prim}${cls}" transform="translate(${x} ${y})" d="${GLYPH[prim]}"/>`;

  function drawGrid(st) {
    const L = core.layout(V.mode);
    const G = L.geo;
    const fx = V.sel ? core.focus(V.sel.kind, V.sel.id) : null;
    const isSel = (kind, id) => !!V.sel && V.sel.kind === kind && V.sel.id === id;
    let h = `<svg class="rec${fx ? ' has-em' : ''}" viewBox="0 0 ${L.width} ${L.height}" width="${L.width}" height="${L.height}" role="group" aria-label="${esc(`Record by ${V.mode === 'layer' ? 'layer' : 'group'}: ${many(L.lanes.length, 'lane')}, ${many(L.cols.length, 'hop column')}, step ${st.k} of ${st.total}, ${many(st.open, 'finding')} open`)}">`;
    L.lanes.forEach((l, i) => {
      h += `<rect class="band b${i % 2}${l.boundary ? ' bd' : ''}" x="0" y="${l.top}" width="${L.width}" height="${l.h}"/>`
        + `<text class="lh" x="10" y="${l.top + 18}"><title>${esc(l.name)}</title>${esc(clip(l.name, 22))}</text>`
        + `<text class="ls" x="10" y="${l.top + 32}">${esc(clip(l.sub, 26))}</text>`;
    });
    for (const c of L.cols) h += `<text class="chd" x="${c.x}" y="14">${esc(c.text)}</text><text class="csb" x="${c.x}" y="27">${esc(c.sub)}</text>`;
    for (const d of L.stems) h += `<path class="stem" d="${d}"/>`;
    for (const e of L.edges) {
      const cls = [`e k-${e.kind}`, e.existence !== 'confirmed' ? `ex-${e.existence}` : '', e.flow && st.red.has(e.id) ? 'red' : '', e.flow && st.closed.has(e.id) ? 'closed' : '', fx && fx.edges.has(e.id) ? 'em' : '', isSel('flow', e.id) ? 'on' : ''].filter(Boolean).join(' ');
      const title = e.flow ? `${core.nodeName(e.flow.from)} → ${core.nodeName(e.flow.to)}${e.label ? `: ${e.label}` : ''}` : `${core.nodeName(e.from.id)} → log drain`;
      h += `<g class="${cls}"${e.flow ? ` data-sel="flow" data-id="${esc(e.id)}"` : ''}><title>${esc(title)}</title><path class="ln" d="${e.d}"/><path class="ah" d="${e.arrow}"/>${e.gate ? `<path class="gt" d="${e.gate}"/>` : ''}</g>`;
    }
    for (const m of L.markers) {
      if (m.kind === 'finding') h += `<circle class="mk mf st-${st.state.get(m.id)}" cx="${m.x}" cy="${m.y}" r="4" data-sel="finding" data-id="${esc(m.id)}"><title>${esc(m.id)}</title></circle>`;
      else h += `<rect class="mk mp${st.landed.has(m.id) ? ' landed' : ''}" x="${m.x - 3.5}" y="${m.y - 3.5}" width="7" height="7" data-sel="patch" data-id="${esc(m.id)}"><title>${esc(m.id)}</title></rect>`;
    }
    for (const u of L.units) {
      if (u.type === 'drain') { h += `<g class="u p-drain"><rect class="cp" x="${u.x}" y="${u.y}" width="${u.w}" height="${u.h}" rx="4"/>${glyph('drain', u.x + 6, u.y + u.h / 2 - 8)}<text class="lb" x="${u.x + 26}" y="${u.y + u.h / 2 + 4}">Log drain</text></g>`; continue; }
      if (u.type === 'route') { h += `<g class="u rt rs-${esc(u.route.status || 'none')}${isSel('route', u.id) ? ' on' : ''}" data-sel="route" data-id="${esc(u.id)}" tabindex="0" role="button" aria-label="${esc(`Route ${u.id}, ${u.route.status || 'no status'}, no node`)}"><rect class="cp" x="${u.x}" y="${u.y}" width="${u.w}" height="${u.h}" rx="2"/>${glyph('route', u.x + 3, u.y + 1, ' sm')}<text class="rw" x="${u.x + 20}" y="${u.y + 12.5}">${esc(clip(u.id, 24))}</text></g>`; continue; }
      const cls = ['u', `p-${u.prim}`, core.outcomes.has(u.id) ? 'outcome' : '', st.exposed.has(u.id) ? 'exposed' : '', fx && fx.units.has(u.id) ? 'em' : '', isSel('node', u.id) ? 'on' : ''].filter(Boolean).join(' ');
      const top = u.y + (u.h - u.lines.length * 13) / 2 + 10;
      h += `<g class="${cls}" data-sel="node" data-id="${esc(u.id)}" tabindex="0" role="button" aria-label="${esc(`${core.nodeName(u.id)}, ${PRIM_WORD[u.prim]}${st.exposed.has(u.id) ? ', reached by an open path' : ''}${u.tray.length ? `, ${many(u.tray.length, 'finding')}` : ''}`)}">`
        + `<rect class="cp" x="${u.x}" y="${u.y}" width="${u.w}" height="${u.h}" rx="4"/>${glyph(u.prim, u.x + 6, u.y + u.h / 2 - 8)}`
        + `<text class="lb">${u.lines.map((t, i) => `<tspan x="${u.x + 26}" y="${top + i * 13}">${esc(t)}</tspan>`).join('')}</text></g>`;
      for (const r of u.tray) {
        const s = st.state.get(r.id);
        h += `<g class="row st-${s}${isSel('finding', r.id) ? ' on' : ''}" data-sel="finding" data-id="${esc(r.id)}" tabindex="0" role="button" aria-label="${esc(`${r.id} ${r.finding.title || ''}, ${core.STATE_WORD[s]}`)}"><rect class="rb" x="${r.x}" y="${r.y}" width="${G.rowW}" height="${G.rowH}" rx="2"/><rect class="rs" x="${r.x}" y="${r.y}" width="3" height="${G.rowH}"/><text class="rw" x="${r.x + 7}" y="${r.y + 12.5}"><tspan class="rid">${esc(clip(r.id, 12))}</tspan> ${esc(clip(r.finding.title || '', Math.max(4, 23 - Math.min(12, r.id.length))))}</text></g>`;
      }
      for (const t of u.tests) h += `<g class="row rt rs-${esc(t.route.status || 'none')}${isSel('route', t.id) ? ' on' : ''}" data-sel="route" data-id="${esc(t.id)}" tabindex="0" role="button" aria-label="${esc(`Route ${t.id}, ${t.route.status || 'no status'}`)}"><rect class="rb" x="${t.x}" y="${t.y}" width="${G.rowW}" height="${G.rowH}" rx="2"/>${glyph('route', t.x + 3, t.y + 1, ' sm')}<text class="rw" x="${t.x + 20}" y="${t.y + 12.5}">${esc(clip(t.id, 22))}</text></g>`;
    }
    $('grid').innerHTML = `${h}</svg>`;
  }

  function drawRail(st) {
    const pos = new Map(order().map((k, i) => [k.id, i + 1]));
    const groups = core.groupsOf(V.dim, V.mode);
    let h = `<p class="rail-n"><span>Patches</span><span class="n">${V.active.size} / ${core.orders.sets.length}</span></p><p class="rail-all"><button type="button" class="lk" data-all="1">All</button> <button type="button" class="lk" data-all="0">None</button></p>`;
    groups.forEach((g, gi) => {
      const on = g.ids.filter((id) => V.active.has(id)).length;
      h += `<div class="rg"><label><input type="checkbox" data-group="${gi}"${on === g.ids.length ? ' checked' : ''}${on && on < g.ids.length ? ' aria-checked="mixed"' : ''}> <span class="gv">${esc(clip(g.value, 26))}</span></label><span class="n">${on}/${g.ids.length}</span></div>`;
      for (const id of g.ids) {
        const k = core.patch(id);
        const n = pos.get(id);
        h += `<div class="rr${st.landed.has(id) ? ' landed' : ''}${V.sel && V.sel.kind === 'patch' && V.sel.id === id ? ' on' : ''}"><input type="checkbox" data-patch="${esc(id)}" aria-label="${esc(`Include ${id} in the replay`)}"${V.active.has(id) ? ' checked' : ''}>${link('patch', id, clip(id, 10))}<span class="pt" title="${esc(core.name(k))}">${esc(clip(core.name(k) === id ? '' : core.name(k), 18))}</span>`
          + (n ? `<button type="button" class="sn" data-step="${n}" aria-label="${esc(`Replay to step ${n}, ${id} landed`)}">${n}</button>` : '<span class="sn off">–</span>') + '</div>';
      }
    });
    $('rail').innerHTML = h;
  }

  function drawBar(st) {
    $('pb-scrub').max = String(st.total);
    $('pb-scrub').value = String(st.k);
    $('pb-play').textContent = V.playing === null ? 'Play' : 'Pause';
    $('pb-play').setAttribute('aria-pressed', V.playing === null ? 'false' : 'true');
    $('pb-out').textContent = `Step ${st.k} of ${st.total} · ${st.patch ? `${st.patch} landed` : 'nothing landed'} · ${st.open} open`;
  }

  function drawAccount(st) {
    const n = (s) => [...st.state.values()].filter((v) => v === s).length;
    const last = st.patch ? core.sets.find((s) => s.patches.some((k) => k.id === st.patch)) : null;
    const exposed = [...st.exposed];
    $('account').innerHTML = `<h2>Step ${st.k} of ${st.total}</h2><p class="set">${last ? esc(last.title) : 'Before any patch'}</p>`
      + `<dl class="tally"><div><dt>Open</dt><dd class="bad">${n('open')}</dd></div><div><dt>Fixed, untested</dt><dd>${n('fixed')}</dd></div><div><dt>Fixed, tested</dt><dd class="ok">${n('proven')}</dd></div><div><dt>Dismissed</dt><dd>${n('dismissed')}</dd></div></dl>`
      + `<h3>Outcomes on an open path: ${exposed.length}</h3>${exposed.length ? `<ul class="lks">${exposed.map((id) => `<li>${link('node', id, core.nodeName(id))}</li>`).join('')}</ul>` : ''}`
      + `<p class="sub">${many(st.red.size, 'flow')} on open paths · ${many(st.closed.size, 'flow')} closed</p>`;
  }

  function drawSel(st) {
    const d = V.sel ? core.detail(V.sel.kind, V.sel.id, st) : null;
    if (!d) { $('sel').innerHTML = '<h3>Selection</h3><p class="sub">No selection. Pick a chip, a row, a marker or a flow.</p>'; return; }
    $('sel').innerHTML = `<p class="kick">${esc(d.kicker)}</p><h3>${esc(d.title)}</h3><dl class="kv">${d.rows.map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>`
      + d.links.filter(([, l]) => l.length).map(([label, l]) => `<h4>${esc(label)} <span class="n">${l.length}</span></h4><ul class="lks">${l.map((r) => `<li>${link(r.kind, r.id, clip(r.text, 70))}</li>`).join('')}</ul>`).join('');
  }

  function drawTables(st) {
    const T = core.tables(st);
    const words = { flows: 'Flows', findings: 'Findings', patches: 'Patches', routes: 'Routes' };
    $('tabs').innerHTML = Object.keys(words).map((k) => `<button type="button" role="tab" data-tab="${k}" aria-selected="${k === V.tab}">${words[k]} <span class="n">${T[k].rows.length}</span></button>`).join('');
    const t = T[V.tab];
    const rowClass = (r) => { const c = [r.cls, V.sel && V.sel.kind === r.kind && V.sel.id === r.id ? 'on' : ''].filter(Boolean).join(' '); return c ? ` class="${c}"` : ''; };
    $('table').innerHTML = t.rows.length
      ? `<table class="tb"><thead><tr>${t.head.map((c) => `<th scope="col">${esc(c)}</th>`).join('')}</tr></thead><tbody>${t.rows.map((r) => `<tr${rowClass(r)} data-sel="${r.kind}" data-id="${esc(r.id)}" tabindex="0">${r.cells.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`
      : `<p class="sub">No ${words[V.tab].toLowerCase()} in this document.</p>`;
  }

  function drawLegend() {
    const sw = (prim) => `<svg class="lg" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path class="gl p-${prim}" d="${GLYPH[prim]}"/></svg>`;
    const line = (cls) => `<svg class="lg" viewBox="0 0 28 10" width="28" height="10" aria-hidden="true"><g class="e ${cls}"><path class="ln" d="M1 5 H27"/></g></svg>`;
    const rule = core.outcomeRule === 'declared' ? 'Outcome: a node with a declared impact, or the target of a rejected flow.' : 'Outcome: no node declares an impact, so every node that receives flows and sends none, other than a process, counts as an outcome.';
    $('legend').innerHTML = `<ul class="key">${Object.keys(GLYPH).map((p) => `<li>${sw(p)} ${esc(PRIM_WORD[p])}</li>`).join('')}</ul>`
      + `<ul class="key"><li>${line('k-in')} flow inside a lane</li><li>${line('k-cross')} flow crossing lanes, ticks at the crossing</li><li>${line('k-error')} error flow</li><li>${line('k-return')} feedback or retry</li><li>${line('k-drain')} into the log drain</li><li>${line('k-in ex-unknown')} existence unknown</li><li>${line('k-in ex-contradicted')} existence contradicted</li><li>${line('k-in red')} on an open path to an outcome</li><li>${line('k-in closed')} closed by a landed patch</li></ul>`
      + `<ul class="key"><li><span class="sw st-open"></span> open</li><li><span class="sw st-fixed"></span> fixed, untested</li><li><span class="sw st-proven"></span> fixed, tested</li><li><span class="sw st-dismissed"></span> dismissed</li><li><span class="sw mp"></span> patch guard, filled once landed</li></ul>`
      + `<p class="sub">Columns are hops from the sources along flows. ${esc(rule)}</p>`;
  }

  function draw() {
    const st = state();
    V.k = st.k;
    drawGrid(st); drawRail(st); drawBar(st); drawAccount(st); drawSel(st); drawTables(st);
  }
  const goStep = (k) => { V.k = Math.max(0, Math.min(Number(k) || 0, order().length)); draw(); };
  const pick = (kind, id) => { V.sel = kind && id !== undefined && id !== '' ? { kind, id } : null; draw(); };
  const stop = () => { if (V.playing !== null) { timers.clear(V.playing); V.playing = null; } };
  const tick = () => { V.playing = null; goStep(V.k + 1); V.playing = V.k >= order().length ? null : timers.set(tick, 1200); drawBar(state()); };
  const keepEnd = (fn) => { const atEnd = V.k >= order().length; fn(); V.k = atEnd ? order().length : Math.min(V.k, order().length); draw(); };
  const pressed = (ev) => (ev.key === 'Enter' || ev.key === ' ') && ev.target.closest('[data-sel]');

  $('m-lanes').innerHTML = core.MODES.map(([k, t]) => option(k, t, k === V.mode)).join('');
  $('m-order').innerHTML = core.ORDERS.map(([k, t]) => option(k, t, k === V.order)).join('');
  $('m-dim').innerHTML = core.DIMS.map(([k, t]) => option(k, t, k === V.dim)).join('');
  $('m-lanes').addEventListener('change', (ev) => { V.mode = ev.target.value; draw(); });
  $('m-order').addEventListener('change', (ev) => { stop(); keepEnd(() => { V.order = ev.target.value; }); });
  $('m-dim').addEventListener('change', (ev) => { V.dim = ev.target.value; draw(); });
  $('pb').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-pb]');
    if (!b) return;
    const a = b.dataset.pb;
    if (a === 'play') {
      if (V.playing !== null) { stop(); drawBar(state()); return; }
      if (V.k >= order().length) V.k = 0;
      draw();
      V.playing = timers.set(tick, 1200);
      drawBar(state());
      return;
    }
    stop();
    goStep(a === 'first' ? 0 : a === 'prev' ? V.k - 1 : a === 'next' ? V.k + 1 : order().length);
  });
  $('pb-scrub').addEventListener('input', (ev) => { stop(); goStep(ev.target.value); });
  $('rail').addEventListener('change', (ev) => {
    const t = ev.target;
    if (!t.dataset) return;
    stop();
    if (t.dataset.patch !== undefined) keepEnd(() => { if (t.checked) V.active.add(t.dataset.patch); else V.active.delete(t.dataset.patch); });
    else if (t.dataset.group !== undefined) { const g = core.groupsOf(V.dim, V.mode)[Number(t.dataset.group)]; if (g) keepEnd(() => { for (const id of g.ids) if (t.checked) V.active.add(id); else V.active.delete(id); }); }
  });
  $('rail').addEventListener('click', (ev) => {
    const all = ev.target.closest('[data-all]');
    if (all) { stop(); keepEnd(() => { V.active = new Set(all.dataset.all === '1' ? core.orders.sets.map((k) => k.id) : []); }); return; }
    const s = ev.target.closest('[data-step]');
    if (s) { stop(); goStep(s.dataset.step); return; }
    const b = ev.target.closest('[data-sel]');
    if (b) pick(b.dataset.sel, b.dataset.id);
  });
  for (const id of ['grid', 'account', 'sel', 'table']) {
    $(id).addEventListener('click', (ev) => { const b = ev.target.closest('[data-sel]'); if (b) pick(b.dataset.sel, b.dataset.id); else if (id === 'grid') pick(null); });
    $(id).addEventListener('keydown', (ev) => { const b = pressed(ev); if (b) { if (ev.preventDefault) ev.preventDefault(); pick(b.dataset.sel, b.dataset.id); } });
  }
  $('tabs').addEventListener('click', (ev) => { const b = ev.target.closest('[data-tab]'); if (b) { V.tab = b.dataset.tab; drawTables(state()); } });
  drawLegend();
  draw();
  return { core, V };
}
