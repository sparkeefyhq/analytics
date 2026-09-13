import { backendOrigin, forwardHeaders } from './proxy.js';

// Private identity data never travels through the public tracker response.
export default async function users(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('Vary', 'Cookie');
  res.setHeader('Content-Type', 'application/json');
  const send = (status, body) => { res.statusCode = status; res.end(JSON.stringify(body)); };
  if (req.method !== 'GET') { res.setHeader('Allow', 'GET'); return send(405, {error:'Method not allowed.'}); }
  try {
    const origin = backendOrigin();
    const options = {headers: forwardHeaders(req.headers), redirect:'manual', signal:AbortSignal.timeout(15000)};
    const accessResponse = await fetch(`${origin}/api/tracker`, options);
    if ([401,403].includes(accessResponse.status)) return send(403, {error:'Sign in with an authorized staff account.'});
    if (!accessResponse.ok) return send(502, {error:'Unable to verify access.'});
    const access = await accessResponse.json();
    if (access.canEdit !== true || !access.viewerEmail) return send(403, {error:'Sign in with an authorized staff account.'});
    const incoming = new URL(req.url, 'https://control.invalid');
    const target = new URL('/api/control/users', origin);
    for (const key of ['id','cursor']) {
      const value = incoming.searchParams.get(key);
      if (value && value.length > 256) return send(400, {error:'Invalid request.'});
      if (value) target.searchParams.set(key,value);
    }
    const response = await fetch(target, {...options, signal:AbortSignal.timeout(15000)});
    if (response.status === 404) return send(200, {version:1,status:'unavailable',updatedAt:null,users:[],nextCursor:null});
    if ([401,403].includes(response.status)) return send(403, {error:'Access expired. Sign in again.'});
    if (!response.ok) return send(502, {error:'User analytics source is unavailable.'});
    const data = await response.json();
    if (data.version !== 1 || !['available','unavailable','pending'].includes(data.status)) return send(502, {error:'Unsupported user analytics response.'});
    return send(200,data);
  } catch { return send(502, {error:'User analytics is temporarily unavailable.'}); }
}
