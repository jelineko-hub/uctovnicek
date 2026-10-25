import Link from 'next/link';
import { notFound } from 'next/navigation';
import { KIND_SECTIONS, type Kind } from '@/lib/documentKinds';
import { createClient } from '@/lib/supabase-server';
import { APP_VERSION } from '@/lib/version';

const AGENDAS: Kind[] = ['receipt', 'received_invoice', 'issued_invoice', 'cash', 'other'];

export default async function CompanyLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = await params;
  const supabase = await createClient();
  const { data: company } = await supabase
    .from('companies')
    .select('id, name, ico')
    .eq('id', companyId)
    .maybeSingle();
  if (!company) notFound();

  const base = `/app/${company.id}`;
  return (
    <div className="wrap">
      <header className="company-header">
        <div>
          <Link href="/app" className="muted small">← Moje firmy</Link>
          <h1 style={{ margin: '4px 0 0' }}>{company.name}</h1>
          {company.ico && <span className="muted small">IČO {company.ico}</span>}
        </div>
      </header>
      <nav className="tabs">
        <Link href={base}>Nespracované</Link>
        {AGENDAS.map((k) => (
          <Link key={k} href={`${base}/doklady?druh=${k}`}>{KIND_SECTIONS[k]}</Link>
        ))}
        <Link href={`${base}/partneri`}>Partneri</Link>
      </nav>
      {children}
      <p className="muted small" style={{ marginTop: 32 }}>{APP_VERSION}</p>
    </div>
  );
}
