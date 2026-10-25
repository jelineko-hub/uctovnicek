import Link from 'next/link';
import { AccountBar } from '@/components/AccountBar';
import { createClient } from '@/lib/supabase-server';
import { APP_VERSION } from '@/lib/version';
import { createCompany } from './actions';

export default async function AppHome() {
  const supabase = await createClient();
  const { data: companies } = await supabase
    .from('companies')
    .select('id, name, ico')
    .order('name');

  return (
    <main className="wrap">
      <div className="company-header">
        <h1 style={{ margin: 0 }}>Moje firmy</h1>
        <AccountBar />
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        {companies?.length ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {companies.map((c) => (
              <li key={c.id}>
                <Link href={`/app/${c.id}`}>{c.name}</Link> {c.ico && <span className="muted">IČO {c.ico}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted" style={{ margin: 0 }}>Zatiaľ nemáš žiadnu firmu.</p>
        )}
      </div>
      <form action={createCompany} className="card" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input name="name" placeholder="Názov firmy" required style={{ flex: '1 1 220px' }} />
        <input name="ico" placeholder="IČO" style={{ flex: '0 1 140px' }} />
        <button type="submit">Pridať firmu</button>
      </form>
      <p className="muted">{APP_VERSION}</p>
    </main>
  );
}
