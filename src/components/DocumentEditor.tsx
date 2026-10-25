'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import {
  confirmDocument,
  deleteDocument,
  reopenDocument,
  saveDocument,
  type DocumentInput,
} from '@/app/app/[companyId]/doklady/actions';
import { KINDS, PAYMENT_METHODS, STATUSES, SUBTYPES, VAT_MODES, VAT_RATES, isKey } from '@/lib/documentKinds';
import { money } from '@/lib/format';
import { isValidIban } from '@/lib/iban';
import { round2, totals } from '@/lib/vat';

interface Partner {
  name: string | null;
  ico: string | null;
  dic: string | null;
  ic_dph: string | null;
  street: string | null;
  city: string | null;
  zip: string | null;
  country_code: string | null;
  iban: string | null;
}

export interface EditorDocument {
  id: string;
  company_id: string;
  kind: string;
  subtype: string;
  status: string;
  partner_snapshot: Partial<Partner> | null;
  original_number: string | null;
  variable_symbol: string | null;
  constant_symbol: string | null;
  ekasa_uid: string | null;
  issue_date: string | null;
  tax_point_date: string | null;
  due_date: string | null;
  currency: string;
  total_amount: number | null;
  payment_method: string | null;
  vat_mode: string;
  note: string | null;
  internal_note: string | null;
  ocr_confidence: number | null;
  ocr_notes: string | null;
  printed_vat: { rate: number; base: number; vat: number }[];
  lines: { name: string; quantity: number; unit: string | null; unit_price: number; vat_rate: number }[];
}

type LineDraft = { name: string; quantity: string; unit: string; unit_price: string; vat_rate: string };

const PARTNER_FIELDS: [keyof Partner, string][] = [
  ['name', 'Názov'],
  ['ico', 'IČO'],
  ['dic', 'DIČ'],
  ['ic_dph', 'IČ DPH'],
  ['street', 'Ulica'],
  ['city', 'Mesto'],
  ['zip', 'PSČ'],
  ['country_code', 'Krajina'],
  ['iban', 'IBAN'],
];

const num = (s: string) => {
  const n = Number(s.replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};
const str = (n: number | null | undefined) => (n == null ? '' : String(n));

export function DocumentEditor({ doc, file }: { doc: EditorDocument; file: { url: string; mime: string } | null }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const [kind, setKind] = useState(doc.kind);
  const [subtype, setSubtype] = useState(doc.subtype);
  const [partner, setPartner] = useState<Partner>({
    name: null, ico: null, dic: null, ic_dph: null, street: null, city: null, zip: null, country_code: null, iban: null,
    ...doc.partner_snapshot,
  });
  const [head, setHead] = useState({
    original_number: doc.original_number ?? '',
    variable_symbol: doc.variable_symbol ?? '',
    constant_symbol: doc.constant_symbol ?? '',
    issue_date: doc.issue_date ?? '',
    tax_point_date: doc.tax_point_date ?? '',
    due_date: doc.due_date ?? '',
    currency: doc.currency || 'EUR',
    total_amount: str(doc.total_amount),
    payment_method: doc.payment_method ?? '',
    vat_mode: doc.vat_mode,
    note: doc.note ?? '',
    internal_note: doc.internal_note ?? '',
  });
  const [lines, setLines] = useState<LineDraft[]>(
    doc.lines.map((l) => ({
      name: l.name,
      quantity: str(l.quantity),
      unit: l.unit ?? '',
      unit_price: str(l.unit_price),
      vat_rate: str(l.vat_rate),
    })),
  );

  const computed = useMemo(
    () => totals(lines.map((l) => ({ quantity: num(l.quantity), unitPrice: num(l.unit_price), vatRate: num(l.vat_rate) }))),
    [lines],
  );

  const warnings = useMemo(() => {
    const w: string[] = [];
    const total = head.total_amount.trim() ? num(head.total_amount) : null;
    if (total != null && lines.length && Math.abs(total - computed.total) > 0.02) {
      w.push(`Súčet položiek s DPH (${money(computed.total, head.currency)}) nesedí s celkovou sumou (${money(total, head.currency)}).`);
    }
    for (const p of doc.printed_vat) {
      const c = computed.rows.find((r) => r.rate === p.rate);
      if (!c || Math.abs(c.base - p.base) > 0.02 || Math.abs(c.vat - p.vat) > 0.02) {
        w.push(`Rekapitulácia DPH ${p.rate} % na doklade (základ ${money(p.base)}, DPH ${money(p.vat)}) nesedí s položkami.`);
      }
    }
    if (partner.iban && !isValidIban(partner.iban)) w.push('IBAN partnera nemá platný formát alebo kontrolnú číslicu.');
    return w;
  }, [head.total_amount, head.currency, lines.length, computed, doc.printed_vat, partner.iban]);

  function input(): DocumentInput {
    return {
      kind: kind as DocumentInput['kind'],
      subtype: subtype as DocumentInput['subtype'],
      partner,
      original_number: head.original_number,
      variable_symbol: head.variable_symbol,
      constant_symbol: head.constant_symbol,
      issue_date: head.issue_date,
      tax_point_date: head.tax_point_date,
      due_date: head.due_date,
      currency: head.currency,
      total_amount: head.total_amount.trim() ? round2(num(head.total_amount)) : null,
      payment_method: (head.payment_method || null) as DocumentInput['payment_method'],
      vat_mode: head.vat_mode as DocumentInput['vat_mode'],
      note: head.note,
      internal_note: head.internal_note,
      lines: lines
        .filter((l) => l.name.trim())
        .map((l) => ({
          name: l.name,
          quantity: num(l.quantity) || 1,
          unit: l.unit,
          unit_price: num(l.unit_price),
          vat_rate: num(l.vat_rate),
        })),
    };
  }

  function run(action: () => Promise<{ ok: boolean; error?: string }>, okText: string, after?: () => void) {
    setMessage(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) setMessage({ type: 'error', text: res.error ?? 'Chyba' });
      else {
        setMessage({ type: 'ok', text: okText });
        if (after) after();
        else router.refresh();
      }
    });
  }

  async function reextract() {
    setMessage(null);
    startTransition(async () => {
      const res = await fetch(`/api/documents/${doc.id}/extract`, { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) setMessage({ type: 'error', text: body.error ?? res.statusText });
      else window.location.reload();
    });
  }

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const editable = doc.status !== 'exported';

  return (
    <div className="doc-layout">
      <section className="doc-preview card">
        {!file ? (
          <p className="muted">Doklad nemá súbor.</p>
        ) : file.mime === 'application/pdf' ? (
          <iframe src={file.url} title="Náhľad dokladu" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <a href={file.url} target="_blank" rel="noreferrer"><img src={file.url} alt="Náhľad dokladu" /></a>
        )}
      </section>

      <section className="doc-form">
        <div className="row-between">
          <span className={`badge ${doc.status}`}>{isKey(STATUSES, doc.status) ? STATUSES[doc.status] : doc.status}</span>
          {doc.ocr_confidence != null && (
            <span className="muted small">Istota vyťaženia {Math.round(doc.ocr_confidence * 100)} %</span>
          )}
        </div>
        {doc.ocr_notes && <p className="note">{doc.ocr_notes}</p>}

        <fieldset className="card grid2" disabled={!editable}>
          <label>Druh
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              {Object.entries(KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Typ
            <select value={subtype} onChange={(e) => setSubtype(e.target.value)}>
              {Object.entries(SUBTYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Číslo dokladu<input value={head.original_number} onChange={(e) => setHead({ ...head, original_number: e.target.value })} /></label>
          <label>Variabilný symbol<input value={head.variable_symbol} onChange={(e) => setHead({ ...head, variable_symbol: e.target.value })} /></label>
          <label>Dátum vystavenia<input type="date" value={head.issue_date} onChange={(e) => setHead({ ...head, issue_date: e.target.value })} /></label>
          <label>Dátum dodania (DUZP)<input type="date" value={head.tax_point_date} onChange={(e) => setHead({ ...head, tax_point_date: e.target.value })} /></label>
          <label>Splatnosť<input type="date" value={head.due_date} onChange={(e) => setHead({ ...head, due_date: e.target.value })} /></label>
          <label>Konštantný symbol<input value={head.constant_symbol} onChange={(e) => setHead({ ...head, constant_symbol: e.target.value })} /></label>
          <label>Spôsob úhrady
            <select value={head.payment_method} onChange={(e) => setHead({ ...head, payment_method: e.target.value })}>
              <option value="">—</option>
              {Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Režim DPH
            <select value={head.vat_mode} onChange={(e) => setHead({ ...head, vat_mode: e.target.value })}>
              {Object.entries(VAT_MODES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Mena<input value={head.currency} maxLength={3} onChange={(e) => setHead({ ...head, currency: e.target.value })} /></label>
          <label>Celkom s DPH<input inputMode="decimal" value={head.total_amount} onChange={(e) => setHead({ ...head, total_amount: e.target.value })} /></label>
          {doc.ekasa_uid && <p className="muted small" style={{ gridColumn: '1 / -1', margin: 0 }}>eKasa UID: {doc.ekasa_uid}</p>}
        </fieldset>

        <h3>{kind === 'issued_invoice' ? 'Odberateľ' : 'Dodávateľ'}</h3>
        <fieldset className="card grid2" disabled={!editable}>
          {PARTNER_FIELDS.map(([k, label]) => (
            <label key={k} style={k === 'name' ? { gridColumn: '1 / -1' } : undefined}>
              {label}
              <input value={partner[k] ?? ''} onChange={(e) => setPartner({ ...partner, [k]: e.target.value })} />
            </label>
          ))}
        </fieldset>

        <h3>Položky</h3>
        <fieldset className="card" disabled={!editable}>
          <div className="table-wrap">
            <table className="table lines">
              <thead>
                <tr><th>Názov</th><th>Množstvo</th><th>MJ</th><th>Cena/MJ bez DPH</th><th>DPH %</th><th className="num">Spolu s DPH</th><th /></tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const lineTotal = num(l.quantity) * num(l.unit_price) * (1 + num(l.vat_rate) / 100);
                  return (
                    <tr key={i}>
                      <td><input value={l.name} onChange={(e) => setLine(i, { name: e.target.value })} /></td>
                      <td><input inputMode="decimal" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></td>
                      <td><input value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value })} /></td>
                      <td><input inputMode="decimal" value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} /></td>
                      <td>
                        <select value={l.vat_rate} onChange={(e) => setLine(i, { vat_rate: e.target.value })}>
                          {[...new Set([...VAT_RATES.map(String), l.vat_rate])].map((r) => <option key={r} value={r}>{r}</option>)}
                        </select>
                      </td>
                      <td className="num">{money(round2(lineTotal), head.currency)}</td>
                      <td><button type="button" className="link" onClick={() => setLines(lines.filter((_, j) => j !== i))}>✕</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <button
            type="button"
            className="secondary"
            onClick={() => setLines([...lines, { name: '', quantity: '1', unit: 'ks', unit_price: '', vat_rate: '23' }])}
          >
            + Pridať položku
          </button>

          <table className="table vat-summary">
            <thead><tr><th>Sadzba</th><th className="num">Základ</th><th className="num">DPH</th></tr></thead>
            <tbody>
              {computed.rows.map((r) => (
                <tr key={r.rate}><td>{r.rate} %</td><td className="num">{money(r.base, head.currency)}</td><td className="num">{money(r.vat, head.currency)}</td></tr>
              ))}
              <tr><th>Spolu</th><th className="num">{money(computed.base, head.currency)}</th><th className="num">{money(computed.total, head.currency)} s DPH</th></tr>
            </tbody>
          </table>
        </fieldset>

        {warnings.length > 0 && (
          <ul className="warnings">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        )}

        <fieldset className="card grid2" disabled={!editable}>
          <label style={{ gridColumn: '1 / -1' }}>Poznámka<textarea value={head.note} onChange={(e) => setHead({ ...head, note: e.target.value })} /></label>
          <label style={{ gridColumn: '1 / -1' }}>Interná poznámka<textarea value={head.internal_note} onChange={(e) => setHead({ ...head, internal_note: e.target.value })} /></label>
        </fieldset>

        {message && <p className={message.type === 'error' ? 'error' : 'success'}>{message.text}</p>}

        {editable && (
          <div className="actions">
            {doc.status === 'unprocessed' ? (
              <button type="button" disabled={pending} onClick={() => run(() => confirmDocument(doc.id, input()), 'Doklad potvrdený.', () => router.push(`/app/${doc.company_id}`))}>
                Potvrdiť doklad
              </button>
            ) : null}
            <button type="button" className="secondary" disabled={pending} onClick={() => run(() => saveDocument(doc.id, input()), 'Uložené.')}>
              Uložiť
            </button>
            {doc.status === 'unprocessed' ? (
              <button type="button" className="secondary" disabled={pending} onClick={() => { if (confirm('Vyťažiť znova? Ručné úpravy sa prepíšu.')) reextract(); }}>Znova vyťažiť</button>
            ) : (
              <button type="button" className="secondary" disabled={pending} onClick={() => run(() => reopenDocument(doc.id), 'Doklad vrátený medzi nespracované.')}>
                Vrátiť medzi nespracované
              </button>
            )}
            <button
              type="button"
              className="danger"
              disabled={pending}
              onClick={() => {
                if (confirm('Naozaj zmazať doklad aj so súborom?')) {
                  run(() => deleteDocument(doc.id), 'Zmazané.', () => router.push(`/app/${doc.company_id}`));
                }
              }}
            >
              Zmazať
            </button>
            {pending && <span className="muted small">Pracujem…</span>}
          </div>
        )}
      </section>
    </div>
  );
}
