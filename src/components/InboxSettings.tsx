'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  createInboxAction,
  deleteInboundEmailAction,
  reprocessInboundEmailAction,
  updateInboxAction,
} from '@/app/app/[companyId]/nastavenia/actions';
import { dateTime } from '@/lib/format';
import { waitForJob } from '@/lib/jobs/client';
import { INBOUND_STATUSES, type Inbox, type InboundEmail } from '@/lib/inbound/mail';

export function InboxSettings({
  companyId,
  inbox,
  address,
  emails,
  editable,
}: {
  companyId: string;
  inbox: Inbox | null;
  /** Celá adresa schránky (doména je nastavená na serveri). */
  address: string | null;
  emails: InboundEmail[];
  editable: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [allowAll, setAllowAll] = useState(inbox?.allow_all ?? false);
  const [senders, setSenders] = useState((inbox?.allowed_senders ?? []).join('\n'));

  function run(action: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setMessage(null);
    startTransition(async () => {
      const res = await action();
      setMessage(res.ok ? { type: 'ok', text: okText } : { type: 'error', text: res.error ?? 'Chyba' });
      if (res.ok) router.refresh();
    });
  }

  function reprocess(e: InboundEmail, allowSender: boolean) {
    setMessage(null);
    startTransition(async () => {
      const res = await reprocessInboundEmailAction(companyId, e.id, allowSender);
      if (!res.ok) return setMessage({ type: 'error', text: res.error });
      setMessage({ type: 'ok', text: 'Spracúvam e-mail…' });
      await waitForJob(res.jobId).catch(() => null);
      setMessage({ type: 'ok', text: 'E-mail spracovaný.' });
      router.refresh();
    });
  }

  const copy = async () => {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setMessage({ type: 'ok', text: 'Adresa skopírovaná.' });
    } catch {
      setMessage({ type: 'error', text: 'Kopírovanie zlyhalo — označ adresu a skopíruj ju ručne.' });
    }
  };

  return (
    <div className="card">
      {!inbox ? (
        <>
          <p style={{ marginTop: 0 }}>
            Firma dostane vlastnú e-mailovú adresu. Faktúry, ktoré na ňu prepošleš (alebo ti ich tam pošlú dodávatelia),
            sa objavia medzi nespracovanými dokladmi a samy sa vyťažia.
          </p>
          {editable ? (
            <button type="button" disabled={pending} onClick={() => run(() => createInboxAction(companyId), 'Adresa vytvorená.')}>
              Vytvoriť adresu
            </button>
          ) : (
            <p className="muted small">Adresu vytvorí majiteľ alebo účtovník.</p>
          )}
        </>
      ) : (
        <>
          <p style={{ marginTop: 0 }}>
            Doklady posielaj na <b className="mono">{address}</b>{' '}
            <button type="button" className="link small" onClick={copy}>Kopírovať</button>
          </p>
          <p className="muted small">
            Z e-mailu sa spracujú prílohy PDF, JPG a PNG (každá = jeden doklad). Logá v podpise sa ignorujú.
          </p>
          <fieldset disabled={!editable || pending} style={{ border: 0, padding: 0, margin: 0, display: 'grid', gap: 8 }}>
            <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input type="checkbox" checked={allowAll} onChange={(e) => setAllowAll(e.target.checked)} />
              Prijímať doklady od kohokoľvek
            </label>
            {!allowAll && (
              <label>
                Povolení odosielatelia (jeden na riadok: e-mail alebo celá doména ako <span className="mono">@dodavatel.sk</span>)
                <textarea value={senders} onChange={(e) => setSenders(e.target.value)} rows={4} style={{ width: '100%' }} />
              </label>
            )}
            {editable && (
              <div>
                <button type="button" onClick={() => run(() => updateInboxAction(companyId, allowAll, senders), 'Uložené.')}>
                  Uložiť
                </button>
              </div>
            )}
          </fieldset>
        </>
      )}
      {message && <p className={message.type === 'error' ? 'error' : 'success'}>{message.text}</p>}

      {inbox && (
        <>
          <h3>Prijaté e-maily</h3>
          {!emails.length ? (
            <p className="muted small">Zatiaľ žiadne.</p>
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Prijatý</th>
                    <th>Od</th>
                    <th>Predmet</th>
                    <th>Stav</th>
                  </tr>
                </thead>
                <tbody>
                  {emails.map((e) => (
                    <tr key={e.id}>
                      <td className="small">{dateTime(e.received_at)}</td>
                      <td className="small">{e.from_address}</td>
                      <td className="small">{e.subject ?? '—'}</td>
                      <td className="small">
                        <span className={`badge ${e.status === 'processed' ? 'approved' : e.status === 'received' ? 'ready' : 'rejected'}`}>
                          {INBOUND_STATUSES[e.status] ?? e.status}
                        </span>
                        {e.note && <div className="muted">{e.note}</div>}
                        {e.document_ids.length > 0 && (
                          <div className="row-actions">
                            {e.document_ids.map((id, i) => (
                              <Link key={id} href={`/app/${companyId}/doklady/${id}`}>Doklad {i + 1}</Link>
                            ))}
                          </div>
                        )}
                        {editable && (e.status === 'rejected' || e.status === 'needs_review' || e.status === 'failed') && (
                          <div className="row-actions">
                            {e.status === 'rejected' && (
                              <button type="button" className="link" disabled={pending} onClick={() => reprocess(e, true)}>
                                Povoliť odosielateľa a spracovať
                              </button>
                            )}
                            <button type="button" className="link" disabled={pending} onClick={() => reprocess(e, false)}>
                              Spracovať aj tak
                            </button>
                            <button type="button" className="link" disabled={pending} onClick={() => run(() => deleteInboundEmailAction(companyId, e.id), 'Odstránené zo zoznamu.')}>
                              Odstrániť
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
