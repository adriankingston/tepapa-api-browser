// GET /api/wikipedia — Wikipedia preview for a person/org (by Wikidata id)
// or a place (by name + coordinate/country check). No Te Papa key needed.
const { wikipediaPreview, readQuery, sendJson } = require('../lib/tepapa');

module.exports = async (req, res) => {
  const q = readQuery(req);
  try {
    const data = await wikipediaPreview({
      wikidata: q.wikidata,
      title: q.title,
      country: q.country || '',
      lat: parseFloat(q.lat),
      lon: parseFloat(q.lon),
    });
    sendJson(res, 200, data || {});
  } catch (e) {
    sendJson(res, 502, { error: 'Wikipedia lookup failed', detail: String(e) });
  }
};
