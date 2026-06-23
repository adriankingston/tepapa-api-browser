/* Knowledge-graph view for the Te Papa browser.
   Loaded after app.js; reuses its globals (esc, imagesOf, openDetail).

   Design for scale: a node's relationships are fetched from /api/neighbors,
   which returns every relationship type as a labelled, counted "bundle" (e.g.
   "made of (4)"). A bundle is one node you tap to page its members in — so a
   place with 250k relationships never tries to render 250k nodes. */
(() => {
  // Type colours + icons live in app.js (typeColor / typeIconUri), shared app-wide.
  const colorFor = (t) => typeColor(t);

  // Long record titles (esp. Rare Books / publications) wrap into many lines and
  // overlap neighbouring nodes. Cap the on-graph label at a sensible length on a
  // word boundary with an ellipsis; the full title stays in the node data, the
  // header focus line, and the detail panel.
  const truncateLabel = (s, max = 48) => {
    s = String(s == null ? '' : s).trim();
    if (s.length <= max) return s;
    const cut = s.slice(0, max);
    const sp = cut.lastIndexOf(' ');
    return (sp > max * 0.6 ? cut.slice(0, sp) : cut).replace(/[\s.,:;–—-]+$/, '') + '…';
  };

  // Touch devices have no right-click; the collapse gesture there is a long-press
  // (the same cxttap handler). Used to word the panel tip per device.
  const noHover = () => !!(window.matchMedia && window.matchMedia('(hover: none)').matches);

  const iconFor = (type) => typeIconUri(type, 9);     // graph nodes (fits the circle)
  const legendIcon = (type) => typeIconUri(type, 1);  // legend swatch (fills it)

  // Readable labels for the relationship fields live in app.js (predicateLabel),
  // shared with the detail view's related-records explorer.
  const labelFor = (p) => predicateLabel(p);

  const MAX_NODES = 300;
  const BUNDLE_PAGE = 10;

  const ov = document.getElementById('graph-overlay');
  const cyEl = document.getElementById('cy');
  const elFocusTitle = document.getElementById('graph-focus-title');
  const elCount = document.getElementById('graph-count');
  const elInfo = document.getElementById('graph-info');
  const elToast = document.getElementById('graph-toast');
  const elLegend = document.getElementById('graph-legend');
  let cy = null;
  let toastTimer = null;

  // ---- small helpers ----
  // kind 'info' (default) shows a neutral green toast; 'error' shows red, so
  // genuine failures still read as errors while loading/status messages don't.
  function toast(msg, kind = 'info') {
    elToast.textContent = msg;
    elToast.classList.toggle('error', kind === 'error');
    elToast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (elToast.hidden = true), 2600);
  }
  function updateCount() {
    const n = cy ? cy.nodes('[kind="record"]').length : 0;
    const b = cy ? cy.nodes('[kind="bundle"]').length : 0;
    elCount.textContent =
      `${n} record${n === 1 ? '' : 's'}` +
      (b ? ` · ${b} bundle${b === 1 ? '' : 's'}` : '');
  }
  function atCap() {
    if (cy.nodes().length >= MAX_NODES) {
      toast(`Node limit (${MAX_NODES}) reached — open a node’s details to keep exploring`);
      return true;
    }
    return false;
  }

  function buildLegend() {
    const items = [
      ['Object', 'Object'], ['Person', 'Person'], ['Organisation', 'Organisation'],
      ['Place', 'Place'], ['Taxon', 'Taxon'], ['Specimen', 'Specimen'],
      ['Category', 'Category'], ['Topic', 'Topic'], ['Publication', 'Publication'],
    ];
    const C = graphPalette();
    elLegend.innerHTML = items
      .map(([t, lbl]) => `<span class="lg"><img class="lg-ic" src="${legendIcon(t)}" alt="">${esc(lbl)}</span>`)
      .join('') +
      `<span class="lg"><span class="dot" style="background:${C.bundleBg};border:1px solid ${C.bundleBorder}"></span>bundle (tap to expand)</span>`;
  }

  // ---- cytoscape setup ----
  // Canvas colours can't read CSS tokens, so pick a palette per theme. Light
  // values match the original styling exactly; dark mirrors the --md-* dark tokens.
  function graphPalette() {
    const dark = document.documentElement.dataset.theme === 'dark';
    return dark ? {
      nodeBg: '#2b2926', nodeBorder: '#565250', label: '#e7e3df',
      brand: '#6cc3dd', focusLabel: '#e7e3df',
      bundleBg: '#0c4456', bundleBorder: '#3f8ba8', bundleText: '#cfe7ee',
      doneBg: '#353330', doneBorder: '#565250', doneText: '#cbc6c1',
      edge: '#565250', edgeLabel: '#cbc6c1', edgeLabelBg: '#141312',
      hover: '#ffffff',
    } : {
      nodeBg: '#ffffff', nodeBorder: '#bfc8ca', label: '#191c1d',
      brand: '#073b4c', focusLabel: '#073b4c',
      bundleBg: '#cfe7ee', bundleBorder: '#5fa9c0', bundleText: '#073b4c',
      doneBg: '#e1e4e6', doneBorder: '#bfc8ca', doneText: '#3f484a',
      edge: '#bfc8ca', edgeLabel: '#3f484a', edgeLabelBg: '#fbfcfd',
      hover: '#191c1d',
    };
  }

  function cyStyle() {
    const C = graphPalette();
    return [
      {
        selector: 'node[kind="record"]',
        style: {
          // photo if the record has one, otherwise a type icon on a neutral disc
          'background-color': C.nodeBg,
          'background-image': (e) => (e.data('thumb') ? e.data('thumb') : iconFor(e.data('type'))),
          // Te Papa media redirects to S3 without CORS headers, so load images
          // without the crossorigin flag (we never read pixels back).
          'background-image-crossorigin': 'null',
          'background-fit': 'contain',   // never crop — show the whole image, fit inside the node
          width: 48, height: 48,
          'border-width': 2,
          'border-color': C.nodeBorder,
          label: (e) => truncateLabel(e.data('label')), 'font-size': 10, color: C.label,
          'text-wrap': 'wrap', 'text-max-width': 86,
          'text-valign': 'bottom', 'text-margin-y': 5,
          'min-zoomed-font-size': 6,
        },
      },
      {
        selector: 'node.focus',                // starting record — teal primary emphasis
        style: {
          width: 76, height: 76, 'border-width': 4, 'border-color': C.brand,
          'background-color': C.bundleBg,      // filled teal disc, no square overlay halo
          'font-size': 12, 'font-weight': 'bold', color: C.focusLabel,
        },
      },
      {
        selector: 'node[kind="bundle"]',       // M3 filled-tonal chip
        style: {
          'background-image': 'none', 'background-color': C.bundleBg,
          shape: 'round-rectangle', 'border-color': C.bundleBorder, 'border-width': 2,   // match the record circles
          width: 'label', height: 'label', padding: '10px',
          label: 'data(label)', 'text-wrap': 'wrap', 'text-max-width': 130,
          'text-valign': 'center', 'text-margin-y': 0, color: C.bundleText, 'font-size': 11,
        },
      },
      { selector: 'node.bundle-done', style: { 'background-color': C.doneBg, 'border-color': C.doneBorder, color: C.doneText } },
      { selector: 'node[kind="record"].expanded', style: { 'border-width': 3, 'border-color': C.brand } },
      { selector: 'node.hover', style: { 'border-color': C.brand } },                          // teal ring on hover (no square overlay)
      { selector: 'node:selected', style: { 'border-color': C.brand, 'border-width': 3 } },      // thicker teal ring when selected
      {
        selector: 'edge',
        style: {
          width: 1.5, 'line-color': C.edge, 'curve-style': 'bezier',
          'target-arrow-shape': 'triangle', 'target-arrow-color': C.edge, 'arrow-scale': 0.8,
          label: 'data(label)', 'font-size': 8, color: C.edgeLabel,
          'text-rotation': 'autorotate',
          'text-background-color': C.edgeLabelBg, 'text-background-opacity': 0.92,
          'text-background-padding': 1, 'min-zoomed-font-size': 7,
        },
      },
      { selector: 'edge.reverse', style: { 'line-style': 'dashed' } },
    ];
  }

  function ensureCy() {
    if (cy) return cy;
    cy = cytoscape({
      container: cyEl,
      wheelSensitivity: 0.2,
      minZoom: 0.15,
      maxZoom: 3,
      style: cyStyle(),
    });
    cy.on('tap', 'node', (evt) => onTapNode(evt.target));
    cy.on('cxttap', 'node', (evt) => collapse(evt.target)); // right-click / long-press
    cy.on('mouseover', 'node', (evt) => evt.target.addClass('hover'));  // M3 hover state layer
    cy.on('mouseout', 'node', (evt) => evt.target.removeClass('hover'));
    cyEl.addEventListener('contextmenu', (e) => e.preventDefault());
    cy.on('tap', (evt) => { if (evt.target === cy) elInfo.hidden = true; });
    window.__cy = cy; // debug/automation hook
    return cy;
  }

  function nodePos(parentNode) {
    if (!parentNode) return { x: 0, y: 0 };
    const p = parentNode.position();
    const a = Math.random() * Math.PI * 2;
    const r = 90 + Math.random() * 60;
    return { x: p.x + Math.cos(a) * r, y: p.y + Math.sin(a) * r };
  }

  // Fill the circle edge-to-edge: swap a node's raw thumb for an edge-extended
  // square composite (bands filled with the image's own edge pixels), so the
  // whole photo shows with no white gaps and nothing cropped. Shared with the
  // list view via app.js's edgeExtendedThumb (same /api/imgproxy + cache).
  function extendNodeThumb(key, url) {
    if (!url || typeof edgeExtendedThumb !== 'function') return;
    edgeExtendedThumb(url, 160).then((d) => {
      if (!d) return;
      const n = cy.getElementById(key);
      if (n.nonempty()) n.data('thumb', d);
    });
  }

  function addRecordNode(node, parentNode) {
    const existing = cy.getElementById(node.key);
    if (existing.nonempty()) return existing;
    if (atCap()) return null;
    const el = cy.add({
      group: 'nodes',
      data: { id: node.key, kind: 'record', label: node.title, type: node.type, href: node.href, thumb: node.thumb, expanded: false },
      position: nodePos(parentNode),
    });
    extendNodeThumb(node.key, node.thumb);
    return el;
  }

  function addEdge(source, target, label, reverse, via) {
    const id = `e:${source}>${target}:${label}`;
    if (cy.getElementById(id).nonempty()) return;
    if (cy.getElementById(source).empty() || cy.getElementById(target).empty()) return;
    // `via` records which node's expansion created this edge — used by collapse().
    cy.add({ group: 'edges', data: { id, source, target, label: label || '', via: via || null }, classes: reverse ? 'reverse' : '' });
  }

  function relayout() {
    cy.layout({
      name: 'cose', animate: true, animationDuration: 450, fit: true, padding: 50,
      randomize: false, nodeRepulsion: 9000, idealEdgeLength: 95, edgeElasticity: 60,
      nestingFactor: 1.1, gravity: 0.3, numIter: 800,
    }).run();
    updateCount();
  }

  // ---- expansion ----
  async function expandRecord(node) {
    if (node.data('expanded')) return;
    node.data('expanded', true);
    const href = node.data('href');
    if (!href) { toast('No record link to expand', 'error'); return; }
    toast('Loading relationships…');
    let data;
    try {
      const res = await fetch('/api/neighbors', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ href }),
      });
      data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    } catch (e) {
      node.data('expanded', false);
      toast(`Couldn’t expand: ${e.message}`, 'error');
      return;
    }

    const via = node.id();
    cy.startBatch();
    // add the related record nodes first, then connect them
    for (const n of data.nodes || []) addRecordNode(n, node);
    for (const e of data.edges || []) {
      addEdge(e.source, e.target, labelFor(e.predicate), e.direction === 'in', via);
    }
    for (const b of data.bundles || []) {
      // mode in the id keeps a forward (inline) and reverse bundle of the same
      // predicate from colliding on one node.
      const bid = `bundle:${node.id()}|${b.predicate}|${b.mode}`;
      if (cy.getElementById(bid).empty() && !atCap()) {
        cy.add({
          group: 'nodes',
          data: {
            id: bid, kind: 'bundle', predicate: b.predicate, mode: b.mode,
            focusId: b.focusId || null, members: b.members || null,
            count: b.count, loaded: 0,
            label: `${labelFor(b.predicate)}\n(${b.count})`,
          },
          position: nodePos(node),
        });
        addEdge(node.id(), bid, '', false, via);
      }
    }
    cy.endBatch();
    node.addClass('expanded');
    relayout();
  }

  async function expandBundle(bundle) {
    const mode = bundle.data('mode');
    const count = bundle.data('count');
    let loaded = bundle.data('loaded') || 0;
    if (loaded >= count) { toast('All members loaded'); return; }
    let members = [];

    if (mode === 'inline') {
      members = (bundle.data('members') || []).slice(loaded, loaded + BUNDLE_PAGE);
    } else {
      toast('Loading members…');
      try {
        const res = await fetch('/api/search', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            query: '*', from: loaded, size: BUNDLE_PAGE,
            filters: [{ field: `${bundle.data('predicate')}.id`, keyword: bundle.data('focusId') }],
          }),
        });
        const json = await res.json();
        members = (json.results || []).map((r) => {
          const reps = (r.hasRepresentation || []).filter((x) => x.type === 'ImageObject' && x.thumbnailUrl);
          return { key: `${r.type}:${r.id}`, id: String(r.id), type: r.type, title: r.title || r.prefLabel || '(untitled)', href: r.href, thumb: reps[0] ? reps[0].thumbnailUrl : null };
        });
      } catch (e) {
        toast(`Couldn’t load members: ${e.message}`, 'error');
        return;
      }
    }

    cy.startBatch();
    let added = 0;
    for (const m of members) {
      const n = addRecordNode(m, bundle);
      if (!n) break;
      addEdge(bundle.id(), m.key, '', false, bundle.id());
      added++;
    }
    cy.endBatch();
    loaded += added;
    bundle.data('loaded', loaded);
    bundle.data('label', `${labelFor(bundle.data('predicate'))}\n(${loaded}/${count})`);
    if (loaded >= count) bundle.addClass('bundle-done');
    bundle.addClass('expanded');
    relayout();
  }

  // ---- collapse ----
  // Collapse one node's expansion. Works the same for the focus and any other
  // node: detach the edges this node introduced, then keep the pieces that are
  // still tied to the focus OR that contain a node you expanded (those branches
  // are reconnected so the graph stays whole), and drop only the unexplored
  // leaf branches. So collapsing the starting record keeps the branches you
  // drilled into open, and share-safety is preserved (a node still reached
  // another way survives).
  function collapse(node, skipLayout) {
    if (cy.nodes('.focus').empty()) return;
    const id = node.id();

    // reset this node's own expansion state
    node.data('expanded', false);
    node.removeClass('expanded');
    if (node.data('kind') === 'bundle') {
      node.data('loaded', 0);
      node.data('label', `${labelFor(node.data('predicate'))}\n(${node.data('count')})`);
      node.removeClass('bundle-done');
    }

    // detach the edges this node's expansion created
    const detached = cy.edges().filter((e) => e.data('via') === id).remove();

    // triage the now-separated pieces
    const keepFar = new Set();
    cy.elements().components().forEach((comp) => {
      if (!comp.nodes('.focus').empty()) return;     // still attached to the focus
      if (!comp.nodes('.expanded').empty()) {         // a branch you opened — keep it
        comp.nodes().forEach((n) => keepFar.add(n.id()));
      } else {
        comp.remove();                                // unexplored leaves — drop
      }
    });
    // reconnect the kept branches to this node
    detached
      .filter((e) => keepFar.has(e.data('source') === id ? e.data('target') : e.data('source')))
      .restore();

    if (!skipLayout) relayout();
  }

  function collapseAll() {
    const root = cy.nodes('.focus');
    if (root.empty()) return;
    cy.elements().difference(root).remove();
    root.data('expanded', false);
    root.removeClass('expanded');
    expandRecord(root); // back to the focus and its first ring
  }

  // ---- info panel + interaction ----
  function showRecordInfo(node) {
    const thumb = node.data('thumb');
    const type = node.data('type');
    elInfo.innerHTML =
      (thumb ? `<img src="${esc(thumb)}" alt="">` : '') +
      `<h3>${esc(node.data('label'))}</h3>` +
      `<div class="gi-meta"><span class="badge type" style="color:${colorFor(type)};border-color:${colorFor(type)}66">${esc(type)}</span></div>` +
      (node.data('expanded')
        ? `<button id="gi-collapse">Collapse branches</button>`
        : `<button id="gi-expand">Expand relationships</button>`) +
      `<button id="gi-detail">Open full details</button>` +
      `<p class="gi-note">Tip: ${noHover() ? 'long-press' : 'right-click'} a node to collapse its branches.</p>`;
    elInfo.hidden = false;
    const exp = document.getElementById('gi-expand');
    if (exp) exp.onclick = () => { expandRecord(node); showRecordInfo(node); };
    const col = document.getElementById('gi-collapse');
    if (col) col.onclick = () => { collapse(node); showRecordInfo(node); };
    document.getElementById('gi-detail').onclick = () => openDetailFor(node.data('href'));
  }

  function showBundleInfo(bundle) {
    const loaded = bundle.data('loaded') || 0;
    const count = bundle.data('count');
    elInfo.innerHTML =
      `<h3>${esc(labelFor(bundle.data('predicate')))}</h3>` +
      `<div class="gi-meta"><span class="badge type">${count.toLocaleString()} related</span></div>` +
      `<p class="gi-note">${loaded.toLocaleString()} of ${count.toLocaleString()} loaded. This relationship is large, so it’s shown as a bundle to keep the graph readable.</p>` +
      (loaded < count ? `<button id="gi-more">Load ${Math.min(BUNDLE_PAGE, count - loaded)} more</button>` : '') +
      (loaded > 0 ? `<button id="gi-collapse">Collapse (remove ${loaded} loaded)</button>` : '');
    elInfo.hidden = false;
    const more = document.getElementById('gi-more');
    if (more) more.onclick = () => { expandBundle(bundle).then(() => showBundleInfo(bundle)); };
    const col = document.getElementById('gi-collapse');
    if (col) col.onclick = () => { collapse(bundle); showBundleInfo(bundle); };
  }

  function onTapNode(node) {
    const kind = node.data('kind');
    if (kind === 'bundle') {
      showBundleInfo(node);
      expandBundle(node).then(() => showBundleInfo(node));
    } else {
      showRecordInfo(node);
      if (!node.data('expanded')) expandRecord(node);
    }
  }

  async function openDetailFor(href) {
    if (!href) return;
    try {
      const res = await fetch(`/api/record?href=${encodeURIComponent(href)}`);
      const record = await res.json();
      if (record && record.id) openDetail(record); // detail overlay sits above the graph
    } catch { toast('Couldn’t open details', 'error'); }
  }

  // ---- entry / chrome ----
  function openGraph(record) {
    ov.hidden = false;
    elInfo.hidden = true;
    buildLegend();
    ensureCy();
    cy.style(cyStyle());   // re-theme in case the light/dark setting changed since last open
    cy.elements().remove();
    cy.resize();
    const focus = {
      key: `${record.type}:${record.id}`,
      id: String(record.id),
      type: record.type,
      title: record.title || record.prefLabel || '(untitled)',
      href: record.href || null,
      // suppress potentially-sensitive imagery in the graph (shows the type icon)
      thumb: isSensitive(record) ? null : (imagesOf(record)[0] || {}).thumbnailUrl || null,
    };
    elFocusTitle.textContent = focus.title;
    const fn = cy.add({
      group: 'nodes',
      data: { id: focus.key, kind: 'record', label: focus.title, type: focus.type, href: focus.href, thumb: focus.thumb, expanded: false },
      position: { x: 0, y: 0 },
      classes: 'focus',
    });
    extendNodeThumb(focus.key, focus.thumb);
    // Centre the viewport on the focus node straight away — model (0,0) otherwise
    // renders at the top-left corner, so the node would appear there until the
    // first relayout fits it. Centring now means it starts centred.
    cy.center(fn);
    updateCount();
    expandRecord(fn);
  }

  function closeGraph() { ov.hidden = true; }

  document.getElementById('graph-close').addEventListener('click', closeGraph);
  // The logo doubles as a home button, like the main top bar.
  document.getElementById('graph-home').addEventListener('click', () => {
    closeGraph();
    if (window.goHome) window.goHome();
  });
  document.getElementById('graph-collapse-all').addEventListener('click', () => cy && collapseAll());
  document.getElementById('graph-fit').addEventListener('click', () => cy && cy.fit(undefined, 50));
  document.getElementById('graph-relayout').addEventListener('click', () => cy && relayout());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !ov.hidden) { e.stopPropagation(); closeGraph(); }
  });
  window.addEventListener('resize', () => { if (cy && !ov.hidden) cy.resize(); });

  // expose entry point for app.js
  window.openGraph = openGraph;
})();
