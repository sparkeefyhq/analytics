/**
 * In-app answers, one per chat turn. 7 Nov: when Wingman's first answer is repaired, the backend logs a
 * second successful call (product wingman_turn_recovery) under the SAME request id as the turn. Counting
 * rows made Karan's 8 messages show as 11 chats. Keep the first completed row per (user, request).
 * Rows without a request id (older backends) are kept as they are.
 */
export interface ReplyFact {
  user: string;
  at: string;
  kind: string;
  request?: string;
}

export function oneReplyPerTurn(facts: ReplyFact[]): { id: string; at: string }[] {
  const firstByTurn = new Map<string, ReplyFact>();
  const out: { id: string; at: string }[] = [];
  for (const f of facts) {
    if (f.kind !== 'complete') continue;
    if (!f.request) {
      out.push({ id: f.user, at: f.at });
      continue;
    }
    const key = `${f.user.toLowerCase()}|${f.request}`;
    const seen = firstByTurn.get(key);
    if (!seen || Date.parse(f.at) < Date.parse(seen.at)) firstByTurn.set(key, f);
  }
  for (const f of firstByTurn.values()) out.push({ id: f.user, at: f.at });
  return out.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}
