// POST /api/collections — collection-facet breakdown for the collection filter.
const { collectionFacet, readJson, sendJson, apiKey } = require('../lib/tepapa');

module.exports = async (req, res) => {
  if (!apiKey()) return sendJson(res, 500, { error: 'No API key configured.' });
  const p = await readJson(req);
  if (p === null) return sendJson(res, 400, { error: 'Invalid JSON' });
  try {
    sendJson(res, 200, await collectionFacet(p.query, p.type));
  } catch (e) {
    sendJson(res, 502, { error: 'Collection facet failed', detail: String(e) });
  }
};
