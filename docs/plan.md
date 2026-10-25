# Účtovníček — prvé kroky (návrh)

Vychádza z `analyza-doklado.md`. Preberáme funkcie, nie kód ani texty Doklado.

## 1. Odporúčaný stack

Rovnaký ako ACDone: **Next.js 15 + React 19 + TypeScript, Supabase (Postgres, Auth, RLS, Storage), Vercel**.
Dôvod: v ACDone už máš vlastný, odladený kód, ktorý sa dá do Účtovníčka priamo prevziať:

| Potreba Účtovníčka | Vlastný kód v ACDone |
|---|---|
| PDF faktúry, SK/CZ/EN | `src/lib/invoice-pdf.ts`, `invoice-pdf-l10n.ts` |
| DPH rozpad z riadkov | `src/lib/invoiceVat.ts` |
| e-Faktúra (UBL/Peppol) | `src/lib/einvoiceUbl.ts` |
| Bankové pohyby, párovanie | `src/lib/accounting-bank.ts`, `accounting-bank-types.ts` |
| Portál pre účtovníčku | `src/lib/accounting-portal*.ts` |
| Odosielanie e-mailov | `src/lib/outboundMail.ts` |
| Hľadanie bez diakritiky | `src/lib/searchText.ts` |

Mobil: PWA (fotenie bločkov cez `<input capture>`); natívnu appku riešiť až neskôr.

## 2. Fázy

Pôvodné fázy F0–F5 nahradil koncept **[`koncept-roadmapa.md`](koncept-roadmapa.md)**:
priority P0–P3 s rozsahom, DB zmenami a kritériom „hotovo keď" sú v **§3**, poradie práce (etapy E1–E11+) v **§5**.
F0 a F1 (nahrávanie, vyťaženie, editor, zoznamy) sú hotové vo v0.001–v0.004.

## 3. Dátový model — návrh (vlastné názvy)

```
companies(id, name, ico, dic, ic_dph, vat_payer, address jsonb, iban, created_at)
company_members(company_id, user_id, role check in ('owner','accountant','approver','viewer'))
partners(id, company_id, name, ico, dic, ic_dph, address jsonb, iban, email)
documents(
  id, company_id, kind check in ('receipt','received_invoice','issued_invoice','cash','bank_statement','other'),
  subtype,                -- invoice | advance | credit | debit | tax_payment | corrective
  status check in ('unprocessed','ready','approved','rejected','exported','archived'),
  partner_id, number, variable_symbol, ekasa_uid,
  issue_date, tax_point_date, due_date, delivery_date,
  currency, total_amount numeric, total_amount_eur numeric, fx_rate numeric,
  vat_mode check in ('standard','reverse_charge','exempt','oss'),
  payment_method, payment_status check in ('unpaid','partial','paid'),
  accounting jsonb,       -- predkontácia, číselný rad, stredisko, zákazka, členenie DPH, pomer
  ocr_raw jsonb, ocr_confidence numeric,
  note, internal_note, created_by, created_at, updated_at)
document_lines(id, document_id, name, quantity, unit, unit_price, vat_rate, vat_amount, total, accounting jsonb)
document_files(id, document_id, storage_path, mime, pages, sha256)
document_vat_summary(document_id, vat_rate, base, vat)      -- alebo počítať z lines
document_history(id, document_id, changed_by, changed_at, diff jsonb)
bank_accounts(id, company_id, iban, currency, name)
bank_transactions(id, bank_account_id, booking_date, amount, currency, vs, ks, ss,
  counterparty_name, counterparty_iban, message, pairing_status, document_ids uuid[])
tags(id, company_id, name, color) · document_tags(document_id, tag_id)
accounting_rules(id, company_id, match jsonb, apply jsonb, priority)
recurring_invoices(id, company_id, template jsonb, interval, next_date)
exports(id, company_id, target, period, document_ids uuid[], status, file_path)
```

## 4. Rozhodnutia (2026-10-25)

- Samostatná aplikácia, repozitár `jelineko-hub/uctovnicek` (privátny).
- Prvý export: **MRP-K/S, XML 2.0** (import: Export/Import → Import; pred prvým importom založiť importný profil).
  Hotové: `src/lib/mrp/xml.ts` (faktúry vydané/prijaté v EUR). Neskôr: pokladňa (`CashVouchers`),
  interné doklady (`AccountingItems`), cudzia mena, prípadne autonómny režim MRP (HTTP POST + XML) namiesto súboru.
- Na overenie na reálnom MRP: kódy „Typ DPH" v číselníku, znamienka súm pri dobropise, poradie elementov.

## 5. Pôvodné otázky

1. Názov repozitára a či ho mám založiť (`jelineko-hub/uctovnicek`, privátny).
2. Či ide Účtovníček ako samostatná appka, alebo ako modul v ACDone (Účtovníctvo tam už existuje).
3. Prístup k prihlásenej časti Doklado: spusti session na svojom počítači (Claude Desktop / `claude remote-control`),
   alebo pošli screenshoty hlavných obrazoviek — doplním presné formuláre a toky.
4. Ktorý účtovný program používa tvoja účtovníčka (určí prvý export).
