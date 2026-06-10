/* Te Papa Collections Browser — front-end logic.
   Talks only to our own /api/search proxy, which adds the API key. */

const PAGE_SIZE = 24;

// Record types shown as result tabs, in order, with their (plural) labels.
const TYPE_LABELS = {
  all: 'All', Object: 'Objects', Specimen: 'Specimens', Taxon: 'Taxa',
  Person: 'People', Organisation: 'Organisations', Place: 'Places',
  Topic: 'Topics', Publication: 'Publications', Category: 'Categories',
};
const TAB_TYPES = ['Object', 'Specimen', 'Taxon', 'Person', 'Organisation', 'Place', 'Topic', 'Publication', 'Category'];
const typeLabel = (t) => TYPE_LABELS[t] || t;

const state = {
  query: '',
  type: 'all',
  from: 0,
  total: 0,
  results: [],
  counts: {},     // per-type result counts for the current query
  totalAll: 0,    // unfiltered total (the "All" tab)
  collections: [],       // selected collection filters (Objects/Specimens only)
  collectionFacet: {},   // available collections + counts for current query+type
  sort: { field: null, order: null }, // active sort (null = relevance)
  view: localStorage.getItem('tepapa.view') === 'list' ? 'list' : 'grid',
};

// The collection filter only applies to Objects and Specimens.
const COLLECTION_TYPES = new Set(['Object', 'Specimen']);
const collectionLabel = (c) => String(c).replace(/([a-z])([A-Z])/g, '$1 $2');

const el = {
  form: document.getElementById('search-form'),
  q: document.getElementById('q'),
  tabs: document.getElementById('result-tabs'),
  collectionBar: document.getElementById('collection-filter'),
  status: document.getElementById('status'),
  results: document.getElementById('results'),
  imagesOnly: document.getElementById('images-only'),
  sortCtl: document.getElementById('sort-control'),
  sortSelect: document.getElementById('sort-select'),
  viewGrid: document.getElementById('view-grid'),
  viewList: document.getElementById('view-list'),
  pager: document.getElementById('pager'),
  prev: document.getElementById('prev'),
  next: document.getElementById('next'),
  pageInfo: document.getElementById('page-info'),
  overlay: document.getElementById('overlay'),
  detail: document.getElementById('detail'),
  closeDetail: document.getElementById('close-detail'),
  home: document.getElementById('home'),
  toolbar: document.querySelector('.toolbar'),
  brand: document.querySelector('.brand'),
};

// ---- Helpers ----------------------------------------------------------------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );

// Pull the first usable image (ImageObject) out of a record.
function imagesOf(record) {
  const reps = Array.isArray(record.hasRepresentation) ? record.hasRepresentation : [];
  return reps.filter((r) => r && r.type === 'ImageObject' && r.thumbnailUrl);
}

// ---- Culturally sensitive imagery -------------------------------------------
// The API has no sensitivity flag, so this is a best-effort, deliberately
// cautious heuristic over the record's materials, classification and text.
// It flags images that may depict or include modified human remains or
// deceased persons; the blur is always one click from being revealed.
const SENSITIVE_TERMS = [
  'mummif', 'mummy', 'mummies', 'sarcophag',
  'mokomokai', 'toi moko', 'kōiwi', 'koiwi', 'tūpāpaku', 'tupapaku',
  'human remains', 'human skull', 'human skeleton', 'human bone',
  'human hair', 'human teeth', 'human skin',
  'shrunken head', 'preserved head', 'dried head', 'trophy head', 'severed head',
  'post-mortem', 'postmortem', 'post mortem', 'deathbed', 'death bed', 'tangihanga',
];
function isSensitive(record) {
  if (!record) return false;
  // any human-derived material is treated as (modified) human remains
  const materials = [record.isMadeOfSummary, ...asArray(record.isMadeOf).map((c) => c && c.title)]
    .filter(Boolean).join(' ').toLowerCase();
  if (materials.includes('human')) return true;
  const text = [record.title, record.caption, ...asArray(record.isTypeOf).map((c) => c && c.title)]
    .filter(Boolean).join(' · ').toLowerCase();
  return SENSITIVE_TERMS.some((t) => text.includes(t));
}
function sensitiveOverlay() {
  return (
    `<div class="sensitive-overlay">` +
    `<span class="sensitive-msg">⚠ Potentially sensitive image</span>` +
    `<small>May depict or include human remains or deceased persons.</small>` +
    `<button type="button" class="reveal-btn">View image</button>` +
    `</div>`
  );
}

function asArray(v) {
  return v == null ? [] : Array.isArray(v) ? v : [v];
}

// Primary maker name from production credits (e.g. "Rita Angus").
function makerOf(record) {
  const prod = asArray(record.production);
  const names = prod
    .map((p) => (p.contributor && p.contributor.title) || '')
    .filter((n) => n && n.toLowerCase() !== 'unknown');
  if (!names.length) return '';
  const unique = [...new Set(names)];
  return unique.length > 1 ? `${unique[0]} +${unique.length - 1}` : unique[0];
}

// Human-readable production date (e.g. "c.1950 - 1980").
function dateOf(record) {
  const prod = asArray(record.production);
  for (const p of prod) {
    if (p.verbatimCreatedDate) return p.verbatimCreatedDate;
    if (p.createdDate) return p.createdDate;
  }
  return '';
}

// ---- Per-type field extractors (plain text) for the results table & cards ---

const titleOf = (r) => r.title || r.prefLabel || r.scientificName || '(untitled)';
const joinText = (v) => (Array.isArray(v) ? v.filter(Boolean).join(', ') : v || '');

function localityOf(r) {
  const loc = r.evidenceFor && r.evidenceFor.atEvent && r.evidenceFor.atEvent.atLocation;
  return (loc && (loc.locality || loc.title)) || '';
}
function collectedDateOf(r) {
  const ev = r.evidenceFor && r.evidenceFor.atEvent;
  return (ev && (ev.verbatimEventDate || ev.eventDate)) || '';
}
function commonNameOf(r) {
  const v = asArray(r.vernacularName).map((x) => x.title).filter(Boolean);
  return v.length ? v[0] : joinText(r.commonName);
}
const bornOf = (r) => r.verbatimBirthDate || r.birthDate || '';
const diedOf = (r) => r.verbatimDeathDate || r.deathDate || '';
const placeTypeOf = (r) => (r.placeType ? String(r.placeType).split('/').pop() : '');
const regionOf = (r) => (asArray(r.broaderTerms)[0] || {}).title || r.nation || '';
function coordsOf(r) {
  const g = r.geoLocation;
  return g && g.lat != null ? `${g.lat}, ${g.lon}` : '';
}
function byOf(r) {
  for (const field of ['authors', 'editor', 'publisher']) {
    const names = asArray(r[field]).map((x) => x && x.title).filter(Boolean);
    if (names.length) {
      return names.length > 2 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
    }
  }
  return '';
}

// One-line summary for the mixed ("All types") table and the grid cards.
function summaryOf(r) {
  switch (r.type) {
    case 'Object': return [makerOf(r), dateOf(r)].filter(Boolean).join(' · ');
    case 'Specimen': return [localityOf(r), collectedDateOf(r)].filter(Boolean).join(' · ');
    case 'Taxon': return [r.scientificName, r.taxonRank].filter(Boolean).join(' · ');
    case 'Person':
    case 'Organisation': return [bornOf(r), diedOf(r)].filter(Boolean).join(' – ');
    case 'Place': return [placeTypeOf(r), regionOf(r)].filter(Boolean).join(' · ');
    case 'Topic': return joinText(r.purpose);
    case 'Publication': return [byOf(r), joinText(r.publicationDate)].filter(Boolean).join(' · ');
    case 'Category': return r.scopeNote ? String(r.scopeNote).slice(0, 90) : '';
    default: return r.identifier || '';
  }
}

// Table columns per record type — [label, getter, cssClass]. Topics, taxa,
// people, etc. have no registration number, so each type gets the fields that
// actually matter for it.
const RESULT_COLUMNS = {
  Object: [
    ['Reg. no.', (r) => r.identifier, 'col-reg'],
    ['Title', titleOf, 'col-title'],
    ['Date', dateOf, 'col-date'],
    ['Maker', makerOf, 'col-soft'],
    ['Collection', (r) => joinText(r.collectionLabel || r.collection), 'col-soft'],
  ],
  Specimen: [
    ['Reg. no.', (r) => r.identifier, 'col-reg'],
    ['Name', titleOf, 'col-title'],
    ['Collection', (r) => joinText(r.collectionLabel || r.collection), 'col-soft'],
    ['Locality', localityOf, 'col-soft'],
    ['Collected', collectedDateOf, 'col-date'],
  ],
  Taxon: [
    ['Scientific name', (r) => r.scientificName, 'col-title col-sci'],
    ['Common name', commonNameOf, 'col-soft'],
    ['Rank', (r) => r.taxonRank, 'col-soft'],
    ['Family', (r) => r.family, 'col-soft'],
  ],
  Person: [
    ['Name', titleOf, 'col-title'],
    ['Born', bornOf, 'col-date'],
    ['Died', diedOf, 'col-date'],
    ['Nationality', (r) => joinText(r.nationality), 'col-soft'],
  ],
  Place: [
    ['Name', titleOf, 'col-title'],
    ['Type', placeTypeOf, 'col-soft'],
    ['Region', regionOf, 'col-soft'],
    ['Coordinates', coordsOf, 'col-date'],
  ],
  Topic: [
    ['Title', titleOf, 'col-title'],
    ['Collection', (r) => joinText(r.collectionLabel || r.collection), 'col-soft'],
    ['Purpose', (r) => joinText(r.purpose), 'col-soft'],
  ],
  Publication: [
    ['Title', titleOf, 'col-title'],
    ['By', byOf, 'col-soft'],
    ['Published', (r) => joinText(r.publicationDate), 'col-date'],
    ['Type', (r) => joinText(r.publicationType), 'col-soft'],
  ],
  Category: [
    ['Term', titleOf, 'col-title'],
    ['Scope note', (r) => (r.scopeNote ? String(r.scopeNote).slice(0, 120) : ''), 'col-soft'],
    ['Source', (r) => r.creditLine, 'col-soft'],
  ],
  all: [
    ['Type', (r) => r.type, 'col-type'],
    ['Title', titleOf, 'col-title'],
    ['Identifier', (r) => r.identifier, 'col-reg'],
    ['Details', summaryOf, 'col-soft'],
  ],
};
const columnsFor = (type) =>
  RESULT_COLUMNS[type] || (type === 'Organisation' ? RESULT_COLUMNS.Person : RESULT_COLUMNS.all);

// Sort options per type — [label, field, order]. field null = relevance (default).
// Only fields the API actually sorts on are used (e.g. scientificName / publicationDate
// aren't sortable, so taxa/publications sort by title).
const SORT_OPTIONS = {
  // NB: the API only sorts these fields cleanly. production date and maker are
  // analyzed-text fields that the API accepts but does not order chronologically/
  // alphabetically, so they're intentionally not offered (they'd lie).
  Object: [
    ['Relevance', null, null],
    ['Title (A–Z)', 'title', 'asc'],
    ['Registration no.', 'identifier', 'asc'],
  ],
  Specimen: [
    ['Relevance', null, null],
    ['Name (A–Z)', 'title', 'asc'],
    ['Collected (oldest)', 'evidenceFor.atEvent.eventDate', 'asc'],
    ['Collected (newest)', 'evidenceFor.atEvent.eventDate', 'desc'],
    ['Registration no.', 'identifier', 'asc'],
  ],
  Taxon: [
    ['Relevance', null, null],
    ['Name (A–Z)', 'title', 'asc'],
  ],
  Person: [
    ['Relevance', null, null],
    ['Name (A–Z)', 'title', 'asc'],
    ['Born (earliest)', 'birthDate', 'asc'],
    ['Born (latest)', 'birthDate', 'desc'],
    ['Died (most recent)', 'deathDate', 'desc'],
  ],
  Place: [
    ['Relevance', null, null],
    ['Name (A–Z)', 'title', 'asc'],
  ],
  Topic: [
    ['Relevance', null, null],
    ['Title (A–Z)', 'title', 'asc'],
  ],
  Publication: [
    ['Relevance', null, null],
    ['Title (A–Z)', 'title', 'asc'],
  ],
  all: [
    ['Relevance', null, null],
    ['Title (A–Z)', 'title', 'asc'],
  ],
};
const sortOptionsFor = (type) =>
  SORT_OPTIONS[type] || (type === 'Organisation' ? SORT_OPTIONS.Person : SORT_OPTIONS.all);

// ---- Search -----------------------------------------------------------------

// A new query: fetch per-type counts (for the tabs), then load the active tab.
async function doSearch() {
  state.query = el.q.value;
  if (!state.query.trim()) { showHome(); return; }
  hideHome();
  el.results.innerHTML = '<div class="spinner"><div></div></div>';
  el.pager.hidden = true;

  let counts = {};
  let total = 0;
  try {
    const res = await fetch('/api/typecounts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: state.query }),
    });
    const data = await res.json();
    counts = data.counts || {};
    total = data.total || 0;
  } catch { /* tabs simply won't appear */ }

  state.counts = counts;
  state.totalAll = total;
  state.collections = []; // a new query clears any collection filter
  // keep the active tab if it still has results for this query, else go to All
  if (state.type !== 'all' && !(counts[state.type] > 0)) state.type = 'all';
  renderTabs();
  renderSortOptions();
  runSearch(true);
  updateCollectionFilter();
}

function renderTabs() {
  if (!state.totalAll) { el.tabs.hidden = true; return; }
  const tabs = [['all', state.totalAll]];
  for (const t of TAB_TYPES) {
    if (state.counts[t] > 0) tabs.push([t, state.counts[t]]);
  }
  el.tabs.innerHTML = tabs
    .map(([t, n]) =>
      `<button class="tab${t === state.type ? ' active' : ''}" role="tab" aria-selected="${t === state.type}" data-type="${t}">` +
      `${esc(typeLabel(t))} <span class="tab-count">${n.toLocaleString()}</span></button>`
    )
    .join('');
  el.tabs.hidden = false;
  el.tabs.querySelectorAll('.tab').forEach((b) => {
    b.addEventListener('click', () => selectTab(b.dataset.type));
  });
}

function selectTab(type) {
  if (type === state.type) return;
  state.type = type;
  state.collections = []; // collection filter is per-type
  el.tabs.querySelectorAll('.tab').forEach((b) => {
    const on = b.dataset.type === type;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  renderSortOptions();
  runSearch(true);
  updateCollectionFilter();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---- Collection filter (multiselect, Objects & Specimens) -------------------

// Fold the selected collections into the query as an OR clause.
function effectiveQuery() {
  if (state.collections.length && COLLECTION_TYPES.has(state.type)) {
    const clause = state.collections.map((c) => `collection:"${c}"`).join(' OR ');
    return `(${state.query}) AND (${clause})`;
  }
  return state.query;
}

async function updateCollectionFilter() {
  if (!COLLECTION_TYPES.has(state.type)) {
    el.collectionBar.hidden = true;
    el.collectionBar.innerHTML = '';
    return;
  }
  let facet = {};
  try {
    const res = await fetch('/api/collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: state.query, type: state.type }),
    });
    facet = (await res.json()).collection || {};
  } catch { /* no bar if it fails */ }
  state.collectionFacet = facet;
  renderCollectionBar();
}

function renderCollectionBar() {
  const entries = Object.entries(state.collectionFacet).sort((a, b) => b[1] - a[1]);
  if (!entries.length) { el.collectionBar.hidden = true; el.collectionBar.innerHTML = ''; return; }
  el.collectionBar.innerHTML =
    `<span class="cfilter-label">Collection</span>` +
    entries
      .map(([c, n]) =>
        `<button class="cchip${state.collections.includes(c) ? ' active' : ''}" data-coll="${esc(c)}" aria-pressed="${state.collections.includes(c)}">` +
        `${esc(collectionLabel(c))} <span class="cchip-count">${n.toLocaleString()}</span></button>`
      )
      .join('') +
    (state.collections.length ? `<button class="cchip-clear" id="cfilter-clear">Clear ✕</button>` : '');
  el.collectionBar.hidden = false;
  el.collectionBar.querySelectorAll('.cchip').forEach((b) => {
    b.addEventListener('click', () => toggleCollection(b.dataset.coll));
  });
  const clear = document.getElementById('cfilter-clear');
  if (clear) clear.addEventListener('click', () => { state.collections = []; renderCollectionBar(); runSearch(true); });
}

function toggleCollection(c) {
  const i = state.collections.indexOf(c);
  if (i >= 0) state.collections.splice(i, 1);
  else state.collections.push(c);
  renderCollectionBar();
  runSearch(true);
}

// ---- Sort (per type) --------------------------------------------------------

// Populate the sort dropdown for the active type and reset to Relevance.
function renderSortOptions() {
  el.sortSelect.innerHTML = sortOptionsFor(state.type)
    .map(([label], i) => `<option value="${i}">${esc(label)}</option>`)
    .join('');
  el.sortSelect.value = '0';
  state.sort = { field: null, order: null };
  el.sortCtl.hidden = false;
}

async function runSearch(reset = true) {
  if (reset) state.from = 0;
  if (!state.query.trim()) return;

  el.results.innerHTML = '<div class="spinner"><div></div></div>';
  el.pager.hidden = true;

  const body = {
    query: effectiveQuery(),
    from: state.from,
    size: PAGE_SIZE,
  };
  if (state.type !== 'all') {
    body.filters = [{ field: 'type', keyword: state.type }];
  }
  if (state.sort.field) {
    body.sort = [{ field: state.sort.field, order: state.sort.order }];
  }

  let data;
  try {
    const res = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  } catch (err) {
    el.results.innerHTML = `<div class="message error">Couldn’t reach the collection.<br><small>${esc(
      err.message
    )}</small></div>`;
    el.status.textContent = '';
    return;
  }

  state.results = data.results || [];
  state.total = (data._metadata && data._metadata.resultset && data._metadata.resultset.count) || 0;

  renderResults();
}

// ---- Render results ---------------------------------------------------------

function renderResults() {
  const imagesOnly = el.imagesOnly.checked;
  let items = state.results;
  if (imagesOnly) items = items.filter((r) => imagesOf(r).length > 0);

  if (state.total === 0) {
    el.results.className = 'grid';
    el.results.innerHTML = `<div class="message">No results for “${esc(state.query)}”. Try another term.</div>`;
    el.status.innerHTML = `0 results`;
    el.pager.hidden = true;
    return;
  }

  el.status.innerHTML =
    `<strong>${state.total.toLocaleString()}</strong> result${state.total === 1 ? '' : 's'} for ` +
    `“${esc(state.query)}”` +
    (state.type !== 'all' ? ` · ${esc(typeLabel(state.type))}` : '');

  if (items.length === 0) {
    el.results.className = 'grid';
    el.results.innerHTML = `<div class="message">None of the items on this page have images. Untick “Images only” or go to the next page.</div>`;
  } else if (state.view === 'list') {
    el.results.className = 'list-wrap';
    el.results.innerHTML = listHtml(items);
    wireRowClicks();
  } else {
    el.results.className = 'grid';
    el.results.innerHTML = items.map(cardHtml).join('');
    wireRowClicks();
  }

  // Pager
  const start = state.from + 1;
  const end = Math.min(state.from + PAGE_SIZE, state.total);
  el.pageInfo.textContent = `${start.toLocaleString()}–${end.toLocaleString()} of ${state.total.toLocaleString()}`;
  el.prev.disabled = state.from === 0;
  el.next.disabled = end >= state.total;
  el.pager.hidden = false;
}

function cardHtml(record) {
  const i = state.results.indexOf(record);
  const img = imagesOf(record)[0];
  const title = titleOf(record);
  const sensitive = img && isSensitive(record);
  const thumb = img
    ? `<div class="thumb${sensitive ? ' sensitive' : ''}"><img loading="lazy" src="${esc(img.thumbnailUrl)}" alt="${esc(title)}">${sensitive ? sensitiveOverlay() : ''}</div>`
    : `<div class="thumb no-image"><span>No image</span></div>`;
  const sub = summaryOf(record); // type-appropriate secondary line
  return `
    <article class="card" data-i="${i}" tabindex="0">
      ${thumb}
      <button class="result-graph" title="Explore relationship graph" aria-label="Explore relationship graph">🕸</button>
      <div class="card-body">
        <div class="card-title">${esc(title)}</div>
        ${sub ? `<div class="card-sub">${esc(sub)}</div>` : ''}
        <div class="card-meta">
          <span class="badge type">${esc(record.type || '')}</span>
          ${record.identifier ? `<span class="badge">${esc(record.identifier)}</span>` : ''}
        </div>
      </div>
    </article>`;
}

// Click handler shared by grid cards and list rows; data-i maps back into the
// full (unfiltered) result set.
function wireRowClicks() {
  el.results.querySelectorAll('[data-i]').forEach((node) => {
    node.addEventListener('click', () => openDetail(state.results[Number(node.dataset.i)]));
  });
  // Per-result "explore graph" buttons jump straight to the graph for that record.
  el.results.querySelectorAll('.result-graph').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const host = btn.closest('[data-i]');
      const record = state.results[Number(host.dataset.i)];
      if (window.openGraph) window.openGraph(record);
    });
  });
  wireReveal(el.results);
}

// Reveal a blurred sensitive image without triggering the surrounding click.
function wireReveal(container) {
  container.querySelectorAll('.reveal-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const wrap = btn.closest('.sensitive');
      if (wrap) wrap.classList.add('revealed');
    });
  });
}

function listHtml(items) {
  const cols = columnsFor(state.type); // columns tailored to the record type
  const head =
    `<th class="col-thumb"></th>` +
    cols.map((c) => `<th class="${c[2]}">${esc(c[0])}</th>`).join('') +
    `<th class="col-act"></th>`;
  const rows = items
    .map((record) => {
      const i = state.results.indexOf(record);
      const img = imagesOf(record)[0];
      const thumb = img
        ? `<span class="lthumb${isSensitive(record) ? ' sensitive' : ''}"><img loading="lazy" src="${esc(img.thumbnailUrl)}" alt="">${isSensitive(record) ? '<span class="lthumb-warn" title="Potentially sensitive image">⚠</span>' : ''}</span>`
        : `<span class="ph"></span>`;
      const cells = cols
        .map((c) => {
          const raw = c[1](record);
          const val = raw == null || raw === '' ? '—' : esc(raw);
          const inner = c[2].includes('col-sci') && raw ? `<em>${val}</em>` : val;
          return `<td class="${c[2]}">${inner}</td>`;
        })
        .join('');
      return `<tr data-i="${i}" tabindex="0">
        <td class="col-thumb">${thumb}</td>
        ${cells}
        <td class="col-act"><button class="result-graph" title="Explore relationship graph" aria-label="Explore relationship graph">🕸</button></td>
      </tr>`;
    })
    .join('');
  return `<table class="list">
    <thead><tr>${head}</tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

// ---- Detail view ------------------------------------------------------------

// The public Collections Online page uses the same <path>/<id> as the API href.
function collectionsOnlineUrl(record) {
  const prefix = 'https://data.tepapa.govt.nz/collection/';
  if (record.href && record.href.startsWith(prefix)) {
    return 'https://collections.tepapa.govt.nz/' + record.href.slice(prefix.length);
  }
  return null;
}

function row(label, valueHtml) {
  if (!valueHtml) return '';
  return `<dt>${esc(label)}</dt><dd>${valueHtml}</dd>`;
}

function chips(items, key = 'title') {
  const list = asArray(items)
    .map((x) => (typeof x === 'string' ? x : x && x[key]))
    .filter(Boolean);
  if (!list.length) return '';
  return `<div class="chips">${list.map((t) => `<span class="badge">${esc(t)}</span>`).join('')}</div>`;
}

// One navigable chip-link for a single referenced record, used inline (e.g. the
// maker/place in the production line). Falls back to plain text with no link.
function recordLink(rec, text) {
  const label = text || (rec && (rec.title || rec.prefLabel)) || '';
  if (!label) return '';
  if (rec && rec.href) {
    return `<button class="badge chip-link" data-href="${esc(rec.href)}" title="Open ${esc(label)}">${esc(label)}</button>`;
  }
  return esc(label);
}

function productionHtml(record) {
  const prod = asArray(record.production);
  if (!prod.length) return '';
  const lines = prod.map((p) => {
    const c = p.contributor;
    const who = (c && (c.title || c.prefLabel)) || '';
    const main = who ? recordLink(c, who) : esc(p.title || '');
    const role = p.role ? esc(p.role) : 'maker';
    const sp = p.spatial;
    const where = sp && (sp.title || sp.prefLabel) ? ` · ${recordLink(sp)}` : '';
    const date = p.verbatimCreatedDate || p.createdDate || p.date || '';
    const when = date ? ` · ${esc(date)}` : '';
    return `<p>${main}<span style="color:var(--muted)"> — ${role}</span>${when}${where}</p>`;
  });
  return lines.join('');
}

// The short tombstone caption (title · date · maker · credit line).
// captionFormatted is trusted HTML from the API; caption is plain text.
function captionHtml(record) {
  if (record.captionFormatted) return `<p class="caption">${record.captionFormatted}</p>`;
  if (record.caption) return `<p class="caption">${esc(record.caption)}</p>`;
  return '';
}

// The longer interpretive "web summary" shown under About. description and
// narrative are trusted HTML from the API; the rest are plain text. The short
// caption is handled separately (captionHtml) so it no longer masks these —
// previously captionFormatted always won and record.description was never shown.
function summaryHtml(record) {
  if (record.description) return record.description;
  if (record.narrative) return record.narrative;
  const text = record.narrativeSummary || record.scopeNote || record.summary;
  return text ? `<p>${esc(text)}</p>` : '';
}

// Measurements. The API gives a ready-formatted `title` (e.g. "Overall: 92mm
// (width), 315mm (height), 28mm (depth)") on almost every entry; fall back to
// building one from the numeric size keys. We render every distinct measurement
// (multi-component objects legitimately repeat an extent label for each part, as
// Collections Online does), collapsing only exact-duplicate lines and skipping
// value-less entries (e.g. a bare "Other:").
function dimensionsHtml(record) {
  const dims = asArray(record.observedDimension);
  if (!dims.length) return '';
  const SIZE = ['height', 'width', 'length', 'depth', 'diameter'];
  const seen = new Set();
  const lines = [];
  for (const d of dims) {
    let text = d.title;
    if (!text) {
      const unit = d.sizeUnitText || d.unit || '';
      const parts = SIZE.filter((k) => d[k] != null).map((k) => `${d[k]}${unit} (${k})`);
      if (parts.length) text = `${d.extentType ? d.extentType + ': ' : ''}${parts.join(', ')}`;
    }
    text = text && text.trim();
    if (!text || !/\d/.test(text) || seen.has(text)) continue; // need a value, no repeats
    seen.add(text);
    lines.push(text);
  }
  return lines.length ? lines.map((l) => `<p>${esc(l)}</p>`).join('') : '';
}

function vernacularHtml(record) {
  const names = asArray(record.vernacularName)
    .map((v) => (v.language ? `${v.title} (${v.language})` : v.title))
    .filter(Boolean);
  return names.length ? `<div class="chips">${names.map((n) => `<span class="badge">${esc(n)}</span>`).join('')}</div>` : '';
}

// Clickable chips for referenced records — open that record's details in place.
function recordChips(items, cap = 24) {
  const list = asArray(items).filter((x) => x && x.id && x.type && x.href);
  if (!list.length) return '';
  const shown = list.slice(0, cap);
  const extra = list.length - shown.length;
  return `<div class="chips">${shown
    .map((x) => {
      const label = x.title || x.prefLabel || x.scientificName || x.type;
      return `<button class="badge chip-link" data-href="${esc(x.href)}" title="Open ${esc(label)}">${esc(label.slice(0, 70))}</button>`;
    })
    .join('')}${extra > 0 ? `<span class="badge">+${extra} more</span>` : ''}</div>`;
}

// External web links (Wikidata etc.) and authority references.
function extLinksHtml(record) {
  const out = [];
  for (const r of asArray(record.related)) {
    if (r && r.contentUrl) out.push(`<a href="${esc(r.contentUrl)}" target="_blank" rel="noopener">${esc(r.title || 'Link')} ↗</a>`);
  }
  return out.length ? `<div class="links">${out.join('')}</div>` : '';
}

function personDates(record, which) {
  const verbatim = which === 'birth' ? record.verbatimBirthDate || record.birthDate : record.verbatimDeathDate || record.deathDate;
  const place = which === 'birth' ? record.birthPlace : record.deathPlace;
  return [verbatim, place].filter(Boolean).map(esc).join(' · ');
}

function taxonomyHtml(record) {
  if (!record.higherClassification) return '';
  return esc(String(record.higherClassification).replace(/\s*\|\s*/g, ' › '));
}

function geoHtml(record) {
  const g = record.geoLocation;
  if (!g || g.lat == null) return '';
  const map = `https://www.openstreetmap.org/?mlat=${g.lat}&mlon=${g.lon}&zoom=6`;
  return `${esc(`${g.lat}, ${g.lon}`)} · <a href="${esc(map)}" target="_blank" rel="noopener">map ↗</a>`;
}

function identificationHtml(record) {
  const taxa = asArray(record.identification)
    .map((i) => i.toTaxon && (i.toTaxon.title || i.toTaxon.scientificName))
    .filter(Boolean);
  return taxa.length ? esc([...new Set(taxa)].join(', ')) : '';
}

function collectionEventHtml(record) {
  const ev = record.evidenceFor && record.evidenceFor.atEvent;
  if (!ev) return '';
  const loc = ev.atLocation || {};
  const who = asArray(ev.recordedBy).map((r) => r.title).filter(Boolean).join(', ');
  const parts = [];
  if (who) parts.push(`by ${esc(who)}`);
  const place = loc.locality || loc.title;
  if (place) parts.push(`at ${esc(place)}`);
  const date = ev.verbatimEventDate || ev.eventDate;
  if (date) parts.push(`on ${esc(date)}`);
  return parts.length ? parts.join(' · ') : '';
}

async function openRecordByHref(href) {
  if (!href) return;
  try {
    const res = await fetch(`/api/record?href=${encodeURIComponent(href)}`);
    const rec = await res.json();
    if (rec && rec.id) openDetail(rec);
  } catch { /* ignore */ }
}

// ---- Wikipedia preview (people via Wikidata id, places via name + coords) ----

const WIKI_TYPES = new Set(['Person', 'Organisation', 'Place']);

function wikidataId(record) {
  for (const r of asArray(record.related)) {
    const m = /wikidata\.org\/(?:wiki|entity)\/(Q\d+)/i.exec((r && (r.contentUrl || r.iri)) || '');
    if (m) return m[1];
  }
  for (const idf of asArray(record.identifiers)) {
    if (idf && /wikidata/i.test(idf.title || '') && /^Q\d+$/i.test(idf.identifier || '')) return idf.identifier;
  }
  return null;
}

function wikiQuery(record) {
  if (record.type === 'Person' || record.type === 'Organisation') {
    const q = wikidataId(record);
    return q ? `wikidata=${q}` : null; // people: explicit Wikidata id only
  }
  if (record.type === 'Place') {
    const name = (record.prefLabel || record.title || '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    if (!name) return null;
    const p = new URLSearchParams({ title: name });
    if (record.nation) p.set('country', record.nation);
    const g = record.geoLocation || {};
    if (g.lat != null && g.lon != null) { p.set('lat', g.lat); p.set('lon', g.lon); }
    return p.toString();
  }
  return null;
}

function wikiHtml(d) {
  return (
    `<div class="section-title">Wikipedia</div>` +
    `<div class="wiki">` +
    (d.thumb ? `<img class="wiki-thumb" src="${esc(d.thumb)}" alt="">` : '') +
    `<div class="wiki-body">` +
    (d.description ? `<div class="wiki-desc">${esc(d.description)}</div>` : '') +
    `<p class="wiki-extract">${esc(d.extract)}</p>` +
    `<a class="wiki-link" href="${esc(d.url)}" target="_blank" rel="noopener">Read on Wikipedia ↗</a>` +
    `<p class="wiki-credit">Summary from <a href="${esc(d.url)}" target="_blank" rel="noopener">Wikipedia</a>, ` +
    `licensed <a href="https://creativecommons.org/licenses/by-sa/4.0/" target="_blank" rel="noopener">CC BY-SA</a>.</p>` +
    `</div></div>`
  );
}

async function loadWikipedia(record) {
  const qs = wikiQuery(record);
  if (!qs) return;
  const recKey = `${record.type}:${record.id}`;
  let data;
  try {
    const res = await fetch(`/api/wikipedia?${qs}`);
    data = await res.json();
  } catch { return; }
  if (!data || !data.extract) return;
  // make sure the detail panel still shows this same record
  const host = document.getElementById('wiki-section');
  if (!host || host.dataset.rec !== recKey) return;
  host.innerHTML = wikiHtml(data);
  host.hidden = false;
}

// ---- Image gallery (hero + thumbnails) + IIIF deep-zoom lightbox ------------

// Te Papa runs a public, CORS-enabled IIIF Image API. The representation/media
// id is the IIIF id; the iiifUrl field signals a IIIF service exists for it.
function iiifInfo(img) {
  return img && img.iiifUrl && img.id
    ? `https://iiif.tepapa.govt.nz/iiif/2/${img.id}/info.json`
    : null;
}

function renderGallery(images, sensitive, title) {
  if (!images.length) return '';
  const hero = images[0];
  const heroImg = `<img loading="lazy" src="${esc(hero.previewUrl || hero.thumbnailUrl)}" alt="${esc(hero.title || title)}">`;
  const heroBlock = sensitive
    ? `<div class="g-hero media sensitive" data-lb="0">${heroImg}${sensitiveOverlay()}</div>`
    : `<button class="g-hero" type="button" data-lb="0" aria-label="Zoom image"><span class="g-zoom">⤢ Zoom</span>${heroImg}</button>`;

  let thumbs = '';
  if (images.length > 1) {
    const strip = images.slice(1).map((img, k) =>
      `<button class="g-thumb${sensitive ? ' sensitive' : ''}" type="button" data-lb="${k + 1}" aria-label="View image ${k + 2}">` +
      `<img loading="lazy" src="${esc(img.thumbnailUrl)}" alt="">${sensitive ? '<span class="lthumb-warn" title="Potentially sensitive">⚠</span>' : ''}</button>`
    ).join('');
    thumbs =
      '<div class="g-strip-wrap">' +
      '<button class="g-arrow g-arrow-l" type="button" aria-label="Scroll thumbnails left" hidden>‹</button>' +
      `<div class="g-strip" data-strip>${strip}</div>` +
      '<button class="g-arrow g-arrow-r" type="button" aria-label="Scroll thumbnails right" hidden>›</button>' +
      '</div>';
  }
  const rights = (hero.rights && hero.rights.title) || '';
  const note = images.length > 1
    ? `<p class="g-count">${images.length} images · tap any to zoom</p>`
    : `<p class="g-count">Tap to zoom${rights ? ' · ' + esc(rights) : ''}</p>`;
  return `<div class="gallery" data-gallery>${heroBlock}${thumbs}${note}</div>`;
}

// Show the chevron arrows only while a scroller overflows, disable them at the
// ends, and page by ~80% of the visible width on click. Re-measures after
// layout and on resize (ResizeObserver). Shared by the detail-view image
// filmstrip and the home-page card rows; touch devices hide the arrows via CSS
// and scroll by swipe.
function attachScrollArrows(scroller, left, right) {
  if (!scroller || !left || !right) return;
  const update = () => {
    const overflow = scroller.scrollWidth > scroller.clientWidth + 4;
    left.hidden = right.hidden = !overflow;
    if (!overflow) return;
    left.disabled = scroller.scrollLeft <= 2;
    right.disabled = scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 2;
  };
  const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const page = (dir) => scroller.scrollBy({ left: dir * scroller.clientWidth * 0.8, behavior: reduce ? 'auto' : 'smooth' });
  left.addEventListener('click', () => page(-1));
  right.addEventListener('click', () => page(1));
  scroller.addEventListener('scroll', update, { passive: true });
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(update).observe(scroller);
  else window.addEventListener('resize', update);
  requestAnimationFrame(() => requestAnimationFrame(update)); // after layout
}

// Detail-view image filmstrip.
function wireGalleryStrip(container) {
  const strip = container.querySelector('[data-strip]');
  if (!strip) return;
  const wrap = strip.parentElement;
  attachScrollArrows(strip, wrap.querySelector('.g-arrow-l'), wrap.querySelector('.g-arrow-r'));
}

// Home-page card rows — the same arrows, one independent instance per shelf.
function wireShelfArrows(host) {
  host.querySelectorAll('.home-row-wrap').forEach((wrap) =>
    attachScrollArrows(
      wrap.querySelector('[data-shelf]'),
      wrap.querySelector('.home-arrow-l'),
      wrap.querySelector('.home-arrow-r')
    ));
}

// Full-screen IIIF deep-zoom lightbox (OpenSeadragon).
const lb = { images: [], i: 0, sensitive: false, revealed: false, osd: null, token: 0 };

function openLightbox(images, index, sensitive) {
  if (!images || !images.length) return;
  lb.images = images;
  lb.i = Math.max(0, Math.min(index, images.length - 1));
  lb.sensitive = !!sensitive;
  lb.revealed = false;
  document.getElementById('lightbox').hidden = false;
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', lbKey);
  const multi = images.length > 1;
  document.getElementById('lb-prev').hidden = !multi;
  document.getElementById('lb-next').hidden = !multi;
  lbShow();
}

function lbShow() {
  const img = lb.images[lb.i];
  document.getElementById('lb-counter').textContent =
    lb.images.length > 1 ? `${lb.i + 1} / ${lb.images.length}` : '';
  const rights = (img.rights && img.rights.title) || '';
  const dl = img.rights && img.rights.allowsDownload && img.contentUrl;
  document.getElementById('lb-caption').innerHTML =
    `${esc(img.title || '')}${rights ? ` <span class="lb-rights">· ${esc(rights)}</span>` : ''}` +
    (dl ? ` · <a href="${esc(img.contentUrl)}" target="_blank" rel="noopener">download ↗</a>` : '');

  const stage = document.getElementById('osd');
  const blurred = lb.sensitive && !lb.revealed;
  stage.classList.toggle('sensitive', blurred);
  document.getElementById('lb-reveal').hidden = !blurred;
  // Instant placeholder: the pre-generated preview JPEG shows immediately while
  // OpenSeadragon loads IIIF tiles. Te Papa's IIIF `full/{w},` overview scales are slow
  // on a cold cache (~3-5s); the preview (cached from the gallery hero, else ~0.9s) hides
  // that wait. Region tiles for zoom are fast.
  stage.style.backgroundImage = `url("${img.previewUrl || img.thumbnailUrl}")`;
  if (blurred) {
    // don't request hi-res tiles until revealed
    if (lb.osd) { lb.osd.destroy(); lb.osd = null; stage.innerHTML = ''; }
    return;
  }
  const tileSources = iiifInfo(img) ||
    { type: 'image', url: (img.rights && img.rights.allowsDownload && img.contentUrl) ? img.contentUrl : (img.previewUrl || img.thumbnailUrl) };
  // Reuse ONE viewer across images — open() swaps the source while keeping the zoom/pan
  // handlers alive. Destroying + recreating per image raced on the shared element and
  // broke zoom after a couple of hops.
  if (lb.osd) {
    lb.osd.open(tileSources);
    return;
  }
  // First image: create the viewer, deferred a frame so the just-shown container is laid
  // out before OSD measures it (otherwise the canvas inits at ~0px).
  const token = ++lb.token;
  requestAnimationFrame(() => {
    if (token !== lb.token || document.getElementById('lightbox').hidden) return;
    lb.osd = OpenSeadragon({
      element: stage,
      tileSources,
      prefixUrl: '',
      showNavigationControl: false,
      showSequenceControl: false,
      crossOriginPolicy: 'Anonymous',
      immediateRender: true,            // paint the sharpest available tile at once (no blur-up wait)
      blendTime: 0,
      maxImageCacheCount: 500,          // keep more tiles cached while panning/zooming
      gestureSettingsMouse: { clickToZoom: false, dblClickToZoom: true, scrollToZoom: true, flickEnabled: true },
      gestureSettingsTouch: { dblClickToZoom: true, pinchToZoom: true, flickEnabled: true },
      visibilityRatio: 1, minZoomImageRatio: 0.8, maxZoomPixelRatio: 2,
      animationTime: 0.4, springStiffness: 7,
    });
  });
}

function lbNav(d) {
  if (lb.images.length < 2) return;
  lb.i = (lb.i + d + lb.images.length) % lb.images.length;
  lbShow();
}

function lbReveal() { lb.revealed = true; lbShow(); }

function closeLightbox() {
  lb.token++;                                  // cancel any pending deferred init
  if (lb.osd) { lb.osd.destroy(); lb.osd = null; }
  const stage = document.getElementById('osd');
  stage.innerHTML = '';                        // clean slate for the next open
  stage.style.backgroundImage = '';
  document.getElementById('lightbox').hidden = true;
  document.removeEventListener('keydown', lbKey);
  // the detail dialog is still open underneath — only release scroll if it isn't
  if (el.overlay.hidden) document.body.style.overflow = '';
}

function lbKey(e) {
  if (e.key === 'Escape') { e.stopPropagation(); closeLightbox(); }
  else if (e.key === 'ArrowLeft') lbNav(-1);
  else if (e.key === 'ArrowRight') lbNav(1);
}

function openDetail(record) {
  if (!record) return;
  const title = record.title || record.prefLabel || '(untitled)';
  const images = imagesOf(record);

  const sensitive = isSensitive(record);
  const gallery = renderGallery(images, sensitive, title);

  // Outbound links — Collections Online mirrors the API href path for every
  // record type (object, agent, place, taxon, document…), so derive it from href.
  const links = [];
  const onlineUrl = collectionsOnlineUrl(record);
  if (onlineUrl) {
    links.push(`<a href="${esc(onlineUrl)}" target="_blank" rel="noopener">View on Te Papa Collections Online ↗</a>`);
  }
  if (record.href) {
    // Go through our proxy so the API key is added — the raw data.tepapa.govt.nz
    // URL returns 401 if opened directly in the browser.
    links.push(`<a href="/api/record?href=${encodeURIComponent(record.href)}" target="_blank" rel="noopener">Raw API record (JSON) ↗</a>`);
  }

  // Facts — every possible row is listed; empty ones drop out via row().
  // The fields present depend on the record type (object, person, place,
  // taxon, specimen, document, category…).
  const meta = [
    row('Type', `${esc(record.type || '')}${record.additionalType ? ' · ' + esc(asArray(record.additionalType).join(', ')) : ''}`),
    row('Collection', esc(joinText(record.collectionLabel || record.collection))),
    row('Registration', esc(record.identifier)),

    // Object
    row('Made by', productionHtml(record)),
    row('Classification', recordChips(record.isTypeOf)),
    row('Materials', recordChips(record.isMadeOf)),
    row('Materials summary', esc(record.isMadeOfSummary)),
    row('Techniques', recordChips(record.productionUsedTechnique)),
    row('Depicts', recordChips(record.depicts)),
    row('Subjects', recordChips(record.isAbout)),
    row('Dimensions', dimensionsHtml(record)),

    // Person / Organisation
    row('Born', personDates(record, 'birth')),
    row('Died', personDates(record, 'death')),
    row('Gender', esc(record.gender)),
    row('Nationality', esc(joinText(record.nationality))),
    row('Ethnicity', esc(joinText(record.ethnicity))),

    // Taxon
    row('Scientific name', record.scientificName ? `<em>${esc(record.scientificName)}</em>` : ''),
    row('Rank', esc(record.taxonRank)),
    row('Common names', vernacularHtml(record)),
    row('Taxonomy', taxonomyHtml(record)),
    row('Nomenclature', esc(record.nomenclaturalCode)),

    // Place
    row('Place type', record.placeType ? esc(String(record.placeType).split('/').pop()) : ''),
    row('Coordinates', geoHtml(record)),
    row('Also known as', esc(joinText(record.alternativeTerms))),

    // Specimen
    row('Identified as', identificationHtml(record)),
    row('Specimen type', esc(record.specimenType)),
    row('Quantity', esc(record.organismQuantity)),
    row('Collected', collectionEventHtml(record)),
    row('Institution', esc(record.institutionCode)),

    // Document / Topic / Publication
    row('Published', esc(joinText(record.publicationDate))),
    row('Publication type', esc(joinText(record.publicationType))),
    row('Purpose', esc(joinText(record.purpose))),

    // Provenance + term-hierarchy references
    row('Credit line', esc(record.creditLine)),
    row('Reference', esc(record.exactMatch)),
    row('Acknowledgement', esc(record.acknowledgement)),
    row('Rights holder', esc(record.rightsHolder)),
  ]
    .filter(Boolean)
    .join('');

  // Connections to other records — rendered as clickable chips.
  const related = [
    // Object associations
    row('Influenced by', recordChips(record.influencedBy)),
    row('Intended for', recordChips(record.intendedFor)),
    row('Former owner', recordChips(record.formerOwner)),
    row('Refers to', recordChips(record.refersTo)),
    row('Parts', recordChips(record.hasPart)),
    row('Comprises', recordChips(record.comprisesOf)),
    row('Related objects', recordChips(record.relatedObjects)),
    row('Related', recordChips(record.relation)),
    row('Referenced by', recordChips(record.isReferencedBy)),

    // Person / Document
    row('Authors', recordChips(record.authors)),

    // Term hierarchy (category / place / topic)
    row('Part of', record.isPartOf ? recordChips([record.isPartOf]) : ''),
    row('Parent', record.broaderRank ? recordChips([record.broaderRank]) : ''),
    row('Broader', recordChips(record.broaderTerms)),
    row('Narrower', recordChips(record.narrowerTerms)),
    row('Related terms', recordChips(record.relatedTerms)),
    row('Associated', recordChips(record.associatedParties)),
    row('Associated with', recordChips(record.associatedWith)),
  ]
    .filter(Boolean)
    .join('');

  const external = extLinksHtml(record);
  const caption = captionHtml(record);
  const summary = summaryHtml(record);

  el.detail.innerHTML = `
    <h2>${esc(title)}</h2>
    <div class="sub">
      <span class="badge type">${esc(record.type || '')}</span>
      ${record.scientificName ? `<span class="badge"><em>${esc(record.scientificName)}</em></span>` : ''}
      ${record.identifier ? `<span class="badge">${esc(record.identifier)}</span>` : ''}
    </div>
    ${gallery}
    ${caption}
    ${summary ? `<div class="section-title">About</div><div class="about">${summary}</div>` : ''}
    ${WIKI_TYPES.has(record.type) ? `<div id="wiki-section" class="wiki-section" data-rec="${esc(record.type + ':' + record.id)}" hidden></div>` : ''}
    ${meta ? `<div class="section-title">Details</div><dl>${meta}</dl>` : ''}
    ${related ? `<div class="section-title">Related records</div><dl>${related}</dl>` : ''}
    ${external ? `<div class="section-title">External links</div>${external}` : ''}
    ${links.length ? `<div class="links">${links.join('')}</div>` : ''}
    ${record.href ? `<button class="graph-btn" id="detail-graph-btn">🕸 Explore relationship graph</button>` : ''}
  `;

  const graphBtn = document.getElementById('detail-graph-btn');
  if (graphBtn) {
    graphBtn.addEventListener('click', () => {
      closeDetail();
      if (window.openGraph) window.openGraph(record);
    });
  }
  el.detail.querySelectorAll('.chip-link').forEach((b) => {
    b.addEventListener('click', () => openRecordByHref(b.dataset.href));
  });
  wireReveal(el.detail);
  // gallery → open the IIIF deep-zoom lightbox (reveal-btn clicks stop propagation)
  const galleryEl = el.detail.querySelector('[data-gallery]');
  if (galleryEl) {
    galleryEl.addEventListener('click', (e) => {
      const t = e.target.closest('[data-lb]');
      if (!t) return;
      openLightbox(images, Number(t.dataset.lb), sensitive);
    });
  }
  wireGalleryStrip(el.detail);
  if (WIKI_TYPES.has(record.type)) loadWikipedia(record);

  el.overlay.hidden = false;
  document.body.style.overflow = 'hidden';
  el.detail.parentElement.scrollTop = 0;
}

function closeDetail() {
  el.overlay.hidden = true;
  document.body.style.overflow = '';
}

// ---- Events -----------------------------------------------------------------

// ---- Home page (driven by /home.json — edit that file to curate) ------------
// Section types: "recent" (auto, newest images), "pool" (hand-picked objects,
// shuffled), "query" (random from a search/collection), "links" (search chips).

const shuffle = (a) => {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

async function searchRecords(body) {
  try {
    const res = await fetch('/api/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await res.json();
    return Array.isArray(data.results) ? data.results : [];
  } catch { return []; }
}
const hasImage = (r) => imagesOf(r).length > 0;

// Recently added images: newest-MODIFIED records that have an image (adding an
// image bumps a record's modified date), across the chosen types.
async function homeRecent(section) {
  const types = (section.types && section.types.length) ? section.types : ['Object'];
  const want = section.count || 12;
  const batches = await Promise.all(types.map((t) =>
    searchRecords({ query: '*', size: want * 3, filters: [{ field: 'type', keyword: t }], sort: [{ field: '_meta.modified', order: 'desc' }] })
  ));
  const seen = new Set();
  return batches.flat()
    .filter(hasImage)
    .filter((r) => { const k = `${r.type}:${r.id}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => String((b._meta || {}).modified || '').localeCompare(String((a._meta || {}).modified || '')))
    .slice(0, want);
}

// Hand-picked pool: fetch each record, shuffled, up to count.
async function homePool(section) {
  const items = shuffle([...(section.items || [])]).slice(0, section.count || 8);
  const recs = await Promise.all(items.map(async (it) => {
    const href = /^https?:/.test(it) ? it : `https://data.tepapa.govt.nz/collection/${String(it).replace(/^\/+/, '')}`;
    try {
      const r = await (await fetch(`/api/record?href=${encodeURIComponent(href)}`)).json();
      return (r && r.id) ? r : null;
    } catch { return null; }
  }));
  return recs.filter(Boolean);
}

// Random selection from a query / collection.
async function homeQuery(section) {
  const want = section.count || 10;
  const filters = section.recordType ? [{ field: 'type', keyword: section.recordType }] : undefined;
  const random = section.shuffle !== false;
  const from = random ? Math.floor(Math.random() * 150) : 0;
  let recs = (await searchRecords({ query: section.query || '*', from, size: Math.max(want * 4, 30), filters })).filter(hasImage);
  if (recs.length < want) {
    // top up from the start — some queries (e.g. a whole collection) lead with
    // image-less topics/publications, with the imaged records further in.
    const seen = new Set(recs.map((r) => `${r.type}:${r.id}`));
    for (const r of (await searchRecords({ query: section.query || '*', size: 120, filters })).filter(hasImage)) {
      const k = `${r.type}:${r.id}`;
      if (!seen.has(k)) { seen.add(k); recs.push(r); }
    }
  }
  if (random) shuffle(recs);
  return recs.slice(0, want);
}

function homeCardHtml(record, idx) {
  const img = imagesOf(record)[0];
  const title = titleOf(record);
  const sensitive = img && isSensitive(record);
  const thumb = img
    ? `<div class="thumb${sensitive ? ' sensitive' : ''}"><img loading="lazy" src="${esc(img.thumbnailUrl)}" alt="${esc(title)}">${sensitive ? sensitiveOverlay() : ''}</div>`
    : `<div class="thumb no-image"><span>No image</span></div>`;
  return `<article class="hcard" data-h="${idx}" tabindex="0">
      ${thumb}
      <div class="hcard-body">
        <div class="hcard-title">${esc(title)}</div>
        <div class="hcard-sub">${esc(record.type || '')}${record.identifier ? ' · ' + esc(record.identifier) : ''}</div>
      </div>
    </article>`;
}

function renderShelf(title, records) {
  const t = esc(title || '');
  const lbl = (dir) => (t ? `Scroll ${t} ${dir}` : `Scroll ${dir}`);
  return `<section class="home-shelf">
      <h2 class="home-shelf-title">${t}</h2>
      <div class="home-row-wrap">
        <button class="home-arrow home-arrow-l" type="button" aria-label="${lbl('left')}" hidden>‹</button>
        <div class="home-row" data-shelf>${records.map((r, i) => homeCardHtml(r, i)).join('')}</div>
        <button class="home-arrow home-arrow-r" type="button" aria-label="${lbl('right')}" hidden>›</button>
      </div>
    </section>`;
}

// Substitute {token} placeholders (e.g. live counts) in editable hero text.
function applyTokens(str, tokens) {
  return String(str).replace(/\{(\w+)\}/g, (m, k) => (tokens[k] != null ? tokens[k] : '…'));
}
function heroInner(hero, tokens) {
  const t = (s) => esc(applyTokens(s || '', tokens || {}));
  const descs = Array.isArray(hero.description) ? hero.description : (hero.description ? [hero.description] : []);
  return (hero.eyebrow ? `<div class="home-intro-eyebrow">${t(hero.eyebrow)}</div>` : '') +
    `<h1>${t(hero.title)}</h1>` +
    (hero.subtitle ? `<p class="home-hero-sub">${t(hero.subtitle)}</p>` : '') +
    descs.map((d) => `<p class="home-hero-desc">${t(d)}</p>`).join('');
}

// The hero number band — render placeholders, then fill each with a live count.
function renderStats(stats) {
  const items = stats && Array.isArray(stats.items) ? stats.items : [];
  if (!items.length) return '';
  return `<section class="home-stats" aria-label="Collection at a glance">` +
    items.map((it, i) =>
      `<div class="home-stat">` +
        `<div class="home-stat-num" data-stat="${i}" data-loading>…</div>` +
        `<div class="home-stat-label">${esc(it.label || '')}</div>` +
      `</div>`).join('') +
    `</section>`;
}
// A live record count from the API (a size:0 search → the resultset count).
async function homeCount(spec) {
  const body = { size: 0, query: (typeof spec === 'string' ? spec : (spec && spec.query) || '*') };
  if (spec && typeof spec === 'object') {
    if (Array.isArray(spec.filters)) body.filters = spec.filters;
    else if (spec.recordType) body.filters = [{ field: 'type', keyword: spec.recordType }];
  }
  try {
    const d = await (await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
    const n = (((d._metadata || {}).resultset || {}).count);
    return typeof n === 'number' ? n.toLocaleString() : null;
  } catch { return null; }
}

async function loadHome() {
  let config = null;
  try { config = await (await fetch('/home.json', { cache: 'no-store' })).json(); } catch { /* */ }
  if (!config) { el.home.innerHTML = '<div class="message">Couldn’t load the home page (home.json).</div>'; return; }

  let html = '';
  if (config.hero) {
    html += `<div class="home-intro">${heroInner(config.hero, {})}</div>`;
  }
  if (config.stats) html += renderStats(config.stats);
  const sections = Array.isArray(config.sections) ? config.sections : [];
  html += sections.map((s, i) =>
    `<div class="home-section" data-sec="${i}">${s.type === 'links' ? '' : '<div class="home-shelf"><div class="home-skeleton"></div></div>'}</div>`
  ).join('');
  el.home.innerHTML = html;

  sections.forEach(async (s, i) => {
    const host = el.home.querySelector(`[data-sec="${i}"]`);
    if (!host) return;
    if (s.type === 'links') {
      const chips = (s.items || []).map((it) =>
        `<button class="home-link" type="button" data-q="${esc(it.query || it.label)}">${esc(it.label)}</button>`).join('');
      host.innerHTML = `<section class="home-shelf"><h2 class="home-shelf-title">${esc(s.title || 'Explore')}</h2><div class="home-links">${chips}</div></section>`;
      host.querySelectorAll('.home-link').forEach((b) =>
        b.addEventListener('click', () => { el.q.value = b.dataset.q; doSearch(); }));
      return;
    }
    let records = [];
    try {
      if (s.type === 'recent') records = await homeRecent(s);
      else if (s.type === 'pool') records = await homePool(s);
      else if (s.type === 'query') records = await homeQuery(s);
    } catch { records = []; }
    if (!records.length) { host.innerHTML = ''; return; }
    host.innerHTML = renderShelf(s.title, records);
    host.querySelectorAll('[data-shelf] [data-h]').forEach((node) =>
      node.addEventListener('click', () => openDetail(records[Number(node.dataset.h)])));
    wireReveal(host);
    wireShelfArrows(host);
  });

  // Fill the stat band with live counts as each one returns.
  if (config.stats && Array.isArray(config.stats.items)) {
    config.stats.items.forEach(async (it, i) => {
      const v = await homeCount(it.count);
      const cell = el.home.querySelector(`.home-stat-num[data-stat="${i}"]`);
      if (cell) { cell.textContent = v != null ? v : '—'; cell.removeAttribute('data-loading'); }
    });
  }
}

function showHome() {
  el.home.hidden = false;
  el.results.hidden = true;
  el.toolbar.hidden = true;
  el.tabs.hidden = true;
  el.collectionBar.hidden = true;
  el.pager.hidden = true;
  if (!el.home.dataset.loaded) { el.home.dataset.loaded = '1'; loadHome(); }
}
function hideHome() {
  el.home.hidden = true;
  el.results.hidden = false;
  el.toolbar.hidden = false;
}

el.form.addEventListener('submit', (e) => {
  e.preventDefault();
  doSearch();
});

// Lightbox controls
document.getElementById('lb-close').addEventListener('click', closeLightbox);
document.getElementById('lb-prev').addEventListener('click', () => lbNav(-1));
document.getElementById('lb-next').addEventListener('click', () => lbNav(1));
document.getElementById('lb-reveal').addEventListener('click', lbReveal);
document.getElementById('lightbox').addEventListener('click', (e) => {
  if (e.target.id === 'lightbox') closeLightbox();   // click the backdrop to close
});

el.imagesOnly.addEventListener('change', renderResults);

el.sortSelect.addEventListener('change', () => {
  const opt = sortOptionsFor(state.type)[Number(el.sortSelect.value)] || [];
  state.sort = { field: opt[1] || null, order: opt[2] || null };
  if (state.query.trim()) runSearch(true);
});

function setView(view) {
  state.view = view;
  localStorage.setItem('tepapa.view', view);
  const isList = view === 'list';
  el.viewList.classList.toggle('active', isList);
  el.viewGrid.classList.toggle('active', !isList);
  el.viewList.setAttribute('aria-pressed', String(isList));
  el.viewGrid.setAttribute('aria-pressed', String(!isList));
  if (state.results.length) renderResults();
}
el.viewGrid.addEventListener('click', () => setView('grid'));
el.viewList.addEventListener('click', () => setView('list'));
setView(state.view); // reflect persisted choice in the toggle on load

el.prev.addEventListener('click', () => {
  state.from = Math.max(0, state.from - PAGE_SIZE);
  runSearch(false);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});
el.next.addEventListener('click', () => {
  state.from += PAGE_SIZE;
  runSearch(false);
  window.scrollTo({ top: 0, behavior: 'smooth' });
});

el.closeDetail.addEventListener('click', closeDetail);
el.overlay.addEventListener('click', (e) => {
  if (e.target === el.overlay) closeDetail();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !el.overlay.hidden) closeDetail();
});

// Home: clicking the brand returns to the home page; show it on first load.
el.brand.addEventListener('click', () => {
  el.q.value = '';
  state.query = '';
  showHome();
  window.scrollTo({ top: 0 });
});
showHome();
