'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createExportAction } from '@/app/app/[companyId]/export/actions';
import { EXPORT_KINDS, periodDate, type ExportKind } from '@/lib/export/mrpDocument';
import type { PreviewRow, Problem } from '@/lib/export/service';
import { date, money } from '@/lib/format';

export function ExportPreview({
  companyId,
  kind,
  period,
  rows,
  allowed,
}: {
  companyId: string;
  kind: ExportKind;
  period: string;
  rows: PreviewRow[];
  allowed: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [selected, setSelected] = useState(() => new Set(rows.filter((r) => !r.check.errors.length).map((r) => r.doc.id)));
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string; problems?: Problem[] } | null>(null);

  if (!rows.length) {
    return <p className="muted">{EXPORT_KINDS[kind].label}: v tomto mesiaci nie je žiadny schválený doklad na export.</p>;
  }

  const withErrors = rows.filter((r) => r.check.errors.length).length;
  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  function create() {
    setMessage(null);
    startTransition(async () => {
      const res = await createExportAction(companyId, kind, period, [...selected]);
      if (res.ok) {
        setMessage({ type: 'ok', text: res.message ?? 'Hotovo.' });
        router.refresh();
      } else setMessage({ type: 'error', text: res.error, problems: res.problems });
    });
  }

  return (
    <div className="card">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th />
              <th>Dátum</th>
              <th>Partner</th>
              <th>Číslo</th>
              <th className="num">Suma</th>
              <th>Kontrola</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ doc, check }) => (
              <tr key={doc.id}>
                <td>
                  <input
                    type="checkbox"
                    aria-label="Zahrnúť do exportu"
                    disabled={!allowed || check.errors.length > 0}
                    checked={selected.has(doc.id)}
                    onChange={() => toggle(doc.id)}
                  />
                </td>
                <td>{date(periodDate(doc))}</td>
                <td><Link href={`/app/${companyId}/doklady/${doc.id}`}>{doc.partner_snapshot?.name || 'Bez partnera'}</Link></td>
                <td>{doc.original_number ?? '—'}</td>
                <td className="num">{money(doc.total_amount, doc.currency)}</td>
                <td className="small">
                  {check.errors.map((e) => <div key={e} className="error">{e}</div>)}
                  {check.warnings.map((w) => <div key={w} className="muted">⚠ {w}</div>)}
                  {!check.errors.length && !check.warnings.length && <span className="success">v poriadku</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {withErrors > 0 && (
        <p className="small muted">Doklady s chybou ({withErrors}) sa nedajú exportovať — oprav ich v detaile dokladu.</p>
      )}
      {message && (
        <div className={message.type === 'error' ? 'error' : 'success'}>
          {message.text}
          {message.problems?.map((p) => (
            <div key={p.id} className="small">
              <Link href={`/app/${companyId}/doklady/${p.id}`}>{p.label}</Link>: {p.errors.join(' ')}
            </div>
          ))}
        </div>
      )}
      {allowed && (
        <div className="actions">
          <button type="button" disabled={pending || !selected.size} onClick={create}>
            Vytvoriť export ({selected.size})
          </button>
          <span className="muted small">Exportované doklady sa zamknú a nebude sa dať meniť.</span>
          {pending && <span className="muted small">Pracujem…</span>}
        </div>
      )}
    </div>
  );
}
