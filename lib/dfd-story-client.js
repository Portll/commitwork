// lib/dfd-story-client.js — the drawing and wiring of the story view. lib/dfd-story-render.mjs
// inlines this file after the two cores and calls mountStoryView(document, createStoryCore,
// createMapCore); the tests call it with a stand-in document. Platform layout never moves: a stage
// changes which boxes and lines are lit, which dots are shown and what the words say.

export function mountStoryView(document, createStoryCore, createMapCore, env = {}) {
  const timers = env.timers || { set: (fn, ms) => setTimeout(fn, ms), clear: (t) => clearTimeout(t) };
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  const core = createStoryCore(JSON.parse($('dfd-data').textContent), createMapCore);
  const S = { stage: 0, pick: null, timer: null };
  const last = core.stages.length - 1;
  const RADIUS = { 1: 5, 2: 7, 3: 9 };
  const KEY = {
    look: ['<i class="k-box"></i> box: element, input or impact', '<i class="k-sec"></i> frame: group, owner in name', '<i class="k-line"></i> line: data flow'],
    routes: ['<i class="k-harm"></i> red box: impact sink', '<i class="k-calm"></i> grey box, right: benign sink', '<i class="k-line"></i> dashed line: unconfirmed flow'],
    hazards: ['<i class="k-dot open"></i> red dot: open finding', 'dot size: worst reachable impact', '<i class="k-line danger"></i> red line: open attack path'],
    change: ['<i class="k-dot done"></i> green dot: mitigated, tested', '<i class="k-dot done hollow"></i> hollow green dot: mitigated, untested', '<i class="k-dot thin"></i> red ring: dismissed, unproven', '<i class="k-guard"></i> green bar: guard on flow', '<i class="k-line safe"></i> green line: typed rejection', '<i class="k-dot open"></i> red dot: open finding'],
    left: ['<i class="k-dot open"></i> red dot: open finding', '<i class="k-dot thin"></i> red ring: dismissed, unproven', '<i class="k-line danger"></i> red line: open attack path'],
  };

  const picked = () => {
    if (!S.pick) return { card: null, nodes: new Set() };
    const card = S.pick.kind === 'box' ? core.boxCard(S.pick.id, S.stage) : core.card(S.pick.id, S.stage);
    return { card, nodes: new Set(!card ? [] : card.kind === 'box' ? [card.id] : card.places.map((p) => p.node)) };
  };
  const frame = (cls, r) => `<g class="${cls}"><rect x="${r.x}" y="${r.y}" width="${r.w}" height="${r.h}" rx="6"/><text x="${r.x + 10}" y="${r.y + 14}">${esc(r.label)}</text></g>`;
  const drawPicture = (v, sel) => {
    const L = core.layout;
    const lines = v.lines.map((e) => {
      const [x2, y2] = e.d.split(' ').slice(-2).map(Number);
      const guard = e.guard ? `<rect class="gd${e.fresh ? ' fresh' : ''}" x="${x2 - 12}" y="${y2 - 9}" width="5" height="18" rx="2"/>` : '';
      return `<g class="ln${e.cls ? ` ${e.cls}` : ''}">${e.label ? `<title>${esc(e.label)}</title>` : ''}<path d="${e.d}" marker-end="url(#st-a)"/>${guard}</g>`;
    }).join('');
    const boxes = v.boxes.map((b) => {
      const text = b.lines.map((l, i) => `<tspan x="${b.x + 10}" y="${b.y + (b.lines.length === 1 ? 28 : 19 + i * 15)}">${esc(l)}</tspan>`).join('');
      let cx = b.x + b.w - 4;
      const dots = b.dots.map((d) => { const r = RADIUS[d.size]; cx -= r; const c = `<circle class="dot ${d.state}${d.sure ? '' : ' hollow'}" data-weak="${esc(d.weak)}" cx="${cx}" cy="${b.y}" r="${r}"><title>${esc(d.id)}</title></circle>`; cx -= r + 3; return c; }).join('');
      return `<g class="bx ${b.cls}${sel.has(b.id) ? ' sel' : ''}" data-box="${esc(b.id)}" tabindex="0" role="button"><title>${esc(b.name)}</title><rect x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="${b.role === 'part' ? 6 : 22}"/><text>${text}</text>${dots}</g>`;
    }).join('');
    return `<svg class="dfd story fit st-${v.kind}" viewBox="0 0 ${L.w} ${L.h}" role="img" aria-label="${esc(v.caption.title)}"><defs><marker id="st-a" viewBox="0 0 10 8" refX="9" refY="4" markerWidth="8" markerHeight="6" orient="auto" markerUnits="userSpaceOnUse"><path d="M0,0 L10,4 L0,8 z"/></marker></defs>`
      + `${L.sections.map((s) => frame('sec', s)).join('')}${L.lanes.map((s) => frame('lane', s)).join('')}${lines}${boxes}</svg>`;
  };
  const weakButton = (id, text, open, where = '') => `<button type="button" class="it ${open ? 'open' : 'done'}" data-weak="${esc(id)}">${esc(text)}${where ? ` <span class="mut">· ${esc(where)}</span>` : ''}</button>`;
  const drawCaption = (v) => {
    const c = v.caption;
    const tally = v.marks ? `<p class="tally"><b>${v.counts.total}</b> findings · <b class="g">${v.counts.fixed + v.counts.held}</b> mitigated${v.counts.thin ? ` · <b class="a">${v.counts.thin}</b> dismissed` : ''} · <b class="r">${v.counts.open}</b> open</p>` : '';
    const items = c.items.length ? `<ul class="items">${c.items.map((it) => `<li>${weakButton(it.id, it.text, it.open, it.where)}</li>`).join('')}</ul>` : '';
    return `<h2>${esc(c.title)}</h2>${tally}${c.lines.map((l) => `<p>${esc(l)}</p>`).join('')}${items}`;
  };
  const drawCard = (card) => {
    if (!card) return '<p class="mut">Select box, dot or finding.</p>';
    if (card.kind === 'box') {
      const weak = card.weak.map((id) => { const w = core.card(id, S.stage); return `<li>${weakButton(id, w.title, w.places.some((p) => p.state === 'open' || p.state === 'thin'))}</li>`; }).join('');
      return `<h3>${esc(card.name)}</h3>${card.area ? `<p class="mut">${esc(card.area)}</p>` : ''}`
        + `${card.from ? `<p><span class="k">Inbound</span> ${esc(card.from)}</p>` : ''}${card.to ? `<p><span class="k">Outbound</span> ${esc(card.to)}</p>` : ''}`
        + `${weak ? `<p class="k">Findings</p><ul class="items">${weak}</ul>` : ''}${card.label ? `<p class="ids">Source label: ${esc(card.label)}</p>` : ''}`;
    }
    const places = card.places.map((p) => `<li><span class="st ${p.state}">${esc(p.word)}</span> ${esc(p.name)}${p.how ? ` <span class="mut">· ${esc(p.how)}</span>` : ''}${p.area ? `<br><span class="mut">${esc(p.area)}</span>` : ''}${p.ruling ? `<p class="why">${esc(p.ruling)}</p>` : ''}</li>`).join('');
    const ends = card.outcomes.map((o) => `<li>${esc(o.name)} <span class="mut">(${esc(o.word)})</span></li>`).join('');
    const done = card.done.map((d) => `<li>${esc(d.text)} <span class="mut">· ${esc(d.how)}</span>${d.caveat ? `<p class="cav"><b>Residual:</b> ${esc(d.caveat)}</p>` : ''}${d.note ? `<details><summary>Patch note</summary><p>${esc(d.note)}</p></details>` : ''}</li>`).join('');
    return `<h3>${esc(card.title)}</h3><p class="k">Location</p><ul>${places}</ul>`
      + `${ends ? `<p class="k">Worst impact</p><ul>${ends}</ul>` : ''}<p class="k">Mitigation to date</p>${done ? `<ul>${done}</ul>` : '<p class="mut">None.</p>'}`
      + `<p class="ids">Reference: ${esc(card.places.map((p) => p.id).join(', '))}</p>`;
  };
  const draw = () => {
    const v = core.view(S.stage);
    const sel = picked();
    $('pic').innerHTML = drawPicture(v, sel.nodes);
    $('cap').innerHTML = drawCaption(v);
    $('card').innerHTML = drawCard(sel.card);
    $('key').innerHTML = KEY[v.kind].filter((k) => v.counts.thin > 0 || !k.includes('k-dot thin')).map((k) => `<li>${k}</li>`).join('');
    $('chips').innerHTML = core.stages.map((st, i) => `<li><button type="button" data-stage="${i}"${i === S.stage ? ' aria-current="step"' : ''}>${i + 1}. ${esc(st.label)}</button></li>`).join('');
    $('st-prev').disabled = S.stage === 0;
    $('st-next').disabled = S.stage === last;
    $('st-play').textContent = S.timer === null ? '▶ play' : '❚❚ pause';
  };
  const stop = () => { if (S.timer !== null) { timers.clear(S.timer); S.timer = null; } };
  const go = (i) => { S.stage = Math.max(0, Math.min(last, i)); draw(); };
  const tick = () => { S.timer = null; if (S.stage < last) { S.stage += 1; if (S.stage < last) S.timer = timers.set(tick, 4000); } draw(); };
  const pick = (ev) => {
    const w = ev.target.closest('[data-weak]');
    const b = w ? null : ev.target.closest('[data-box]');
    S.pick = w ? { kind: 'weak', id: w.dataset.weak } : b ? { kind: 'box', id: b.dataset.box } : null;
    draw();
  };
  $('pic').addEventListener('click', pick);
  $('pic').addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') pick(ev); });
  for (const id of ['cap', 'card']) $(id).addEventListener('click', (ev) => { if (ev.target.closest('[data-weak]')) pick(ev); });
  $('chips').addEventListener('click', (ev) => { const b = ev.target.closest('[data-stage]'); if (b) { stop(); go(Number(b.dataset.stage)); } });
  $('st-prev').addEventListener('click', () => { stop(); go(S.stage - 1); });
  $('st-next').addEventListener('click', () => { stop(); go(S.stage + 1); });
  $('st-play').addEventListener('click', () => {
    if (S.timer !== null) { stop(); draw(); return; }
    if (S.stage === last) S.stage = 0;
    S.timer = timers.set(tick, 4000);
    draw();
  });
  draw();
  return { core, S, draw, go };
}
