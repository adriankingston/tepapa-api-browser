/* Knowledge-graph view for the Te Papa browser.
   Loaded after app.js; reuses its globals (esc, imagesOf, openDetail).

   Design for scale: a node's relationships are fetched from /api/neighbors,
   which draws low-degree relationships as individual nodes and returns
   high-degree ones as "bundles" (e.g. "made (53)"). A bundle is one node you
   tap to page its members in — so a place with 250k relationships never tries
   to render 250k nodes. */
(() => {
  // Material 3-aligned, harmonised type palette. Object is the brand primary
  // (teal #008e96) so focus, selection, bundles and Object icons share one hue.
  const TYPE_COLORS = {
    Object: '#008e96', Person: '#ff7043', Organisation: '#ff7043',
    Place: '#43a047', Taxon: '#8e5fd9', Specimen: '#c79100',
    Category: '#5c7a99', Topic: '#d81b78', Publication: '#d81b78',
    Document: '#d81b78', Story: '#d81b78',
  };
  const DEFAULT_COLOR = '#9aa3b2';
  const colorFor = (t) => TYPE_COLORS[t] || DEFAULT_COLOR;

  // Simple type icons (24×24 SVG paths), drawn in the type colour.
  const ICONS = {
    Person: "<circle cx='12' cy='8' r='3.8'/><path d='M5 20c0-4 3.2-6.5 7-6.5s7 2.5 7 6.5v.6H5z'/>",
    Place: "<path d='M12 2.2a6.6 6.6 0 0 0-6.6 6.6c0 4.6 6.6 12.4 6.6 12.4s6.6-7.8 6.6-12.4A6.6 6.6 0 0 0 12 2.2z'/><circle cx='12' cy='8.8' r='2.4' fill='#fff'/>",
    Object: "<path d='M12 2.5 20.5 7v10L12 21.5 3.5 17V7z'/>",
    Taxon: "<circle cx='7.5' cy='11' r='1.9'/><circle cx='12' cy='8.5' r='2'/><circle cx='16.5' cy='11' r='1.9'/><path d='M12 12.5c-2.8 0-4.7 2-4.7 4 0 1.5 1.2 2.4 2.8 2.4h3.8c1.6 0 2.8-.9 2.8-2.4 0-2-1.9-4-4.7-4z'/>",
    Specimen: "<path d='M10 2.5h4v1.6h-1v4.3l4.7 8.5A1.6 1.6 0 0 1 16.3 19.5H7.7a1.6 1.6 0 0 1-1.4-2.6L11 8.4V4.1h-1z'/>",
    Category: "<path d='M3.2 11.8 11.8 3.2H21v9.2l-8.6 8.6z'/><circle cx='16.4' cy='7.6' r='1.5' fill='#fff'/>",
    Document: "<path d='M6.5 2.5h7L18 7v14.5H6.5z'/><path d='M13.5 2.5V7H18z' fill='#fff'/>",
    _default: "<circle cx='12' cy='12' r='6.5'/>",
  };
  const ICON_ALIAS = { Organisation: 'Person', Topic: 'Document', Publication: 'Document', Story: 'Document' };
  const iconCache = {};
  // `pad` units around the 24×24 icon. Graph nodes use generous padding so boxy
  // icons stay inside the circular node; the (square) legend swatch uses almost
  // none so the icon fills it.
  function iconUri(type, pad) {
    const ck = `${type}|${pad}`;
    if (iconCache[ck]) return iconCache[ck];
    const key = ICONS[type] ? type : (ICON_ALIAS[type] || '_default');
    const size = 24 + 2 * pad;
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='${-pad} ${-pad} ${size} ${size}' fill='${colorFor(type)}'>${ICONS[key]}</svg>`;
    return (iconCache[ck] = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg));
  }
  const iconFor = (type) => iconUri(type, 9);     // graph nodes (fits the circle)
  const legendIcon = (type) => iconUri(type, 1);  // legend swatch (fills it)

  // Readable labels for the native Collections Online relationship fields.
  const PREDICATE_LABELS = {
    'production.contributor': 'made', 'production.spatial': 'made in',
    isMadeOf: 'made of', productionUsedTechnique: 'technique', isTypeOf: 'type',
    influencedBy: 'influenced by', depicts: 'depicts', refersTo: 'refers to',
    isReferencedBy: 'referenced by', associatedParties: 'associated',
    associatedWith: 'associated with', broaderRank: 'parent taxon',
    'identification.toTaxon': 'identified as', 'identification.identifiedBy': 'identified by',
    'evidenceFor.atEvent': 'collected', 'evidenceFor.atEvent.recordedBy': 'recorded by',
    isAbout: 'about', aggregatedAgents: 'aggregates', relatedObjects: 'related',
  };
  const labelFor = (p) =>
    PREDICATE_LABELS[p] ||
    (p || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\./g, ' · ').toLowerCase();

  const MAX_NODES = 300;
  const BUNDLE_PAGE = 10;
  const AUTO_THRESHOLD = 8;

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
      ['Object', 'Object'], ['Person', 'Person / org'], ['Place', 'Place'],
      ['Taxon', 'Taxon'], ['Specimen', 'Specimen'], ['Category', 'Category'],
      ['Topic', 'Topic / pub'],
    ];
    elLegend.innerHTML = items
      .map(([t, lbl]) => `<span class="lg"><img class="lg-ic" src="${legendIcon(t)}" alt="">${esc(lbl)}</span>`)
      .join('') +
      `<span class="lg"><span class="dot" style="background:#bdeef1;border:1px solid #74d3da"></span>bundle (tap to expand)</span>`;
  }

  // ---- cytoscape setup ----
  function ensureCy() {
    if (cy) return cy;
    cy = cytoscape({
      container: cyEl,
      wheelSensitivity: 0.2,
      minZoom: 0.15,
      maxZoom: 3,
      style: [
        {
          selector: 'node[kind="record"]',
          style: {
            // photo if the record has one, otherwise a type icon on a white disc
            'background-color': '#ffffff',
            'background-image': (e) => (e.data('thumb') ? e.data('thumb') : iconFor(e.data('type'))),
            // Te Papa media redirects to S3 without CORS headers, so load images
            // without the crossorigin flag (we never read pixels back).
            'background-image-crossorigin': 'null',
            'background-fit': (e) => (e.data('thumb') ? 'cover' : 'contain'),
            width: 48, height: 48,
            'border-width': 2,
            'border-color': '#bfc8ca',       // M3 outline-variant
            label: 'data(label)', 'font-size': 10, color: '#191c1d',
            'text-wrap': 'wrap', 'text-max-width': 86,
            'text-valign': 'bottom', 'text-margin-y': 5,
            'min-zoomed-font-size': 6,
          },
        },
        {
          selector: 'node.focus',                // starting record — teal primary emphasis
          style: {
            width: 76, height: 76, 'border-width': 4, 'border-color': '#008e96',
            'overlay-color': '#008e96', 'overlay-opacity': 0.10, 'overlay-padding': 6,
            'font-size': 12, 'font-weight': 'bold', color: '#00363a',
          },
        },
        {
          selector: 'node[kind="bundle"]',       // M3 filled-tonal chip
          style: {
            'background-image': 'none', 'background-color': '#bdeef1',
            shape: 'round-rectangle', 'border-color': '#74d3da', 'border-width': 1,
            width: 'label', height: 'label', padding: '10px',
            label: 'data(label)', 'text-wrap': 'wrap', 'text-max-width': 130,
            'text-valign': 'center', 'text-margin-y': 0, color: '#00363a', 'font-size': 11,
          },
        },
        { selector: 'node.bundle-done', style: { 'background-color': '#e1e4e6', 'border-color': '#bfc8ca', color: '#3f484a' } },
        { selector: 'node[kind="record"].expanded', style: { 'border-width': 3, 'border-color': '#008e96' } },
        { selector: 'node.hover', style: { 'overlay-color': '#191c1d', 'overlay-opacity': 0.08, 'overlay-padding': 4 } },
        { selector: 'node:selected', style: { 'border-color': '#008e96', 'border-width': 3, 'overlay-color': '#008e96', 'overlay-opacity': 0.12, 'overlay-padding': 4 } },
        {
          selector: 'edge',
          style: {
            width: 1.5, 'line-color': '#bfc8ca', 'curve-style': 'bezier',
            'target-arrow-shape': 'triangle', 'target-arrow-color': '#bfc8ca', 'arrow-scale': 0.8,
            label: 'data(label)', 'font-size': 8, color: '#3f484a',
            'text-rotation': 'autorotate',
            'text-background-color': '#fbfcfd', 'text-background-opacity': 0.92,
            'text-background-padding': 1, 'min-zoomed-font-size': 7,
          },
        },
        { selector: 'edge.reverse', style: { 'line-style': 'dashed' } },
      ],
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

  function addRecordNode(node, parentNode) {
    const existing = cy.getElementById(node.key);
    if (existing.nonempty()) return existing;
    if (atCap()) return null;
    return cy.add({
      group: 'nodes',
      data: { id: node.key, kind: 'record', label: node.title, type: node.type, href: node.href, thumb: node.thumb, expanded: false },
      position: nodePos(parentNode),
    });
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
        body: JSON.stringify({ href, autoThreshold: AUTO_THRESHOLD }),
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
      const bid = `bundle:${node.id()}|${b.predicate}`;
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
      `<p class="gi-note">Tip: right-click a node to collapse its branches.</p>`;
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
    updateCount();
    expandRecord(fn);
  }

  function closeGraph() { ov.hidden = true; }

  document.getElementById('graph-close').addEventListener('click', closeGraph);
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
