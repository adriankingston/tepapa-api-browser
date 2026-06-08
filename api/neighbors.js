// POST /api/neighbors — build the relationship-graph neighbourhood of one record.
const { buildNeighbors, readJson, sendJson, apiKey } = require('../lib/tepapa');

module.exports = async (req, res) => {
  if (!apiKey()) return sendJson(res, 500, { error: 'No API key configured.' });
  const payload = await readJson(req);
  if (payload === null) return sendJson(res, 400, { error: 'Invalid JSON' });
  try {
    sendJson(res, 200, await buildNeighbors(payload.href, payload.autoThreshold));
  } catch (e) {
    sendJson(res, 502, { error: 'Could not build neighbours', detail: String(e) });
  }
};
