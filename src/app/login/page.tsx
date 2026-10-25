'use client';

import { useState } from 'react';
import { safeNext } from '@/lib/safeNext';
import { createClient } from '@/lib/supabase-browser';

/** Návrat po prihlásení (napr. na pozvánku) — len relatívna cesta v rámci appky. */
function nextQuery(): string {
  const safe = safeNext(new URLSearchParams(window.location.search).get('next'));
  return safe ? `?next=${encodeURIComponent(safe)}` : '';
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const value = email.trim();
    if (!value) return;
    setState('sending');
    const { error } = await createClient().auth.signInWithOtp({
      email: value,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback${nextQuery()}` },
    });
    if (error) {
      setError(error.message);
      setState('error');
    } else {
      setState('sent');
    }
  }

  return (
    <main className="wrap" style={{ maxWidth: 420 }}>
      <h1>Prihlásenie</h1>
      {state === 'sent' ? (
        <p>Poslali sme ti prihlasovací odkaz na <b>{email.trim()}</b>.</p>
      ) : (
        <form onSubmit={submit} className="card" style={{ display: 'grid', gap: 12 }}>
          <label>
            E-mail
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: '100%' }} />
          </label>
          <button type="submit" disabled={state === 'sending'}>
            {state === 'sending' ? 'Posielam…' : 'Poslať prihlasovací odkaz'}
          </button>
          {state === 'error' && <p style={{ color: 'crimson', margin: 0 }}>{error}</p>}
        </form>
      )}
    </main>
  );
}
