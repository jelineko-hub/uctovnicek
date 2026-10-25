import Link from 'next/link';
import { DOC_COLUMNS, DocumentTable, type DocumentRow } from '@/components/DocumentTable';
import { KIND_SECTIONS, STATUSES, isKey } from '@/lib/documentKinds';
import { fold, foldedIncludes } from '@/lib/searchText';
import { createClient } from '@/lib/supabase-server';

export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ druh?: string; stav?: string; q?: string; od?: string; do?: string; po_splatnosti?: string }>;
}) {
  const { companyId } = await params;
  const sp = await searchParams;
  const kind = isKey(KIND_SECTIONS, sp.druh) ? sp.druh : null;
  const status = isKey(STATUSES, sp.stav) ? sp.stav : null;

  const supabase = await createClient();
  let query = supabase
    .from('documents')
    .select(DOC_COLUMNS)
    .eq('company_id', companyId)
    .neq('status', 'unprocessed')
    .order('issue_date', { ascending: false, nullsFirst: false })
    .limit(500);
  if (kind) query = query.eq('kind', kind);
  if (status) query = query.eq('status', status);
  if (sp.od) query = query.gte('issue_date', sp.od);
  if (sp.do) query = query.lte('issue_date', sp.do);
  const overdue = sp.po_splatnosti === '1';
  if (overdue) {
    query = query
      .lt('due_date', new Date().toISOString().slice(0, 10))
      .neq('payment_status', 'paid')
      .neq('status', 'rejected');
  }
  const { data } = await query;

  const needle = fold((sp.q ?? '').trim());
  const rows = ((data ?? []) as DocumentRow[]).filter((d) =>
    foldedIncludes(needle, d.partner_snapshot?.name, d.original_number),
  );

  return (
    <>
      <h2>
        {kind ? KIND_SECTIONS[kind] : 'Všetky doklady'}
        {overdue && <span className="muted"> — po splatnosti, nezaplatené</span>}
      </h2>
      <form className="filters" method="get">
        {kind && <input type="hidden" name="druh" value={kind} />}
        <input name="q" placeholder="Hľadať partnera alebo číslo" defaultValue={sp.q ?? ''} />
        <label>Od <input type="date" name="od" defaultValue={sp.od ?? ''} /></label>
        <label>Do <input type="date" name="do" defaultValue={sp.do ?? ''} /></label>
        <select name="stav" defaultValue={status ?? ''}>
          <option value="">Všetky stavy</option>
          {Object.entries(STATUSES)
            .filter(([k]) => k !== 'unprocessed')
            .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <button type="submit">Filtrovať</button>
        <Link href={`/app/${companyId}/doklady${kind ? `?druh=${kind}` : ''}`} className="small">Zrušiť filter</Link>
      </form>
      <DocumentTable companyId={companyId} rows={rows} showKind={!kind} />
    </>
  );
}
