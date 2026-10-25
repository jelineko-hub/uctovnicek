import { ExportHistory } from '@/components/export/ExportHistory';
import { ExportPreview } from '@/components/export/ExportPreview';
import { MrpSettingsForm } from '@/components/export/MrpSettingsForm';
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
  const [role, preview, exports] = await Promise.all([
    memberRole(supabase, companyId),
    exportPreview(supabase, companyId, kind, period),
    listExports(supabase, companyId),
  ]);
  const allowed = canExport(role);

  return (
    <>
      <h2>Export do MRP-K/S</h2>
      {!allowed && <p className="note">Exportovať môže účtovník firmy. Ty vidíš len náhľad a históriu.</p>}

      <details className="card" style={{ marginBottom: 16 }}>
        <summary>Nastavenie exportu (číselné rady a Typ DPH v MRP)</summary>
        <MrpSettingsForm companyId={companyId} settings={preview.settings} editable={role === 'owner' || role === 'accountant'} />
      </details>

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
    </>
  );
}
