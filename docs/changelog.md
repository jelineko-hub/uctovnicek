# Changelog

## Téma v0.012 — E6: číselníky, automatické účtovanie, uzávierky
- **Číselníky** (Nastavenia → Účtovanie): predkontácia (MRP číslo), Typ DPH, stredisko (6), zákazka (15), číselný rad
  (prefix, 10); pridanie, predvolená/aktívna, platnosť pre druh dokladu, import CSV `kód;názov`. Nastavenie exportu
  z E3 (`companies.settings.mrp`) presunuté do číselníkov ako predvolené hodnoty. `lib/accounting/codes.ts` + testy.
- **Účtovanie na doklade** (`documents.accounting`, mení len účtovník): editor sekcia „Účtovanie" s výberom z číselníkov;
  export do MRP posiela `DoubleEntryBookkeepingCode`, `CostCentre`, `ContractNumber`, `TaxCode` a prefix radu z dokladu,
  inak predvolené firmy.
- **Automatické účtovanie:** pravidlá (IČO / druh / text → účtovné údaje, priorita, aktívne) sa uplatnia po vyťažení,
  eKasa a uložení dokladu, ak doklad ešte nemá účtovné údaje; návrh z posledných 5 dokladov partnera; „Uložiť ako
  pravidlo" z editora.
- **Uzávierky** (Export → Uzávierky): mesiace s počtami dokladov, uzavrieť (majiteľ, účtovník) / otvoriť (len účtovník).
  Doklad patrí do mesiaca podľa dátumu evidencie → DUZP → vystavenia (`lib/accounting/periods.ts`, export aj DB).
  Spracovaný doklad v uzavretom mesiaci je len na čítanie (DB trigger); pri potvrdení dokladu z uzavretého mesiaca editor
  ponúkne dátum evidencie v najbližšom otvorenom. Prehľad firiem: stĺpec „Uzavreté do".
- API: `GET /api/companies/:id/code-lists`, `GET/POST /api/companies/:id/periods`. `lib/membership.ts` (Db, memberRole).
- Migrácia `20261025160000_e6_accounting_periods.sql`: `company_code_lists`, `accounting_periods`, `documents.evidence_date`,
  `accounting_rules.name/active`, `period_closed()`, triggery obdobia, `company_overview()` + `last_closed_period`.

## Téma v0.011 — E5: pozvánky, členovia, prehľad firiem
- **Nastavenia firmy → ľudia:** zoznam členov (majiteľ mení rolu, odoberá; firma nesmie ostať bez majiteľa — trigger),
  pozvánka e-mail + rola → odkaz `/pozvanka/<token>` na 14 dní (zatiaľ ho používateľ pošle sám, e-mail v E7),
  nevybavené pozvánky: kopírovať odkaz, zrušiť. Pozývať smie majiteľ aj účtovník.
- **Prijatie pozvánky:** stránka ukáže firmu a rolu; prijať sa dá len účtom s e-mailom z pozvánky (`accept_invite`,
  security definer). Neprihlásený → prihlásenie a návrat na pozvánku (`?next=`, len relatívne cesty — `lib/safeNext.ts`).
- **Moje firmy = prehľad:** jedna RPC `company_overview()` — nespracované, na schválenie, schválené neexportované,
  zamietnuté, faktúry po splatnosti (mám zaplatiť / dlžia mne), posledný export; čísla vedú na filtrované zoznamy.
  Majiteľ vidí zjednodušený prehľad, účtovník/schvaľovateľ plný. Filter dokladov `po_splatnosti=1`.
- API: `GET/POST /api/companies/:id/invites`, `POST /api/invites/:token/accept`, `GET /api/overview`.
- Migrácia `20261025150000_e5_invites_overview.sql` (aplikovaná): `company_invites` + RLS, `invite_preview`,
  `accept_invite`, `company_member_list`, `company_overview`, trigger `company_members_keep_owner`.

## Téma v0.010 — E4: bločky z eKasa, DPH bločkov, IBAN signál
- **eKasa:** `lib/ekasa/` — UID (`O-` + 32 hex) z QR alebo textu, lookup „Over doklad" Finančnej správy
  (`opd/receipt/find`, neoficiálne rozhranie: timeout 5 s, chyby do logu, fallback na vyťaženie), prevod na doklad
  (predajca → partner, cena riadku s DPH → jednotková cena bez DPH, rekapitulácia DPH z eKasa, platba „V hotovosti").
  Test na reálnom bločku (`test-fixtures/ekasa/receipt-pd.json`). Synchrónne; do `jobs` v E7.
- Nahrávanie fotky: QR kód sa prečíta v prehliadači (`BarcodeDetector`, inak `jsqr`) → doklad sa doplní z eKasa
  bez volania modelu. Ak QR nejde prečítať a model vyčíta UID z textu, eKasa sa zavolá po vyťažení a má prednosť.
  Editor nespracovaného bločku: pole UID + „Načítať z eKasa". API `POST /api/documents/:id/ekasa` ({uid?}).
- **DPH bločkov zo súm s DPH:** `lib/vat.ts` `pricesWithVat` (zaokrúhli sa suma s DPH za sadzbu, DPH = suma − základ;
  12,75 € pri 23 % → 10,37 + 2,38, nie 2,39). Zapnuté pre bločky (eKasa aj vyťaženie) cez `documents.prices_with_vat`;
  editor a uloženie dokladu ho rešpektujú.
- **P0.5 IBAN:** ak IČO nerozhodne, IBAN dodávateľa = IBAN firmy alebo jej bankového účtu → vydaná faktúra.
- Migrácia `20261025140000_e4_ekasa.sql` (aplikovaná): `documents.ekasa_data`, index na `ekasa_uid`.

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
