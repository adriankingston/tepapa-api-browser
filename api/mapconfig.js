// GET /api/mapconfig — non-secret client map config. Exposes the LINZ Basemaps
// API key so the browser can request LINZ tiles directly (LINZ standard keys are
// designed for client-side use). Kept server-side in .env so it can be renewed
// (standard keys expire ~90 days) without a code change. Null when unset.
module.exports = (req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify({ linz: process.env.LINZ_API_KEY || null }));
};
