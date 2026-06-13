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
  rights: null,          // image-rights filter: 'downloadable' | 'cc' | 'nkc' | null
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

// A rights-restricted image (allowsDownload === false) may only ever be shown at
// thumb size — no preview/full/IIIF, no zoom. Only an explicit false locks an
// image down; images with no rights flag stay zoomable.
function isZoomable(img) {
  return !(img && img.rights && img.rights.allowsDownload === false);
}

// Cards show each image at its true aspect ratio (never cropped), clamped to a
// sensible range so an extreme panorama/column doesn't make an absurdly short or
// tall card. Dimensions come from the rep's width/height metadata; falls back to
// square when they're missing. Returns a unitless string for `aspect-ratio`.
function thumbAspect(img, min = 0.6, max = 3.0) {
  const w = +(img && img.width), h = +(img && img.height);
  const ar = (w > 0 && h > 0) ? w / h : 1;
  return Math.min(max, Math.max(min, ar));
}

// Readable labels for the native Collections Online relationship fields.
// Shared by the detail view's related-records explorer and the graph (graph.js).
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
function predicateLabel(p) {
  return PREDICATE_LABELS[p] ||
    (p || '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/\./g, ' · ').toLowerCase();
}

// ---- Record-type palette + icons ---------------------------------------------
// Shared by the graph view (nodes, legend) and anywhere else that shows record
// types. Material 3-aligned; Object is the brand primary (teal #008e96) so
// focus, selection, bundles and Object icons share one hue.
const TYPE_COLORS = {
  Object: '#008e96', Person: '#ff7043', Organisation: '#ff7043',
  Place: '#43a047', Taxon: '#8e5fd9', Specimen: '#c79100',
  Category: '#5c7a99', Topic: '#d81b78', Publication: '#d81b78',
  Document: '#d81b78', Story: '#d81b78',
};
function typeColor(t) { return TYPE_COLORS[t] || '#9aa3b2'; }

// 24×24 icon markup per type. Solid shapes inherit the root SVG's fill; stroked
// (line-drawn) icons set fill='none' and stroke='__C__' — the placeholder is
// replaced with the type colour when the SVG is built.
const TYPE_ICONS = {
  Person: "<circle cx='12' cy='8' r='3.8'/><path d='M5 20c0-4 3.2-6.5 7-6.5s7 2.5 7 6.5v.6H5z'/>",
  Place: "<path d='M12 2.2a6.6 6.6 0 0 0-6.6 6.6c0 4.6 6.6 12.4 6.6 12.4s6.6-7.8 6.6-12.4A6.6 6.6 0 0 0 12 2.2z'/><circle cx='12' cy='8.8' r='2.4' fill='#fff'/>",
  // Hexagon divided into six segments — spokes from the centre to every vertex.
  Object: "<g fill='none' stroke='__C__' stroke-width='2' stroke-linejoin='round' stroke-linecap='round'>" +
    "<path d='M12 2.5 20.5 7v10L12 21.5 3.5 17V7z'/>" +
    "<path d='M12 2.5v9.5l8.5-5M12 12l8.5 5M12 12v9.5M12 12l-8.5 5M12 12 3.5 7'/></g>",
  // Cascading classification tree (à la Linnaean ranks): a root node branching
  // to children, one of which branches again. Lines are trimmed to circle edges.
  Taxon: "<g fill='none' stroke='__C__' stroke-width='2' stroke-linejoin='round' stroke-linecap='round'>" +
    "<path d='M10.9 5.6 7.6 10.4M13.1 5.6l3.3 4.8M5.8 13.8l-1.6 4.4M7.2 13.8l1.6 4.4'/>" +
    "<circle cx='12' cy='4' r='1.9'/><circle cx='6.5' cy='12' r='1.9'/><circle cx='17.5' cy='12' r='1.9'/>" +
    "<circle cx='3.5' cy='20' r='1.9'/><circle cx='9.5' cy='20' r='1.9'/></g>",
  // Natural-history specimen: a foraging kiwi — high rounded back, small head,
  // long decurved beak probing toward a leaf on the ground (the flora half of
  // the collections). Legs are bent with flat feet, after the user's reference.
  // The eye dot sits outside the stroked group so it inherits the root fill.
  Specimen: "<g fill='none' stroke='__C__' stroke-width='2' stroke-linejoin='round' stroke-linecap='round'>" +
    "<path d='M8.7 9.5 C9 7.9 10 7 11.3 6.9 C13.6 5.9 17.8 6.3 20.3 8.7 C22.3 10.7 22.4 13.8 20.8 15.9 C19.5 17.7 17.4 18.6 15.5 18.2 C13.2 17.7 11 15.8 9.8 13.4 C9.1 12.1 8.8 10.8 8.7 9.5Z'/>" +
    "<path d='M8.9 9.8 Q5.9 11.3 4.1 16.2'/>" +
    "<path d='M14.9 18.4 13.9 21.4h-2.4M16.9 18.2 16.3 21.7h-2.4'/>" +
    "<path d='M2.5 20.8 C3 18.6 5.7 17.8 7.7 19.1 C7.1 21.3 4.3 22 2.5 20.8Z M3.5 20.4 Q5 19.8 6.6 19.5'/></g>" +
    "<circle cx='10' cy='8.6' r='.65'/>",
  Category: "<path d='M3.2 11.8 11.8 3.2H21v9.2l-8.6 8.6z'/><circle cx='16.4' cy='7.6' r='1.5' fill='#fff'/>",
  Document: "<path d='M6.5 2.5h7L18 7v14.5H6.5z'/><path d='M13.5 2.5V7H18z' fill='#fff'/>",
  _default: "<circle cx='12' cy='12' r='6.5'/>",
};
const TYPE_ICON_ALIAS = { Organisation: 'Person', Topic: 'Document', Publication: 'Document', Story: 'Document' };
const typeIconCache = {};
// Data-URI SVG for a type icon. `pad` units of space around the 24×24 icon —
// circular hosts (graph nodes) need generous padding, square swatches almost none.
function typeIconUri(type, pad) {
  const ck = `${type}|${pad}`;
  if (typeIconCache[ck]) return typeIconCache[ck];
  const key = TYPE_ICONS[type] ? type : (TYPE_ICON_ALIAS[type] || '_default');
  const size = 24 + 2 * pad;
  const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='${size}' height='${size}' viewBox='${-pad} ${-pad} ${size} ${size}' fill='${typeColor(type)}'>` +
    TYPE_ICONS[key].replace(/__C__/g, typeColor(type)) + `</svg>`;
  return (typeIconCache[ck] = 'data:image/svg+xml;utf8,' + encodeURIComponent(svg));
}

// Small inline type icon (type-coloured) for badges, tabs and card subtitles.
function typeIconHtml(type, size = 16) {
  if (!type || type === 'all') return '';
  return `<img class="type-icon" src="${typeIconUri(type, 1)}" width="${size}" height="${size}" alt="">`;
}

// Imageless cards show a large, muted type icon as the placeholder.
function noImageThumbHtml(type, size = 64) {
  return `<div class="thumb no-image"><img class="type-icon-ph" src="${typeIconUri(type || '_default', 2)}" width="${size}" height="${size}" alt="No image"></div>`;
}

// ---- List-thumb edge extension --------------------------------------------------
// List thumbs are contain-fitted into a square, leaving letterbox bands. Compose
// a square version on a canvas where the bands are the image's own outermost
// pixel row/column stretched outward — every band pixel exactly continues the
// adjacent image pixel, so flat, gradient and vignetted backdrops all blend
// seamlessly. Te Papa media has no CORS headers (canvas would taint), so bytes
// come via our /api/imgproxy. Composites cache per URL as data URLs.
const edgeThumbCache = new Map();   // thumbnailUrl → Promise<dataURL | null>

function edgeExtendedThumb(url) {
  if (!url || !/^https:\/\/media\.tepapa\.govt\.nz\//.test(url)) return Promise.resolve(null);
  if (edgeThumbCache.has(url)) return edgeThumbCache.get(url);
  const p = (async () => {
    const res = await fetch('/api/imgproxy?url=' + encodeURIComponent(url));
    if (!res.ok) return null;
    const bmp = await createImageBitmap(await res.blob());
    const S = 80;   // 2× the 40px box for retina
    const cv = document.createElement('canvas');
    cv.width = S; cv.height = S;
    const cx = cv.getContext('2d');
    if (bmp.width >= bmp.height) {
      // landscape: fills the width; stretch the top/bottom pixel rows into the bands
      const dh = Math.max(1, Math.round((S * bmp.height) / bmp.width));
      const oy = Math.round((S - dh) / 2);
      if (oy > 0) {
        cx.drawImage(bmp, 0, 0, bmp.width, 1, 0, 0, S, oy);
        cx.drawImage(bmp, 0, bmp.height - 1, bmp.width, 1, 0, oy + dh, S, S - oy - dh);
      }
      cx.drawImage(bmp, 0, oy, S, dh);
    } else {
      // portrait: fills the height; stretch the left/right pixel columns
      const dw = Math.max(1, Math.round((S * bmp.width) / bmp.height));
      const ox = Math.round((S - dw) / 2);
      if (ox > 0) {
        cx.drawImage(bmp, 0, 0, 1, bmp.height, 0, 0, ox, S);
        cx.drawImage(bmp, bmp.width - 1, 0, 1, bmp.height, ox + dw, 0, S - ox - dw, S);
      }
      cx.drawImage(bmp, ox, 0, dw, S);
    }
    return cv.toDataURL('image/jpeg', 0.92);
  })().catch(() => null);
  edgeThumbCache.set(url, p);
  return p;
}

function listThumbHtml(url, sensitive) {
  const warn = sensitive ? '<span class="lthumb-warn" title="Potentially sensitive image">⚠</span>' : '';
  return `<span class="lthumb${sensitive ? ' sensitive' : ''}">` +
    `<img loading="lazy" src="${esc(url)}" data-thumb alt="">${warn}</span>`;
}

// Swap freshly rendered list thumbs for their edge-extended composites.
function extendListThumbEdges() {
  el.results.querySelectorAll('.list .col-thumb img[data-thumb]').forEach((img) => {
    const url = img.getAttribute('src');
    img.removeAttribute('data-thumb');
    edgeExtendedThumb(url).then((d) => { if (d && img.isConnected) img.src = d; });
  });
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
  el.results.className = 'grid';
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
      `${typeIconHtml(t, 18)}${esc(typeLabel(t))} <span class="tab-count">${n.toLocaleString()}</span></button>`
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

// Image-rights filters fold into the query string (the filters array can't OR,
// and `rights.title` only matches via query-string field syntax — all three
// clauses verified against the live API). Each means "has ≥1 image with that rights".
const RIGHTS_CLAUSES = {
  downloadable: 'hasRepresentation.rights.allowsDownload:true',
  cc: 'hasRepresentation.rights.type:"Licence"',                              // Te Papa's Licence rights are the CC ones
  nkc: 'hasRepresentation.rights.title:"No Known Copyright Restrictions"',
};

// Fold the selected collections and image-rights filter into the query.
function effectiveQuery() {
  let q = state.query;
  if (state.collections.length && COLLECTION_TYPES.has(state.type)) {
    const clause = state.collections.map((c) => `collection:"${c}"`).join(' OR ');
    q = `(${q}) AND (${clause})`;
  }
  if (state.rights && RIGHTS_CLAUSES[state.rights]) {
    q = `(${q}) AND ${RIGHTS_CLAUSES[state.rights]}`;
  }
  return q;
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

  el.results.className = 'grid';
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
    extendListThumbEdges();   // fill letterbox bands with each image's own edge pixels
  } else {
    el.results.className = 'grid masonry';
    el.results.innerHTML = items.map(cardHtml).join('');
    wireRowClicks();
    wireMasonryResize();
    requestAnimationFrame(layoutGridMasonry);
  }

  enhanceAgentThumbs();   // people/orgs: borrow an image from a related object that depicts them

  // Pager
  const start = state.from + 1;
  const end = Math.min(state.from + PAGE_SIZE, state.total);
  el.pageInfo.textContent = `${start.toLocaleString()}–${end.toLocaleString()} of ${state.total.toLocaleString()}`;
  el.prev.disabled = state.from === 0;
  el.next.disabled = end >= state.total;
  el.pager.hidden = false;
}

// The image grid is masonry: each card keeps its image's aspect ratio, so card
// heights vary. Assign every card a grid row-span from its measured height to
// pack the columns gap-free while preserving result (relevance) order. Thumb
// heights come from CSS aspect-ratio, so this needn't wait on image loads;
// recomputed on resize. Only the card grid (`.grid.masonry`) is packed — not the
// list view or message/spinner states.
function layoutGridMasonry() {
  const grid = el.results;
  if (!grid || !grid.classList.contains('masonry')) return;
  const unit = parseFloat(getComputedStyle(grid).gridAutoRows) || 4;
  grid.querySelectorAll('.card').forEach((card) => {
    const h = card.getBoundingClientRect().height;
    card.style.gridRowEnd = 'span ' + Math.max(1, Math.ceil((h + 16) / unit));
  });
}

let masonryResizeWired = false;
function wireMasonryResize() {
  if (masonryResizeWired) return;
  masonryResizeWired = true;
  let raf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(layoutGridMasonry);
  });
}

// People & organisations rarely have their own image. After rendering, find a
// related object that depicts each agent (reverse `depicts.id` lookup, limited to
// imaged objects) and swap its thumbnail into the card/row. Progressive: the
// placeholder shows first, images fill in as the lookups resolve.
const AGENT_TYPES = new Set(['Person', 'Organisation']);

// Memoised per record: a Promise of {thumbnailUrl,width,height,sensitive} | null.
function agentDepictImage(record) {
  if (!record._depictImg) {
    record._depictImg = searchRecords({
      filters: [
        { field: 'depicts.id', keyword: String(record.id) },
        { field: 'hasRepresentation.type', keyword: 'ImageObject' },
      ],
      size: 1,
    }).then((objs) => {
      const obj = objs[0];
      const rep = obj && imagesOf(obj)[0];   // full ImageObject (thumb/preview/full/iiif/rights)
      return rep ? { rep, sensitive: isSensitive(obj) } : null;
    }).catch(() => null);
  }
  return record._depictImg;
}

function applyAgentThumb(node, d) {
  const rep = d.rep;
  const gridThumb = node.querySelector('.thumb.no-image');
  if (gridThumb) {
    gridThumb.className = 'thumb' + (d.sensitive ? ' sensitive' : '');
    gridThumb.style.aspectRatio = thumbAspect(rep);
    gridThumb.innerHTML = `<img loading="lazy" src="${esc(rep.thumbnailUrl)}" alt="">` + (d.sensitive ? sensitiveOverlay() : '');
    if (d.sensitive) wireReveal(gridThumb);
    requestAnimationFrame(layoutGridMasonry);   // card height changed
    return;
  }
  const cell = node.querySelector('.col-thumb');
  if (cell) {
    cell.innerHTML = listThumbHtml(rep.thumbnailUrl, d.sensitive);
    if (d.sensitive) wireReveal(cell);
    extendListThumbEdges();
  }
}

// Fill in depicting-object images for the person/org cards/rows currently on screen.
function enhanceAgentThumbs() {
  el.results.querySelectorAll('[data-i]').forEach((node) => {
    const i = Number(node.dataset.i);
    const rec = state.results[i];
    if (!rec || !AGENT_TYPES.has(rec.type) || imagesOf(rec).length) return;
    agentDepictImage(rec).then((d) => {
      if (!d || state.results[i] !== rec) return;   // results changed under us — don't cross-wire
      const cur = el.results.querySelector(`[data-i="${i}"]`);
      if (cur) applyAgentThumb(cur, d);
    });
  });
}

function cardHtml(record) {
  const i = state.results.indexOf(record);
  const img = imagesOf(record)[0];
  const title = titleOf(record);
  const sensitive = img && isSensitive(record);
  const thumb = img
    ? `<div class="thumb${sensitive ? ' sensitive' : ''}" style="aspect-ratio:${thumbAspect(img)}"><img loading="lazy" src="${esc(img.thumbnailUrl)}" alt="${esc(title)}">${sensitive ? sensitiveOverlay() : ''}</div>`
    : noImageThumbHtml(record.type, 64);
  const sub = summaryOf(record); // type-appropriate secondary line
  return `
    <article class="card" data-i="${i}" tabindex="0">
      ${thumb}
      <button class="result-graph" title="Explore relationship graph" aria-label="Explore relationship graph">🕸</button>
      <div class="card-body">
        <div class="card-title">${esc(title)}</div>
        ${sub ? `<div class="card-sub">${esc(sub)}</div>` : ''}
        <div class="card-meta">
          <span class="badge type">${typeIconHtml(record.type)}${esc(record.type || '')}</span>
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
        ? listThumbHtml(img.thumbnailUrl, isSensitive(record))
        : `<span class="ph"></span>`;
      const cells = cols
        .map((c) => {
          const raw = c[1](record);
          const val = raw == null || raw === '' ? '—' : esc(raw);
          const inner = c[2].includes('col-sci') && raw ? `<em>${val}</em>`
            : c[2].includes('col-type') && raw ? `${typeIconHtml(raw)}${val}`   // the All tab's Type column
            : val;
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

// The hero's licence/rights label for the gallery caption. When the API marks it
// as a Creative Commons licence (rights.type 'Licence' with a canonical
// creativecommons.org iri), link to that deed; otherwise plain text. Non-CC
// statements (All Rights Reserved, No Known Copyright Restrictions) carry no iri
// and stay as text. Returns pre-escaped HTML.
function rightsLabel(img) {
  const r = img && img.rights;
  if (!r || !r.title) return '';
  const cc = r.type === 'Licence' && typeof r.iri === 'string' &&
    /^https?:\/\/creativecommons\.org\//.test(r.iri);
  return cc
    ? `<a href="${esc(r.iri)}" target="_blank" rel="license noopener">${esc(r.title)} ↗</a>`
    : esc(r.title);
}

// The lightbox shows only the zoomable (downloadable) subset; data-lb indexes
// into it. Restricted images never get a data-lb, so they never open the viewer.
function lbIndexOf(images, i) {
  return isZoomable(images[i]) ? images.slice(0, i).filter(isZoomable).length : null;
}

// Hero block for images[i]. Restricted: thumbnail at natural size, no zoom.
// Zoomable: preview image with the zoom affordance (data-lb → lightbox).
// Reveals in place when the record is sensitive.
function heroBlockHtml(images, i, sensitive, title) {
  const img = images[i];
  const lb = lbIndexOf(images, i);
  if (lb === null) {
    const heroImg = `<img loading="lazy" src="${esc(img.thumbnailUrl)}" alt="${esc(img.title || title)}">`;
    return `<div class="g-hero g-hero-static media${sensitive ? ' sensitive' : ''}">${heroImg}${sensitive ? sensitiveOverlay() : ''}</div>`;
  }
  const heroImg = `<img loading="lazy" src="${esc(img.previewUrl || img.thumbnailUrl)}" alt="${esc(img.title || title)}">`;
  return sensitive
    ? `<div class="g-hero media sensitive" data-lb="${lb}">${heroImg}${sensitiveOverlay()}</div>`
    : `<button class="g-hero" type="button" data-lb="${lb}" aria-label="Zoom image"><span class="g-zoom">⤢ Zoom</span>${heroImg}</button>`;
}

// Caption line under the gallery, for the image currently shown as the hero.
function galleryNoteHtml(images, heroI) {
  const rights = rightsLabel(images[heroI]);   // pre-escaped; a CC deed link when applicable
  const heroZoom = isZoomable(images[heroI]);
  const swapMode = images.length > 1 && images.some((im) => !isZoomable(im));
  const parts = [];
  if (images.length > 1) parts.push(`${images.length} images`);
  if (heroZoom) parts.push(images.length > 1 && !swapMode ? 'tap any to zoom' : 'tap to zoom');
  if (rights) parts.push(rights);
  return parts.length ? `<p class="g-count">${parts.join(' · ')}</p>` : '';
}

function renderGallery(images, sensitive, title) {
  if (!images.length) return '';
  // Records with any rights-restricted image use "swap mode": every image gets a
  // filmstrip thumb (including the first) and tapping one swaps it into the hero
  // slot — so restricted images stay viewable (at thumb size, no zoom) instead of
  // being unselectable. Fully-zoomable records keep the classic behaviour:
  // strip = the rest of the images, any tap opens the deep-zoom lightbox.
  const swapMode = images.length > 1 && images.some((im) => !isZoomable(im));
  const heroBlock = heroBlockHtml(images, 0, sensitive, title);

  let thumbs = '';
  if (images.length > 1) {
    const strip = images.map((img, i) => {
      if (!swapMode && i === 0) return '';   // classic mode: hero isn't repeated in the strip
      const inner =
        `<img loading="lazy" src="${esc(img.thumbnailUrl)}" alt="">` +
        (sensitive ? '<span class="lthumb-warn" title="Potentially sensitive">⚠</span>' : '');
      return swapMode
        ? `<button class="g-thumb${i === 0 ? ' current' : ''}${sensitive ? ' sensitive' : ''}" type="button" data-hero="${i}"${i === 0 ? ' aria-current="true"' : ''} aria-label="Show image ${i + 1}">${inner}</button>`
        : `<button class="g-thumb${sensitive ? ' sensitive' : ''}" type="button" data-lb="${lbIndexOf(images, i)}" aria-label="View image ${i + 1}">${inner}</button>`;
    }).join('');
    thumbs =
      '<div class="g-strip-wrap">' +
      '<button class="g-arrow g-arrow-l" type="button" aria-label="Scroll thumbnails left" hidden>‹</button>' +
      `<div class="g-strip" data-strip>${strip}</div>` +
      '<button class="g-arrow g-arrow-r" type="button" aria-label="Scroll thumbnails right" hidden>›</button>' +
      '</div>';
  }
  return `<div class="gallery" data-gallery>${heroBlock}${thumbs}${galleryNoteHtml(images, 0)}</div>`;
}

// Swap images[i] into the hero slot (swap-mode strips). Keeps the sensitive
// reveal state, refreshes the caption, and moves the current-thumb marker.
function swapGalleryHero(galleryEl, images, i, sensitive, title) {
  const hero = galleryEl.querySelector('.g-hero');
  if (!hero || !images[i]) return;
  const revealed = hero.classList.contains('revealed');
  hero.outerHTML = heroBlockHtml(images, i, sensitive, title);
  const fresh = galleryEl.querySelector('.g-hero');
  if (revealed) fresh.classList.add('revealed');
  const note = galleryEl.querySelector('.g-count');
  const newNote = galleryNoteHtml(images, i);
  if (note && newNote) note.outerHTML = newNote;
  else if (note) note.remove();
  else if (newNote) galleryEl.insertAdjacentHTML('beforeend', newNote);
  galleryEl.querySelectorAll('[data-hero]').forEach((b) => {
    const on = Number(b.dataset.hero) === i;
    b.classList.toggle('current', on);
    if (on) b.setAttribute('aria-current', 'true');
    else b.removeAttribute('aria-current');
  });
  wireReveal(fresh);   // the rebuilt overlay's reveal button
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

// Wire the detail-view gallery: swap-mode thumbs (data-hero) swap the hero in
// place; zoomable elements (data-lb) open the lightbox over the downloadable
// subset; plus the filmstrip arrows. Shared by the initial render and the async
// agent (depicts) image injection.
function wireDetailGallery(galleryImages, gallerySensitive, galleryTitle) {
  const galleryEl = el.detail.querySelector('[data-gallery]');
  if (galleryEl) {
    const zoomImages = galleryImages.filter(isZoomable);
    galleryEl.addEventListener('click', (e) => {
      const hs = e.target.closest('[data-hero]');
      if (hs) {
        swapGalleryHero(galleryEl, galleryImages, Number(hs.dataset.hero), gallerySensitive, galleryTitle);
        return;
      }
      const t = e.target.closest('[data-lb]');
      if (!t) return;
      openLightbox(zoomImages, Number(t.dataset.lb), gallerySensitive);
    });
  }
  wireGalleryStrip(el.detail);
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

// ---- Related-records explorer (detail view) ---------------------------------
// One chip per relationship type (from /api/neighbors bundles, same data as the
// graph), and ONE carousel below showing that relationship's records — swapped
// when a chip is selected. Forward bundles carry members inline; reverse ones
// page via a `<predicate>.id` search. Members cache on the bundle per detail open.
const REL_PAGE = 12;

function relMembers(b, from, size) {
  if (b.mode === 'inline') {
    return Promise.resolve((b.members || []).slice(from, from + size).map((m) => ({
      type: m.type, title: m.title || '(untitled)', href: m.href,
      thumb: m.thumb || null, w: 0, h: 0, sensitive: false,   // server nulls sensitive thumbs
    })));
  }
  return searchRecords({
    query: '*', from, size,
    filters: [{ field: `${b.predicate}.id`, keyword: b.focusId }],
  }).then((recs) => recs.map((r) => {
    const img = imagesOf(r)[0];
    return {
      type: r.type, title: r.title || r.prefLabel || '(untitled)', href: r.href,
      thumb: img ? img.thumbnailUrl : null,
      w: img ? +img.width || 0 : 0, h: img ? +img.height || 0 : 0,
      sensitive: img ? isSensitive(r) : false,
    };
  }));
}

function relCardHtml(m) {
  const w = m.thumb ? Math.round(thumbAspect({ width: m.w, height: m.h }, 0.75, 3.0) * 120) : 120;
  const thumb = m.thumb
    ? `<div class="thumb${m.sensitive ? ' sensitive' : ''}"><img loading="lazy" src="${esc(m.thumb)}" alt="">${m.sensitive ? sensitiveOverlay() : ''}</div>`
    : noImageThumbHtml(m.type, 40);
  return `<article class="hcard rcard" data-relhref="${esc(m.href || '')}" tabindex="0" style="width:${w}px">
      ${thumb}
      <div class="hcard-body">
        <div class="hcard-title">${esc(m.title)}</div>
        <div class="hcard-sub">${typeIconHtml(m.type, 15)}${esc(m.type || '')}</div>
      </div>
    </article>`;
}

function renderRelRow(b, row, recKey) {
  const more = b._members.length < b.count;
  row.innerHTML = b._members.map(relCardHtml).join('') +
    (more
      ? `<button class="rcard-more" type="button" data-relmore>Show more<span>${b._members.length} of ${b.count.toLocaleString()}</span></button>`
      : '');
  wireReveal(row);   // reveal-btn clicks stop propagation, so they don't open the record
  row.querySelectorAll('[data-relhref]').forEach((card) => {
    card.addEventListener('click', () => { if (card.dataset.relhref) openRecordByHref(card.dataset.relhref); });
  });
  const moreBtn = row.querySelector('[data-relmore]');
  if (moreBtn) {
    moreBtn.addEventListener('click', async () => {
      moreBtn.disabled = true;
      const key = row.dataset.pred;
      const next = await relMembers(b, b._members.length, REL_PAGE);
      if (el.detail.dataset.rec !== recKey || row.dataset.pred !== key || !row.isConnected) return;
      b._members = b._members.concat(next);
      renderRelRow(b, row, recKey);
    });
  }
  row.dispatchEvent(new Event('scroll'));   // refresh the chevron-arrow state
}

async function showRelBundle(b, row, recKey) {
  const key = `${b.predicate}|${b.mode}`;
  row.dataset.pred = key;
  if (!b._members) {
    row.innerHTML = '<div class="spinner"><div></div></div>';
    const first = await relMembers(b, 0, REL_PAGE);
    // bail if another chip or another record's detail took over while loading
    if (el.detail.dataset.rec !== recKey || row.dataset.pred !== key || !row.isConnected) return;
    b._members = first;
  }
  renderRelRow(b, row, recKey);
}

async function loadRelExplorer(record) {
  const host = document.getElementById('rel-explorer');
  if (!host || !record.href) return;
  const recKey = record.type + ':' + record.id;
  let data;
  try {
    const res = await fetch('/api/neighbors', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ href: record.href }),
    });
    data = await res.json();
  } catch { return; }
  if (el.detail.dataset.rec !== recKey || !host.isConnected) return;
  const bundles = (data && Array.isArray(data.bundles) ? data.bundles : []).filter((b) => b.count > 0);
  if (!bundles.length) return;

  const title = document.getElementById('rel-title');
  if (title) title.hidden = false;
  host.hidden = false;
  // Chips keep the record's field order; default-select the largest bundle —
  // usually the visual one (a person's works, a material's objects, an album's parts).
  const def = bundles.reduce((m, b, i) => (b.count > bundles[m].count ? i : m), 0);
  host.innerHTML =
    `<div class="rel-chips">` +
    bundles.map((b, i) =>
      `<button type="button" class="cchip rel-chip${i === def ? ' active' : ''}" data-b="${i}">` +
      `${esc(predicateLabel(b.predicate))}<span class="cchip-count">${b.count.toLocaleString()}</span></button>`
    ).join('') +
    `</div>` +
    `<div class="rel-row-wrap">` +
    `<button class="home-arrow rel-arrow-l" type="button" aria-label="Scroll related records left" hidden>‹</button>` +
    `<div class="rel-row" data-relrow></div>` +
    `<button class="home-arrow rel-arrow-r" type="button" aria-label="Scroll related records right" hidden>›</button>` +
    `</div>`;
  const row = host.querySelector('[data-relrow]');
  attachScrollArrows(row, host.querySelector('.rel-arrow-l'), host.querySelector('.rel-arrow-r'));
  const chips = [...host.querySelectorAll('.rel-chip')];
  chips.forEach((chip) => {
    chip.addEventListener('click', () => {
      chips.forEach((c) => c.classList.toggle('active', c === chip));
      showRelBundle(bundles[Number(chip.dataset.b)], row, recKey);
    });
  });
  showRelBundle(bundles[def], row, recKey);
}

function openDetail(record) {
  if (!record) return;
  const title = record.title || record.prefLabel || '(untitled)';
  const images = imagesOf(record);

  const sensitive = isSensitive(record);
  const gallery = renderGallery(images, sensitive, title);
  // People/orgs have no own image — leave a slot to inject one from a related
  // object that depicts them (resolved below; same lookup as the grid/list cards).
  const agentNoImage = AGENT_TYPES.has(record.type) && !images.length;

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

  // Key the open record on the panel itself — async fills (agent hero, related
  // explorer, Wikipedia) check it so a late response can't land on the wrong record.
  el.detail.dataset.rec = record.type + ':' + record.id;

  el.detail.innerHTML = `
    <h2>${esc(title)}</h2>
    <div class="sub">
      <span class="badge type">${typeIconHtml(record.type)}${esc(record.type || '')}</span>
      ${record.scientificName ? `<span class="badge"><em>${esc(record.scientificName)}</em></span>` : ''}
      ${record.identifier ? `<span class="badge">${esc(record.identifier)}</span>` : ''}
    </div>
    ${gallery}${agentNoImage ? '<div data-agent-gallery></div>' : ''}
    ${caption}
    ${summary ? `<div class="section-title">About</div><div class="about">${summary}</div>` : ''}
    ${WIKI_TYPES.has(record.type) ? `<div id="wiki-section" class="wiki-section" data-rec="${esc(record.type + ':' + record.id)}" hidden></div>` : ''}
    ${meta ? `<div class="section-title">Details</div><dl>${meta}</dl>` : ''}
    <div class="section-title" id="rel-title"${related ? '' : ' hidden'}>Related records</div>
    <div id="rel-explorer" hidden></div>
    ${related ? `<dl>${related}</dl>` : ''}
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
  wireDetailGallery(images, sensitive, title);
  loadRelExplorer(record);   // relationship chips + carousel (async, race-guarded)
  // People/orgs: borrow the hero from a related object that depicts them.
  if (agentNoImage) {
    const recKey = el.detail.dataset.rec;
    agentDepictImage(record).then((d) => {
      if (!d || el.detail.dataset.rec !== recKey) return;   // detail changed under us
      const slot = el.detail.querySelector('[data-agent-gallery]');
      if (!slot || slot.firstChild) return;
      slot.innerHTML = renderGallery([d.rep], d.sensitive, title);
      wireReveal(slot);
      wireDetailGallery([d.rep], d.sensitive, title);
    });
  }
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
  // Sample a random window from across the result set (the API caps deep paging at
  // from + size <= 10000) so the selection genuinely varies between visits instead
  // of always drawing from the first page.
  const size = Math.max(want * 4, 30);
  const from = random ? Math.floor(Math.random() * Math.max(0, 10000 - size)) : 0;
  let recs = (await searchRecords({ query: section.query || '*', from, size, filters })).filter(hasImage);
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
  // Width tracks the (clamped) image aspect at the fixed 176px thumb height and
  // goes on the CARD, so the thumb fills it and the title wraps to the card width
  // instead of stretching it. The 176 must match `.hcard .thumb` height in CSS.
  const w = img ? Math.round(thumbAspect(img, 0.75, 3.0) * 176) : 176;
  const thumb = img
    ? `<div class="thumb${sensitive ? ' sensitive' : ''}"><img loading="lazy" src="${esc(img.thumbnailUrl)}" alt="${esc(title)}">${sensitive ? sensitiveOverlay() : ''}</div>`
    : noImageThumbHtml(record.type, 56);
  return `<article class="hcard" data-h="${idx}" tabindex="0" style="width:${w}px">
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

// One category link: label + a live count, or a hover arrow for curated lists.
function catButtonHtml(label, query, count) {
  return `<button class="home-cat" type="button" data-q="${esc(query)}">` +
    `<span class="home-cat-label">${esc(label)}</span>` +
    (count != null
      ? `<span class="home-cat-count">${Number(count).toLocaleString()}</span>`
      : `<span class="home-cat-arrow" aria-hidden="true">›</span>`) +
  `</button>`;
}
// A list of collection buttons from {token, count} entries.
function catListHtml(cols, showCount) {
  return cols.map((c) =>
    catButtonHtml(collectionLabel(c.token), `collection:"${c.token}"`, showCount ? c.count : null)).join('');
}

// Category links beside the intro. Either a curated `items` list, or
// `source: "collections"` to auto-list every collection (filled in async).
function categoriesInner(cats) {
  if (!cats) return '';
  const items = Array.isArray(cats.items) ? cats.items : null;
  const auto = !items && cats.source === 'collections';
  if (!items && !auto) return '';
  const title = cats.title || 'Browse';
  const grouped = auto && Array.isArray(cats.groups) && cats.groups.length;
  const body = items ? items.map((c) => catButtonHtml(c.label, c.query || c.label)).join('') : '';
  return `<div class="home-cats-title">${esc(title)}</div>` +
    `<nav class="home-cats${auto ? ' home-cats-auto' : ''}${grouped ? ' home-cats-grouped' : ''}" aria-label="${esc(title)}">${body}</nav>`;
}

// The full collection list, from the live `collection` facet (deduped by case).
async function fetchCollectionFacet() {
  try {
    const d = await (await fetch('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '*', size: 0, facets: [{ field: 'collection', size: 80 }] }) })).json();
    const facet = (d.facets && d.facets.collection) || {};
    const pairs = Array.isArray(facet)
      ? facet.map((x) => [x.key || x.value || x.label, x.count != null ? x.count : x.doc_count])
      : Object.entries(facet);
    const byLower = new Map();           // merge case-variant duplicates, keep the larger
    for (const [token, count] of pairs) {
      if (!token) continue;
      const k = String(token).toLowerCase();
      const prev = byLower.get(k);
      if (!prev || count > prev.count) byLower.set(k, { token, count });
    }
    return [...byLower.values()];
  } catch { return []; }
}

async function fillCollectionCats(navEl, cats) {
  cats = cats || {};
  const min = Number(cats.min) || 0;
  const showCount = cats.showCounts !== false;
  const byName = cats.sort === 'name';
  const sortCols = (arr) => arr.sort((a, b) =>
    byName ? collectionLabel(a.token).localeCompare(collectionLabel(b.token)) : b.count - a.count);

  const cols = (await fetchCollectionFacet()).filter((c) => c.count >= min);
  if (!cols.length) { navEl.innerHTML = ''; return; }

  if (Array.isArray(cats.groups) && cats.groups.length) {
    // Split into the configured type-columns; any collection not listed in a
    // group joins the last one, so nothing silently disappears.
    const byToken = new Map(cols.map((c) => [String(c.token).toLowerCase(), c]));
    const used = new Set();
    const groups = cats.groups.map((g) => {
      const list = [];
      for (const t of (g.collections || [])) {
        const c = byToken.get(String(t).toLowerCase());
        if (c && !used.has(c.token)) { used.add(c.token); list.push(c); }
      }
      return { title: g.title || '', cols: list };
    });
    const leftover = cols.filter((c) => !used.has(c.token));
    if (leftover.length && groups.length) groups[groups.length - 1].cols.push(...leftover);
    navEl.innerHTML = `<div class="home-cat-groups">` +
      groups.filter((g) => g.cols.length).map((g) =>
        `<div class="home-cat-group">` +
          (g.title ? `<div class="home-cat-group-title">${esc(g.title)}</div>` : '') +
          `<div class="home-cat-list">${catListHtml(sortCols(g.cols), showCount)}</div>` +
        `</div>`).join('') +
      `</div>`;
  } else {
    navEl.innerHTML = catListHtml(sortCols(cols), showCount);
  }
  navEl.querySelectorAll('.home-cat').forEach((b) =>
    b.addEventListener('click', () => { el.q.value = b.dataset.q; doSearch(); }));
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
  const hasCats = config.categories &&
    ((Array.isArray(config.categories.items) && config.categories.items.length) ||
     config.categories.source === 'collections');
  if (config.hero || hasCats) {
    html += `<div class="home-intro${hasCats ? ' has-cats' : ''}">` +
      `<div class="home-intro-text">${config.hero ? heroInner(config.hero, {}) : ''}</div>` +
      (hasCats ? `<div class="home-intro-cats">${categoriesInner(config.categories)}</div>` : '') +
      `</div>`;
  }
  if (config.stats) html += renderStats(config.stats);
  const sections = Array.isArray(config.sections) ? config.sections : [];
  html += sections.map((s, i) =>
    `<div class="home-section" data-sec="${i}">${s.type === 'links' ? '' : '<div class="home-shelf"><div class="home-skeleton"></div></div>'}</div>`
  ).join('');
  el.home.innerHTML = html;

  // Intro category links → run the search. A "collections" rail fills in async.
  el.home.querySelectorAll('.home-cat').forEach((b) =>
    b.addEventListener('click', () => { el.q.value = b.dataset.q; doSearch(); }));
  const autoCats = el.home.querySelector('.home-cats-auto');
  if (autoCats) fillCollectionCats(autoCats, config.categories);

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

// Image-rights chips: single-select (the categories overlap — downloadable
// includes both CC and no-known-copyright); clicking the active chip clears it.
document.querySelectorAll('#rights-filter .cchip').forEach((chip) => {
  chip.addEventListener('click', () => {
    state.rights = state.rights === chip.dataset.rights ? null : chip.dataset.rights;
    document.querySelectorAll('#rights-filter .cchip').forEach((c) => {
      const on = c.dataset.rights === state.rights;
      c.classList.toggle('active', on);
      c.setAttribute('aria-pressed', String(on));
    });
    if (state.query.trim()) runSearch(true);
  });
});

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

// Home: clicking the brand (top bar, or the logo in the graph view) returns to
// the home page; show it on first load.
function goHome() {
  el.q.value = '';
  state.query = '';
  showHome();
  window.scrollTo({ top: 0 });
}
window.goHome = goHome;
el.brand.addEventListener('click', goHome);
showHome();
