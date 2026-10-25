'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { saveMrpSettingsAction } from '@/app/app/[companyId]/export/actions';
import type { MrpSettings } from '@/lib/export/mrpDocument';

export function MrpSettingsForm({ companyId, settings, editable }: { companyId: string; settings: MrpSettings; editable: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);
  const [form, setForm] = useState({
    prefix_received: settings.prefix_received ?? '',
    prefix_issued: settings.prefix_issued ?? '',
    tax_code_received: settings.tax_code_received ? String(settings.tax_code_received) : '',
    tax_code_issued: settings.tax_code_issued ? String(settings.tax_code_issued) : '',
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setMessage(null);
        startTransition(async () => {
          const res = await saveMrpSettingsAction(companyId, form);
          setMessage(res.ok ? { type: 'ok', text: res.message ?? 'Uložené.' } : { type: 'error', text: res.error });
          if (res.ok) router.refresh();
        });
      }}
    >
      <p className="small muted">
        Číslo dokladu v MRP pridelí MRP pri importe v číselnom rade s týmto prefixom — rada musí v MRP existovať.
        Typ DPH: kód z číselníka MRP (prázdne = 40 prijaté, 10 vydané).
      </p>
      <fieldset className="grid2" disabled={!editable || pending}>
        <label>Prefix radu — prijaté faktúry<input maxLength={10} value={form.prefix_received} onChange={set('prefix_received')} /></label>
        <label>Prefix radu — vydané faktúry<input maxLength={10} value={form.prefix_issued} onChange={set('prefix_issued')} /></label>
        <label>Typ DPH — prijaté<input inputMode="numeric" placeholder="40" value={form.tax_code_received} onChange={set('tax_code_received')} /></label>
        <label>Typ DPH — vydané<input inputMode="numeric" placeholder="10" value={form.tax_code_issued} onChange={set('tax_code_issued')} /></label>
      </fieldset>
      {editable && <button type="submit" disabled={pending}>Uložiť nastavenie</button>}
      {message && <p className={message.type === 'error' ? 'error' : 'success'}>{message.text}</p>}
    </form>
  );
}
