'use client';

import { useState } from 'react';
import { safeNext } from '@/lib/safeNext';
import { createClient } from '@/lib/supabase-browser';

type Mode = 'password' | 'signup' | 'link' | 'reset';

const TITLES: Record<Mode, string> = {
  password: 'Prihlásenie',
  signup: 'Nový účet',
  link: 'Prihlásenie odkazom',
  reset: 'Zabudnuté heslo',
};

/** Návrat po prihlásení (napr. na pozvánku) — len relatívna cesta v rámci appky. */
function nextPath(): string | null {
  return safeNext(new URLSearchParams(window.location.search).get('next'));
}

function callbackUrl(next: string | null): string {
  return `${window.location.origin}/auth/callback${next ? `?next=${encodeURIComponent(next)}` : ''}`;
}

const MESSAGES: Record<string, string> = {
  'Invalid login credentials': 'Nesprávny e-mail alebo heslo.',
  'Email not confirmed': 'E-mail ešte nie je potvrdený — klikni na odkaz v potvrdzovacom e-maile.',
  'User already registered': 'Účet s týmto e-mailom už existuje — prihlás sa heslom.',
  'email rate limit exceeded': 'Príliš veľa e-mailov za krátky čas — skús to neskôr alebo sa prihlás heslom.',
};
const message = (m: string) => MESSAGES[m] ?? m;

export default function LoginPage() {
  const [mode, setMode] = useState<Mode>('password');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');

  function switchMode(m: Mode) {
    setMode(m);
    setError('');
    setInfo('');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const mail = email.trim();
    if (!mail) return;
    setBusy(true);
    setError('');
    setInfo('');
    const auth = createClient().auth;
    const next = nextPath();
    let res: { error: { message: string } | null; signedIn?: boolean };

    if (mode === 'password') {
      const r = await auth.signInWithPassword({ email: mail, password });
      res = { error: r.error, signedIn: !r.error };
    } else if (mode === 'signup') {
      const r = await auth.signUp({ email: mail, password, options: { emailRedirectTo: callbackUrl(next) } });
      res = { error: r.error, signedIn: !!r.data.session };
      if (!r.error && !r.data.session) setInfo(`Poslali sme potvrdzovací e-mail na ${mail}. Po potvrdení sa prihlás heslom.`);
    } else if (mode === 'link') {
      const r = await auth.signInWithOtp({ email: mail, options: { emailRedirectTo: callbackUrl(next) } });
      res = { error: r.error };
      if (!r.error) setInfo(`Poslali sme prihlasovací odkaz na ${mail}.`);
    } else {
      const r = await auth.resetPasswordForEmail(mail, { redirectTo: callbackUrl('/app/ucet') });
      res = { error: r.error };
      if (!r.error) setInfo(`Poslali sme odkaz na nastavenie hesla na ${mail}.`);
    }

    if (res.error) {
      setError(message(res.error.message));
      setBusy(false);
    } else if (res.signedIn) {
      // Celé načítanie stránky, aby server videl novú session v cookies.
      window.location.assign(next ?? '/app');
    } else {
      setBusy(false);
    }
  }

  const needsPassword = mode === 'password' || mode === 'signup';
  const submitLabel: Record<Mode, string> = {
    password: 'Prihlásiť sa',
    signup: 'Vytvoriť účet',
    link: 'Poslať prihlasovací odkaz',
    reset: 'Poslať odkaz na nové heslo',
  };

  return (
    <main className="wrap" style={{ maxWidth: 420 }}>
      <h1>{TITLES[mode]}</h1>
      <form onSubmit={submit} className="card" style={{ display: 'grid', gap: 12 }}>
        <label>
          E-mail
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            style={{ width: '100%' }}
          />
        </label>
        {needsPassword && (
          <label>
            Heslo
            <input
              type="password"
              required
              minLength={mode === 'signup' ? 8 : undefined}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ width: '100%' }}
            />
          </label>
        )}
        <button type="submit" disabled={busy}>
          {busy ? 'Moment…' : submitLabel[mode]}
        </button>
        {error && <p style={{ color: 'crimson', margin: 0 }}>{error}</p>}
        {info && <p style={{ margin: 0 }}>{info}</p>}
      </form>
      <p className="muted small" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        {mode !== 'password' && (
          <button type="button" className="link small" onClick={() => switchMode('password')}>Prihlásiť sa heslom</button>
        )}
        {mode !== 'signup' && (
          <button type="button" className="link small" onClick={() => switchMode('signup')}>Vytvoriť účet</button>
        )}
        {mode !== 'reset' && (
          <button type="button" className="link small" onClick={() => switchMode('reset')}>Zabudnuté heslo</button>
        )}
        {mode !== 'link' && (
          <button type="button" className="link small" onClick={() => switchMode('link')}>Prihlásiť sa odkazom na e-mail</button>
        )}
      </p>
    </main>
  );
}
