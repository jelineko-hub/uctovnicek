import { formatIban } from '@/lib/iban';
import { fold, foldedIncludes } from '@/lib/searchText';
import { createClient } from '@/lib/supabase-server';

export default async function PartnersPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { companyId } = await params;
  const { q } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase
    .from('partners')
    .select('id, name, ico, dic, ic_dph, iban, address')
    .eq('company_id', companyId)
    .order('name');
  const needle = fold((q ?? '').trim());
  const rows = (data ?? []).filter((p) => foldedIncludes(needle, p.name, p.ico, p.ic_dph));

  return (
    <>
      <h2>Partneri</h2>
      <p className="muted small">Partneri sa zakladajú automaticky pri potvrdení dokladu (podľa IČO).</p>
      <form className="filters" method="get">
        <input name="q" placeholder="Hľadať názov, IČO, IČ DPH" defaultValue={q ?? ''} />
        <button type="submit">Hľadať</button>
      </form>
      {rows.length === 0 ? (
        <p className="muted">Žiadni partneri.</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Názov</th><th>IČO</th><th>IČ DPH</th><th>Adresa</th><th>IBAN</th></tr></thead>
            <tbody>
              {rows.map((p) => {
                const a = (p.address ?? {}) as { street?: string | null; city?: string | null; zip?: string | null };
                return (
                  <tr key={p.id}>
                    <td>{p.name}</td>
                    <td>{p.ico || '—'}</td>
                    <td>{p.ic_dph || '—'}</td>
                    <td>{[a.street, [a.zip, a.city].filter(Boolean).join(' ')].filter(Boolean).join(', ') || '—'}</td>
                    <td className="nowrap">{p.iban ? formatIban(p.iban) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
