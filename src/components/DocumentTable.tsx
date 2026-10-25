import Link from 'next/link';
import { KINDS, STATUSES, isKey } from '@/lib/documentKinds';
import { date, money } from '@/lib/format';

export const DOC_COLUMNS = 'id, kind, status, issue_date, original_number, total_amount, currency, partner_snapshot, created_at';

export interface DocumentRow {
  id: string;
  kind: string;
  status: string;
  issue_date: string | null;
  original_number: string | null;
  total_amount: number | string | null;
  currency: string;
  partner_snapshot: { name?: string | null } | null;
  created_at: string;
}

export function DocumentTable({ companyId, rows, showKind }: { companyId: string; rows: DocumentRow[]; showKind?: boolean }) {
  if (!rows.length) return <p className="muted">Žiadne doklady.</p>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Dátum</th>
            <th>Partner</th>
            <th>Číslo</th>
            {showKind && <th>Druh</th>}
            <th className="num">Suma</th>
            <th>Stav</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d.id}>
              <td>{date(d.issue_date ?? d.created_at)}</td>
              <td>
                <Link href={`/app/${companyId}/doklady/${d.id}`}>{d.partner_snapshot?.name || 'Bez partnera'}</Link>
              </td>
              <td>{d.original_number || '—'}</td>
              {showKind && <td>{isKey(KINDS, d.kind) ? KINDS[d.kind] : d.kind}</td>}
              <td className="num">{money(d.total_amount, d.currency)}</td>
              <td><span className={`badge ${d.status}`}>{isKey(STATUSES, d.status) ? STATUSES[d.status] : d.status}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
