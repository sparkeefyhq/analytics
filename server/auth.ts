/**
 * Sign-in: an allow-listed email plus the shared dashboard password, kept in a
 * signed, HttpOnly cookie for 7 days. Same settings as the previous Control
 * dashboard (SPARKEEFY_LOGIN_PASSWORD, SPARKEEFY_SESSION_SECRET), so existing
 * team members sign in exactly as before.
 */

export const SESSION_COOKIE = 'keefie_control_session';
const SESSION_SECONDS = 60 * 60 * 24 * 7;

const DEFAULT_ALLOWED = [
  'sarthakverma0802@gmail.com',
  'rahulpandey.creates@gmail.com',
  'ashmitsinghbhadoria1975@gmail.com',
  'nabeelahmad.dbg@gmail.com',
  'yogiroshan2005@gmail.com',
  'fahadchampion1@gmail.com',
  'aniketraj08309@gmail.com',
];

type SessionPayload = { email: string; expiresAt: number };

function allowed(): Set<string> {
  const extra = (process.env.CONTROL_ALLOWED_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return new Set([...DEFAULT_ALLOWED, ...extra]);
}

function secret(name: 'SPARKEEFY_LOGIN_PASSWORD' | 'SPARKEEFY_SESSION_SECRET'): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing runtime setting ${name}`);
  return value;
}

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
const encode = (text: string) => b64url(new TextEncoder().encode(text));
const decode = (value: string) => {
  const base64 = value.replaceAll('-', '+').replaceAll('_', '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return new TextDecoder().decode(Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)));
};

async function hmac(value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret('SPARKEEFY_SESSION_SECRET')),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))));
}

async function sha256(value: string): Promise<string> {
  return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}

function sameString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export const normaliseEmail = (email: string) => email.trim().toLowerCase();

/**
 * 7 Nov (audit): who may read people's in-app conversations and email in the detail panel.
 * CONTROL_CONVERSATION_EMAILS (comma list) narrows it; unset = every signed-in member (as before).
 */
export function canSeeConversations(email: string): boolean {
  const list = (process.env.CONTROL_CONVERSATION_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return list.length === 0 || list.includes(normaliseEmail(email));
}
/**
 * 11 Nov (Sarthak): the overlay chat reader shows real users' WhatsApp /
 * Instagram / Snapchat threads for training. It is founder-only — tighter than
 * canSeeConversations — so it never reaches the rest of the team even though
 * everyone shares one dashboard password (each member signs in with their own
 * email, which is what we check here). CONTROL_FOUNDER_EMAILS (comma list)
 * overrides; unset = the founder only.
 */
const DEFAULT_FOUNDERS = ['sarthakverma0802@gmail.com'];
export function canSeeOverlayChats(email: string): boolean {
  const list = (process.env.CONTROL_FOUNDER_EMAILS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const founders = list.length > 0 ? list : DEFAULT_FOUNDERS;
  return founders.includes(normaliseEmail(email));
}
export const emailAllowed = (email: string) => allowed().has(normaliseEmail(email));

export async function passwordMatches(candidate: string): Promise<boolean> {
  return sameString(await sha256(candidate), await sha256(secret('SPARKEEFY_LOGIN_PASSWORD')));
}

export async function sessionCookie(email: string): Promise<string> {
  const payload = encode(JSON.stringify({ email: normaliseEmail(email), expiresAt: Date.now() + SESSION_SECONDS * 1000 }));
  return `${SESSION_COOKIE}=${payload}.${await hmac(payload)}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export const clearCookie = () => `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

export async function getSession(request: Request): Promise<SessionPayload | null> {
  if (!process.env.SPARKEEFY_LOGIN_PASSWORD || !process.env.SPARKEEFY_SESSION_SECRET) return null;
  const raw = request.headers
    .get('cookie')
    ?.split(';')
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${SESSION_COOKIE}=`))
    ?.slice(SESSION_COOKIE.length + 1);
  if (!raw) return null;
  const dot = raw.lastIndexOf('.');
  if (dot < 1) return null;
  const payload = raw.slice(0, dot);
  if (!sameString(raw.slice(dot + 1), await hmac(payload))) return null;
  try {
    const parsed = JSON.parse(decode(payload)) as SessionPayload;
    if (!emailAllowed(parsed.email) || parsed.expiresAt <= Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}
