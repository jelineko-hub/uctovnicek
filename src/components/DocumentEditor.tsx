'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState, useTransition } from 'react';
import {
  changeStatus,
  confirmDocument,
  deleteDocument,
  ignoreDuplicate,
  saveAccountingRuleFromDocument,
  saveDocument,
  type DocumentInput,
} from '@/app/app/[companyId]/doklady/actions';
import { KINDS, PAYMENT_METHODS, SOURCES, STATUSES, SUBTYPES, VAT_MODES, VAT_RATES, isKey, type Status } from '@/lib/documentKinds';
import { CODE_LISTS, CODE_LIST_KEYS, defaultsFor, isEmptyAccounting, itemsFor, type Accounting, type CodeItem } from '@/lib/accounting/codes';
import { periodLabel } from '@/lib/accounting/periods';
import { allowedTransitions, canDelete, canEdit, editBlockedReason, type Role } from '@/lib/documentStatus';
import { date } from '@/lib/format';
import { jobMessage, runJobRequest, waitForJob } from '@/lib/jobs/client';
import type { JobView } from '@/lib/jobs/types';
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
  source: string;
  ocr_notes: string | null;
  from_ekasa: boolean;
  evidence_date: string | null;
  accounting: Accounting;
  prices_with_vat: boolean;
  printed_vat: { rate: number; base: number; vat: number }[];
  lines: { name: string; quantity: number; unit: string | null; unit_price: number; vat_rate: number }[];
}

/** Tlačidlá ručných zmien stavu (potvrdenie a export majú vlastné akcie). */
const TRANSITION_LABELS: Partial<Record<Status, string>> = {
  approved: 'Schváliť',
  rejected: 'Zamietnuť',
  unprocessed: 'Vrátiť medzi nespracované',
  archived: 'Archivovať',
};

export interface DuplicateInfo {
  id: string;
  original_number: string | null;
  issue_date: string | null;
  status: string;
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

export function DocumentEditor({
  doc,
  role,
  codeItems,
  suggestion,
  closedPeriod,
  duplicateOf,
  file,
  lastJob,
}: {
  doc: EditorDocument;
  role: Role | null;
  /** Číselníky firmy (len pre účtovníka/schvaľovateľa). */
  codeItems: CodeItem[];
  /** Návrh účtovných údajov z histórie partnera (keď doklad žiadne nemá). */
  suggestion: Accounting;
  /** Obdobie dokladu je uzavreté (napr. '9/2026') → len na čítanie. */
  closedPeriod: string | null;
  duplicateOf: DuplicateInfo | null;
  file: { url: string; mime: string } | null;
  /** Posledná úloha vyťaženia/eKasa dokladu (beží → editor čaká a obnoví sa; zlyhala → hláška). */
  lastJob: JobView | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string; evidenceDate?: string } | null>(() =>
    lastJob?.status === 'failed' && doc.status === 'unprocessed'
      ? { type: 'error', text: `Vyťaženie zlyhalo: ${jobMessage(lastJob)}` }
      : null,
  );
  const jobActive = (j: JobView | null) => !!j && (j.status === 'pending' || j.status === 'running');
  const [working, setWorking] = useState(jobActive(lastJob) && doc.status === 'unprocessed');

  // Doklad sa práve vyťažuje na pozadí (napr. príloha zo zberného e-mailu) → počkať a načítať výsledok.
  useEffect(() => {
    if (!lastJob || !working) return;
    let cancelled = false;
    waitForJob(lastJob.id)
      .then((chain) => {
        if (cancelled) return;
        const last = chain[chain.length - 1];
        if (last.status === 'done') window.location.reload();
        else {
          setWorking(false);
          setMessage({ type: 'error', text: jobMessage(last) ?? 'Vyťaženie ešte beží.' });
        }
      })
      .catch(() => !cancelled && setWorking(false));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastJob?.id]);

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
    evidence_date: doc.evidence_date ?? '',
  });
  const suggested = isEmptyAccounting(doc.accounting) && !isEmptyAccounting(suggestion);
  const [accounting, setAccounting] = useState<Accounting>(suggested ? suggestion : doc.accounting);
  const showAccounting = role === 'accountant' || role === 'approver';
  const defaults = useMemo(() => defaultsFor(codeItems, kind), [codeItems, kind]);
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
    () =>
      totals(
        lines.map((l) => ({ quantity: num(l.quantity), unitPrice: num(l.unit_price), vatRate: num(l.vat_rate) })),
        { pricesWithVat: doc.prices_with_vat },
      ),
    [lines, doc.prices_with_vat],
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
      evidence_date: head.evidence_date,
      ...(role === 'accountant' ? { accounting: Object.fromEntries(Object.entries(accounting).filter(([, v]) => v)) as Record<string, string> } : {}),
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

  function run(action: () => Promise<{ ok: boolean; error?: string; evidenceDate?: string }>, okText: string, after?: () => void) {
    setMessage(null);
    startTransition(async () => {
      const res = await action();
      if (!res.ok) setMessage({ type: 'error', text: res.error ?? 'Chyba', evidenceDate: res.evidenceDate });
      else {
        setMessage({ type: 'ok', text: okText });
        if (after) after();
        else router.refresh();
      }
    });
  }

  const [ekasaUid, setEkasaUid] = useState(doc.ekasa_uid ?? '');
  /** Úloha na pozadí (eKasa / vyťaženie): počká na výsledok a načíta doklad znova. */
  function runJob(url: string, body?: unknown) {
    setMessage(null);
    setWorking(true);
    startTransition(async () => {
      try {
        const chain = await runJobRequest(url, body);
        const last = chain[chain.length - 1];
        const problem = last.status === 'done' ? null : jobMessage(last);
        if (problem) {
          setMessage({ type: 'error', text: problem });
          setWorking(false);
        } else window.location.reload();
      } catch (e) {
        setMessage({ type: 'error', text: e instanceof Error ? e.message : String(e) });
        setWorking(false);
      }
    });
  }
  const loadEkasa = () => runJob(`/api/documents/${doc.id}/ekasa`, { uid: ekasaUid });
  const reextract = () => runJob(`/api/documents/${doc.id}/extract`);

  const setLine = (i: number, patch: Partial<LineDraft>) =>
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const editable = canEdit(doc.status, role) && !closedPeriod;
  const blockedReason =
    editBlockedReason(doc.status, role) ?? (closedPeriod ? `Obdobie ${closedPeriod} je uzavreté — doklad sa nedá meniť.` : null);
  const transitions = allowedTransitions(doc.status, role).filter(
    (t) => t !== 'exported' && !(doc.status === 'unprocessed' && t === 'ready'),
  );
  const transitionLabel = (t: Status) =>
    t === 'ready' ? 'Vrátiť na kontrolu' : TRANSITION_LABELS[t] ?? STATUSES[t];

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
          <span className="muted small">
            {isKey(SOURCES, doc.source) ? SOURCES[doc.source] : doc.source}
            {doc.from_ekasa
              ? ' · údaje z eKasa (Finančná správa)'
              : doc.ocr_confidence != null && ` · istota vyťaženia ${Math.round(doc.ocr_confidence * 100)} %`}
          </span>
        </div>
        {blockedReason && <p className="note">{blockedReason}</p>}
        {working && <p className="note">Čítam údaje z dokladu… stránka sa po dokončení sama obnoví.</p>}
        {duplicateOf && (
          <div className="warnings dup-banner">
            <strong>Možný duplikát:</strong> rovnaké číslo, suma a dátum ako{' '}
            <Link href={`/app/${doc.company_id}/doklady/${duplicateOf.id}`}>
              doklad {duplicateOf.original_number ?? ''} z {date(duplicateOf.issue_date)}
            </Link>{' '}
            ({isKey(STATUSES, duplicateOf.status) ? STATUSES[duplicateOf.status].toLowerCase() : duplicateOf.status}).
            {role && role !== 'viewer' && (
              <div className="row-actions">
                <button type="button" className="link" disabled={pending} onClick={() => run(() => ignoreDuplicate(doc.id), 'Označené — nie je to duplikát.')}>
                  Nie je to duplikát
                </button>
                {canDelete(doc.status, role) && (
                  <button
                    type="button"
                    className="link"
                    disabled={pending}
                    onClick={() => {
                      if (confirm('Zmazať tento doklad aj so súborom?')) {
                        run(() => deleteDocument(doc.id), 'Zmazané.', () => router.push(`/app/${doc.company_id}`));
                      }
                    }}
                  >
                    Zmazať tento doklad
                  </button>
                )}
              </div>
            )}
          </div>
        )}
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
          <label title="Ak doklad prišiel po uzávierke jeho mesiaca, zaeviduje sa do otvoreného obdobia">Dátum evidencie (nepovinné)
            <input type="date" value={head.evidence_date} onChange={(e) => setHead({ ...head, evidence_date: e.target.value })} />
          </label>
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
          {editable && doc.status === 'unprocessed' && (kind === 'receipt' || kind === 'other') ? (
            <div style={{ gridColumn: '1 / -1' }} className="ekasa-row">
              <label style={{ flex: 1 }}>UID bločku (eKasa)
                <input value={ekasaUid} placeholder="O-…" onChange={(e) => setEkasaUid(e.target.value)} />
              </label>
              <button type="button" className="secondary" disabled={pending || !ekasaUid.trim()} onClick={loadEkasa}>
                Načítať z eKasa
              </button>
            </div>
          ) : (
            doc.ekasa_uid && <p className="muted small" style={{ gridColumn: '1 / -1', margin: 0 }}>eKasa UID: {doc.ekasa_uid}</p>
          )}
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

        {showAccounting && (
          <>
            <h3>Účtovanie</h3>
            <fieldset className="card grid2" disabled={!editable || role !== 'accountant'}>
              {suggested && (
                <p className="note" style={{ gridColumn: '1 / -1', margin: 0 }}>
                  Návrh podľa posledných dokladov tohto partnera — uloží sa spolu s dokladom.
                </p>
              )}
              {CODE_LIST_KEYS.map((k) => {
                const options = itemsFor(codeItems, k, kind);
                const current = accounting[k] ?? '';
                return (
                  <label key={k}>{CODE_LISTS[k].label}
                    <select value={current} onChange={(e) => setAccounting({ ...accounting, [k]: e.target.value || undefined })}>
                      <option value="">{defaults[k] ? `predvolené (${defaults[k]})` : '—'}</option>
                      {current && !options.some((o) => o.code === current) && <option value={current}>{current} (nie je v číselníku)</option>}
                      {options.map((o) => <option key={o.id} value={o.code}>{o.code}{o.name ? ` — ${o.name}` : ''}</option>)}
                    </select>
                  </label>
                );
              })}
              {role === 'accountant' && editable && !isEmptyAccounting(accounting) && partner.ico && (
                <div style={{ gridColumn: '1 / -1' }}>
                  <button
                    type="button"
                    className="secondary"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => saveAccountingRuleFromDocument(doc.id, accounting),
                        'Pravidlo uložené — ďalšie doklady od tohto partnera dostanú tieto údaje automaticky.',
                      )
                    }
                  >
                    Uložiť ako pravidlo pre {partner.name || `IČO ${partner.ico}`}
                  </button>
                </div>
              )}
            </fieldset>
          </>
        )}

        {warnings.length > 0 && (
          <ul className="warnings">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
        )}

        <fieldset className="card grid2" disabled={!editable}>
          <label style={{ gridColumn: '1 / -1' }}>Poznámka<textarea value={head.note} onChange={(e) => setHead({ ...head, note: e.target.value })} /></label>
          <label style={{ gridColumn: '1 / -1' }}>Interná poznámka<textarea value={head.internal_note} onChange={(e) => setHead({ ...head, internal_note: e.target.value })} /></label>
        </fieldset>

        {message && (
          <p className={message.type === 'error' ? 'error' : 'success'}>
            {message.text}{' '}
            {message.evidenceDate && (
              <button
                type="button"
                className="secondary"
                disabled={pending}
                onClick={() => {
                  setHead({ ...head, evidence_date: message.evidenceDate! });
                  setMessage({ type: 'ok', text: 'Dátum evidencie nastavený — potvrď alebo ulož doklad znova.' });
                }}
              >
                Nastaviť dátum evidencie {periodLabel(message.evidenceDate.slice(0, 7))}
              </button>
            )}
          </p>
        )}

        {(editable || transitions.length > 0) && (
          <div className="actions">
            {editable && doc.status === 'unprocessed' && (
              <button type="button" disabled={pending} onClick={() => run(() => confirmDocument(doc.id, input()), 'Doklad potvrdený.', () => router.push(`/app/${doc.company_id}`))}>
                Potvrdiť doklad
              </button>
            )}
            {editable && (
              <button type="button" className="secondary" disabled={pending} onClick={() => run(() => saveDocument(doc.id, input()), 'Uložené.')}>
                Uložiť
              </button>
            )}
            {editable && doc.status === 'unprocessed' && (
              <button type="button" className="secondary" disabled={pending} onClick={() => { if (confirm('Vyťažiť znova? Ručné úpravy sa prepíšu.')) reextract(); }}>Znova vyťažiť</button>
            )}
            {transitions.map((t) => (
              <button
                key={t}
                type="button"
                className={t === 'approved' ? undefined : 'secondary'}
                disabled={pending}
                onClick={() => run(() => changeStatus(doc.id, t), `Stav: ${STATUSES[t]}.`)}
              >
                {transitionLabel(t)}
              </button>
            ))}
            {canDelete(doc.status, role) && (
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
            )}
            {pending && <span className="muted small">Pracujem…</span>}
          </div>
        )}
      </section>
    </div>
  );
}
