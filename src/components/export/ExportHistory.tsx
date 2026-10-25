'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { cancelExportAction, setExportStatusAction } from '@/app/app/[companyId]/export/actions';
import { EXPORT_KINDS, EXPORT_STATUSES, isExportKind, type ExportStatus } from '@/lib/export/mrpDocument';

export interface ExportRow {
  id: string;
  kind: string | null;
  period: string | null;
  status: string;
  error: string | null;
  file_name: string | null;
  count: number;
  created_at: string;
}

const STATUS_BADGE: Record<ExportStatus, string> = {
  created: 'unprocessed',
  downloaded: 'ready',
  imported: 'exported',
  failed: 'rejected',
  cancelled: 'archived',
};

export function ExportHistory({ companyId, exports, allowed }: { companyId: string; exports: ExportRow[]; allowed: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  if (!exports.length) return <p className="muted">Zatiaľ žiadny export.</p>;
  const latestActive = exports.find((e) => e.status !== 'cancelled')?.id;

  function run(action: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    setMessage(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) setMessage({ type: 'error', text: res.error ?? 'Chyba' });
      else {
        if (res.message) setMessage({ type: 'ok', text: res.message });
        router.refresh();
      }
    });
  }

  return (
    <div className="card">
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Vytvorený</th><th>Druh</th><th>Mesiac</th><th className="num">Dokladov</th><th>Stav</th><th /></tr>
          </thead>
          <tbody>
            {exports.map((e) => {
              const status = e.status as ExportStatus;
              const active = status !== 'cancelled';
              return (
                <tr key={e.id}>
                  <td>{new Date(e.created_at).toLocaleString('sk-SK', { dateStyle: 'short', timeStyle: 'short' })}</td>
                  <td>{isExportKind(e.kind) ? EXPORT_KINDS[e.kind].label : '—'}</td>
                  <td>{e.period ?? '—'}</td>
                  <td className="num">{e.count}</td>
                  <td>
                    <span className={`badge ${STATUS_BADGE[status] ?? ''}`}>{EXPORT_STATUSES[status] ?? e.status}</span>
                    {e.error && <div className="small error">{e.error}</div>}
                  </td>
                  <td className="small">
                    <div className="row-actions" style={{ marginTop: 0 }}>
                      {active && (
                        <a href={`/api/companies/${companyId}/exports/${e.id}/file`} onClick={() => setTimeout(() => router.refresh(), 1500)}>
                          Stiahnuť XML
                        </a>
                      )}
                      {allowed && active && status !== 'imported' && (
                        <button type="button" className="link" disabled={pending} onClick={() => run(() => setExportStatusAction(companyId, e.id, 'imported'))}>
                          Naimportované v MRP
                        </button>
                      )}
                      {allowed && active && (
                        <button
                          type="button"
                          className="link"
                          disabled={pending}
                          onClick={() => {
                            const text = prompt('Čo hlásilo MRP pri importe?');
                            if (text !== null) run(() => setExportStatusAction(companyId, e.id, 'failed', text));
                          }}
                        >
                          Import zlyhal
                        </button>
                      )}
                      {allowed && e.id === latestActive && status !== 'imported' && (
                        <button
                          type="button"
                          className="link"
                          disabled={pending}
                          onClick={() => {
                            if (confirm('Zrušiť export? Doklady sa vrátia medzi schválené a odomknú sa.')) {
                              run(() => cancelExportAction(companyId, e.id));
                            }
                          }}
                        >
                          Zrušiť export
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {message && <p className={message.type === 'error' ? 'error' : 'success'}>{message.text}</p>}
    </div>
  );
}
