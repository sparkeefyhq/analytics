/**
 * Founder-only overlay chat reader (11 Nov). Reads stored overlay 1:1 chats
 * through the backend's admin-gated endpoints (same key as the conversation
 * reader) and hands them to the founder page. The dashboard never touches the
 * database directly; the backend owns the SQL.
 *
 * Founder gating happens in the handler (by signed-in email) before any of
 * these run; nothing here is reachable by a non-founder session.
 */

import type { Config } from './config';

export interface OverlayChatUser {
  userId: string;
  name: string | null;
  trafficClass: string | null;
  chats: number;
  lines: number;
  apps: string[];
  lastActivity: string | null;
}

export interface OverlayChatLine {
  from: string;
  text: string;
  fromOverlay: boolean;
}

export interface OverlayChat {
  sourceApp: string;
  titleHash: string;
  updatedAt: string;
  expiresAt: string | null;
  lines: OverlayChatLine[];
}

export interface OverlayUserChats {
  userId: string;
  name: string | null;
  generatedAt: string;
  usage: { drafts: number; inserted: number; sent: number };
  chats: OverlayChat[];
  truncated: boolean;
}

function assertBackend(cfg: Config): void {
  if (!cfg.backendUrl || !cfg.backendAdminKey) throw new Error('backend not configured');
}

async function getJson<T>(cfg: Config, path: string): Promise<T> {
  const response = await fetch(`${cfg.backendUrl}${path}`, {
    headers: { 'x-admin-api-key': cfg.backendAdminKey },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`overlay-chats ${response.status}`);
  const body = (await response.json()) as { data?: T };
  if (!body.data) throw new Error('overlay-chats: empty response');
  return body.data;
}

export async function fetchOverlayChatUsers(cfg: Config): Promise<OverlayChatUser[]> {
  assertBackend(cfg);
  const data = await getJson<{ users?: OverlayChatUser[] }>(cfg, '/api/admin/analytics/v2/overlay-chats/users');
  return (data.users ?? []).slice().sort((a, b) => (b.lastActivity ?? '').localeCompare(a.lastActivity ?? ''));
}

export async function fetchOverlayUserChats(cfg: Config, userId: string): Promise<OverlayUserChats> {
  assertBackend(cfg);
  return getJson<OverlayUserChats>(cfg, `/api/admin/analytics/v2/overlay-chats?user=${encodeURIComponent(userId)}`);
}
