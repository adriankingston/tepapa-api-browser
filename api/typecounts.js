// POST /api/typecounts — per-type result counts for the search tabs (one parallel sweep).
const { typeCounts, readJson, sendJson, apiKey } = require('../lib/tepapa');

module.exports = async (req, res) => {
  if (!apiKey()) return sendJson(res, 500, { error: 'No API key configured.' });
  const payload = await readJson(req);
  if (payload === null) return sendJson(res, 400, { error: 'Invalid JSON' });
  try {
    sendJson(res, 200, await typeCounts(payload.query));
  } catch (e) {
    sendJson(res, 502, { error: 'Count failed', detail: String(e) });
  }
};
