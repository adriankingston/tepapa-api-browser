// GET /api/imgproxy?url=… — pipe a Te Papa media image through our origin.
// The media host 303-redirects to S3 without CORS headers, so the browser can
// display the images but never read their pixels; the list view's edge-extended
// thumbnails are composed on a canvas, which needs same-origin bytes. Locked to
// the Te Papa media host so this can't be used as an open proxy.
const ALLOWED = /^https:\/\/media\.tepapa\.govt\.nz\//;

module.exports = async (req, res) => {
  const url = (req.query && req.query.url) || '';
  if (!ALLOWED.test(url)) {
    res.statusCode = 400;
    return res.end('Only media.tepapa.govt.nz URLs are proxied');
  }
  try {
    const upstream = await fetch(url, { redirect: 'follow' });
    if (!upstream.ok) {
      res.statusCode = 502;
      return res.end(`Upstream ${upstream.status}`);
    }
    res.setHeader('Content-Type', upstream.headers.get('content-type') || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (e) {
    res.statusCode = 502;
    res.end(`Proxy failed: ${e.message}`);
  }
};
