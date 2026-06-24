// Visualisations — a data view onto the Te Papa collection.
//
// A standalone page (like bragge.html) served by the same server. It reuses the
// main app's design tokens (style.css) and links back into the SPA search, but
// runs its own small bundle of code. The first visualisation is a treemap of how
// many objects and specimens sit in each collection.
//
// No build step, no chart library: a hand-rolled squarified treemap in absolutely
// positioned DOM tiles, coloured in the app's shared record-type families
// (Object = slate, Specimen = teal) so it reads as part of the same browser.

(function () {
  'use strict';

  // ── Header: theme switch, brand, search ───────────────────────────────────
  // The <head> inline script already set the pre-paint theme; this wires the
  // segmented switch and keeps following the OS until an explicit choice. A theme
  // change re-paints the treemap (layout is unchanged, only the colour ramp).
  const themeListeners = [];
  (function initTheme() {
    const sw = document.getElementById('theme-switch');
    if (!sw) return;
    const opts = sw.querySelectorAll('.theme-opt');
    const apply = (t) => {
      document.documentElement.dataset.theme = t;
      sw.dataset.active = t;
      opts.forEach((b) => b.setAttribute('aria-checked', String(b.dataset.val === t)));
      themeListeners.forEach((fn) => fn(t));
    };
    apply(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    opts.forEach((b) => b.addEventListener('click', () => {
      try { localStorage.setItem('tepapa.theme', b.dataset.val); } catch (e) { /* */ }
      apply(b.dataset.val);
    }));
    try {
      matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem('tepapa.theme')) apply(e.matches ? 'dark' : 'light');
      });
    } catch (e) { /* */ }
  })();
  const isDark = () => document.documentElement.dataset.theme === 'dark';

  document.querySelector('.brand')?.addEventListener('click', () => { location.href = '/'; });
  document.getElementById('search-form')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = document.getElementById('q').value.trim();
    location.href = q ? `/#q=${encodeURIComponent(q)}` : '/';
  });

  // ── Helpers ───────────────────────────────────────────────────────────────
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  // "FossilVertebrates" → "Fossil Vertebrates" (mirrors collectionLabel in app.js).
  const collectionLabel = (c) => String(c).replace(/([a-z])([A-Z])/g, '$1 $2');
  const fmt = (n) => Number(n).toLocaleString();
  const pct = (n, total) => total ? (n / total * 100) : 0;

  // Colour mixing for the per-tile ramps.
  const hexToRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const rgbToHex = (c) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
  const mixHex = (a, b, t) => rgbToHex(mix(hexToRgb(a), hexToRgb(b), t));
  // WCAG relative luminance → pick legible text colour over a tile.
  const luminance = (rgb) => {
    const s = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * s[0] + 0.7152 * s[1] + 0.0722 * s[2];
  };
  const textOn = (hex) => (luminance(hexToRgb(hex)) > 0.46 ? '#13242b' : '#ffffff');

  // Each record-type family gets a [biggest, smallest] colour ramp per theme.
  // Light: deep brand tone → pale tint. Dark: bright tone → deep muted shade.
  const RAMP = {
    Object: { light: ['#3c4759', '#bdc5cf'], dark: ['#b4c3d2', '#3c4a5e'] },
    Specimen: { light: ['#0c8f88', '#b3e6e1'], dark: ['#48cfc6', '#15514d'] },
  };
  const SWATCH = { Object: '#5e6876', Specimen: '#0cb0a9' };
  // Colour for a tile: interpolate its family ramp by rank (0 = biggest).
  function tileColor(family, rank, n) {
    const ramp = RAMP[family][isDark() ? 'dark' : 'light'];
    const t = n <= 1 ? 0 : rank / (n - 1);
    return mixHex(ramp[0], ramp[1], t);
  }

  // ── Squarified treemap (Bruls, Huizing, van Wijk) ─────────────────────────
  // Lay `items` ({value, ...}) into `rect` ({x,y,w,h}); returns leaf rects in the
  // same units. Greedily packs rows, choosing per row the orientation that keeps
  // tile aspect ratios closest to square.
  function layoutRow(row, rect, out) {
    const { x, y, w, h } = rect;
    const sum = row.reduce((s, r) => s + r.area, 0);
    if (w >= h) {                         // a column of width dw, tiles stacked
      const dw = sum / h;
      let yy = y;
      for (const r of row) { const rh = r.area / dw; out.push({ ...r, x, y: yy, w: dw, h: rh }); yy += rh; }
    } else {                              // a strip of height dh, tiles side by side
      const dh = sum / w;
      let xx = x;
      for (const r of row) { const rw = r.area / dh; out.push({ ...r, x: xx, y, w: rw, h: dh }); xx += rw; }
    }
  }
  function worst(row, side) {
    const sum = row.reduce((s, r) => s + r.area, 0);
    const mx = Math.max(...row.map((r) => r.area));
    const mn = Math.min(...row.map((r) => r.area));
    const s2 = sum * sum, l2 = side * side;
    return Math.max((l2 * mx) / s2, s2 / (l2 * mn));
  }
  function squarify(items, rect) {
    const out = [];
    const data = items.filter((d) => d.value > 0).sort((a, b) => b.value - a.value);
    const total = data.reduce((s, d) => s + d.value, 0);
    if (total <= 0 || rect.w <= 0 || rect.h <= 0) return out;
    const areaScale = (rect.w * rect.h) / total;
    const scaled = data.map((d) => ({ ...d, area: d.value * areaScale }));
    let { x, y, w, h } = rect;
    let row = [];
    let i = 0;
    while (i < scaled.length) {
      const side = Math.min(w, h);
      const it = scaled[i];
      if (row.length === 0 || worst(row, side) >= worst(row.concat(it), side)) {
        row.push(it); i++;
      } else {
        layoutRow(row, { x, y, w, h }, out);
        const sum = row.reduce((s, r) => s + r.area, 0);
        if (w >= h) { const dw = sum / h; x += dw; w -= dw; } else { const dh = sum / w; y += dh; h -= dh; }
        row = [];
      }
    }
    if (row.length) layoutRow(row, { x, y, w, h }, out);
    return out;
  }

  // ── Data ──────────────────────────────────────────────────────────────────
  // For one record type, the collection-facet breakdown {collection → count},
  // with case-variant tokens (e.g. landmammals / LandMammals) merged.
  async function collectionCounts(recordType) {
    const body = {
      query: '*', size: 0,
      filters: [{ field: 'type', keyword: recordType }],
      facets: [{ field: 'collection', size: 80 }],
    };
    const d = await (await fetch('/api/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    })).json();
    const facet = (d.facets && d.facets.collection) || {};
    const pairs = Array.isArray(facet)
      ? facet.map((x) => [x.key || x.value || x.label, x.count != null ? x.count : x.doc_count])
      : Object.entries(facet);
    const byLower = new Map();
    for (const [token, count] of pairs) {
      if (!token || !count) continue;
      const k = String(token).toLowerCase();
      const prev = byLower.get(k);
      // Merge case variants: sum counts, keep the better-cased display token.
      if (prev) { prev.count += count; if (count > prev.lead) { prev.lead = count; prev.token = token; } }
      else byLower.set(k, { token, count, lead: count });
    }
    const total = (((d._metadata || {}).resultset || {}).count) || 0;
    return { total, cols: [...byLower.values()].map(({ token, count }) => ({ token, count })) };
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const HEADER = 32;       // group title strip height (px)
  const GROUP_GAP = 16;    // gap between the Objects / Specimens regions (px)
  const TILE_GAP = 2.5;    // gutter between collection tiles (px)

  const root = document.getElementById('treemap');
  const tip = document.getElementById('tm-tip');
  let groups = [];         // [{ key, label, total, cols }]
  let grandTotal = 0;
  let placed = [];         // computed tile records, repainted on theme change

  function deepLink(token, recordType) {
    return `/#q=${encodeURIComponent(`collection:"${token}"`)}&type=${recordType}`;
  }

  function layout() {
    if (!groups.length) return;
    const W = root.clientWidth;
    const H = root.clientHeight;
    if (W < 2 || H < 2) return;
    placed = [];
    // Outer split: divide the canvas between Objects and Specimens by their totals.
    const groupRects = squarify(
      groups.map((g) => ({ value: g.total, ref: g })),
      { x: 0, y: 0, w: W, h: H }
    );
    for (const gr of groupRects) {
      const g = gr.ref;
      // Inset for the inter-group gutter, then reserve a header strip on top.
      const gx = gr.x + GROUP_GAP / 2, gy = gr.y + GROUP_GAP / 2;
      const gw = gr.w - GROUP_GAP, gh = gr.h - GROUP_GAP;
      g.rect = { x: gx, y: gy, w: gw, h: gh };
      const body = { x: gx, y: gy + HEADER, w: gw, h: Math.max(0, gh - HEADER) };
      const cols = g.cols.slice().sort((a, b) => b.count - a.count);
      const tiles = squarify(cols.map((c) => ({ value: c.count, ref: c })), body);
      tiles.forEach((t, i) => placed.push({ ...t, family: g.key, group: g, rank: i, n: tiles.length, col: t.ref }));
    }
    paint();
  }

  function paint() {
    const W = root.clientWidth;
    let html = '';
    // Group header strips.
    for (const g of groups) {
      if (!g.rect) continue;
      const left = g.rect.x, top = g.rect.y, w = g.rect.w;
      html += `<a class="tm-group-head" href="${esc(`/#q=${encodeURIComponent('*')}&type=${g.key}`)}" ` +
        `style="left:${left}px;top:${top}px;width:${w}px;height:${HEADER}px" ` +
        `title="Browse all ${esc(g.label.toLowerCase())}">` +
        `<span class="tm-group-swatch" style="background:${SWATCH[g.key]}"></span>` +
        `<span class="tm-group-name">${esc(g.label)}</span>` +
        `<span class="tm-group-count">${fmt(g.total)}</span>` +
        `</a>`;
    }
    // Collection tiles.
    for (const p of placed) {
      const x = p.x + TILE_GAP / 2, y = p.y + TILE_GAP / 2;
      const w = Math.max(0, p.w - TILE_GAP), h = Math.max(0, p.h - TILE_GAP);
      const bg = tileColor(p.family, p.rank, p.n);
      const fg = textOn(bg);
      const label = collectionLabel(p.col.token);
      const share = pct(p.col.count, p.group.total);
      // Only label tiles with room; tiny tiles rely on the hover tooltip.
      const showName = w >= 54 && h >= 30;
      const showCount = w >= 70 && h >= 46;
      const inner = showName
        ? `<span class="tm-tile-name">${esc(label)}</span>` +
          (showCount ? `<span class="tm-tile-count">${fmt(p.col.count)}</span>` : '')
        : '';
      html += `<a class="tm-tile" href="${esc(deepLink(p.col.token, p.family))}" ` +
        `style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${bg};color:${fg}" ` +
        `data-token="${esc(p.col.token)}" data-label="${esc(label)}" data-count="${p.col.count}" ` +
        `data-family="${p.family}" data-share="${share.toFixed(1)}" ` +
        `aria-label="${esc(label)} — ${fmt(p.col.count)} ${p.family === 'Object' ? 'objects' : 'specimens'}, ${share.toFixed(1)}% of ${p.group.label.toLowerCase()}">` +
        `<span class="tm-tile-in">${inner}</span></a>`;
    }
    root.style.setProperty('--tm-w', W + 'px');
    root.innerHTML = html;
  }

  // Floating tooltip (desktop hover) — shared by both visualisations on the page.
  function showTip(html, ev) { tip.innerHTML = html; tip.hidden = false; moveTip(ev); }
  function hideTip() { tip.hidden = true; }
  function tileTipHtml(t) {
    const count = Number(t.dataset.count);
    const noun = t.dataset.family === 'Object' ? 'objects' : 'specimens';
    return `<strong>${esc(t.dataset.label)}</strong>` +
      `<span class="tm-tip-row">${fmt(count)} ${noun}</span>` +
      `<span class="tm-tip-row tm-tip-muted">${t.dataset.share}% of ${noun} · ${pct(count, grandTotal).toFixed(1)}% of all records</span>` +
      `<span class="tm-tip-row tm-tip-cta">Click to browse →</span>`;
  }
  function moveTip(ev) {
    const pad = 14;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + tw > window.innerWidth - 8) x = ev.clientX - tw - pad;
    if (y + th > window.innerHeight - 8) y = ev.clientY - th - pad;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
  }
  root.addEventListener('mouseover', (e) => { const t = e.target.closest('.tm-tile'); if (t) showTip(tileTipHtml(t), e); });
  root.addEventListener('mousemove', (e) => { if (!tip.hidden) moveTip(e); });
  root.addEventListener('mouseout', (e) => { if (!root.contains(e.relatedTarget)) hideTip(); });

  // ── Boot ──────────────────────────────────────────────────────────────────
  async function boot() {
    try {
      const [objects, specimens] = await Promise.all([
        collectionCounts('Object'),
        collectionCounts('Specimen'),
      ]);
      groups = [
        { key: 'Object', label: 'Objects', total: objects.total, cols: objects.cols },
        { key: 'Specimen', label: 'Specimens', total: specimens.total, cols: specimens.cols },
      ];
      grandTotal = objects.total + specimens.total;
      // Fill in the summary line under the heading.
      const sum = document.getElementById('tm-summary');
      if (sum) {
        sum.innerHTML =
          `<strong>${fmt(grandTotal)}</strong> records across ` +
          `<strong>${objects.cols.length + specimens.cols.length}</strong> collections — ` +
          `<span class="tm-key"><span class="tm-key-dot" style="background:${SWATCH.Object}"></span>${fmt(objects.total)} objects</span> · ` +
          `<span class="tm-key"><span class="tm-key-dot" style="background:${SWATCH.Specimen}"></span>${fmt(specimens.total)} specimens</span>`;
      }
      root.classList.remove('tm-loading');
      layout();
    } catch (e) {
      root.classList.remove('tm-loading');
      root.innerHTML = `<div class="tm-error">Couldn't load the collection data. Is the server running?<br><small>${esc(String(e))}</small></div>`;
    }
  }

  // Re-layout on resize (debounced) and re-paint on theme change.
  let rt;
  const relayout = () => { clearTimeout(rt); rt = setTimeout(layout, 120); };
  if (window.ResizeObserver) new ResizeObserver(relayout).observe(root);
  window.addEventListener('resize', relayout);
  themeListeners.push(() => { if (placed.length) paint(); });

  // ════════════════════════════════════════════════════════════════════════
  // Visualisation 2 — the people behind the collection, by gender.
  //
  // gender sits on Person records (and is facetable), but the API can't join it
  // across a relationship (production.contributor.gender errors), so a role
  // breakdown means enumerating every linked person and looking up their gender —
  // ~100+ calls across the three roles. That's baked offline by
  // build-people-gender.js into /people-gender.json (full population, no cap);
  // here we just load and render it, with a By people / By works toggle.
  // ════════════════════════════════════════════════════════════════════════
  const GENDERS = ['Male', 'Female', 'Gender Diverse', 'Unrecorded'];
  const GN_COLORS = {
    light: { Male: '#3f7fbf', Female: '#e08a2e', 'Gender Diverse': '#8a63d2', Unrecorded: '#c2c8d0' },
    dark: { Male: '#6aa6e0', Female: '#f0a85a', 'Gender Diverse': '#b095e8', Unrecorded: '#6c727b' },
  };
  const gnColor = (g) => GN_COLORS[isDark() ? 'dark' : 'light'][g] || '#888';

  const gnChart = document.getElementById('genderchart');
  const gnLegend = document.getElementById('gn-legend');
  const gnSummary = document.getElementById('gn-summary');
  const gnMethod = document.getElementById('gn-method');
  const gnState = { mode: 'people', breakdown: 'role', role: 'maker', knownOnly: false, data: null };

  // Segments for one row's counts. knownOnly drops Unrecorded and renormalises
  // over the recorded-gender population.
  const gnSegments = (counts, knownOnly) => {
    const gs = knownOnly ? GENDERS.filter((g) => g !== 'Unrecorded') : GENDERS;
    const total = gs.reduce((s, g) => s + (counts[g] || 0), 0) || 1;
    return gs.map((g) => ({ g, n: counts[g] || 0, pct: (counts[g] || 0) / total * 100 }));
  };

  function renderGenderChart() {
    const data = gnState.data;
    if (!data) return;
    const rows = gnState.breakdown === 'collection'
      ? (data.byCollection && data.byCollection[gnState.role]) || []
      : data.roles || [];
    const noun = gnState.mode === 'people' ? 'people' : 'records';
    const ko = gnState.knownOnly;
    if (!rows.length) { gnChart.innerHTML = '<div class="tm-error">No data for this breakdown.</div>'; gnLegend.innerHTML = ''; return; }
    let html = '';
    for (const r of rows) {
      const counts = gnState.mode === 'people' ? r.people : r.works;
      const segs = gnSegments(counts, ko);
      const total = segs.reduce((s, x) => s + x.n, 0);
      const known = (counts.Male || 0) + (counts.Female || 0) + (counts['Gender Diverse'] || 0);
      const unrec = counts.Unrecorded || 0;
      const femalePct = known ? ((counts.Female || 0) / known * 100) : 0;
      const bar = segs.filter((s) => s.n > 0).map((s) =>
        `<span class="gn-seg" style="width:${s.pct}%;background:${gnColor(s.g)};color:${textOn(gnColor(s.g))}" ` +
        `data-g="${esc(s.g)}" data-n="${s.n}" data-pct="${s.pct.toFixed(1)}" data-noun="${noun}" data-role="${esc(r.label)}">` +
        (s.pct >= 9 ? `<span class="gn-seg-l">${Math.round(s.pct)}%</span>` : '') + `</span>`).join('');
      const foot = ko
        ? (unrec ? `${fmt(unrec)} more with no recorded gender (not shown)` : '')
        : (known ? `${femalePct.toFixed(0)}% women among those with a recorded gender` : '');
      html += `<div class="gn-row">` +
        `<div class="gn-row-head"><span class="gn-role">${esc(r.label)}</span>` +
        `<span class="gn-total">${total ? fmt(total) + ' ' + noun : 'no data'}</span></div>` +
        `<div class="gn-bar">${bar}</div>` +
        (foot ? `<div class="gn-row-foot">${foot}</div>` : '') +
        `</div>`;
    }
    gnChart.innerHTML = html;
    const keys = ko ? GENDERS.filter((g) => g !== 'Unrecorded') : GENDERS;
    gnLegend.innerHTML = keys.map((g) =>
      `<span class="gn-key"><span class="gn-key-dot" style="background:${gnColor(g)}"></span>${esc(g)}</span>`).join('');
  }

  const gnSegTip = (s) =>
    `<strong>${esc(s.dataset.role)}</strong>` +
    `<span class="tm-tip-row">${esc(s.dataset.g)}</span>` +
    `<span class="tm-tip-row tm-tip-muted">${fmt(Number(s.dataset.n))} ${s.dataset.noun} · ${s.dataset.pct}%</span>`;
  gnChart.addEventListener('mouseover', (e) => { const s = e.target.closest('.gn-seg'); if (s) showTip(gnSegTip(s), e); });
  gnChart.addEventListener('mousemove', (e) => { if (!tip.hidden) moveTip(e); });
  gnChart.addEventListener('mouseout', (e) => { if (!gnChart.contains(e.relatedTarget)) hideTip(); });

  document.querySelectorAll('.gn-mode-opt').forEach((b) => b.addEventListener('click', () => {
    gnState.mode = b.dataset.mode;
    document.querySelectorAll('.gn-mode-opt').forEach((x) => {
      const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-checked', String(on));
    });
    renderGenderChart();
  }));
  const gnBreakdown = document.getElementById('gn-breakdown');
  const gnRoleSel = document.getElementById('gn-role');
  const gnRoleField = document.querySelector('.gn-role-field');
  const gnKnown = document.getElementById('gn-known');
  gnBreakdown.addEventListener('change', () => {
    gnState.breakdown = gnBreakdown.value;
    if (gnRoleField) gnRoleField.hidden = gnState.breakdown !== 'collection';
    renderGenderChart();
  });
  gnRoleSel.addEventListener('change', () => { gnState.role = gnRoleSel.value; renderGenderChart(); });
  gnKnown.addEventListener('change', () => { gnState.knownOnly = gnKnown.checked; renderGenderChart(); });
  themeListeners.push(() => { if (gnState.data) renderGenderChart(); });

  async function bootGender() {
    try {
      const data = await (await fetch('/people-gender.json', { cache: 'no-store' })).json();
      gnState.data = data;
      const b = data.baseline.counts;
      const known = (b.Male || 0) + (b.Female || 0) + (b['Gender Diverse'] || 0);
      const malePct = known ? Math.round((b.Male || 0) / known * 100) : 0;
      const femPct = known ? Math.round((b.Female || 0) / known * 100) : 0;
      const knownPct = data.baseline.total ? Math.round(known / data.baseline.total * 100) : 0;
      if (gnSummary) {
        let s = `Te Papa's records name <strong>${fmt(data.baseline.total)}</strong> people. ` +
          `<strong>${knownPct}%</strong> have a recorded gender — of those, <strong>${malePct}% are men</strong> and <strong>${femPct}% women</strong>. `;
        // Surface the per-collection spread among makers (data-driven extremes).
        const ranked = ((data.byCollection && data.byCollection.maker) || []).map((c) => {
          const k = (c.people.Male || 0) + (c.people.Female || 0) + (c.people['Gender Diverse'] || 0);
          return { label: c.label, n: c.persons, pct: k ? (c.people.Female || 0) / k * 100 : null };
        }).filter((c) => c.pct != null && c.n >= 150).sort((a, b) => b.pct - a.pct);
        if (ranked.length >= 2) {
          const hi = ranked[0], lo = ranked[ranked.length - 1];
          s += `But it swings hard by collection — among makers, from <strong>${esc(hi.label)} (${Math.round(hi.pct)}% women)</strong> down to <strong>${esc(lo.label)} (${Math.round(lo.pct)}%)</strong>:`;
        } else {
          s += `The same skew runs through every role people play in the collection:`;
        }
        gnSummary.innerHTML = s;
      }
      if (gnMethod) {
        const totPeople = data.roles.reduce((s, r) => s + (r.persons || 0), 0);
        const when = data.generatedAt ? ` Snapshot ${data.generatedAt}.` : '';
        gnMethod.textContent =
          `Every linked person is counted — no cap (${totPeople.toLocaleString()} individuals across the three roles); switch “Break down by” to Collection to compare. ` +
          `“By works” weights each person by how many records they’re linked to. Organisations and unnamed agents have no gender and are excluded from these counts. ` +
          `“Unrecorded” = a person record with no gender in the source data.${when}`;
      }
      gnChart.classList.remove('gn-loading');
      renderGenderChart();
      gtBoot();
    } catch (e) {
      gnChart.classList.remove('gn-loading');
      gnChart.innerHTML = `<div class="tm-error">Couldn't load the people data (people-gender.json).<br><small>${esc(String(e))}</small></div>`;
    }
  }

  // ════════════════════════════════════════════════════════════════════════
  // Visualisation 3 — the gender map of the collections.
  //
  // A treemap (reusing the squarify engine) where each tile is a collection,
  // sized by how many people are linked to it in the selected role, and filled
  // with a hard-stop gradient of the gender split. Reads the same baked JSON.
  // ════════════════════════════════════════════════════════════════════════
  const gtRoot = document.getElementById('gendertreemap');
  const gtLegend = document.getElementById('gt-legend');
  const gtState = { role: 'maker', mode: 'people' };
  const GT_GAP = 2.5;
  let gtTiles = [];

  const gtDeepLink = (token) =>
    `/#q=${encodeURIComponent(`collection:"${token}"`)}&type=${gtState.role === 'collector' ? 'Specimen' : 'Object'}`;

  // Hard-stop gradient across the tile = a mini stacked bar of the gender split.
  function gtGradient(counts) {
    let acc = 0;
    const stops = [];
    for (const s of gnSegments(counts, false)) {
      if (s.pct <= 0) continue;
      const from = acc, to = acc + s.pct; acc = to;
      stops.push(`${gnColor(s.g)} ${from.toFixed(2)}% ${to.toFixed(2)}%`);
    }
    return stops.length ? `linear-gradient(90deg, ${stops.join(', ')})` : 'var(--md-surface-container-high)';
  }

  function gtLayout() {
    const data = gnState.data;
    if (!data || !gtRoot) return;
    const rows = (data.byCollection && data.byCollection[gtState.role]) || [];
    const W = gtRoot.clientWidth, H = gtRoot.clientHeight;
    if (!rows.length || W < 2 || H < 2) { gtTiles = []; return; }
    const items = rows.map((c) => {
      const counts = gtState.mode === 'people' ? c.people : c.works;
      const value = GENDERS.reduce((s, g) => s + (counts[g] || 0), 0);
      return { value, ref: c, counts };
    }).filter((i) => i.value > 0);
    gtTiles = squarify(items, { x: 0, y: 0, w: W, h: H });
    gtPaint();
  }

  function gtPaint() {
    const noun = gtState.mode === 'people' ? 'people' : 'records';
    let html = '';
    for (const t of gtTiles) {
      const c = t.ref, counts = t.counts;
      const x = t.x + GT_GAP / 2, y = t.y + GT_GAP / 2;
      const w = Math.max(0, t.w - GT_GAP), h = Math.max(0, t.h - GT_GAP);
      const known = (counts.Male || 0) + (counts.Female || 0) + (counts['Gender Diverse'] || 0);
      const femPct = known ? (counts.Female || 0) / known * 100 : 0;
      const showLabel = w >= 58 && h >= 30;
      html += `<a class="gt-tile" href="${esc(gtDeepLink(c.collection))}" ` +
        `style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;background:${gtGradient(counts)}" ` +
        `data-label="${esc(c.label)}" data-total="${t.value}" data-noun="${noun}" ` +
        `data-m="${counts.Male || 0}" data-f="${counts.Female || 0}" data-gd="${counts['Gender Diverse'] || 0}" data-u="${counts.Unrecorded || 0}" ` +
        `aria-label="${esc(c.label)}: ${fmt(t.value)} ${noun}, ${Math.round(femPct)}% women of those with a recorded gender">` +
        (showLabel
          ? `<span class="gt-lab"><span class="gt-lab-name">${esc(c.label)}</span>` +
            `<span class="gt-lab-meta">${fmt(t.value)} · ${Math.round(femPct)}% ♀</span></span>`
          : '') +
        `</a>`;
    }
    gtRoot.innerHTML = html;
    gtLegend.innerHTML = GENDERS.map((g) =>
      `<span class="gn-key"><span class="gn-key-dot" style="background:${gnColor(g)}"></span>${esc(g)}</span>`).join('') +
      `<span class="gn-key gt-key-note">tile size = number of ${noun}</span>`;
  }

  function gtTipHtml(el) {
    const d = el.dataset;
    const parts = [['Male', +d.m], ['Female', +d.f], ['Gender Diverse', +d.gd], ['Unrecorded', +d.u]]
      .filter(([, n]) => n > 0)
      .map(([g, n]) => `<span class="tm-tip-row tm-tip-muted">${g}: ${fmt(n)} (${Math.round(n / (+d.total) * 100)}%)</span>`).join('');
    return `<strong>${esc(d.label)}</strong>` +
      `<span class="tm-tip-row">${fmt(+d.total)} ${d.noun}</span>` + parts +
      `<span class="tm-tip-row tm-tip-cta">Click to browse →</span>`;
  }
  gtRoot.addEventListener('mouseover', (e) => { const t = e.target.closest('.gt-tile'); if (t) showTip(gtTipHtml(t), e); });
  gtRoot.addEventListener('mousemove', (e) => { if (!tip.hidden) moveTip(e); });
  gtRoot.addEventListener('mouseout', (e) => { if (!gtRoot.contains(e.relatedTarget)) hideTip(); });

  document.querySelectorAll('#gt-mode .gn-mode-opt').forEach((b) => b.addEventListener('click', () => {
    gtState.mode = b.dataset.gtmode;
    document.querySelectorAll('#gt-mode .gn-mode-opt').forEach((x) => {
      const on = x === b; x.classList.toggle('active', on); x.setAttribute('aria-checked', String(on));
    });
    gtLayout();
  }));
  const gtRoleSel = document.getElementById('gt-role');
  if (gtRoleSel) gtRoleSel.addEventListener('change', () => { gtState.role = gtRoleSel.value; gtLayout(); });

  let gtRt;
  const gtRelayout = () => { clearTimeout(gtRt); gtRt = setTimeout(gtLayout, 120); };
  if (window.ResizeObserver && gtRoot) new ResizeObserver(gtRelayout).observe(gtRoot);
  window.addEventListener('resize', gtRelayout);
  themeListeners.push(() => { if (gnState.data && gtTiles.length) gtPaint(); });

  function gtBoot() {
    if (!gtRoot) return;
    gtRoot.classList.remove('tm-loading');
    gtLayout();
  }

  // ════════════════════════════════════════════════════════════════════════
  // Visualisation 4 — the botany collecting timeline.
  //
  // Plants specimens carry a field-collection date at
  // evidenceFor.atEvent.eventDate. The facet API has no date histogram, so we
  // bucket by decade with one size:0 range-count per decade (live; ~28 light
  // queries). Bars are %-positioned (resize-free) and CSS-coloured (theme-free).
  // ════════════════════════════════════════════════════════════════════════
  const btPlot = document.getElementById('bt-plot');
  const btAxis = document.getElementById('bt-axis');
  const btSub = document.getElementById('bt-sub');
  const btCollectors = document.getElementById('bt-collectors');
  const btInstitutions = document.getElementById('bt-institutions');
  const BT_START = 1750, BT_END = 2020;
  // Shared x-axis with the histogram: year → % across the rendered decade span.
  let btAxisStart = BT_START, btAxisEnd = BT_END + 10;
  const btX = (y) => Math.max(0, Math.min(100, (y - btAxisStart) / (btAxisEnd - btAxisStart) * 100));

  // The museum's institutional eras (name-change years, verified from Te Papa).
  const INSTITUTIONS = [
    { name: 'Colonial Museum', short: 'Colonial', from: 1865, to: 1907 },
    { name: 'Dominion Museum', short: 'Dominion', from: 1907, to: 1972 },
    { name: 'National Museum', short: 'National', from: 1972, to: 1992 },
    { name: 'Te Papa', short: 'Te Papa', from: 1992, to: null, note: 'Museum of New Zealand Te Papa Tongarewa — established by Act 1992, opened 14 Feb 1998.' },
  ];
  const ERA_COLORS = ['#2f6d7a', '#3f8a9a', '#57a7b8', '#7cc4d4'];   // sequential blue-teal
  const apiSearch = (body) => fetch('/api/search', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }).then((r) => r.json()).catch(() => null);
  const btCount = (j) => (((j && j._metadata) || {}).resultset || {}).count || 0;
  const btDeepLink = (year) =>
    `/#q=${encodeURIComponent(`collection:"Plants" AND evidenceFor.atEvent.eventDate:[${year} TO ${year + 9}-12-31]`)}&type=Specimen`;

  function btRender(decades) {
    const n = decades.length;
    const max = Math.max(...decades.map((d) => d.count), 1);
    const slot = 100 / n;
    const grid = [10000, 20000, 30000].filter((g) => g < max * 1.02).map((g) => {
      const b = g / max * 100;
      return `<div class="bt-grid" style="bottom:${b}%"></div><span class="bt-ylab" style="bottom:${b}%">${g / 1000}k</span>`;
    }).join('');
    const bars = decades.map((d, i) => {
      const lab = d.year + 's';
      return `<a class="bt-bar" style="left:${(i * slot + slot * 0.13).toFixed(3)}%;width:${(slot * 0.74).toFixed(3)}%;height:${(d.count / max * 100).toFixed(3)}%" ` +
        `href="${esc(btDeepLink(d.year))}" data-decade="${lab}" data-count="${d.count}" ` +
        `aria-label="${lab}: ${fmt(d.count)} specimens collected"></a>`;
    }).join('');
    btPlot.innerHTML = grid + bars;
    btAxis.innerHTML = decades.map((d, i) =>
      (d.year % 50 === 0 || i === 0 || i === n - 1)
        ? `<span class="bt-xlab" style="left:${(i * slot + slot / 2).toFixed(3)}%">${d.year}s</span>` : ''
    ).join('');
  }

  const btTipHtml = (el) =>
    `<strong>${esc(el.dataset.decade)}</strong>` +
    `<span class="tm-tip-row">${fmt(+el.dataset.count)} specimens collected</span>` +
    `<span class="tm-tip-row tm-tip-cta">Click to browse →</span>`;
  if (btPlot) {
    btPlot.addEventListener('mouseover', (e) => { const b = e.target.closest('.bt-bar'); if (b) showTip(btTipHtml(b), e); });
    btPlot.addEventListener('mousemove', (e) => { if (!tip.hidden) moveTip(e); });
    btPlot.addEventListener('mouseout', (e) => { if (!btPlot.contains(e.relatedTarget)) hideTip(); });
  }

  // Top collectors as range bars on the SAME x-axis (baked in collectors-botany.json).
  async function btRenderCollectors() {
    if (!btCollectors) return;
    let data;
    try { data = await (await fetch('/collectors-botany.json', { cache: 'no-store' })).json(); }
    catch { btCollectors.innerHTML = ''; return; }
    const cs = (data.collectors || []).filter((c) => c.start && c.end);
    if (!cs.length) { btCollectors.innerHTML = ''; return; }
    const dl = (id) => `/#q=${encodeURIComponent(`collection:"Plants" AND evidenceFor.atEvent.recordedBy.id:${id}`)}&type=Specimen`;
    const rows = cs.map((c) => {
      const x0 = btX(c.start), x1 = btX(c.end), xm = btX(c.median);
      const w = Math.max(0.4, x1 - x0);
      const leftAnchor = x0 < 60;
      const pos = leftAnchor ? `left:${x0.toFixed(2)}%` : `right:${(100 - x1).toFixed(2)}%`;
      return `<a class="bt-crow" href="${esc(dl(c.id))}" data-name="${esc(c.name)}" data-count="${c.count}" data-start="${c.start}" data-end="${c.end}" data-peak="${c.median}" ` +
        `aria-label="${esc(c.name)}: ${fmt(c.count)} specimens, active ${c.start} to ${c.end}, peak ${c.median}">` +
        `<span class="bt-cname${leftAnchor ? '' : ' bt-cname-r'}" style="${pos}">${esc(c.name)} <span class="bt-cn">${fmt(c.count)}</span></span>` +
        `<span class="bt-cbar" style="left:${x0.toFixed(2)}%;width:${w.toFixed(2)}%"></span>` +
        `<span class="bt-cdot" style="left:${xm.toFixed(2)}%"></span>` +
        `</a>`;
    }).join('');
    btCollectors.innerHTML = '<div class="bt-clabel">Its top 10 collectors — and the 1769 origin — by their active years (dot = peak). Click any to browse their specimens:</div>' + rows;
  }
  const btCTip = (r) =>
    `<strong>${esc(r.dataset.name)}</strong>` +
    `<span class="tm-tip-row">${fmt(+r.dataset.count)} specimens</span>` +
    `<span class="tm-tip-row tm-tip-muted">active ${r.dataset.start}–${r.dataset.end} · peak ${r.dataset.peak}</span>` +
    `<span class="tm-tip-row tm-tip-cta">Click to browse →</span>`;
  if (btCollectors) {
    btCollectors.addEventListener('mouseover', (e) => { const r = e.target.closest('.bt-crow'); if (r) showTip(btCTip(r), e); });
    btCollectors.addEventListener('mousemove', (e) => { if (!tip.hidden) moveTip(e); });
    btCollectors.addEventListener('mouseout', (e) => { if (!btCollectors.contains(e.relatedTarget)) hideTip(); });
  }

  // The museum's institutional eras as a band on the same x-axis.
  function btRenderInstitutions() {
    if (!btInstitutions) return;
    const eras = INSTITUTIONS.map((m, i) => {
      const to = m.to || Math.round(btAxisEnd);
      const x0 = btX(m.from), x1 = btX(to);
      const w = x1 - x0;
      if (w <= 0) return '';
      const bg = ERA_COLORS[i] || '#888';
      const yrs = m.to ? `${m.from}–${m.to}` : `${m.from}–now`;
      return `<div class="bt-era" style="left:${x0.toFixed(2)}%;width:${w.toFixed(2)}%;background:${bg};color:${textOn(bg)}" ` +
        `data-name="${esc(m.name)}" data-years="${yrs}"${m.note ? ` data-note="${esc(m.note)}"` : ''}>` +
        `<span class="bt-era-name">${esc(m.short || m.name)}</span><span class="bt-era-yr">${yrs}</span></div>`;
    }).join('');
    btInstitutions.innerHTML =
      '<div class="bt-clabel">The museum through time — Colonial Museum to Te Papa (specimens to the left predate it):</div>' +
      `<div class="bt-era-track">${eras}</div>`;
  }
  const btETip = (el) =>
    `<strong>${esc(el.dataset.name)}</strong>` +
    `<span class="tm-tip-row">${esc(el.dataset.years)}</span>` +
    (el.dataset.note ? `<span class="tm-tip-row tm-tip-muted">${esc(el.dataset.note)}</span>` : '');
  if (btInstitutions) {
    btInstitutions.addEventListener('mouseover', (e) => { const r = e.target.closest('.bt-era'); if (r) showTip(btETip(r), e); });
    btInstitutions.addEventListener('mousemove', (e) => { if (!tip.hidden) moveTip(e); });
    btInstitutions.addEventListener('mouseout', (e) => { if (!btInstitutions.contains(e.relatedTarget)) hideTip(); });
  }

  async function btBoot() {
    if (!btPlot) return;
    const years = [];
    for (let y = BT_START; y <= BT_END; y += 10) years.push(y);
    try {
      const [total, ...counts] = await Promise.all([
        apiSearch({ query: 'collection:"Plants"', size: 0, filters: [{ field: 'type', keyword: 'Specimen' }] }).then(btCount),
        ...years.map((y) => apiSearch({ query: `collection:"Plants" AND evidenceFor.atEvent.eventDate:[${y} TO ${y + 9}-12-31]`, size: 0, filters: [{ field: 'type', keyword: 'Specimen' }] }).then(btCount)),
      ]);
      let decades = years.map((y, i) => ({ year: y, count: counts[i] }));
      while (decades.length && decades[0].count === 0) decades.shift();
      while (decades.length && decades[decades.length - 1].count === 0) decades.pop();
      btPlot.classList.remove('bt-loading');
      if (decades.length) {
        btAxisStart = decades[0].year;
        btAxisEnd = decades[decades.length - 1].year + 10;
        const withDate = decades.reduce((s, d) => s + d.count, 0);
        btRender(decades);
        if (btSub) btSub.innerHTML =
          `<strong>${fmt(withDate)}</strong> of <strong>${fmt(total)}</strong> plant specimens carry a collection date, ` +
          `spanning the <strong>${decades[0].year}s</strong> to today — the oldest gathered in October 1769 by ` +
          `Banks and Solander on Cook’s <em>Endeavour</em>.`;
      } else {
        btPlot.innerHTML = '<div class="tm-error">No dated specimens found.</div>';
      }
    } catch (e) {
      btPlot.classList.remove('bt-loading');
      btPlot.innerHTML = `<div class="tm-error">Couldn't load the collecting timeline.<br><small>${esc(String(e))}</small></div>`;
    }
    btRenderInstitutions();
    btRenderCollectors();
  }

  boot();
  bootGender();
  btBoot();
})();
