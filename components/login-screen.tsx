'use client';

import { FormEvent, useState } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

export function LoginScreen({ onAuthenticated }: { onAuthenticated: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setIsSubmitting(true);
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? 'Unable to sign in.');
      onAuthenticated();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Unable to sign in.');
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-scene">
      <div className="login-vignette" />
      <section className="login-shell">
        <div className="login-brand"><span className="login-mark"><Sparkles className="size-4" /></span><span>Sparkeefy</span></div>
        <div className="login-card">
          <span className="login-lock"><LockKeyhole className="size-4" /></span>
          <p className="login-kicker">Internal workspace</p>
          <h1>Launch control</h1>
          <p className="login-copy">Sign in to view Sparkeefy’s Android V3 launch roadmap.</p>
          <form className="mt-7 space-y-4" onSubmit={(event) => void submit(event)}>
            <label className="login-field"><span>Email</span><Input type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" /></label>
            <label className="login-field"><span>Password</span><span className="relative block"><Input type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="••••••••••••" className="pr-11" /><button type="button" className="login-password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label={showPassword ? 'Hide password' : 'Show password'}>{showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</button></span></label>
            {error && <p className="rounded-xl border border-red-300/25 bg-red-500/10 px-3 py-2.5 text-xs text-red-100">{error}</p>}
            <Button type="submit" className="login-submit" disabled={isSubmitting}>{isSubmitting ? 'Checking access…' : 'Enter launch control'} <ArrowRight /></Button>
          </form>
          <p className="login-footnote">Access is limited to the Sparkeefy launch team.</p>
        </div>
      </section>
      <p className="login-caption">ANDROID V3 · PRODUCT VALIDATION</p>
    </main>
  );
}
