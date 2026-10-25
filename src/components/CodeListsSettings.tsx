'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteCodeItemAction, importCodeCsvAction, saveCodeItemAction } from '@/app/app/[companyId]/nastavenia/actions';
import { CODE_LISTS, CODE_LIST_KEYS, type CodeItem, type CodeList } from '@/lib/accounting/codes';
import { KINDS, isKey } from '@/lib/documentKinds';

const kindLabel = (kinds: string[] | null) =>
  kinds?.length ? kinds.map((k) => (isKey(KINDS, k) ? KINDS[k] : k)).join(', ') : 'všetky druhy';

export function CodeListsSettings({ companyId, items, editable }: { companyId: string; items: CodeItem[]; editable: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [list, setList] = useState<CodeList>('bookkeeping_code');
  const [form, setForm] = useState({ code: '', name: '', kind: '', is_default: false });
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const rows = items.filter((i) => i.list === list);

  function run(action: () => Promise<{ ok: boolean; error?: string }>, okText?: string, after?: () => void) {
    setMessage(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) setMessage({ type: 'error', text: res.error ?? 'Chyba' });
      else {
        if (okText) setMessage({ type: 'ok', text: okText });
        after?.();
        router.refresh();
      }
    });
  }

  const update = (i: CodeItem, patch: Partial<CodeItem>) =>
    run(() => saveCodeItemAction(companyId, { list: i.list, code: i.code, name: i.name, kinds: i.kinds, is_default: i.is_default, active: i.active, ...patch }, i.id));

  return (
    <div className="card">
      <h3 style={{ marginTop: 0 }}>Číselníky pre účtovanie a export do MRP</h3>
      <div className="tabs" style={{ marginBottom: 12 }}>
        {CODE_LIST_KEYS.map((k) => (
          <button key={k} type="button" className={k === list ? undefined : 'secondary'} onClick={() => setList(k)}>
            {CODE_LISTS[k].short} ({items.filter((i) => i.list === k).length})
          </button>
        ))}
      </div>
      <p className="small muted">{CODE_LISTS[list].label}: {CODE_LISTS[list].hint}. Predvolená hodnota sa použije pri exporte, ak doklad nemá vlastnú.</p>

      {rows.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Kód</th><th>Názov</th><th>Platí pre</th><th>Predvolená</th><th>Aktívna</th><th /></tr></thead>
            <tbody>
              {rows.map((i) => (
                <tr key={i.id} className={i.active ? undefined : 'muted'}>
                  <td><b>{i.code}</b></td>
                  <td>{i.name ?? '—'}</td>
                  <td className="small">{kindLabel(i.kinds)}</td>
                  <td><input type="checkbox" disabled={!editable || pending} checked={i.is_default} onChange={(e) => update(i, { is_default: e.target.checked })} /></td>
                  <td><input type="checkbox" disabled={!editable || pending} checked={i.active} onChange={(e) => update(i, { active: e.target.checked })} /></td>
                  <td>
                    {editable && (
                      <button type="button" className="link" disabled={pending} onClick={() => { if (confirm(`Zmazať ${i.code}?`)) run(() => deleteCodeItemAction(companyId, i.id)); }}>
                        Zmazať
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="muted">Číselník je prázdny.</p>
      )}

      {editable && (
        <>
          <form
            className="filters"
            onSubmit={(e) => {
              e.preventDefault();
              run(
                () => saveCodeItemAction(companyId, { list, code: form.code, name: form.name, kinds: form.kind ? [form.kind] : null, is_default: form.is_default }),
                'Pridané.',
                () => setForm({ code: '', name: '', kind: '', is_default: false }),
              );
            }}
          >
            <input required placeholder="kód" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} style={{ width: 120 }} />
            <input placeholder="názov" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              <option value="">všetky druhy</option>
              {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <label className="small"><input type="checkbox" checked={form.is_default} onChange={(e) => setForm({ ...form, is_default: e.target.checked })} /> predvolená</label>
            <button type="submit" disabled={pending}>Pridať</button>
          </form>
          <label className="small">
            Import z CSV (stĺpce kód;názov):{' '}
            <input
              type="file"
              accept=".csv,.txt,text/csv,text/plain"
              disabled={pending}
              onChange={async (e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const text = await file.text();
                setMessage(null);
                startTransition(async () => {
                  const res = await importCodeCsvAction(companyId, list, text);
                  if (!res.ok) setMessage({ type: 'error', text: res.error });
                  else {
                    setMessage({
                      type: res.errors.length ? 'error' : 'ok',
                      text: `Načítaných ${res.imported} kódov.${res.errors.length ? ` Preskočené: ${res.errors.join(' ')}` : ''}`,
                    });
                    router.refresh();
                  }
                });
              }}
            />
          </label>
        </>
      )}
      {message && <p className={message.type === 'error' ? 'error' : 'success'}>{message.text}</p>}
    </div>
  );
}
