import Link from 'next/link';
import { signOut } from '@/app/app/actions';
import { createClient } from '@/lib/supabase-server';

/** E-mail prihláseného účtu + odhlásenie (pri viacerých účtoch treba vidieť, kto je prihlásený). */
export async function AccountBar({ next }: { next?: string } = {}) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  return (
    <form action={signOut} className="account-bar">
      {next && <input type="hidden" name="next" value={next} />}
      <Link href="/app/ucet" className="muted small">{user.email}</Link>
      <button type="submit" className="link small">Odhlásiť</button>
    </form>
  );
}
