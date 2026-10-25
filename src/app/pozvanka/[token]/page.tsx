import Link from 'next/link';
import { AccountBar } from '@/components/AccountBar';
import { previewInvite, ROLE_HELP, ROLE_LABELS } from '@/lib/members/service';
import { createClient } from '@/lib/supabase-server';
import { AcceptInvite } from './AcceptInvite';

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const loginHref = `/login?next=${encodeURIComponent(`/pozvanka/${token}`)}`;

  if (!user) {
    return (
      <main className="wrap" style={{ maxWidth: 520 }}>
        <h1>Pozvánka do Účtovníčka</h1>
        <p>Na prijatie pozvánky sa prihlás e-mailom, na ktorý prišla (ak ešte nemáš účet, na prihlasovacej stránke si ho vytvoríš).</p>
        <Link href={loginHref} className="button">Prihlásiť sa</Link>
      </main>
    );
  }

  const invite = await previewInvite(supabase, token);
  const sameEmail = invite && user.email?.toLowerCase() === invite.email.toLowerCase();
  return (
    <main className="wrap" style={{ maxWidth: 520 }}>
      <div className="company-header">
        <h1 style={{ margin: 0 }}>Pozvánka</h1>
        <AccountBar next={`/pozvanka/${token}`} />
      </div>
      {!invite ? (
        <p className="error">Pozvánka neexistuje alebo bola zrušená.</p>
      ) : invite.accepted ? (
        <p>Pozvánka už bola použitá. <Link href="/app">Prejsť na moje firmy</Link></p>
      ) : invite.expired ? (
        <p className="error">Platnosť pozvánky vypršala. Požiadaj o novú.</p>
      ) : (
        <div className="card">
          <p>
            Pozvánka do firmy <b>{invite.company_name}</b> ako <b>{ROLE_LABELS[invite.role]}</b>{' '}
            <span className="muted">({ROLE_HELP[invite.role]})</span>.
          </p>
          {sameEmail ? (
            <AcceptInvite token={token} />
          ) : (
            <p className="note">
              Pozvánka je pre <b>{invite.email}</b>, ale si prihlásený ako <b>{user.email}</b>. Odhlás sa a prihlás sa
              správnym e-mailom.
            </p>
          )}
        </div>
      )}
    </main>
  );
}
