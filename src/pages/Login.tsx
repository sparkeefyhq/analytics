import { useState } from 'react';

export function Login({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Sign-in failed.');
      onDone();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card" onSubmit={submit}>
        <div className="lhead">
          <div className="brand-logo"><img src="/keefie-logo.png" alt="" /></div>
          <div>
            <h1>Keefie Control Plane</h1>
            <div className="sub" style={{ margin: 0 }}>Team sign-in</div>
          </div>
        </div>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="password">Password</label>
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        <button className="go" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {error && <div className="err">{error}</div>}
      </form>
    </div>
  );
}
