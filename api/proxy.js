const PRODUCTION_ORIGIN = 'https://sparkeefy-launch-control.samarthvm-0302.chatgpt.site';

export function backendOrigin() {
  const configured = process.env.SPARKEEFY_BACKEND_ORIGIN;
  // A missing preview setting must never silently send test writes to production.
  if (process.env.VERCEL_ENV === 'preview' && !configured) throw new Error('Preview backend is required.');
  const origin = new URL(configured || PRODUCTION_ORIGIN);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) throw new Error('Invalid backend origin.');
  if (process.env.VERCEL_ENV === 'preview' && origin.origin === PRODUCTION_ORIGIN) throw new Error('Preview must use an isolated backend.');
  return origin.origin;
}

export function forwardHeaders(headers) {
  const result = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (!value || ['host', 'connection', 'content-length', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'oai-sites-authorization'].includes(key.toLowerCase())) continue;
    result.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
  if (process.env.SPARKEEFY_BACKEND_ACCESS_TOKEN) result.set('OAI-Sites-Authorization', `Bearer ${process.env.SPARKEEFY_BACKEND_ACCESS_TOKEN}`);
  return result;
}

async function requestBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined;
  const parts = [];
  for await (const part of req) parts.push(part);
  return Buffer.concat(parts);
}

export default async function proxy(req, res) {
  try {
    const incoming = new URL(req.url, `https://${req.headers.host}`);
    const path = incoming.searchParams.get('path') || '';
    if (!/^api\/[a-z0-9/_-]+$/i.test(path)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Invalid API path.' }));
      return;
    }
    const target = new URL(`/${path}`, backendOrigin());
    for (const [key, value] of incoming.searchParams.entries()) if (key !== 'path') target.searchParams.append(key, value);

    const response = await fetch(target, {
      method: req.method,
      headers: forwardHeaders(req.headers),
      body: await requestBody(req),
      redirect: 'manual',
    });

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (!['content-encoding', 'content-length', 'transfer-encoding'].includes(key.toLowerCase())) res.setHeader(key, value);
    });
    const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
    if (cookies.length) res.setHeader('set-cookie', cookies);
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch {
    res.statusCode = 502;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ error: 'Launch Control is temporarily unavailable.' }));
  }
};
