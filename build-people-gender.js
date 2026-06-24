// build-people-gender.js — precompute the FULL-POPULATION gender breakdown of
// the people linked to the collection, by role AND by collection.
// Writes public/people-gender.json.
//
// Why precomputed (baked), not live: the Te Papa API can't facet a record by its
// linked person's gender (production.contributor.gender errors), so a role
// breakdown means enumerating every linked person (the `<role>.id` facet returns
// the full distinct set at size:20000) and looking up each one's gender in
// chunks. That's ~100+ upstream calls — fine once, offline, far too slow per page
// view. We fetch every person's gender ONCE into a shared map, then reuse it to
// aggregate the global view and every per-collection view for free.
//
// Re-run whenever you want a fresh snapshot (needs TEPAPA_API_KEY in .env):
//   node build-people-gender.js

const fs = require('fs');
const path = require('path');

try {
  const env = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* fall back to real environment */ }

const { tepapaRequest } = require('./lib/tepapa');

const GENDERS = ['Male', 'Female', 'Gender Diverse'];
const normGender = (g) => (GENDERS.includes(g) ? g : 'Unrecorded');
const collectionLabel = (c) => String(c).replace(/([a-z])([A-Z])/g, '$1 $2');
const CHUNK = 500;       // ids per person lookup (500 works; 1000 overflows the query)
const CONCURRENCY = 5;   // kept low: the API throttles heavier bursts and drops people

// Roles that link records → people. scope = which record type / collections apply.
const ROLES = [
  { key: 'maker', label: 'Makers & creators', type: 'Object', field: 'production.contributor.id', scope: 'object' },
  { key: 'collector', label: 'Collectors', type: 'Specimen', field: 'evidenceFor.atEvent.recordedBy.id', scope: 'specimen' },
  { key: 'subject', label: 'Depicted people', type: 'Object', field: 'depicts.id', scope: 'object' },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Robust search: the API throttles heavy bursts (non-200 / error body), which
// silently drops people and can't be detected downstream (a dropped person just
// miscounts as a non-Person). So retry on any non-200/error/throw with
// exponential backoff; return null only after exhausting tries (caller re-queues).
async function search(body, tries = 7) {
  for (let a = 0; a < tries; a++) {
    try {
      const r = await tepapaRequest('POST', '/collection/search', body);
      if (r.status === 200 && r.json && !r.json.errorCode) return r.json;
    } catch { /* network — fall through to backoff */ }
    await sleep(Math.min(16000, 500 * 2 ** a) + Math.floor(Math.random() * 250));
  }
  return null;
}
function facetEntries(j, field) {
  const f = j.facets && j.facets[field];
  if (!f) return [];
  return Array.isArray(f)
    ? f.map((x) => [String(x.key || x.value), x.count != null ? x.count : x.doc_count])
    : Object.entries(f).map(([k, v]) => [String(k), v]);
}
async function pool(items, n, fn) {
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k); }
  }));
}

// Every person-id linked in a role (optionally within one collection), + per-id
// record count. The collection filter uses the query-string form that works.
async function roleIds(role, collection) {
  const body = {
    query: collection ? `collection:"${collection}"` : '*',
    size: 0,
    filters: [{ field: 'type', keyword: role.type }],
    facets: [{ field: role.field, size: 20000 }],
  };
  const j = await search(body);
  return j ? facetEntries(j, role.field) : [];
}

// Roll up [[id, count]] against the shared id→gender map: people (each once) and
// works (record-weighted). Ids with no gender entry are non-Person (orgs etc.).
function aggregate(ent, idGender) {
  const people = {}, works = {};
  let persons = 0, nonPersonIds = 0;
  for (const [id, c] of ent) {
    const g = idGender.get(id);
    if (g) { persons++; people[g] = (people[g] || 0) + 1; works[g] = (works[g] || 0) + c; }
    else nonPersonIds++;
  }
  return { people, works, persons, nonPersonIds, totalLinks: ent.reduce((s, [, c]) => s + c, 0) };
}

async function baseline() {
  const j = await search({ query: '*', size: 0, filters: [{ field: 'type', keyword: 'Person' }], facets: [{ field: 'gender', size: 12 }] }) || {};
  const counts = {};
  for (const [k, v] of facetEntries(j, 'gender')) counts[k] = v;
  const total = (((j._metadata || {}).resultset || {}).count) || 0;
  counts.Unrecorded = Math.max(0, total - GENDERS.reduce((s, g) => s + (counts[g] || 0), 0));
  return { total, counts };
}

(async () => {
  if (!process.env.TEPAPA_API_KEY) { console.error('No TEPAPA_API_KEY in environment/.env'); process.exit(1); }
  const t0 = Date.now();
  console.log('Computing full-population people-by-gender (role + collection)…');

  const base = await baseline();

  // 1) Global per-role id lists.
  const globalEnt = {};
  for (const r of ROLES) globalEnt[r.key] = await roleIds(r);

  // 2) Collection token lists, split by record type.
  const objCols = facetEntries(await search({ query: '*', size: 0, filters: [{ field: 'type', keyword: 'Object' }], facets: [{ field: 'collection', size: 50 }] }), 'collection').map(([k]) => k);
  const specCols = facetEntries(await search({ query: '*', size: 0, filters: [{ field: 'type', keyword: 'Specimen' }], facets: [{ field: 'collection', size: 50 }] }), 'collection').map(([k]) => k);
  const colsFor = (r) => (r.scope === 'object' ? objCols : specCols);

  // 3) Per-collection id lists (every collection's makers/collectors/depicted).
  const perColEnt = { maker: {}, collector: {}, subject: {} };
  for (const r of ROLES) {
    for (const col of colsFor(r)) {
      perColEnt[r.key][col] = await roleIds(r, col);
      process.stdout.write(`\r  facets: ${r.label} / ${collectionLabel(col)}                 `);
    }
  }
  process.stdout.write('\n');

  // 4) Resolve gender for every linked id (per-collection ids ⊆ these globals).
  // Fetch per role at low concurrency; mark a chunk done only on a real response,
  // and re-queue any id that didn't resolve until the set is exhausted — so a
  // throttled chunk is retried, never silently dropped.
  const idGender = new Map();   // person id -> gender (absent => non-Person / org)
  const fetched = new Set();    // ids confirmed seen in a successful chunk
  async function resolveGenders(idList) {
    let todo = idList.filter((id) => !fetched.has(id));
    for (let round = 0; todo.length && round < 8; round++) {
      const chunks = [];
      for (let i = 0; i < todo.length; i += CHUNK) chunks.push(todo.slice(i, i + CHUNK));
      let done = 0;
      await pool(chunks, CONCURRENCY, async (chunk) => {
        const pj = await search({ query: 'id:(' + chunk.join(' OR ') + ')', size: CHUNK, filters: [{ field: 'type', keyword: 'Person' }] });
        if (pj) {
          (pj.results || pj.records || []).forEach((r) => idGender.set(String(r.id), normGender(r.gender)));
          chunk.forEach((id) => fetched.add(id));
        }
        process.stdout.write(`\r  gender: ${++done}/${chunks.length} chunks · ${fetched.size.toLocaleString()} resolved   `);
      });
      todo = idList.filter((id) => !fetched.has(id));
    }
  }
  for (const r of ROLES) await resolveGenders(globalEnt[r.key].map(([id]) => id));
  process.stdout.write('\n');

  // 4b) Validation gate: the record-fetch above can under-resolve under throttle,
  // and "persons + nonPerson = total" can't catch it (a dropped person just
  // miscounts as non-Person). Cross-check each role's people count against the
  // lighter, throttle-resistant gender FACET (1000-id chunks, size:0).
  async function facetPeople(idList) {
    let persons = 0;
    for (let i = 0; i < idList.length; i += 1000) {
      const j = await search({ query: 'id:(' + idList.slice(i, i + 1000).join(' OR ') + ')', size: 0, filters: [{ field: 'type', keyword: 'Person' }] });
      if (j) persons += (((j._metadata || {}).resultset || {}).count) || 0;
    }
    return persons;
  }
  for (const r of ROLES) {
    const ref = await facetPeople(globalEnt[r.key].map(([id]) => id));
    const mapPersons = globalEnt[r.key].filter(([id]) => idGender.has(id)).length;
    const pass = ref === 0 || Math.abs(mapPersons - ref) / ref < 0.01;
    console.log(`  validate ${r.label}: map ${mapPersons.toLocaleString()} vs facet ${ref.toLocaleString()} people  ${pass ? '✓' : '✗ MISMATCH — rerun'}`);
  }

  // 5) Aggregate the global view and every per-collection view from the map.
  const roles = ROLES.map((r) => ({ key: r.key, label: r.label, type: r.type, field: r.field, scope: r.scope, distinctIds: globalEnt[r.key].length, ...aggregate(globalEnt[r.key], idGender) }));
  const byCollection = {};
  for (const r of ROLES) {
    byCollection[r.key] = colsFor(r)
      .map((col) => ({ collection: col, label: collectionLabel(col), ...aggregate(perColEnt[r.key][col], idGender) }))
      .filter((c) => c.persons > 0)
      .sort((a, b) => b.totalLinks - a.totalLinks);
  }

  const out = {
    generatedAt: new Date().toISOString().slice(0, 10),
    note: 'Full-population gender of people linked to collection records, by role and by collection — every linked person counted (no top-N cap). "By works" weights each person by how many records they are linked to. Organisations and unnamed agents have no gender and are excluded from these counts. "Unrecorded" = a Person record with no gender in the source data.',
    baseline: base,
    roles,
    byCollection,
  };
  const file = path.join(__dirname, 'public', 'people-gender.json');
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`\nWrote ${file}  (${((Date.now() - t0) / 1000).toFixed(0)}s, ${fetched.size.toLocaleString()} ids resolved)`);
  for (const r of roles) console.log(`  ${r.label}: ${r.persons.toLocaleString()} people · ${byCollection[r.key].length} collections`);
})();
