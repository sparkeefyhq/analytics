import { useEffect, useState } from "react";
import { Megaphone, Send } from "lucide-react";

type Campaign = {
  id: string;
  name: string;
  title: string;
  body: string;
  status: string;
  sentAt: string | null;
  createdAt: string;
};

/**
 * Send a push notification to every user right now. Proxies to the backend's
 * existing campaign API (create with no segment → targets everyone, then
 * send immediately) — no scheduling, no segmentation UI. That's a deliberate
 * v0: the ask was "hardcoded notification to everyone whenever we want."
 */
export function Broadcast({ canEdit, onLogin }: { canEdit: boolean; onLogin: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [deepLink, setDeepLink] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ targeted: number; enqueued: number } | null>(null);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [recent, setRecent] = useState<Campaign[]>([]);
  const [loadingRecent, setLoadingRecent] = useState(true);

  const loadRecent = async () => {
    setLoadingRecent(true);
    try {
      const response = await fetch("/api/admin/broadcast");
      if (response.ok) {
        const data = (await response.json()) as { campaigns?: Campaign[] };
        setRecent((data.campaigns || []).slice(0, 10));
      }
    } catch {
      /* Recent-sends history is a nice-to-have; a failed load doesn't block sending. */
    } finally {
      setLoadingRecent(false);
    }
  };
  useEffect(() => {
    if (canEdit) void loadRecent();
  }, [canEdit]);

  const send = async () => {
    setSending(true);
    setError("");
    setResult(null);
    try {
      const response = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, body, deepLink: deepLink || null }),
      });
      const data = (await response.json()) as {
        result?: { targeted: number; enqueued: number };
        error?: string;
      };
      if (!response.ok || !data.result) throw Error(data.error || "Unable to send broadcast.");
      setResult(data.result);
      setTitle("");
      setBody("");
      setDeepLink("");
      void loadRecent();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to send broadcast.");
    } finally {
      setSending(false);
      setConfirming(false);
    }
  };

  if (!canEdit)
    return (
      <section className="control-page">
        <header className="control-header">
          <div>
            <p className="v2-eyebrow">ADMIN</p>
            <h1>Notify</h1>
          </div>
        </header>
        <article className="signal-card phase-placeholder">
          <p className="card-eyebrow">RESTRICTED</p>
          <h2>Founder sign-in required</h2>
          <p>Sending a broadcast notification is restricted to the founder account.</p>
          <button className="control-secondary" onClick={onLogin}>Sign in</button>
        </article>
      </section>
    );

  return (
    <section className="control-page">
      <header className="control-header">
        <div>
          <p className="v2-eyebrow">ADMIN</p>
          <h1><Megaphone size={30} aria-hidden="true" style={{ verticalAlign: "-4px", marginRight: 8 }} />Notify</h1>
          <p>Send a push notification to every user right now. No scheduling, no segments — just everyone, immediately.</p>
        </div>
      </header>

      <article className="signal-card phase-placeholder" style={{ padding: 22, display: "grid", gap: 14 }}>
        <label style={{ display: "grid", gap: 5 }}>
          <small style={{ color: "var(--cm)", fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>Title</small>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={120}
            placeholder="e.g. Sparkeefy is live"
            style={{ padding: "9px 11px", borderRadius: 8, border: "1px solid var(--cl)", background: "var(--cr)", color: "var(--ci)" }}
          />
        </label>
        <label style={{ display: "grid", gap: 5 }}>
          <small style={{ color: "var(--cm)", fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>Body</small>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            maxLength={500}
            rows={3}
            placeholder="What do you want everyone to see?"
            style={{ padding: "9px 11px", borderRadius: 8, border: "1px solid var(--cl)", background: "var(--cr)", color: "var(--ci)", resize: "vertical", fontFamily: "inherit" }}
          />
        </label>
        <label style={{ display: "grid", gap: 5 }}>
          <small style={{ color: "var(--cm)", fontSize: 10, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase" }}>Deep link (optional)</small>
          <input
            value={deepLink}
            onChange={(e) => setDeepLink(e.target.value)}
            placeholder="sparkeefy://wingman"
            style={{ padding: "9px 11px", borderRadius: 8, border: "1px solid var(--cl)", background: "var(--cr)", color: "var(--ci)" }}
          />
        </label>
        {!confirming ? (
          <button
            className="control-primary"
            disabled={!title.trim() || !body.trim() || sending}
            onClick={() => setConfirming(true)}
            style={{ justifySelf: "start", display: "flex", alignItems: "center", gap: 7 }}
          >
            <Send size={13} aria-hidden="true" />Send to everyone
          </button>
        ) : (
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <span style={{ color: "#ffc2be", fontSize: 11 }}>Send now to every user? This can't be recalled.</span>
            <button className="control-primary" disabled={sending} onClick={() => void send()}>
              {sending ? "Sending…" : "Confirm send"}
            </button>
            <button className="control-secondary" disabled={sending} onClick={() => setConfirming(false)}>Cancel</button>
          </div>
        )}
        {result && (
          <p style={{ color: "#9ae2bb", fontSize: 11 }}>
            Sent to {result.targeted} user{result.targeted === 1 ? "" : "s"} ({result.enqueued} queued).
          </p>
        )}
        {error && <p style={{ color: "#ffc2be", fontSize: 11 }}>{error}</p>}
      </article>

      <article className="signal-card phase-placeholder" style={{ marginTop: 16, padding: 22 }}>
        <p className="card-eyebrow">RECENT SENDS</p>
        {loadingRecent ? (
          <p style={{ color: "var(--cm)", fontSize: 11 }}>Loading…</p>
        ) : recent.length === 0 ? (
          <p style={{ color: "var(--cm)", fontSize: 11 }}>No broadcasts sent yet.</p>
        ) : (
          <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
            {recent.map((c) => (
              <div key={c.id} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 8, borderTop: "1px solid var(--cl)", paddingTop: 10 }}>
                <div>
                  <b style={{ fontSize: 12 }}>{c.title}</b>
                  <p style={{ margin: "3px 0 0", color: "var(--cm)", fontSize: 11 }}>{c.body}</p>
                </div>
                <span style={{ color: "var(--cm)", fontSize: 10, whiteSpace: "nowrap" }}>
                  {c.status}{c.sentAt ? ` · ${new Date(c.sentAt).toLocaleString()}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}
