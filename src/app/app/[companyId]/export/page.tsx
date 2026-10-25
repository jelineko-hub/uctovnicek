import { ExportHistory } from '@/components/export/ExportHistory';
import { ExportPreview } from '@/components/export/ExportPreview';
import Link from 'next/link';
import { PeriodsPanel, type PeriodRow } from '@/components/export/PeriodsPanel';
import { closedPeriods } from '@/lib/accounting/service';
import { documentPeriodDate, periodOf, recentPeriods } from '@/lib/accounting/periods';
import { EXPORT_KINDS, isExportKind, periodRange, previousPeriod, type ExportKind } from '@/lib/export/mrpDocument';
import { canExport, exportPreview, listExports, memberRole } from '@/lib/export/service';
import { createClient } from '@/lib/supabase-server';

export default async function ExportPage({
  params,
  searchParams,
}: {
  params: Promise<{ companyId: string }>;
  searchParams: Promise<{ druh?: string; obdobie?: string }>;
}) {
  const { companyId } = await params;
  const sp = await searchParams;
  const kind: ExportKind = isExportKind(sp.druh) ? sp.druh : 'received_invoice';
  const period = sp.obdobie && periodRange(sp.obdobie) ? sp.obdobie : previousPeriod();

  const supabase = await createClient();
  const months = recentPeriods(new Date().toISOString().slice(0, 7), 12);
  const from = `${months[months.length - 1]}-01`;
  const [role, preview, exports, closed, { data: periodDocs }] = await Promise.all([
    memberRole(supabase, companyId),
    exportPreview(supabase, companyId, kind, period),
    listExports(supabase, companyId),
    closedPeriods(supabase, companyId),
    supabase
      .from('documents')
      .select('status, evidence_date, tax_point_date, issue_date')
      .eq('company_id', companyId)
      .or(`evidence_date.gte.${from},tax_point_date.gte.${from},issue_date.gte.${from}`)
      .limit(10000),
  ]);
  const periodRows: PeriodRow[] = months.map((p) => {
    const docs = (periodDocs ?? []).filter((d) => periodOf(documentPeriodDate(d)) === p);
    const n = (s: string) => docs.filter((d) => d.status === s).length;
    return {
      period: p,
      closed: closed.has(p),
      unprocessed: n('unprocessed'),
      ready: n('ready'),
      approved: n('approved'),
      exported: n('exported') + n('archived'),
    };
  });
  const allowed = canExport(role);

  return (
    <>
      <h2>Export do MRP-K/S</h2>
      {!allowed && <p className="note">Exportovať môže účtovník firmy. Ty vidíš len náhľad a históriu.</p>}

      <p className="small muted">
        Číselné rady, Typ DPH, predkontácie a strediská sú v <Link href={`/app/${companyId}/nastavenia`}>Nastaveniach → Číselníky</Link>.
      </p>

      <form className="filters" method="get">
        <select name="druh" defaultValue={kind}>
          {Object.entries(EXPORT_KINDS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <label>Mesiac <input type="month" name="obdobie" defaultValue={period} /></label>
        <button type="submit">Zobraziť</button>
      </form>

      {preview.pending > 0 && (
        <p className="note">
          V tomto mesiaci {preview.pending === 1 ? 'je 1 doklad' : `je ${preview.pending} dokladov`} ešte neschválených — do exportu nepôjdu.
        </p>
      )}

      <ExportPreview
        key={`${kind}-${period}`}
        companyId={companyId}
        kind={kind}
        period={period}
        rows={preview.rows}
        allowed={allowed}
      />

      <h3>Exporty</h3>
      <ExportHistory companyId={companyId} exports={exports} allowed={allowed} />

      <h3>Uzávierky</h3>
      <PeriodsPanel companyId={companyId} rows={periodRows} canClose={role === 'owner' || role === 'accountant'} canOpen={role === 'accountant'} />
    </>
  );
}
