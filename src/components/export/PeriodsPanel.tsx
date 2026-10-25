'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { setPeriodStatusAction } from '@/app/app/[companyId]/export/actions';
import { periodLabel } from '@/lib/accounting/periods';

export interface PeriodRow {
  period: string;
  closed: boolean;
  unprocessed: number;
  ready: number;
  approved: number;
  exported: number;
}

/** Mesiace s počtami dokladov podľa stavu; uzavretý mesiac sa nedá meniť (DB trigger). */
export function PeriodsPanel({
  companyId,
  rows,
  canClose,
  canOpen,
}: {
  companyId: string;
  rows: PeriodRow[];
  canClose: boolean;
  canOpen: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function set(row: PeriodRow, status: 'open' | 'closed') {
    const open = row.unprocessed + row.ready + row.approved;
    const question =
      status === 'closed'
        ? `Uzavrieť ${periodLabel(row.period)}?${open ? `\n\nV mesiaci je ešte ${open} nevybavených dokladov (nespracované / na schválenie / neexportované) — po uzavretí sa nebudú dať meniť.` : ''}`
        : `Otvoriť ${periodLabel(row.period)}? Doklady v ňom sa znova budú dať meniť.`;
    if (!confirm(question)) return;
    setError(null);
    startTransition(async () => {
      const res = await setPeriodStatusAction(companyId, row.period, status);
      if (!res.ok) setError(res.error);
      else router.refresh();
    });
  }

  return (
    <div className="card">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Mesiac</th>
              <th className="num">Nespracované</th>
              <th className="num">Na schválenie</th>
              <th className="num">Schválené</th>
              <th className="num">Exportované</th>
              <th>Stav</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.period}>
                <td>{periodLabel(r.period)}</td>
                <td className="num">{r.unprocessed || <span className="muted">0</span>}</td>
                <td className="num">{r.ready || <span className="muted">0</span>}</td>
                <td className="num">{r.approved || <span className="muted">0</span>}</td>
                <td className="num">{r.exported || <span className="muted">0</span>}</td>
                <td>{r.closed ? <span className="badge exported">Uzavretý</span> : <span className="muted small">otvorený</span>}</td>
                <td>
                  {!r.closed && canClose && (
                    <button type="button" className="link" disabled={pending} onClick={() => set(r, 'closed')}>Uzavrieť</button>
                  )}
                  {r.closed && canOpen && (
                    <button type="button" className="link" disabled={pending} onClick={() => set(r, 'open')}>Otvoriť</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        Doklad patrí do mesiaca podľa dátumu evidencie, inak DUZP, inak dátumu vystavenia. Uzavrieť môže majiteľ aj účtovník, otvoriť len účtovník.
      </p>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
