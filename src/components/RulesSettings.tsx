'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { deleteRuleAction, saveRuleAction } from '@/app/app/[companyId]/nastavenia/actions';
import { CODE_LISTS, CODE_LIST_KEYS, itemsFor, type Accounting, type CodeItem, type Rule } from '@/lib/accounting/codes';
import { KINDS, isKey } from '@/lib/documentKinds';

const describeMatch = (r: Rule) =>
  [
    r.match.partner_ico && `IČO ${r.match.partner_ico}`,
    r.match.kind && (isKey(KINDS, r.match.kind) ? KINDS[r.match.kind] : r.match.kind),
    r.match.text_contains && `text „${r.match.text_contains}"`,
  ]
    .filter(Boolean)
    .join(' · ');

const describeApply = (a: Accounting | undefined) =>
  CODE_LIST_KEYS.filter((k) => a?.[k]).map((k) => `${CODE_LISTS[k].short} ${a![k]}`).join(' · ') || '—';

export function RulesSettings({ companyId, rules, items, editable }: { companyId: string; rules: Rule[]; items: CodeItem[]; editable: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const empty = { name: '', partner_ico: '', kind: '', text_contains: '', priority: '100', accounting: {} as Accounting };
  const [form, setForm] = useState(empty);

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

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h3 style={{ marginTop: 0 }}>Automatické účtovanie</h3>
      <p className="small muted">
        Pravidlo nastaví účtovné údaje novému dokladu po vyťažení (ak ich doklad ešte nemá). Použije sa prvé platné podľa priority
        (nižšie číslo skôr). Pravidlo pre partnera sa dá uložiť aj priamo z dokladu.
      </p>
      {rules.length > 0 && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Priorita</th><th>Ak</th><th>Nastaví</th><th>Aktívne</th><th /></tr></thead>
            <tbody>
              {rules.map((r) => (
                <tr key={r.id} className={r.active ? undefined : 'muted'}>
                  <td>{r.priority}</td>
                  <td>{r.name && <b>{r.name}<br /></b>}<span className="small">{describeMatch(r)}</span></td>
                  <td className="small">{describeApply(r.apply.accounting)}</td>
                  <td>
                    <input
                      type="checkbox"
                      disabled={!editable || pending}
                      checked={r.active}
                      onChange={(e) => run(() => saveRuleAction(companyId, { ...r, accounting: r.apply.accounting ?? {}, active: e.target.checked }, r.id))}
                    />
                  </td>
                  <td>
                    {editable && (
                      <button type="button" className="link" disabled={pending} onClick={() => { if (confirm('Zmazať pravidlo?')) run(() => deleteRuleAction(companyId, r.id)); }}>
                        Zmazať
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editable && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                saveRuleAction(companyId, {
                  name: form.name,
                  match: { partner_ico: form.partner_ico, kind: form.kind || null, text_contains: form.text_contains },
                  accounting: form.accounting,
                  priority: Number(form.priority) || 100,
                }),
              'Pravidlo uložené.',
              () => setForm(empty),
            );
          }}
        >
          <div className="grid2">
            <label>Názov (voliteľný)<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
            <label>Priorita<input inputMode="numeric" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })} /></label>
            <label>Ak IČO partnera je<input value={form.partner_ico} onChange={(e) => setForm({ ...form, partner_ico: e.target.value })} /></label>
            <label>a druh dokladu je
              <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
                <option value="">akýkoľvek</option>
                {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </label>
            <label style={{ gridColumn: '1 / -1' }}>a partner / položky obsahujú text<input value={form.text_contains} onChange={(e) => setForm({ ...form, text_contains: e.target.value })} /></label>
            {CODE_LIST_KEYS.map((k) => (
              <label key={k}>{CODE_LISTS[k].label}
                <select value={form.accounting[k] ?? ''} onChange={(e) => setForm({ ...form, accounting: { ...form.accounting, [k]: e.target.value || undefined } })}>
                  <option value="">— nemeniť —</option>
                  {itemsFor(items, k, form.kind || 'received_invoice').map((i) => <option key={i.id} value={i.code}>{i.code}{i.name ? ` — ${i.name}` : ''}</option>)}
                </select>
              </label>
            ))}
          </div>
          <button type="submit" disabled={pending}>Pridať pravidlo</button>
        </form>
      )}
      {message && <p className={message.type === 'error' ? 'error' : 'success'}>{message.text}</p>}
    </div>
  );
}
