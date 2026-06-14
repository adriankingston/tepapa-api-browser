// James Bragge — "Wellington to the Wairarapa & Manawatū", a geographical view.
// ---------------------------------------------------------------------------
// A standalone story-map of James Bragge's photographs (Te Papa Person id 4243),
// built on the SAME server proxy as the main browser (POST /api/search) and the
// vendored Leaflet. Nothing is hard-coded about the photos: they are fetched live
// and geocoded at load time.
//
// Why a custom geocoder. Bragge's records DON'T carry coordinates, and their
// `production.spatial` ("made in") defaults to *Wellington* — his studio — for
// the ~215 album prints, even when the photo's subject is the Rimutaka summit or
// the Manawatū Gorge. The real location lives in the very descriptive TITLE
// ("Bushy Bend, Remutaka Hill…", "Manawatu Gorge Bridge", "Township of
// Featherston"). So we match each title against a curated gazetteer of the
// landmarks along the historic Wellington–Masterton road, falling back to the
// record's referenced Place and finally to `production.spatial`.

(() => {
  'use strict';

  const BRAGGE_ID = '4243';

  // --- The route, south → north -------------------------------------------------
  // Each leg is a stretch of the 1870s coach road from Wellington up to the
  // Manawatū. Colours echo the main app's record-type palette.
  const LEGS = {
    'Wellington':  { color: '#008e96', blurb: 'The capital — Bragge’s studio and starting point.' },
    'Hutt Valley': { color: '#43a047', blurb: 'North along the harbour and up the Hutt River.' },
    'Rimutaka':    { color: '#c79100', blurb: 'The great climb: the zig-zag road over the Remutaka (Rimutaka) Range.' },
    'Wairarapa':   { color: '#ff7043', blurb: 'Down onto the plains — Featherston, Greytown, Carterton, Masterton.' },
    'Bush':        { color: '#8e5fd9', blurb: 'Into the Forty- and Seventy-Mile Bush being felled for settlement.' },
    'Manawatū':    { color: '#d81b78', blurb: 'Through the Manawatū Gorge to the western plains.' },
    'Elsewhere':   { color: '#5c7a99', blurb: 'Bragge photographs taken off the Wellington–Manawatū route.' },
  };
  const LEG_ORDER = ['Wellington', 'Hutt Valley', 'Rimutaka', 'Wairarapa', 'Bush', 'Manawatū', 'Elsewhere'];

  // The gazetteer. `pri` is specificity (3 = a named landmark/town, 2 = a
  // river/sub-area, 1 = a broad region used only as a last resort). When two
  // aliases match, the higher `pri` wins, then the longer alias — so "featherston
  // side" (the hill) beats "featherston" (the town), and a town beats its region.
  // Aliases are pre-folded: lower-case, no macrons, no apostrophes/brackets.
  const GAZ = [
    // --- Wellington ---
    { key: 'wellington', label: 'Wellington', leg: 'Wellington', seq: 100, lat: -41.2865, lon: 174.7762, pri: 1,
      aliases: ['wellington', 'lambton quay', 'te aro', 'thorndon', 'mount cook', 'mt cook', 'customhouse quay', 'mulgrave', 'kaiwarawara', 'kaiwharawhara', 'the terrace', 'willis street', 'pipitea', 'oriental bay'] },
    { key: 'ngauranga', label: 'Ngauranga Gorge', leg: 'Wellington', seq: 110, lat: -41.2456, lon: 174.8113, pri: 3,
      aliases: ['ngauranga', 'ngahauranga'] },
    // --- Hutt Valley ---
    { key: 'petone', label: 'Petone', leg: 'Hutt Valley', seq: 120, lat: -41.2256, lon: 174.8726, pri: 3,
      aliases: ['petone', 'colletts farm', 'collett'] },
    { key: 'lower-hutt', label: 'Lower Hutt', leg: 'Hutt Valley', seq: 130, lat: -41.2095, lon: 174.9081, pri: 3,
      aliases: ['lower hutt', 'fitzgerald'] },
    { key: 'upper-hutt', label: 'Upper Hutt', leg: 'Hutt Valley', seq: 150, lat: -41.1244, lon: 175.0709, pri: 3,
      aliases: ['upper hutt', 'fern ground'] },
    // --- Rimutaka approach & climb ---
    { key: 'mangaroa', label: 'Mangaroa Valley', leg: 'Rimutaka', seq: 160, lat: -41.1450, lon: 175.1050, pri: 3,
      aliases: ['mangaroa', 'mungaroa'] },
    { key: 'pakuratahi', label: 'Pakuratahi', leg: 'Rimutaka', seq: 170, lat: -41.0856, lon: 175.1606, pri: 3,
      aliases: ['pakuratahi', 'pukuratahi'] },
    { key: 'kaitoke', label: 'Kaitoke', leg: 'Rimutaka', seq: 175, lat: -41.0667, lon: 175.1833, pri: 3,
      aliases: ['kaitoke'] },
    { key: 'rimutaka-w', label: 'Remutaka — Wellington side', leg: 'Rimutaka', seq: 180, lat: -41.1080, lon: 175.2250, pri: 3,
      aliases: ['wellington side of the remutaka', 'wellington side of the rimutaka', 'wellington side of hill', 'wellington side looking', 'bushy bend', 'red clay point', 'horseshoe bend, bottom', 'bottom of remutaka', 'bottom of the remutaka', 'bottom of rimutaka'] },
    { key: 'rimutaka-top', label: 'Remutaka Summit', leg: 'Rimutaka', seq: 185, lat: -41.1230, lon: 175.2720, pri: 2,
      aliases: ['remutaka hill', 'rimutaka hill', 'remutaka range', 'one mile from top', 'one mile from the top', 'top of the remutaka', 'roadmans hut', 'halfway up the remutaka', 'halfway up the rimutaka', 'the summit', 'the saddle'] },
    { key: 'rimutaka-f', label: 'Remutaka — Featherston side', leg: 'Rimutaka', seq: 190, lat: -41.1150, lon: 175.3050, pri: 3,
      aliases: ['featherston side', 'drakes elbow', 'caves bridge', 'abbotts creek', 'the cutting', 'siberia'] },
    // --- Wairarapa ---
    { key: 'tauherenikau', label: 'Tauherenikau', leg: 'Wairarapa', seq: 195, lat: -41.1330, lon: 175.2950, pri: 3,
      aliases: ['tauherenikau'] },
    { key: 'featherston', label: 'Featherston', leg: 'Wairarapa', seq: 200, lat: -41.1167, lon: 175.3170, pri: 3,
      aliases: ['featherston'] },
    { key: 'greytown', label: 'Greytown', leg: 'Wairarapa', seq: 220, lat: -41.0789, lon: 175.4583, pri: 3,
      aliases: ['greytown', 'waiohine'] },
    { key: 'carterton', label: 'Carterton', leg: 'Wairarapa', seq: 240, lat: -41.0272, lon: 175.5236, pri: 3,
      aliases: ['carterton', 'mangatarara', 'mungatarara'] },
    { key: 'wairarapa', label: 'Wairarapa (general)', leg: 'Wairarapa', seq: 250, lat: -41.0000, lon: 175.5000, pri: 1,
      aliases: ['wairarapa'] },
    { key: 'masterton', label: 'Masterton', leg: 'Wairarapa', seq: 260, lat: -40.9511, lon: 175.6575, pri: 3,
      aliases: ['masterton', 'iorns', 'waipoua', 'ruamahanga', 'ruamahunga', 'waingawa'] },
    { key: 'opaki', label: 'Opaki', leg: 'Wairarapa', seq: 262, lat: -40.9000, lon: 175.6670, pri: 3,
      aliases: ['opaki'] },
    { key: 'te-ore-ore', label: 'Te Ore Ore', leg: 'Wairarapa', seq: 264, lat: -40.9400, lon: 175.7150, pri: 3,
      aliases: ['te ore ore', 'te oreore'] },
    { key: 'taueru', label: 'Taueru', leg: 'Wairarapa', seq: 270, lat: -40.9000, lon: 175.8000, pri: 3,
      aliases: ['taueru'] },
    // --- Forty / Seventy Mile Bush ---
    { key: 'forty-mile-bush', label: 'Forty-Mile Bush', leg: 'Bush', seq: 300, lat: -40.7300, lon: 175.7000, pri: 3,
      aliases: ['forty mile bush', '40 mile bush', 'five mile avenue'] },
    { key: 'eketahuna', label: 'Eketāhuna', leg: 'Bush', seq: 320, lat: -40.6519, lon: 175.7011, pri: 3,
      aliases: ['eketahuna'] },
    { key: 'seventy-mile-bush', label: 'Seventy-Mile Bush', leg: 'Bush', seq: 330, lat: -40.5300, lon: 175.8100, pri: 3,
      aliases: ['seventy mile bush', '70 mile bush', 'fish river'] },
    { key: 'pahiatua', label: 'Pahiatua', leg: 'Bush', seq: 340, lat: -40.4561, lon: 175.8378, pri: 3,
      aliases: ['pahiatua'] },
    { key: 'woodville', label: 'Woodville', leg: 'Bush', seq: 360, lat: -40.3333, lon: 175.8714, pri: 3,
      aliases: ['woodville'] },
    // --- Manawatū ---
    { key: 'manawatu-gorge', label: 'Manawatū Gorge', leg: 'Manawatū', seq: 380, lat: -40.3200, lon: 175.7900, pri: 3,
      aliases: ['manawatu gorge', 'gorge bridge'] },
    { key: 'ashhurst', label: 'Ashhurst', leg: 'Manawatū', seq: 385, lat: -40.2931, lon: 175.7481, pri: 3,
      aliases: ['ashhurst'] },
    { key: 'manawatu-river', label: 'Manawatū River', leg: 'Manawatū', seq: 390, lat: -40.3700, lon: 175.6200, pri: 2,
      aliases: ['manawatu river'] },
    { key: 'manawatu', label: 'Manawatū', leg: 'Manawatū', seq: 400, lat: -40.3523, lon: 175.6082, pri: 1,
      aliases: ['manawatu', 'palmerston'] },
    // --- Off-route (kept, but hidden from the default journey view) ---
    { key: 'castlepoint', label: 'Castlepoint', leg: 'Elsewhere', seq: 600, lat: -40.9000, lon: 176.2200, pri: 2,
      aliases: ['castlepoint', 'castle point'] },
    { key: 'parihaka', label: 'Parihaka', leg: 'Elsewhere', seq: 610, lat: -39.2900, lon: 173.8900, pri: 3,
      aliases: ['parihaka'] },
    { key: 'napier', label: 'Napier', leg: 'Elsewhere', seq: 620, lat: -39.4928, lon: 176.9120, pri: 3,
      aliases: ['napier'] },
    { key: 'dunedin', label: 'Dunedin', leg: 'Elsewhere', seq: 630, lat: -45.8742, lon: 170.5036, pri: 3,
      aliases: ['dunedin'] },
  ];
  const GAZ_BY_KEY = Object.fromEntries(GAZ.map((g) => [g.key, g]));

  // The drawn coach-road corridor (hand-traced down the modern SH2 alignment so
  // it reads as a road, not straight hops between dots).
  const ROUTE = [
    [-41.2865, 174.7762], [-41.2607, 174.7935], [-41.2456, 174.8113], [-41.2256, 174.8726],
    [-41.2095, 174.9081], [-41.1244, 175.0709], [-41.0856, 175.1606], [-41.0667, 175.1833],
    [-41.1080, 175.2250], [-41.1230, 175.2720], [-41.1150, 175.3050], [-41.1167, 175.3170],
    [-41.0789, 175.4583], [-41.0272, 175.5236], [-40.9511, 175.6575], [-40.7300, 175.7000],
    [-40.6519, 175.7011], [-40.4561, 175.8378], [-40.3333, 175.8714], [-40.3200, 175.7900],
    [-40.3523, 175.6082],
  ];

  // --- Geocoding ---------------------------------------------------------------

  const fold = (s) => String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')   // strip macrons/diacritics
    .replace(/\[sic\]/g, ' ')
    .replace(/[\[\]'’.,;:()"]/g, ' ')                    // brackets show both spellings; drop punctuation
    .replace(/\s+/g, ' ').trim();

  // Remove series/album names and road names that contain place words we must not
  // match on (the album is literally called "Wellington to the Wairarapa").
  function cleanTitle(t) {
    let s = fold(t);
    s = s.split('from the album')[0];
    s = s
      .replace(/photographs of new zealand scenery/g, ' ')
      .replace(/new zealand scenery/g, ' ')
      .replace(/wellington to the wair?arapa/g, ' ')
      .replace(/wellington and masterton road/g, ' ')   // road name, not a place
      .replace(/castle point road/g, ' ')               // road name (subject is Taueru etc.)
      .replace(/hutt road/g, ' ')                        // road along the harbour
      .replace(/looking (down |up )?(towards?|toward|on|down on|down the|up the) wellington/g, ' ')
      .replace(/towards wellington/g, ' ')
      .replace(/\s+/g, ' ').trim();
    return s;
  }

  // Best gazetteer hit in a folded string: highest pri, then longest alias.
  function matchGaz(text) {
    let best = null, bestPri = -1, bestLen = -1;
    for (const g of GAZ) {
      for (const a of g.aliases) {
        if (text.includes(a) && (g.pri > bestPri || (g.pri === bestPri && a.length > bestLen))) {
          best = g; bestPri = g.pri; bestLen = a.length;
        }
      }
    }
    return best;
  }

  // Resolve one record to a gazetteer stop, recording how confident we are.
  function geocode(rec) {
    const fromTitle = matchGaz(cleanTitle(rec.title));
    if (fromTitle) return { stop: fromTitle, source: 'title' };

    const places = [].concat(rec.refersTo || [], rec.depicts || []).filter((x) => x && x.type === 'Place');
    for (const p of places) {
      const m = matchGaz(fold(p.title || p.prefLabel));
      if (m) return { stop: m, source: 'refersTo' };
    }
    const prod = Array.isArray(rec.production) ? rec.production[0] : rec.production;
    if (prod && prod.spatial) {
      const m = matchGaz(fold(prod.spatial.title || prod.spatial.prefLabel));
      if (m) return { stop: m, source: 'spatial' };
    }
    return null;
  }

  // --- Images (rights-aware, mirrors the main app) -----------------------------

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const imagesOf = (r) => (Array.isArray(r.hasRepresentation) ? r.hasRepresentation : [])
    .filter((x) => x && x.type === 'ImageObject' && x.thumbnailUrl);
  // allowsDownload === false → thumbnail only, never preview/full, never zoom.
  const isZoomable = (img) => !(img && img.rights && img.rights.allowsDownload === false);

  // Images are NEVER cropped (copyright, cultural sensitivity, artist intent).
  // Rail thumbs are a fixed height; each thumb's WIDTH is set to the image's true
  // aspect ratio so `object-fit:contain` fills the box exactly — no crop, no bands.
  const RAIL_THUMB_H = 74;
  function thumbAspect(img, min = 0.5, max = 3.0) {
    const w = +(img && img.width), h = +(img && img.height);
    const ar = (w > 0 && h > 0) ? w / h : 1.4;   // default to a gentle landscape
    return Math.min(max, Math.max(min, ar));
  }

  // Clean up Bragge's long album titles for display (drop the boilerplate tail).
  function shortTitle(t) {
    let s = String(t || '').split(/\.?\s*From the album/i)[0].trim();
    s = s.replace(/,?\s*(NZ|N\.Z\.|New Zealand)\.?$/i, '').trim();
    return s.replace(/\s*\[sic\]\s*/gi, ' ').replace(/\s+/g, ' ').replace(/[.,]$/, '').trim() || t;
  }

  // --- State -------------------------------------------------------------------

  const state = {
    photos: [],          // { rec, img, stop, source }
    byStop: new Map(),   // stopKey -> { stop, photos:[] }
    routeOnly: true,     // hide Elsewhere + studio-attributed by default
    map: null,
    markers: new Map(),  // stopKey -> L.circleMarker
    selected: null,
    lb: { photos: [], i: 0 },
  };

  const $ = (sel) => document.querySelector(sel);

  // A photo is part of the "journey" unless it's off-route, or merely attributed
  // to Wellington by the studio default (spatial) with no real location signal.
  function onRoute(p) {
    if (p.stop.leg === 'Elsewhere') return false;
    if (p.source === 'spatial' && p.stop.key === 'wellington') return false;
    return true;
  }
  const visiblePhotos = () => state.routeOnly ? state.photos.filter(onRoute) : state.photos;

  // --- Data load ---------------------------------------------------------------

  async function fetchBragge() {
    let all = [];
    for (let from = 0; from < 500; from += 100) {
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filters: [{ field: 'production.contributor.id', keyword: BRAGGE_ID }],
          size: 100, from,
        }),
      });
      const data = await res.json();
      const batch = (data && data.results) || [];
      all = all.concat(batch);
      if (batch.length < 100) break;
    }
    return all;
  }

  function index(records) {
    for (const rec of records) {
      const imgs = imagesOf(rec);
      if (!imgs.length) continue;                  // nothing to show on a visual map
      const g = geocode(rec);
      if (!g) continue;                            // couldn't place it
      const p = { rec, img: imgs[0], stop: g.stop, source: g.source };
      state.photos.push(p);
      if (!state.byStop.has(g.stop.key)) state.byStop.set(g.stop.key, { stop: g.stop, photos: [] });
      state.byStop.get(g.stop.key).photos.push(p);
    }
  }

  // --- Map ---------------------------------------------------------------------

  function buildMap() {
    const map = L.map('map', { scrollWheelZoom: true, preferCanvas: false }).setView([-40.85, 175.3], 8);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 17, attribution: '© OpenStreetMap contributors',
    }).addTo(map);
    L.polyline(ROUTE, { color: '#5b6472', weight: 3, opacity: 0.55, dashArray: '2 7', lineCap: 'round' }).addTo(map);
    state.map = map;
    drawMarkers({ fit: true });
    // The map lives in a sticky/grid cell that may not have its final size on the
    // first paint; re-measure and re-fit once layout settles (and on resize).
    const settle = () => { map.invalidateSize(); fitToVisible(); };
    requestAnimationFrame(settle);
    setTimeout(settle, 250);
    window.addEventListener('resize', () => map.invalidateSize());
  }

  // Always frame the journey corridor — never the off-route outliers (Dunedin,
  // Napier…), so toggling "show everything" doesn't zoom out to all of NZ.
  function fitToVisible() {
    const bounds = [...new Set(visiblePhotos().map((p) => p.stop.key))]
      .filter((k) => GAZ_BY_KEY[k].leg !== 'Elsewhere')
      .map((k) => [GAZ_BY_KEY[k].lat, GAZ_BY_KEY[k].lon]);
    if (bounds.length) state.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 10 });
  }

  function drawMarkers({ fit } = {}) {
    for (const m of state.markers.values()) m.remove();
    state.markers.clear();
    const show = visiblePhotos();
    const counts = new Map();
    for (const p of show) counts.set(p.stop.key, (counts.get(p.stop.key) || 0) + 1);

    for (const [key, n] of counts) {
      const stop = GAZ_BY_KEY[key];
      const r = Math.max(7, Math.min(26, 6 + Math.sqrt(n) * 3.2));
      const m = L.circleMarker([stop.lat, stop.lon], {
        radius: r, color: '#fff', weight: 1.5, fillColor: LEGS[stop.leg].color, fillOpacity: 0.85,
      }).addTo(state.map);
      m.bindTooltip(`${stop.label} · ${n}`, { direction: 'top', offset: [0, -r] });
      m.on('click', () => selectStop(key, { fly: false }));
      state.markers.set(key, m);
    }
    if (fit) fitToVisible();
  }

  // --- Rail (photos grouped by leg, in journey order) --------------------------

  function buildRail() {
    const rail = $('#rail');
    const show = visiblePhotos();
    const stopsWith = [...state.byStop.values()]
      .map((s) => ({ ...s, photos: s.photos.filter((p) => show.includes(p)) }))
      .filter((s) => s.photos.length)
      .sort((a, b) => a.stop.seq - b.stop.seq);

    let html = '';
    for (const leg of LEG_ORDER) {
      const legStops = stopsWith.filter((s) => s.stop.leg === leg);
      if (!legStops.length) continue;
      const total = legStops.reduce((n, s) => n + s.photos.length, 0);
      html += `<section class="leg" data-leg="${esc(leg)}">
        <h2 class="leg-h"><span class="leg-dot" style="background:${LEGS[leg].color}"></span>${esc(leg)}
          <span class="leg-n">${total}</span></h2>
        <p class="leg-blurb">${esc(LEGS[leg].blurb)}</p>`;
      for (const s of legStops) {
        html += `<div class="stop" data-stop="${esc(s.stop.key)}">
          <button class="stop-h" type="button" data-focus="${esc(s.stop.key)}">
            ${esc(s.stop.label)} <span class="stop-n">${s.photos.length}</span></button>
          <div class="thumbs">`;
        for (const p of s.photos) {
          const gi = state.photos.indexOf(p);
          const w = Math.round(thumbAspect(p.img) * RAIL_THUMB_H);
          html += `<button class="th" type="button" data-photo="${gi}" style="width:${w}px" title="${esc(shortTitle(p.rec.title))}">
            <img loading="lazy" src="${esc(p.img.thumbnailUrl)}" alt="${esc(shortTitle(p.rec.title))}">
          </button>`;
        }
        html += `</div></div>`;
      }
      html += `</section>`;
    }
    rail.innerHTML = html;

    rail.querySelectorAll('[data-photo]').forEach((b) =>
      b.addEventListener('click', () => openLightbox(Number(b.dataset.photo))));
    rail.querySelectorAll('[data-focus]').forEach((b) =>
      b.addEventListener('click', () => selectStop(b.dataset.focus, { fly: true })));
  }

  // --- Selection (map ↔ rail) --------------------------------------------------

  function selectStop(key, { fly }) {
    const stop = GAZ_BY_KEY[key];
    if (!stop) return;
    state.selected = key;
    if (fly) state.map.flyTo([stop.lat, stop.lon], Math.max(state.map.getZoom(), 11), { duration: 0.6 });
    for (const [k, m] of state.markers) {
      const on = k === key;
      m.setStyle({ weight: on ? 3.5 : 1.5, color: on ? '#1a1d23' : '#fff' });
      if (on) m.bringToFront();
    }
    const open = state.markers.get(key);
    if (open) open.openTooltip();
    const group = document.querySelector(`.stop[data-stop="${CSS.escape(key)}"]`);
    if (group) {
      document.querySelectorAll('.stop.active').forEach((e) => e.classList.remove('active'));
      group.classList.add('active');
      group.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  // --- Lightbox ----------------------------------------------------------------

  function openLightbox(globalIdx) {
    const p = state.photos[globalIdx];
    if (!p) return;
    // Page within the photo's own stop, in rail order.
    const group = state.byStop.get(p.stop.key).photos.filter((x) => visiblePhotos().includes(x));
    state.lb.photos = group;
    state.lb.i = Math.max(0, group.indexOf(p));
    $('#lightbox').hidden = false;
    document.body.style.overflow = 'hidden';
    renderLightbox();
  }
  function renderLightbox() {
    const p = state.lb.photos[state.lb.i];
    if (!p) return;
    const zoom = isZoomable(p.img);
    const big = zoom ? (p.img.previewUrl || p.img.thumbnailUrl) : p.img.thumbnailUrl;
    const full = zoom && p.img.contentUrl;
    const rec = p.rec;
    const rights = p.img.rights && p.img.rights.title ? esc(p.img.rights.title) : '';
    $('#lb-img').src = big;
    $('#lb-img').alt = esc(shortTitle(rec.title));
    $('#lb-title').textContent = shortTitle(rec.title);
    $('#lb-place').textContent = p.stop.label;
    $('#lb-counter').textContent = `${state.lb.i + 1} / ${state.lb.photos.length}`;
    $('#lb-meta').innerHTML =
      (rights ? `<span class="lb-rights">${rights}</span>` : '') +
      `<a href="index.html#detail=${esc(rec.type)}:${esc(rec.id)}" target="_blank" rel="noopener">Open in browser ↗</a>` +
      `<a href="https://collections.tepapa.govt.nz/object/${esc(rec.id)}" target="_blank" rel="noopener">Te Papa record ↗</a>` +
      (full ? `<a href="${esc(full)}" target="_blank" rel="noopener">Full image ↗</a>` : '');
    $('#lb-prev').hidden = state.lb.photos.length < 2;
    $('#lb-next').hidden = state.lb.photos.length < 2;
  }
  function lbStep(d) {
    if (!state.lb.photos.length) return;
    state.lb.i = (state.lb.i + d + state.lb.photos.length) % state.lb.photos.length;
    renderLightbox();
  }
  function closeLightbox() {
    $('#lightbox').hidden = true;
    document.body.style.overflow = '';
  }

  // --- Boot --------------------------------------------------------------------

  function updateStats() {
    const located = state.photos.filter(onRoute).length;
    const stops = new Set(state.photos.filter(onRoute).map((p) => p.stop.key)).size;
    $('#stat-located').textContent = located;
    $('#stat-stops').textContent = stops;
    $('#stat-total').textContent = state.photos.length;
  }

  function renderLegend() {
    $('#legend').innerHTML = LEG_ORDER.filter((l) => l !== 'Elsewhere').map((l) =>
      `<span class="lg"><span class="lg-dot" style="background:${LEGS[l].color}"></span>${esc(l)}</span>`).join('');
  }

  async function boot() {
    try {
      const records = await fetchBragge();
      index(records);
    } catch (e) {
      $('#status').textContent = 'Could not load Bragge’s photographs from the API.';
      console.error(e);
      return;
    }
    if (!state.photos.length) { $('#status').textContent = 'No located photographs found.'; return; }

    $('#status').hidden = true;
    updateStats();
    renderLegend();
    buildMap();
    buildRail();

    // Controls
    const toggle = $('#route-toggle');
    toggle.checked = state.routeOnly;
    toggle.addEventListener('change', () => {
      state.routeOnly = toggle.checked;
      drawMarkers({ fit: true });
      buildRail();
      updateStats();
    });

    // Lightbox wiring
    $('#lb-close').addEventListener('click', closeLightbox);
    $('#lb-prev').addEventListener('click', () => lbStep(-1));
    $('#lb-next').addEventListener('click', () => lbStep(1));
    $('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') closeLightbox(); });
    document.addEventListener('keydown', (e) => {
      if ($('#lightbox').hidden) return;
      if (e.key === 'Escape') closeLightbox();
      else if (e.key === 'ArrowLeft') lbStep(-1);
      else if (e.key === 'ArrowRight') lbStep(1);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
