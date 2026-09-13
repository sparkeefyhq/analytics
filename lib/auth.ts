import { env } from './runtime-env';

export const EDITOR_EMAIL = 'sarthakverma0802@gmail.com';
export const SESSION_COOKIE = 'sparkeefy_launch_session';
const SESSION_SECONDS = 60 * 60 * 24 * 7;

const ALLOWED_EMAILS = new Set([
  EDITOR_EMAIL,
  'ashmitsinghbhadoria1975@gmail.com',
  'nabeelahmad.dbg@gmail.com',
  'yogiroshan2005@gmail.com',
  'fahadchampion1@gmail.com',
  'aniketraj08309@gmail.com',
  'rahulpandey.creates@gmail.com',
]);

type SessionPayload = { email: string; expiresAt: number };

function runtimeSecret(key: 'SPARKEEFY_LOGIN_PASSWORD' | 'SPARKEEFY_SESSION_SECRET') {
  const value = (env as unknown as Record<string, string | undefined>)[key];
  if (!value) throw new Error(`Missing required runtime setting: ${key}.`);
  return value;
}

function encode(value: string) {
  return btoa(value).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
}

function decode(value: string) {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return atob(base64);
}

function cookieValue(request: Request, name: string) {
  const item = request.headers.get('cookie')?.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : null;
}

async function sign(value: string) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(runtimeSecret('SPARKEEFY_SESSION_SECRET')),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return encode(String.fromCharCode(...new Uint8Array(signature)));
}

async function signaturesMatch(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  if (leftBytes.length !== rightBytes.length) return false;
  let different = 0;
  for (let index = 0; index < leftBytes.length; index += 1) different |= leftBytes[index] ^ rightBytes[index];
  return different === 0;
}

export function normaliseEmail(email: string) {
  return email.trim().toLowerCase();
}

export function emailIsAllowed(email: string) {
  return ALLOWED_EMAILS.has(normaliseEmail(email));
}

export async function passwordMatches(candidate: string) {
  const expected = runtimeSecret('SPARKEEFY_LOGIN_PASSWORD');
  return signaturesMatch(await sha256(candidate), await sha256(expected));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return encode(String.fromCharCode(...new Uint8Array(digest)));
}

export async function sessionCookie(email: string) {
  const payload = encode(JSON.stringify({ email, expiresAt: Date.now() + SESSION_SECONDS * 1000 } satisfies SessionPayload));
  const signature = await sign(payload);
  return `${SESSION_COOKIE}=${payload}.${signature}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export function clearSessionCookie() {
  return `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export async function getSession(request: Request): Promise<SessionPayload | null> {
  if (!process.env.SPARKEEFY_LOGIN_PASSWORD) return null;
  try {
    const session = cookieValue(request, SESSION_COOKIE);
    if (!session) return null;
    const separator = session.lastIndexOf('.');
    if (separator < 1) return null;
    const payload = session.slice(0, separator);
    const signature = session.slice(separator + 1);
    if (!await signaturesMatch(signature, await sign(payload))) return null;
    const parsed = JSON.parse(decode(payload)) as SessionPayload;
    if (!emailIsAllowed(parsed.email) || parsed.expiresAt <= Date.now()) return null;
    return { email: normaliseEmail(parsed.email), expiresAt: parsed.expiresAt };
  } catch {
    return null;
  }
}

export async function trackerAccess(request: Request) {
  const session = await getSession(request);
  return {
    authenticated: Boolean(session),
    viewerEmail: session?.email ?? null,
    canEdit: session?.email === EDITOR_EMAIL,
  };
}
