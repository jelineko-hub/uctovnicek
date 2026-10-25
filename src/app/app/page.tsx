import Link from 'next/link';
import { AccountBar } from '@/components/AccountBar';
import { periodLabel } from '@/lib/accounting/periods';
import { EXPORT_STATUSES, type ExportStatus } from '@/lib/export/mrpDocument';
import { ROLE_LABELS } from '@/lib/members/roles';
import { companyOverview, type OverviewRow } from '@/lib/members/service';
import { createClient } from '@/lib/supabase-server';
import { APP_VERSION } from '@/lib/version';
import { createCompany } from './actions';

/** Počet s odkazom na filtrovaný zoznam; nula sa zobrazí sivo bez odkazu. */
function Count({ n, href, warn }: { n: number; href: string; warn?: boolean }) {
  if (!n) return <span className="muted">0</span>;
  return <Link href={href} className={warn ? 'error' : undefined}><b>{n}</b></Link>;
}

export default async function AppHome() {
  const supabase = await createClient();
  const rows = await companyOverview(supabase);
  // Účtovník/schvaľovateľ aspoň v jednej firme → plný prehľad; majiteľ → „čo mi chýba".
  const checker = rows.some((r) => r.role === 'accountant' || r.role === 'approver');
  const base = (r: OverviewRow) => `/app/${r.company_id}`;

  return (
    <main className="wrap">
      <div className="company-header">
        <h1 style={{ margin: 0 }}>Moje firmy</h1>
        <AccountBar />
      </div>
      <div className="card" style={{ marginBottom: 16 }}>
        {rows.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Firma</th>
                  {checker && <th>Moja rola</th>}
                  <th className="num">Nespracované</th>
                  {checker && <th className="num">Na schválenie</th>}
                  {checker && <th className="num">Schválené, neexportované</th>}
                  <th className="num">Zamietnuté</th>
                  <th className="num" title="Prijaté faktúry po splatnosti, ktoré nie sú označené ako zaplatené">Mám zaplatiť</th>
                  <th className="num" title="Vydané faktúry po splatnosti, ktoré nie sú označené ako zaplatené">Dlžia mne</th>
                  {checker && <th>Posledný export</th>}
                  <th>Uzavreté do</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.company_id}>
                    <td>
                      <Link href={base(r)}>{r.name}</Link>
                      {r.ico && <div className="muted small">IČO {r.ico}</div>}
                    </td>
                    {checker && <td className="small">{ROLE_LABELS[r.role] ?? r.role}</td>}
                    <td className="num"><Count n={r.unprocessed} href={base(r)} /></td>
                    {checker && <td className="num"><Count n={r.ready} href={`${base(r)}/doklady?stav=ready`} /></td>}
                    {checker && <td className="num"><Count n={r.approved} href={`${base(r)}/export`} /></td>}
                    <td className="num"><Count n={r.rejected} href={`${base(r)}/doklady?stav=rejected`} warn /></td>
                    <td className="num">
                      <Count n={r.overdue_received} href={`${base(r)}/doklady?druh=received_invoice&po_splatnosti=1`} warn />
                    </td>
                    <td className="num">
                      <Count n={r.overdue_issued} href={`${base(r)}/doklady?druh=issued_invoice&po_splatnosti=1`} warn />
                    </td>
                    {checker && (
                      <td className="small">
                        {r.last_export_at ? (
                          <>
                            {new Date(r.last_export_at).toLocaleDateString('sk-SK')}{' '}
                            <span className="muted">{EXPORT_STATUSES[r.last_export_status as ExportStatus] ?? r.last_export_status}</span>
                          </>
                        ) : (
                          <span className="muted">—</span>
                        )}
                      </td>
                    )}
                    <td className="small">{r.last_closed_period ? periodLabel(r.last_closed_period) : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>Zatiaľ nemáš žiadnu firmu. Pridaj ju nižšie alebo otvor pozvánku od účtovníka či majiteľa.</p>
        )}
        <p className="small muted" style={{ marginBottom: 0 }}>
          „Mám zaplatiť" a „Dlžia mne" rátajú faktúry po splatnosti, ktoré ešte nie sú označené ako zaplatené (párovanie s bankou príde neskôr).
        </p>
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
