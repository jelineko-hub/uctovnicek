# Účtovníček — koncept, výber funkcií z Doklado a plán

**Verzia:** 1 · **Dátum:** 25. 10. 2026 · **Pre:** Claude Code v repozitári `jelineko-hub/uctovnicek`
**Nadväzuje na:** stav repa v0.004 (F0 hotové; F1 nahrávanie, vyťaženie, editor a zoznamy hotové; `lib/mrp/xml.ts` hotové, export UI chýba).
**Zdroj funkcií:** `docs/analyza-doklado.md` — **nová verzia z 25. 10. 2026** (analýza prihlásenej časti, 41 rout, 213 endpointov). Starú verziu v repe nahradiť.
**Vzťah k `docs/plan.md`:** tento dokument nahrádza kapitolu 2 (Fázy) a dopĺňa kapitolu 3 (dátový model). Kapitoly 1, 3 a 4 v plan.md ostávajú platné.

Preberáme **funkcie a koncepty**, nie kód, texty ani grafiku Doklado.

---

## 1. Čo Účtovníček je

**Most medzi malou firmou a jej externým účtovníkom.** Firma zbiera doklady, účtovník ich spracuje a exportuje do svojho účtovného programu. Obaja pracujú v jednej aplikácii nad tými istými dátami.

### Dve persony

| | Majiteľ firmy (napr. TopClima s.r.o.) | Účtovníčka (externá, napr. ekoucto) |
|---|---|---|
| Účet | 1 firma (neskôr aj viac) | 1 účet, **N klientskych firiem** |
| Robí | fotí bločky, nahráva / preposiela faktúry, prijíma e-faktúry, nahrá výpis z banky | kontroluje, dopĺňa účtovné údaje, páruje, exportuje, zamyká obdobie |
| Chce vidieť | čo mi chýba (nezaplatené, nespárované, nespracované), stav uzávierky | prehľad všetkých klientov: čo je nové, čo čaká, čo nie je exportované |
| Odbornosť | žiadna účtovná — UI bez účtovného žargónu | plná — predkontácie, členenie DPH, strediská |

### Čo Účtovníček nie je
- Nie je účtovný program: neúčtuje, nerobí DPH priznanie ani KV DPH. To robí program účtovníčky (MRP-K/S ako prvý).
- Nie je primárne fakturačný nástroj. Vystavovanie faktúr príde, ale až po tom, čo funguje zber → spracovanie → export.
- Nie je nástroj pre veľké firmy: viacúrovňové schvaľovanie, vyúčtovania zamestnancov a verejné API sú až na konci.

### Kľúčový tok (happy path)
```
zber (foto / upload / email / e-faktúra / výpis)
  → vyťaženie (Claude haiku, eKasa lookup)
  → kontrola majiteľom (voliteľná)             stav: unprocessed → ready
  → zaúčtovanie účtovníčkou (predkontácia…)    stav: ready → approved
  → export do MRP-K/S                          stav: approved → exported (zamknuté)
  → uzávierka mesiaca (zamknutie obdobia)
```
Hodnota pre zákazníka: **mesačná uzávierka bez e-mailov, krabíc bločkov a prepisovania.**

---

## 2. Výber funkcií z Doklado

Odkazy „§“ smerujú na kapitoly v `docs/analyza-doklado.md`.

| Funkcia Doklado | Rozhodnutie | Priorita | Dôvod |
|---|---|---|---|
| Foto bločku / upload / drag&drop (§2.1) | prevzaté — **hotové** v0.003 | P0 | jadro |
| OCR/AI vyťaženie, hybrid merge (§2.2) | prevzaté zjednodušene — hotové (Claude haiku, bez AWS) | P0 | funguje; AWS Textract pridať len ak kvalita haiku nebude stačiť |
| **eKasa lookup podľa QR/UID** (§2.2) | **prevziať** | P0 | presné dáta bez OCR; `ekasa_uid` sa už vyťažuje |
| **Detekcia duplicít** (§2.2) | **prevziať** | P0 | majiteľ často nahrá to isté 2× (foto + email) |
| **Stavový automat + zamknutie po exporte** (§2.8, §7) | **prevziať** | P0 | bez toho účtovníčka nemôže dôverovať exportu |
| **Export do účtovníctva — súbor** (§2.10) | prevzaté zjednodušene — len MRP-K/S XML 2.0, bez desktop agenta | P0 | knižnica hotová, chýba UI a stavy exportu |
| Viac firiem na účet, roly, pozvánky (§2.12) | prevzaté čiastočne — **pozvánky chýbajú** | P1 | účtovníčka sa inak do firmy nedostane |
| Dashboard „Ne-exportované / Nespracované“ (§2.12) | **prevziať** ako dashboard účtovníčky cez všetky firmy | P1 | hlavná obrazovka účtovníčky |
| Predkontácie, číselníky, sync z účt. programu (§2.8) | prevziať zjednodušene — číselníky ručne / CSV import, bez sync API | P1 | MRP-K/S nemá verejné API na číselníky |
| **Automatické účtovanie** podľa partnera (§2.8) | **prevziať** | P1 | najväčšia úspora času účtovníčky |
| Prediktívne účtovanie (§2.8) | prevziať zjednodušene — návrh z posledných N dokladov toho istého partnera | P1 | 80 % hodnoty za 5 % práce; žiadny ML |
| **Zberný e-mail per firma** (§2.1) | **prevziať** | P1 | faktúry chodia e-mailom; majiteľ len prepošle |
| **Import výpisov + párovanie** (§2.6) | prevziať zjednodušene — CSV/camt.053 upload, bez PSD2 | P1 | účtovníčka dnes dostáva výpis ručne; PSD2 vyžaduje licenciu/agregátora |
| Určenie typu faktúry podľa IBAN firmy (§2.6) | prevziať | P1 | malé, užitočné (dopĺňa dnešné určenie podľa IČO) |
| Tagy, vlastné filtre (§2.8) | prevziať čiastočne (tagy hotové v DB, UI chýba) | P1 | |
| **E-faktúra príjem (Peppol)** (§2.5) | prevziať **cez partnera** (ePošťák), nie vlastný Access Point | P2 | SK mandát e-fakturácie; vlastný AP je neúnosný |
| Vystavené faktúry — import PDF/XML (§2.3) | prevziať | P2 | účtovníčka ich potrebuje aj keď firma fakturuje inde |
| Rozdeľovač — jedna schránka pre viac firiem (§2.1) | prevziať zjednodušene — routing podľa IČO odberateľa z vyťaženia | P2 | účtovníčka s 20 klientmi má 1 schránku |
| Vystavovanie faktúr, PDF, QR platba, e-mail (§2.4) | prevziať neskôr — základ z ACDone (`invoice-pdf.ts`, `einvoiceUbl.ts`) | P3 | nie je jadro; po mandáte e-fakturácie stúpne |
| Opakované faktúry, upomienky (§2.4) | neskôr | P3 | až po vystavovaní |
| E-faktúra odoslanie (UBL 2.1 → Peppol) (§2.5) | neskôr, cez partnera | P3 | závisí od vystavovania |
| Freemium počítadlá, Stripe (§5) | neskôr | P3 | až keď bude čo spoplatniť |
| Viacúrovňové schvaľovanie (§2.9) | **neprevziať** v tejto etape | — | cieľový segment ho nepotrebuje; stačí stav `approved` |
| Vyúčtovanie výdavkov zamestnancov (§2.11) | neprevziať | — | mimo segmentu |
| Konvertor výpisov platobných brán → SEPA XML (§2.7) | neprevziať | — | iný segment (e-shopy) |
| Desktop agent „Mostík“ (§2.10) | neprevziať | — | MRP-K/S importuje XML súbor; prípadne autonómny HTTP režim MRP |
| Verejné API, webhooky (§2.10) | neprevziať teraz | — | nie je dopyt |
| Prihlásenie cez Tatra banka ID, PSD2 (§1, §2.6) | neprevziať | — | partnerstvo, licencia |
| AI asistent (§2.12) | neprevziať | — | nejasná hodnota |

---

## 3. Priority — detail

Každá položka: **cieľ · rozsah · DB · hotovo keď**. Poradie v rámci priority je poradie implementácie.

### P0 — dokončiť jadro (bez toho nie je použiteľné ani pre TopClima)

#### P0.1 Stavový automat dokladu a zamknutie
- **Cieľ:** jasné prechody stavov, doklad po exporte sa nedá meniť.
- **Rozsah:** `lib/documentStatus.ts` — povolené prechody:
  `unprocessed → ready → approved → exported`; `ready|approved → rejected → unprocessed`; `exported → archived`;
  `approved → ready` (vrátenie účtovníčkou). Kto smie čo: `owner` po `ready`, `accountant` všetko, `approver` po `approved`, `viewer` nič.
  Doklad so stavom `exported`/`archived` je read-only (UI aj server action vrátia chybu; DB trigger odmietne UPDATE polí okrem `status`, `internal_note`, tagov).
- **DB:** `documents.locked_at timestamptz`; trigger `documents_reject_locked_update`.
- **Hotovo keď:** test prechodov (vitest) + pokus o úpravu exportovaného dokladu vráti chybu v UI.

#### P0.2 Detekcia duplicít
- **Cieľ:** upozorniť pri nahratí rovnakého dokladu.
- **Rozsah:** dve úrovne: (a) `document_files.sha256` zhoda v tej istej firme → okamžite pri uploade; (b) po vyťažení kľúč `(company_id, partner IČO, original_number, total_amount, issue_date)` → upozornenie v editore „Možný duplikát: [odkaz]“ s voľbou „Aj tak uložiť“.
- **DB:** `documents.duplicate_of uuid`, `documents.duplicate_ignored boolean default false`; index na `document_files(company_id, sha256)`; index na `documents(company_id, original_number, total_amount)`.
- **Hotovo keď:** nahratie toho istého PDF 2× zobrazí varovanie; test na kľúč (b).

#### P0.3 eKasa lookup
- **Cieľ:** bloček s eKasa UID dostane presné dáta (IČO, DIČ, sumy, DPH rozpad, položky) z Finančnej správy namiesto OCR.
- **Rozsah:** `lib/ekasa/lookup.ts` (server only). Vstup: UID z QR kódu (formát `O-…`) alebo z vyťaženia. Výstup: namapovať na `ExtractedDocument`, zlúčiť s OCR (eKasa má prednosť v hlavičke a sumách). Na mobile: skenovanie QR kamerou (`BarcodeDetector` API s fallbackom na knižnicu `jsqr` alebo `zxing-wasm`) v `UploadDocuments.tsx`.
- **Riziko [overiť]:** endpoint používaný aplikáciou FS „Over doklad“ (`ekasa.financnasprava.sk/mdu/api/v1/opd/receipt/find`) **nie je oficiálne dokumentovaný pre tretie strany** — žiadne SLA, môže vyžadovať hlavičky, môže sa zmeniť. Implementovať ako doplnok s fallbackom na OCR, s timeoutom 5 s a logovaním chýb. Pred implementáciou overiť, či endpoint odpovedá a za akých podmienok.
- **DB:** `documents.ekasa_data jsonb` (surová odpoveď), `documents.source check in ('upload','camera','email','einvoice','manual')`.
- **Hotovo keď:** QR z reálneho bločku → doklad má IČO a DPH rozpad bez ručnej úpravy.

#### P0.4 Export do MRP-K/S — UI a stavy
- **Cieľ:** účtovníčka vyberie obdobie + druh, stiahne XML, doklady prejdú do `exported`.
- **Rozsah:** stránka `/app/[companyId]/export`: filter (druh: vydané / prijaté — v jednom XML sa nemiešajú; obdobie; stav `approved`), náhľad zoznamu s kontrolou (chýba predkontácia? `DocumentNumber` > 10 zn.? duplicitné číslo?), tlačidlo „Vytvoriť export“ → XML do Storage `uctovnicek-documents/<company>/exports/…`, záznam v `exports`, doklady → `exported` + `exported_at` + `locked_at`. Zoznam minulých exportov so stiahnutím a stavom (`created → downloaded → imported | failed`, `imported`/`failed` označí účtovníčka ručne po importe do MRP). Tlačidlo „Zrušiť export“ (len posledný, vráti doklady do `approved`).
- **DB:** `exports.kind text`, `exports.error text`, `documents.export_id uuid references exports`.
- **Hotovo keď:** reálny import do MRP-K/S u účtovníčky prejde (overiť kódy Typ DPH, znamienka dobropisu, poradie elementov — pozri plan.md §4).

#### P0.5 Kontrola a doplnenie vyťaženia
- IBAN firmy ako ďalší signál pre `kind` (prijatá vs. vydaná) — IBAN dodávateľa na doklade = IBAN firmy → vydaná.
- Pri nejasnom výsledku (confidence < 0,6 alebo nesedí rekapitulácia) ponúknuť v editore „Vyťažiť presnejším modelom“ (claude-sonnet-5-5) — **len na klik používateľa**, nikdy automaticky (pravidlo v CLAUDE.md).

### P1 — účtovníčka ako plnohodnotný používateľ

#### P1.1 Pozvánky a roly
- **Rozsah:** `owner` pozve e-mailom (`company_invites`), pozvaný po prihlásení prijme → `company_members`. Účtovníčka pozve majiteľa a naopak. Správa členov v nastaveniach firmy (zmena roly, odobratie). E-mail cez Resend alebo existujúci `outboundMail.ts` z ACDone.
- **DB:** `company_invites(id, company_id, email, role, token unique, invited_by, expires_at, accepted_at, created_at)` + RLS (owner číta/zapisuje; pozvaný číta cez token v server action so service role).
- **Hotovo keď:** účtovníčka s vlastným účtom vidí TopClima po prijatí pozvánky.

#### P1.2 Dashboard účtovníčky (cez všetky firmy)
- **Rozsah:** `/app` pre používateľa s rolou `accountant` v ≥ 1 firme: tabuľka firiem × stĺpce: nespracované, pripravené (čakajú na mňa), schválené neexportované, nespárované pohyby, posledný export, stav obdobia. Klik = filtrovaný zoznam vo firme. Pre `owner` jednoduchšia verzia: „čo mi chýba“ (nezaplatené po splatnosti, nespracované, nespárované).
- **DB:** view alebo RPC `uctovnicek.company_overview(user_id)` (jeden dotaz, nie N+1).

#### P1.3 Účtovné obdobia a uzávierka
- **Rozsah:** `accounting_periods(company_id, year, month, status open|closed, closed_by, closed_at)`. Zatvorené obdobie: doklady s `tax_point_date`/`issue_date` v ňom sa nedajú pridať ani meniť (trigger), nové doklady s takým dátumom dostanú upozornenie a účtovníčka rozhodne (presunúť do ďalšieho obdobia = `evidence_date`). Zatvoriť smie `accountant`/`owner`, otvoriť len `accountant`.
- **DB:** tabuľka vyššie; `documents.evidence_date date` (dátum zaevidovania, tretí dátum podľa §2.2).

#### P1.4 Účtovné údaje a číselníky
- **Rozsah:** namiesto `companies.settings` jsonb samostatná tabuľka číselníkov per firma: predkontácie (MRP „kód zaúčtovania“), typ DPH (MRP TaxCode), strediská, zákazky, číselné rady. Ručná správa + CSV import. V editore dokladu sekcia „Účtovanie“ viditeľná len pre `accountant` (combobox z číselníka). `documents.accounting` jsonb ostáva ako úložisko hodnôt na doklade, kľúče pevne definované v `lib/accounting.ts`.
- **DB:** `company_code_lists(id, company_id, list check in ('bookkeeping_code','vat_code','cost_centre','project','numeric_series'), code, name, is_default, active, sort)`. Migrácia existujúcich `settings`.

#### P1.5 Automatické účtovanie + návrh z histórie
- **Rozsah:** `accounting_rules` (tabuľka existuje): `match {partner_ico?, kind?, text_contains?}` → `apply {accounting:{…}, tags:[…]}`. Aplikovať po vyťažení a pri zmene partnera. Ak pravidlo nie je, **návrh**: posledné 5 dokladov toho istého partnera a druhu → najčastejšia predkontácia, zobrazená ako predvyplnená hodnota s označením „návrh“. Tlačidlo „Uložiť ako pravidlo“ priamo z editora.
- **Hotovo keď:** druhá faktúra od toho istého dodávateľa má predkontáciu bez kliku.

#### P1.6 Zberný e-mail per firma
- **Rozsah:** adresa `<slug>@in.uctovnicek.sk` (slug = IČO alebo náhodný), inbound webhook (Resend Inbound / Postmark / Mailgun — vybrať jeden, dohodnúť doménu). Webhook `POST /api/inbound/email`: overiť podpis, uložiť správu, každú prílohu PDF/JPG/PNG/XML → Storage → `documents` so `source='email'`, `status='unprocessed'` → spustiť vyťaženie. Whitelist odosielateľov per firma (`allow_all` alebo zoznam), ostatné do `inbound_emails` so stavom `rejected`. E-mail bez použiteľnej prílohy (len text / link) → `inbound_emails` stav `needs_review`.
- **DB:** `company_inboxes(company_id pk, address unique, allow_all boolean, allowed_senders text[])`, `inbound_emails(id, company_id, from_address, subject, received_at, status check in ('processed','rejected','needs_review','failed'), raw_storage_path, document_ids uuid[])`.
- **Riziko:** limit tela serverless funkcie ~4,5 MB — webhook musí prílohy sťahovať z providera cez URL, nie prijímať v tele (Resend aj Postmark to umožňujú).

#### P1.7 Import výpisu z banky a párovanie
- **Rozsah:** upload CSV (Tatra banka, SLSP, VÚB, ČSOB — začať bankou TopClima) a camt.053 XML → `bank_transactions`. Parser per formát v `lib/bank/parsers/*.ts` s testami na anonymizovaných vzorkách. Automatické párovanie po importe: skóre VS = VS dokladu (silné), suma ±0,01 (silné), IBAN partnera (stredné), dátum ±10 dní (slabé); ≥ 2 silné → `paired`, inak návrh v UI → ručné potvrdenie → `paired_manually`. Spárovanie nastaví `documents.payment_status` (`paid`/`partial`). Rozpárovanie. Stránka `/app/[companyId]/banka`.
- **DB:** `bank_statement_imports(id, company_id, bank_account_id, format, storage_path, period_from, period_to, imported_count, duplicates_skipped)`; `bank_transactions.import_id`, `external_id` (ID transakcie z banky — dedup), `document_id` namiesto `document_ids[]` pre 1:1 (ponechať pole pre 1:N úhrady).
- **Hotovo keď:** mesačný výpis TopClima sa spáruje s ≥ 80 % faktúr bez ručného zásahu.

#### P1.8 Tagy a filtre v UI
- Tagy na doklade (tabuľky existujú), filter podľa tagu, uložené filtre per používateľ (`custom_filters(user_id, company_id, name, params jsonb)`).

### P2 — e-faktúra a zber bez majiteľa

#### P2.1 Príjem e-faktúr cez partnera (ePošťák)
- **Rozsah:** firma si v Účtovníčku zaregistruje príjem e-faktúr; partner (ePošťák, epostak.sk/partner) doručí UBL 2.1 / Peppol BIS 3.0 XML na webhook → parser `lib/einvoice/ubl-parse.ts` → `documents` (`kind='received_invoice'`, `source='einvoice'`, bez OCR, confidence 1). Prílohy z XML (PDF vizualizácia) uložiť.
- **[overiť]:** API a obchodné podmienky partnerskej služby ePošťák; termíny a rozsah SK mandátu e-fakturácie (plan.md uvádza 1. 1. 2027 B2B podľa poradenských zdrojov — overiť znenie zákona a pokyny FS pred implementáciou).

#### P2.2 Vydané faktúry — import
- Majiteľ nahrá PDF/XML faktúr vystavených v inom programe (vyťaženie už určí `issued_invoice` podľa IČO/IBAN). Hromadný upload ZIP. Export vydaných do MRP (`_fv`) už knižnica podporuje.

#### P2.3 Rozdeľovač (jedna schránka účtovníčky)
- Účtovníčka má vlastnú zbernú adresu; doklad sa po vyťažení smeruje do firmy, ktorej IČO = IČO odberateľa (prijaté) alebo IČO dodávateľa (vydané). Bez zhody → „Na zatriedenie“ v dashboarde účtovníčky. Technicky: `company_inboxes` s `company_id null` + `owner_user_id`; dočasné doklady v tabuľke `unassigned_documents`.

#### P2.4 Mobil ako PWA
- Manifest, ikony, `display: standalone`, offline shell, fotenie priamo z domovskej obrazovky. Príprava na natívnu appku: viď §4.1.

### P3 — rozšírenia (až keď P0–P2 bežia u reálnych zákazníkov)
- Vystavovanie faktúr (prevziať `invoice-pdf.ts`, `invoiceVat.ts`, `einvoiceUbl.ts` z ACDone), číselné rady, PAY by square QR, odoslanie e-mailom.
- Odoslanie e-faktúr cez partnera; opakované faktúry; upomienky (cron).
- Ďalšie exporty podľa dopytu účtovníkov: Pohoda XML, Omega, Money S3. Autonómny HTTP režim MRP-K/S.
- Freemium: `usage_counters(company_id, metric, period, value)`, Stripe.
- Pokladničné doklady (MRP `CashVouchers`), interné doklady.

---

## 4. Architektonické rozhodnutia (nové, doplnok k CLAUDE.md)

### 4.1 API-first kvôli budúcej mobilnej appke
Všetky mutácie, ktoré bude potrebovať mobil (upload, založenie dokladu, vyťaženie, eKasa lookup, zoznamy, potvrdenie dokladu), musia existovať ako **route handlers `/api/*`** s autentifikáciou cez Supabase JWT (`Authorization: Bearer`), nie len ako Next.js server actions. Server actions ich môžu volať interne alebo zdieľať logiku v `lib/`. Odpovede: JSON, chyby `{error: {code, message}}`. Natívna appka (Expo) ich potom použije bez zmien na serveri.

### 4.2 Dlhé úlohy: tabuľka `jobs` (vzor „príkaz + listener“ z Doklado §7)
`jobs(id, company_id, type check in ('extract','ekasa_lookup','export','bank_import','inbound_email'), status check in ('pending','running','done','failed'), payload jsonb, result jsonb, error text, attempts int, created_at, started_at, finished_at)`.
UI zapíše job a sleduje stav (Supabase Realtime na `jobs` alebo polling 2 s). Spracovanie: route handler spustený hneď po zápise (fire-and-forget s `waitUntil`) + Vercel Cron každých 5 min, ktorý dobehne `pending`/`failed` s `attempts < 3`. Vyťaženie prepísať na tento vzor (dnes synchrónne volanie).

### 4.3 Zdroje dokladov
`documents.source` je povinný: `upload | camera | email | einvoice | manual`. Dashboard aj štatistiky ho používajú.

### 4.4 Čo ostáva synchronné
Export XML (sekundy) a párovanie banky (desiatky ms) sú synchronné server actions. Job len tam, kde je externé volanie (Claude, eKasa, e-mail provider).

### 4.5 Kde čo žije
- `lib/documentStatus.ts` — prechody a oprávnenia (čistá funkcia + test).
- `lib/accounting.ts` — kľúče `documents.accounting` a mapovanie na MRP polia.
- `lib/ekasa/`, `lib/bank/parsers/`, `lib/einvoice/`, `lib/inbound/` — každý s testami na vzorkách v `test-fixtures/` (anonymizované).
- Pravidlá z CLAUDE.md platia ďalej (schéma `uctovnicek`, RLS, `company_id` všade, CHECK constrainty, bump `APP_VERSION`, changelog).

---

## 5. Plán etáp (poradie práce pre Claude Code)

Každá etapa = jedna alebo viac tém v changelogu, bump verzie, `npm run typecheck && npm test` zelené.

| Etapa | Obsah | Hotovo keď |
|---|---|---|
| **E1** | Dokumentácia: nahradiť `docs/analyza-doklado.md` novou verziou, pridať tento dokument ako `docs/koncept-roadmapa.md`, v `plan.md` kap. 2 nahradiť odkazom sem. CLAUDE.md: doplniť §4.1–4.3 ako trvalé pravidlá. | commit |
| **E2** | P0.1 stavový automat + zámok, P0.2 duplicity | testy prechodov a duplicít; UI varovanie |
| **E3** | P0.4 export UI + stavy exportu | účtovníčka stiahne XML za mesiac, doklady zamknuté |
| **E4** | P0.3 eKasa lookup (po overení endpointu) + QR sken na mobile, P0.5 IBAN signál | reálny bloček bez ručnej úpravy |
| **E5** | P1.1 pozvánky, P1.2 dashboard účtovníčky | účtovníčka vidí TopClima vlastným účtom |
| **E6** | P1.4 číselníky, P1.5 automatické účtovanie + návrh, P1.3 obdobia | druhá faktúra od dodávateľa má predkontáciu sama |
| **E7** | 4.2 `jobs` + prepis vyťaženia, P1.6 zberný e-mail | preposlaná faktúra sa objaví v Nespracovaných do 1 min |
| **E8** | P1.7 banka: import + párovanie, P1.8 tagy/filtre | výpis TopClima spárovaný ≥ 80 % |
| **Míľnik A** | **TopClima + ekoucto používajú Účtovníček na reálnu mesačnú uzávierku** | spätná väzba účtovníčky → úpravy |
| **E9** | P2.1 e-faktúra príjem cez partnera, P2.2 vydané import | |
| **E10** | P2.3 Rozdeľovač, P2.4 PWA | |
| **Míľnik B** | druhá firma + druhý účtovník (nie TopClima) | |
| E11+ | P3 podľa dopytu | |

Odhad: E2–E4 ≈ 1 týždeň, E5–E8 ≈ 2–3 týždne práce s Claude Code, pri overovaní na reálnych dátach.

---

## 6. Otvorené otázky (odpovie Oliviero, nie Claude Code)

1. **eKasa endpoint** — overiť dostupnosť a podmienky pred E4 (viď P0.3). Ak nefunguje, E4 = len QR sken → UID do `ekasa_uid` a OCR.
2. **Doména a provider pre zberný e-mail** (`in.uctovnicek.sk`? Resend / Postmark?) — pred E7.
3. **ePošťák** — prístup k partnerskému API, formát doručenia, cena — pred E9.
4. **Banka TopClima** — ktorý CSV formát ide ako prvý parser — pred E8.
5. **MRP-K/S u účtovníčky** — prvý skúšobný import XML z E3 (kódy Typ DPH, znamienka dobropisu).
6. **Zákon o e-fakturácii** — termíny a rozsah povinnosti — pred E9.

---

## 7. Dátový model — súhrn zmien oproti migrácii `20261025000000`

```
documents             + source, locked_at, duplicate_of, duplicate_ignored, ekasa_data jsonb,
                        evidence_date, export_id
document_files        + index (company_id, sha256)
exports               + kind, error
company_invites       nová
accounting_periods    nová
company_code_lists    nová (migrácia z companies.settings)
company_inboxes       nová
inbound_emails        nová
bank_statement_imports nová
bank_transactions     + import_id, external_id, document_id
custom_filters        nová
jobs                  nová
unassigned_documents  nová (P2.3)
usage_counters        nová (P3)
```
Každá nová tabuľka: `company_id`, RLS cez `is_company_member`, CHECK constrainty na stavy, migrácia v `supabase/migrations/` aj cez Supabase MCP.
