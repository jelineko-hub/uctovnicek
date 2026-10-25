'use client';

import { useState } from 'react';
import { createClient } from '@/lib/supabase-browser';

export function PasswordForm() {
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setDone(false);
    if (password.length < 8) return setError('Heslo musí mať aspoň 8 znakov.');
    if (password !== again) return setError('Heslá sa nezhodujú.');
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) return setError(error.message);
    setPassword('');
    setAgain('');
    setDone(true);
  }

  return (
    <form onSubmit={submit} style={{ display: 'grid', gap: 12 }}>
      <label>
        Nové heslo
        <input type="password" autoComplete="new-password" required minLength={8} value={password}
          onChange={(e) => setPassword(e.target.value)} style={{ width: '100%' }} />
      </label>
      <label>
        Nové heslo znova
        <input type="password" autoComplete="new-password" required value={again}
          onChange={(e) => setAgain(e.target.value)} style={{ width: '100%' }} />
      </label>
      <button type="submit" disabled={busy}>{busy ? 'Ukladám…' : 'Uložiť heslo'}</button>
      {error && <p className="error" style={{ margin: 0 }}>{error}</p>}
      {done && <p style={{ margin: 0 }}>Heslo je zmenené.</p>}
    </form>
  );
}
