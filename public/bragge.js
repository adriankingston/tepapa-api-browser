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
    // --- Wellington (city, with precisely-placed sub-locations) ---
    // The generic city dot is the fallback; specific photos are pulled to the
    // streets/suburbs below by title alias or the LOC_FIX map (building names
    // with no street in the title, identified from the high-res scans).
    { key: 'wellington', label: 'Wellington', leg: 'Wellington', seq: 100, lat: -41.2865, lon: 174.7762, pri: 1,
      aliases: ['wellington', 'port nicholson', 'city of wellington'] },
    { key: 'wgtn-waterfront', label: 'Wellington waterfront', leg: 'Wellington', seq: 101, lat: -41.2845, lon: 174.7810, pri: 3,
      aliases: ['customhouse quay', 'queens wharf', 'jervois quay', 'oriental bay'] },
    { key: 'lambton-quay', label: 'Lambton Quay', leg: 'Wellington', seq: 102, lat: -41.2828, lon: 174.7758, pri: 3,
      aliases: ['lambton quay', 'lambton', 'willis street', 'union bank'] },
    { key: 'whitmore', label: 'Whitmore Street (govt precinct)', leg: 'Wellington', seq: 103, lat: -41.2786, lon: 174.7775, pri: 3,
      aliases: ['whitmore', 'stout street'] },
    { key: 'thorndon', label: 'Thorndon', leg: 'Wellington', seq: 104, lat: -41.2758, lon: 174.7795, pri: 3,
      aliases: ['thorndon', 'mulgrave', 'pipitea', 'tinakori', 'hill street', 'museum street'] },
    { key: 'te-aro', label: 'Te Aro', leg: 'Wellington', seq: 105, lat: -41.2925, lon: 174.7765, pri: 3,
      aliases: ['te aro', 'cuba street', 'manners street', 'courtenay', 'dixon street'] },
    { key: 'the-terrace', label: 'The Terrace', leg: 'Wellington', seq: 106, lat: -41.2878, lon: 174.7712, pri: 3,
      aliases: ['the terrace', 'gaol hill'] },
    { key: 'mount-cook', label: 'Mount Cook', leg: 'Wellington', seq: 107, lat: -41.3010, lon: 174.7742, pri: 3,
      aliases: ['mount cook', 'mt cook', 'buckle street'] },
    { key: 'basin-reserve', label: 'Basin Reserve', leg: 'Wellington', seq: 108, lat: -41.3018, lon: 174.7805, pri: 3,
      aliases: ['basin reserve'] },
    { key: 'wadestown', label: 'Wadestown', leg: 'Wellington', seq: 109, lat: -41.2680, lon: 174.7665, pri: 3,
      aliases: ['wadestown'] },
    { key: 'kaiwharawhara', label: 'Kaiwharawhara', leg: 'Wellington', seq: 109, lat: -41.2607, lon: 174.7935, pri: 3,
      aliases: ['kaiwarawara', 'kaiwharawhara'] },
    { key: 'ngauranga', label: 'Ngauranga Gorge', leg: 'Wellington', seq: 110, lat: -41.2456, lon: 174.8113, pri: 3,
      aliases: ['ngauranga', 'ngahauranga', 'nghauranga', 'ngahuranga'] },
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

  // Per-record location overrides (by registration number) for Wellington photos
  // whose title is just a building name — placed from the high-res scans + known
  // 1870s Wellington geography. Checked before the title gazetteer in geocode().
  const LOC_FIX = {
    // Lambton Quay
    'D.000008': 'lambton-quay', 'D.000018': 'lambton-quay', 'D.000038': 'lambton-quay',
    'D.000035': 'lambton-quay', 'D.000050': 'lambton-quay', 'D.000006': 'lambton-quay',
    // Whitmore St / government precinct (Supreme Court, Government Buildings, Parliament)
    'D.000001': 'whitmore', 'D.000016': 'whitmore', 'D.000007': 'whitmore',
    'D.000015': 'whitmore', 'O.011673': 'whitmore', 'O.026976': 'whitmore',
    // Thorndon (St Paul's/Mulgrave St, Sacred Heart/Hill St, Colonial Museum/Museum St)
    'D.000011': 'thorndon', 'D.000019': 'thorndon', 'D.000014': 'thorndon',
    // Te Aro (Te Aro House, St John's Dixon St)
    'D.000023': 'te-aro', 'D.000025': 'te-aro', 'D.000020': 'te-aro',
    // The Terrace (city from the Terrace, From Gaol Hill = Terrace Gaol)
    'D.000004': 'the-terrace', 'D.000039': 'the-terrace', 'D.000040': 'the-terrace',
    // Mount Cook schools
    'D.000021': 'mount-cook', 'D.000022': 'mount-cook',
    // Basin Reserve
    'D.000017': 'basin-reserve',
    // Kaiwharawhara (on the Hutt Road)
    'O.032463': 'kaiwharawhara', 'O.032419': 'kaiwharawhara',
    // Wadestown
    'O.020208': 'wadestown',
    // Waterfront / Queens Wharf (Pier Hotel, ships in the harbour)
    'D.000036': 'wgtn-waterfront', 'A.004275': 'wgtn-waterfront', 'D.000051': 'wgtn-waterfront',
  };

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
    const fix = LOC_FIX[String(rec.identifier || '')];
    if (fix && GAZ_BY_KEY[fix]) return { stop: GAZ_BY_KEY[fix], source: 'fix' };

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

  // --- Portrait filter ---------------------------------------------------------
  // This is a GEOGRAPHICAL journey, so studio portraits (the cartes-de-visite /
  // cabinet cards of people) are dropped entirely. A record is a portrait when
  // its SUBJECT is people, not a place: it is typed "studio portraits"/"portraits",
  // or it depicts people-categories and no place/scene category. Exception: if the
  // title names a route place (e.g. "Group at the Masterton pā"), it's a
  // place-anchored documentary photo and stays. Format tags (carte-de-visite,
  // cabinet, "group portraits") are NOT used — they also wrap building/town views
  // ("View of Wellington", "Coker's Hotel") that belong on the map.
  const PEOPLE_DEPICT = /^(people|men|women|man|woman|children|child|girl|boy|girls|boys|indigenous peoples|couples|brides|grooms|family|families|portraits|infants|babies)$/;
  const SCENE_DEPICT = /road|street|river|bridge|building|cities|city|town|hotel|canyon|gorge|hill|valley|church|cathedral|school|store|shop|farm|wharf|quay|railway|station|museum|garden|fence|coast|\bbay\b|plain|bush|\btree|landscape|house|\bpa\b|village|settlement|monument|\bship|harbou?r|mountain|lake|waterfall|cliff|rock|beach|dwelling|wagon|carriage|\bcart|field|scener|\bview|terrace|reserve|park|jetty|crop|fern|hut|carving|architecture|community center/;
  const vocab = (rec, field) => (Array.isArray(rec[field]) ? rec[field] : rec[field] ? [rec[field]] : [])
    .map((x) => String((x && (x.title || x.prefLabel)) || '').toLowerCase());
  function isPortrait(rec) {
    if (matchGaz(cleanTitle(rec.title))) return false;        // titled with a route place → keep
    const types = vocab(rec, 'isTypeOf');
    if (types.includes('studio portraits') || types.includes('portraits')) return true;
    const dep = vocab(rec, 'depicts');
    return dep.some((t) => PEOPLE_DEPICT.test(t)) && !dep.some((t) => SCENE_DEPICT.test(t));
  }

  // --- Prints from one negative ("essentially the same image") -----------------
  // There's no print↔negative link in the data, so same-image records are found
  // by title: identical scene titles that differ only in album suffix, [bracketed]
  // alternate spellings, "NZ", or punctuation collapse to one key. A key only
  // counts as a real duplicate group when it's specific enough (≥3 words, and not
  // a generic "… scene" label) — otherwise vague titles like "Bush scene" (11
  // distinct negatives) or "Wellington" would wrongly merge unrelated photos.
  const isNegative = (rec) => vocab(rec, 'isTypeOf').some((t) => /negative/.test(t));
  function imageKey(title) {
    return String(title || '').toLowerCase()
      .split(/from the album|from the series/)[0]
      .normalize('NFD').replace(/[̀-ͯ]/g, '')
      .replace(/\[sic\]/g, ' ').replace(/\[[^\]]*\]/g, ' ')      // drop "[Rimutaka]" alt spellings
      .replace(/\b(n\.?z\.?|new zealand)\b/g, ' ')
      .replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const groupable = (key) => !!key && key.split(' ').length >= 3 && !/\bscene\b/.test(key);

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
    photos: [],          // one CLUSTER per image: { rec, img, stop, source, count, versions:[{rec,img,negative,reg}] }
    byStop: new Map(),   // stopKey -> { stop, photos:[] }
    totalPlaced: 0,      // total placed records (prints + negatives) before grouping
    imageDupes: [],      // print-dupe groups from bragge-dupes.json (reg-number arrays)
    routeOnly: true,     // hide Elsewhere + studio-attributed by default
    map: null,
    markers: new Map(),  // stopKey -> L.circleMarker
    selected: null,
    lb: { photos: [], i: 0, v: 0 },
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

  // Curator-confirmed same-image groups the title heuristic can't get, by
  // registration number (the negative first). The data has no print↔negative
  // link, titles collide, and near-identical compositions defeat image hashing,
  // so genuinely-ambiguous cases are corrected here.
  //  • 2026-06-14: negative D.000123 ("…looking North") + its 3 prints share no
  //    common catalogue title, and the print group also held a DIFFERENT view
  //    (O.026974, which correctly falls out as its own image).
  //  • 2026-06-14: three copies of the same "Ford of Waiohine River at Greytown"
  //    panorama print (no negative held — its source plates are separate frames),
  //    representative O.020834 first as requested.
  const FORCED_GROUPS = [
    ['D.000123', 'O.047751', 'O.011680', 'O.040858'],
    ['O.020834', 'O.032450', 'O.032494'],
  ];

  // members[0] is the representative. Forced groups pass their intended order;
  // automatic groups sort the negative to the front before calling.
  function addCluster(members) {
    const rep = members[0];
    const cluster = {
      rec: rep.rec, img: rep.img, stop: rep.stop, source: rep.source,
      count: members.length,
      versions: members.map((m) => ({ rec: m.rec, img: m.img, negative: isNegative(m.rec), reg: m.rec.identifier || '' })),
    };
    state.photos.push(cluster);
    if (!state.byStop.has(rep.stop.key)) state.byStop.set(rep.stop.key, { stop: rep.stop, photos: [] });
    state.byStop.get(rep.stop.key).photos.push(cluster);
  }

  function index(records) {
    // 1. Every placed, non-portrait, imaged record.
    const placed = [];
    for (const rec of records) {
      const imgs = imagesOf(rec);
      if (!imgs.length) continue;                  // nothing to show on a visual map
      if (isPortrait(rec)) continue;               // studio portraits aren't part of the journey
      const g = geocode(rec);
      if (!g) continue;                            // couldn't place it
      placed.push({ rec, img: imgs[0], stop: g.stop, source: g.source });
    }
    state.totalPlaced = placed.length;

    // Merge same-image records from three vetted sources, unioned so overlaps
    // (e.g. an image-dupe pair inside a forced group) collapse into one cluster:
    //   a) FORCED_GROUPS — curated corrections (representative listed first).
    //   b) state.imageDupes — print dupes found by title + perceptual-hash
    //      agreement and visually verified (bragge-dupes.json).
    //   c) the single-negative title rule — a specific shared title holding
    //      exactly ONE negative + its prints (one unambiguous exposure). Titles
    //      with 0 or ≥2 negatives are left apart (different exposures can share a
    //      caption — that's what produced earlier wrong merges).
    const byReg = new Map();
    placed.forEach((p) => { if (p.rec.identifier) byReg.set(String(p.rec.identifier), p); });
    const slot = new Map();
    placed.forEach((p, i) => slot.set(p, i));
    const parent = placed.map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
    const repRank = new Map();   // photo → representative priority (higher wins)
    const mergeGroup = (members, headRank) => {
      members = members.filter(Boolean);
      if (members.length < 2) return;
      for (let i = 1; i < members.length; i++) union(slot.get(members[0]), slot.get(members[i]));
      if (headRank) repRank.set(members[0], Math.max(repRank.get(members[0]) || 0, headRank));
    };

    FORCED_GROUPS.forEach((regs) => mergeGroup(regs.map((r) => byReg.get(r)), 3));      // (a) curated head always wins
    (state.imageDupes || []).forEach((regs) => mergeGroup(regs.map((r) => byReg.get(r)), 1)); // (b) head only breaks all-print ties
    const byKey = new Map();                                                            // (c)
    for (const p of placed) {
      const key = imageKey(p.rec.title);
      if (!groupable(key)) continue;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(p);
    }
    for (const members of byKey.values()) {
      if (members.length > 1 && members.filter((m) => isNegative(m.rec)).length === 1) mergeGroup(members, 0);
    }

    // Build one cluster per connected component. Representative rank: a curated
    // FORCED head always wins (3); otherwise prefer a negative ("behind the
    // negative", 2); an image-dupe head only breaks all-print ties (1).
    const rankOf = (p) => (repRank.get(p) === 3 ? 3 : isNegative(p.rec) ? 2 : (repRank.get(p) || 0));
    const comp = new Map();
    placed.forEach((p, i) => { const r = find(i); (comp.get(r) || comp.set(r, []).get(r)).push(p); });
    for (const members of comp.values()) {
      members.sort((a, b) => rankOf(b) - rankOf(a));
      addCluster(members);
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
          const badge = p.count > 1
            ? `<span class="th-badge" title="${p.count} copies — prints &amp; negative">×${p.count}</span>` : '';
          html += `<button class="th${p.count > 1 ? ' th-stack' : ''}" type="button" data-photo="${gi}" style="width:${w}px" title="${esc(shortTitle(p.rec.title))}${p.count > 1 ? ` (${p.count} copies)` : ''}">
            <img loading="lazy" src="${esc(p.img.thumbnailUrl)}" alt="${esc(shortTitle(p.rec.title))}">${badge}
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
    // Prev/next page through the distinct images at this stop, in rail order.
    const group = state.byStop.get(p.stop.key).photos.filter((x) => visiblePhotos().includes(x));
    state.lb.photos = group;
    state.lb.i = Math.max(0, group.indexOf(p));
    state.lb.v = 0;                 // start on the representative (the negative)
    $('#lightbox').hidden = false;
    document.body.style.overflow = 'hidden';
    renderLightbox();
  }
  function renderLightbox() {
    const cl = state.lb.photos[state.lb.i];
    if (!cl) return;
    const ver = cl.versions[state.lb.v] || cl.versions[0];   // which physical copy we're viewing
    const img = ver.img, rec = ver.rec;
    const zoom = isZoomable(img);
    const big = zoom ? (img.previewUrl || img.thumbnailUrl) : img.thumbnailUrl;
    const full = zoom && img.contentUrl;
    const rights = img.rights && img.rights.title ? esc(img.rights.title) : '';
    $('#lb-img').src = big;
    $('#lb-img').alt = esc(shortTitle(cl.rec.title));
    $('#lb-title').textContent = shortTitle(cl.rec.title);
    $('#lb-place').textContent = cl.stop.label;
    $('#lb-counter').textContent = `${state.lb.i + 1} / ${state.lb.photos.length}`;
    // Version switcher — one chip per physical copy (negative + prints).
    $('#lb-versions').innerHTML = cl.count > 1
      ? `<span class="lb-vlabel">Held as ${cl.count} copies:</span>` + cl.versions.map((vv, j) =>
          `<button class="lb-ver${j === state.lb.v ? ' on' : ''}" data-v="${j}">${vv.negative ? 'negative' : 'print'}${vv.reg ? ' ' + esc(vv.reg) : ''}</button>`).join('')
      : '';
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
    state.lb.v = 0;                 // reset to the representative when changing image
    renderLightbox();
  }
  function closeLightbox() {
    $('#lightbox').hidden = true;
    document.body.style.overflow = '';
  }

  // --- Boot --------------------------------------------------------------------

  function updateStats() {
    const onR = state.photos.filter(onRoute);
    const stops = new Set(onR.map((p) => p.stop.key)).size;
    $('#stat-located').textContent = onR.length;
    $('#stat-stops').textContent = stops;
    $('#stat-total').textContent = state.photos.length;
    const grouped = state.totalPlaced - state.photos.length;   // duplicate prints folded away
    const note = $('#dup-note');
    if (note) note.textContent = grouped > 0
      ? `${state.totalPlaced} prints & negatives → ${state.photos.length} distinct images (${grouped} duplicates grouped behind a single representative, where unambiguous).`
      : '';
  }

  function renderLegend() {
    $('#legend').innerHTML = LEG_ORDER.filter((l) => l !== 'Elsewhere').map((l) =>
      `<span class="lg"><span class="lg-dot" style="background:${LEGS[l].color}"></span>${esc(l)}</span>`).join('');
  }

  async function boot() {
    try {
      const [records] = await Promise.all([
        fetchBragge(),
        fetch('/bragge-dupes.json').then((r) => r.json())
          .then((d) => { state.imageDupes = (d && d.groups) || []; })
          .catch(() => { state.imageDupes = []; }),   // grouping still works without the dupe file
      ]);
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
    // Version chips: switch which physical copy (negative / print) is shown.
    $('#lb-versions').addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      state.lb.v = Number(b.dataset.v);
      renderLightbox();
    });
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
