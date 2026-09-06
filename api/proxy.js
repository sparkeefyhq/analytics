const ORIGIN = 'https://sparkeefy-launch-control.samarthvm-0302.chatgpt.site';

function forwardHeaders(headers) {
  const result = new Headers();
  for (const [key, value] of Object.entries(headers)) {
    if (!value || ['host', 'connection', 'content-length', 'x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'].includes(key.toLowerCase())) continue;
    result.set(key, Array.isArray(value) ? value.join(', ') : value);
  }
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
    const target = new URL(`${ORIGIN}/${path.replace(/^\/+/, '')}`);
    for (const [key, value] of incoming.searchParams.entries()) if (key !== 'path') target.searchParams.append(key, value);

    const response = await fetch(target, {
      method: req.method,
      headers: forwardHeaders(req.headers),
      body: await requestBody(req),
      redirect: 'manual',
    });

    res.statusCode = response.status;
    response.headers.forEach((value, key) => {
      if (!['content-encoding', 'transfer-encoding'].includes(key.toLowerCase())) res.setHeader(key, value);
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
