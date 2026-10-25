# Changelog

## Téma v0.009 — Export: dlhé merné jednotky
- MRP `UnitCode` má max. 3 znaky: bežné jednotky sa pri exporte skrátia (komplet → kpl, hodina → hod, balenie → bal,
  meter → m…), neznáma dlhá jednotka sa vynechá. Namiesto chyby, ktorá blokovala export, je to upozornenie v náhľade.

## Téma v0.008 — Odhlásenie
- V hlavičke (Moje firmy aj detail firmy) e-mail prihláseného účtu a tlačidlo „Odhlásiť" (server action `signOut` → /login).

## Téma v0.007 — E3: export do MRP-K/S
- Záložka **Export**: výber prijaté / vydané faktúry a mesiac (podľa DUZP, inak dátumu vystavenia), náhľad schválených
  dokladov s kontrolou (chyby blokujú: chýba partner, položky, dátum, prefix radu, limity MRP; upozornenia: nesedí
  suma, dobropis, chýba IČO, iný režim DPH), počet ešte neschválených dokladov v mesiaci, výber dokladov zaškrtnutím.
- „Vytvoriť export" → XML do Storage `<firma>/exports/<id>.xml`, záznam v `exports`, doklady → Exportované
  (+ `export_id`, `exported_at`, zámok z E2). Zoznam exportov: stiahnutie (prvé → Stiahnutý), Naimportované v MRP,
  Import zlyhal (s textom chyby), Zrušiť export (len posledný, nie naimportovaný → doklady späť do Schválené).
- Číslovanie ako v Doklado: Účtovníček nečísluje, posiela `DocumentNumberPrefix` (prefix radu z nastavenia exportu)
  a MRP pridelí číslo pri importe; `UUID` = id dokladu (MRP odmietne opakovaný import). Nastavenie exportu vo firme:
  prefix pre prijaté/vydané, kód Typ DPH (predvolené 40/10) — `companies.settings.mrp`.
- API-first: `GET/POST /api/companies/:id/exports`, `PATCH …/exports/:exportId`, `POST …/cancel`, `GET …/file`;
  `lib/apiAuth.ts` (Bearer JWT alebo cookies, chyby `{error:{code,message}}`). Logika v `lib/export/` + testy.
- Migrácia `20261025130000_e3_exports.sql` (aplikovaná): `exports.kind`, `error`, `file_name`, stav `cancelled`,
  `documents.export_id`.
- Bločky sa zatiaľ neexportujú (prídu ako pokladničné doklady MRP).

## Téma v0.006 — E2: stav dokladu, zámok po exporte, duplicity
- `lib/documentStatus.ts`: povolené prechody stavov a kto ich smie (majiteľ po „pripravený", schvaľovateľ po
  „schválený", účtovník všetko, len-čítanie nič) + testy. Server actions a editor ho používajú; nová akcia
  `changeStatus` (Schváliť, Zamietnuť, Vrátiť na kontrolu, Vrátiť medzi nespracované, Archivovať).
- Zámok: exportovaný/archivovaný doklad sa nedá upraviť ani zmazať — editor len na čítanie s vysvetlením,
  server action vráti chybu, DB trigger `documents_reject_locked_update` odmietne zmenu iných polí než stav,
  interná poznámka a technické polia; `document_lines` zamknutého dokladu tiež. `locked_at` nastavuje trigger.
- Duplicity: (a) prehliadač spočíta SHA-256 súboru pred uploadom; ak rovnaký súbor vo firme už je → „Už nahraté"
  s odkazom, „Nahrať aj tak" / „Nenahrávať". (b) po vyťažení a uložení `lib/duplicates.ts` hľadá starší doklad
  s rovnakým IČO + číslom + sumou + dátumom → v editore pruh „Možný duplikát" s odkazom, „Nie je to duplikát".
- `documents.source` (povinný; upload / camera zatiaľ z nahrávania), zobrazený v editore.
- Migrácia `20261025120000_e2_status_duplicates.sql` (aplikovaná): `source`, `locked_at`, `duplicate_of`,
  `duplicate_ignored`, indexy na kľúč duplicity a `document_files(company_id, sha256)`, triggery zámku.

## Téma v0.005 — E1: koncept a plán etáp
- `docs/koncept-roadmapa.md`: koncept (most firma ↔ externá účtovníčka), výber funkcií z Doklado, priority P0–P3,
  architektonické rozhodnutia, etapy E1–E11, otvorené otázky, súhrn zmien dátového modelu.
- `docs/analyza-doklado.md` nahradená novou verziou (prihlásená časť Doklado, 25. 10. 2026).
- `docs/plan.md`: kapitola 2 (Fázy F0–F5) nahradená odkazom na koncept §3 a §5.
- CLAUDE.md: trvalé pravidlá API-first (`/api/*` + Supabase JWT), `jobs` pre externé volania, povinný `documents.source`.

## Téma v0.004 — Lacnejší model na vyťažovanie
- Vyťažovanie dokladov prepnuté z `claude-opus-5-5` ($4 / $20 za 1M tokenov) na `claude-haiku-5-5`
  ($0,10 / $0,50 pri promptoch do 100K). Bez server-side fallbacku (Haiku ho nemá), štruktúrovaný výstup cez
  `client.messages.parse` + `zodOutputFormat`.

## Téma v0.003 — F1: nahrávanie a vyťažovanie dokladov
- Detail firmy `/app/[companyId]` so záložkami: Nespracované, Bločky, Prijaté/Vydané faktúry, Pokladňa, Iné, Partneri.
- Nahrávanie: drag & drop, výber súborov, fotenie mobilom; fotky sa v prehliadači zmenšia na 2400 px (JPEG),
  súbor ide priamo do Storage `uctovnicek-documents/<company>/<doc>/…`, potom sa založí doklad (`unprocessed`).
- Vyťaženie `POST /api/documents/:id/extract`: Claude (`claude-opus-5-5`, structured outputs cez zod,
  `fallbacks: "default"`) číta obrázok/PDF → hlavička, partner, položky bez DPH, rekapitulácia DPH, eKasa UID.
  Prijatá vs. vydaná faktúra sa určí aj podľa IČO firmy. Vyžaduje `ANTHROPIC_API_KEY` na serveri.
- Editor dokladu: náhľad súboru, úprava hlavičky/partnera/položiek, prepočet DPH po sadzbách, upozornenia
  (súčet ≠ suma, nesedí rekapitulácia z dokladu, neplatný IBAN). Potvrdenie → stav `ready`, partner sa založí
  alebo aktualizuje podľa IČO. Ďalej: Uložiť, Znova vyťažiť, Vrátiť medzi nespracované, Zmazať (aj súbor).
- Zoznamy dokladov s filtrom (partner/číslo bez diakritiky, dátum od–do, stav), zoznam partnerov.
- Knižnice: `lib/vat.ts` (DPH po sadzbách), `lib/iban.ts` (mod 97), `lib/documentKinds.ts` (názvy = CHECK hodnoty),
  `lib/extraction/*` + testy.

## Téma v0.002 — Databáza v projekte zkw planner (schéma `uctovnicek`)
- Migrácia aplikovaná do Supabase projektu **zkw planner** (`whtnfgxirblxkcmkphhz`) do samostatnej schémy
  `uctovnicek` — tabuľky zkw plannera v `public` sa nemenia. Spoločné je len `auth.users` a `storage`.
- Bucket `uctovnicek-documents`; storage politiky cez `uctovnicek.path_company_id()` (bez priameho `::uuid`,
  aby nezhodili dotazy na buckety zkw plannera).
- Supabase klienti nastavení na `db.schema = 'uctovnicek'` (`src/lib/db.ts`).

## Téma v0.001 — Založenie projektu
- Kostra Next.js 15 + Supabase: prihlásenie magic linkom, zoznam firiem, pridanie firmy.
- Migrácia `20261025000000_init.sql`: firmy, členstvá a roly, partneri, doklady + položky + súbory + história,
  bankové účty a pohyby, štítky, pravidlá účtovania, exporty; RLS cez `is_company_member`, Storage bucket `documents`.
- `src/lib/mrp/xml.ts`: export vydaných a prijatých faktúr do MRP-K/S XML 2.0 (EUR, viac sadzieb DPH, úhrady,
  kontrola dĺžok polí a Windows-1250) + testy.
- Dokumentácia: analýza Doklado (REA), plán F0–F5, oficiálna dokumentácia a vzory MRP XML 2.0.
