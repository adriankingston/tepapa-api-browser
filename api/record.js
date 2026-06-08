// GET /api/record?href=… — fetch one full record (for "Open full details").
const { tepapaRequest, readQuery, sendJson, apiKey } = require('../lib/tepapa');

module.exports = async (req, res) => {
  if (!apiKey()) return sendJson(res, 500, { error: 'No API key configured.' });
  const href = readQuery(req).href || '';
  if (!/^https:\/\/data\.tepapa\.govt\.nz\/collection\//.test(href)) {
    return sendJson(res, 400, { error: 'Invalid href' });
  }
  try {
    const r = await tepapaRequest('GET', href);
    sendJson(res, r.status || 200, r.json || {});
  } catch (e) {
    sendJson(res, 502, { error: 'Upstream failed', detail: String(e) });
  }
};
