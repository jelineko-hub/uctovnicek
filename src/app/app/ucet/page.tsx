import Link from 'next/link';
import { AccountBar } from '@/components/AccountBar';
import { PasswordForm } from './PasswordForm';

export default function AccountPage() {
  return (
    <main className="wrap" style={{ maxWidth: 520 }}>
      <div className="company-header">
        <h1 style={{ margin: 0 }}>Môj účet</h1>
        <AccountBar />
      </div>
      <p><Link href="/app">← Moje firmy</Link></p>
      <div className="card">
        <h2 style={{ marginTop: 0 }}>Heslo</h2>
        <p className="muted small">Účet je spoločný s ďalšími aplikáciami na rovnakom prihlásení — nové heslo platí aj tam.</p>
        <PasswordForm />
      </div>
    </main>
  );
}
