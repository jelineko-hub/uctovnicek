# Analýza Doklado (REA) — podklad pre Účtovníček

Dátum: 2026-10-25 · Cieľ: app.doklado.sk, verzia **2.25.0** (`/version.json`)

**Rozsah:** analyzovaná bola len **verejná, neprihlásená** časť: prihlasovacia stránka, kompletný JS bundle,
asset manifest, verejná OpenAPI dokumentácia a cenník. Do tvojho prihláseného účtu v prehliadači Claude for Windows
sa cloudová session nedostane, takže obrazovky po prihlásení **neboli videné** (pozri „Čo sa neoverilo").

Značky: **[pozorované]** = priamo v dátach · **[odvodené]** = vyvodené z reťazcov/názvov · **[neznáme]** = neoverené.

## Evidence

| ID | Čo |
|---|---|
| `E1` = `ev_0aabb2652aba04b72c24fbb5e9860aae89f031360fcd3eb853ab1ea2c5505515` | REA `inspect-web-page` app.doklado.sk/signin_email (DOM, skripty, resources) |
| `E2` = `ev_d61b3fc99b42fb2dbe791ea4bf23eb271a76b4dafb4126d55f7ce4b2c7da06e3` | REA `analyze-javascript-application` (main.dart.js: parser vyčerpal heap → statická analýza AST nedostupná) |
| `E3` = `ev_272c2467c9a4dadfbe674bdfebaa63398d7945d5fa4ad4abae85bf6df2385e67` | REA retry len main.dart.js (rovnaký limit) |
| `S1` = `main.dart.js` sha256 `b189cad8…c9f` (14,9 MB) | Extrakcia reťazcov z bundlu zachyteného v E1 → `dokazy/api_endpoints.txt`, `dokazy/routes.txt` |
| `S2` = `swagger.json` sha256 `31b62e13…1bf` | Verejná OpenAPI 3.0.1 „Doklado API 2025.2.18" (api-doc.doklado.sk) → `dokazy/schemas_compact.txt` |
| `S3` = `assets/AssetManifest.bin.json` | Zoznam assetov (loga bánk, účtovných SW, konvertorov) → `dokazy/assets_list.txt` |
| `S4` = doklado.com/sk/cennik | Cenník a moduly |

## 1. Architektúra a technológie

- Frontend **Flutter Web** (dart2js `main.dart.js`, `flutter_bootstrap.js`, CanvasKit), PDF viewer `pdfrx`/PDFium, drag&drop `flutter_dropzone`, generovanie PDF `dart_pdf`. [pozorované, E1, S1]
- Rovnaký kód pre iOS/Android (App Store id1586640758, `sk.smartlab.doklado`). [pozorované, S1]
- Backend: **Google Cloud** — API Gateway (`*.ew.gateway.dev`), Cloud Run (`einvoice-v1-*.a.run.app`), **Firebase** (Realtime DB `*-default-rtdb.europe-west1`, Storage, Hosting `*.web.app`). Prostredia dev/dev2–4/test/uat/prod, white-label pre Tatra banku (`rbi-*`, `/tb_*` routy) a HT Solution „esoDoc". [pozorované, S1]
- API štýl: RPC cez `POST /v1/<zdroj>/<akcia>` (213 endpointov, 60 zdrojov). [pozorované, S1]
- Chat widget Brevo, marketing Exponea, platby/predplatné Stripe. [pozorované, E1, S1]
- 9 jazykov UI (sk, cs, en, de, hu, pl, sl, uk, …); lokalizácia SK/CZ (`app.doklado.cz`). [pozorované, S1]

## 2. Funkčné moduly

| Modul | Čo robí | Dôkaz | Stav |
|---|---|---|---|
| **Bločky / Faktúry prijaté / Iné doklady** | Nahratie (foto, PDF, drag&drop, e-mail), OCR „vyťažovanie" hlavičky aj položiek, tolerancia zaokrúhlenia, preferencia domácej meny | S1 reťazce „Automatické vyťažovanie položiek z bločkov/faktúr", routy `process_document/*`, `expense/:id` | [pozorované] |
| **Nespracované doklady + e-mailová schránka** | Každá firma má e-mailovú adresu, prílohy padajú do „Nespracované"; doklady s vyplnenými povinnými poľami sa automaticky presunú do agendy | `not_processed/emails`, `v1/unprocessed-email/*` | [pozorované] |
| **Vydané faktúry** | Typy: faktúra, dobropis, ťarchopis, zálohová, daňový doklad k platbe, opravný; tuzemské/zahraničné; QR platba v PDF; poslanie e-mailom; číslovanie `fetch-next-invoice-number`; OSS (EÚ) | S2 `InputParametersIssueInvoice`, `IssuedInvoiceType`; S1 `v1/invoice/*` | [pozorované] |
| **e-Faktúra / Peppol** | Aktivácia Peppol (výber „poštára", overenie e-mailu), import Peppol BIS 3.0 XML, odkaz na certifikovaných poskytovateľov FS SR | routy `/peppol_activate/*`, `v1/invoice/finalize-einvoice`, `vpds.financnasprava.sk` | [pozorované] |
| **Opakovaná fakturácia** | Šablóny opakovaných faktúr | `recurring_invoice_data/*` | [pozorované] |
| **Automatické upomienky** | Upomienky po splatnosti, e-mailové šablóny, vlastné SMTP | `v1/email-template/*`, `v1/organization/smtp/*` | [pozorované] |
| **Pokladňa** | Príjmové/výdavkové pokladničné doklady | „Pokladničné doklady", `v1/manual-receipt/*` | [pozorované] |
| **Banka** | PSD2 prepojenie (SLSP, Tatra, VÚB, ČSOB, Fio, UniCredit, Raiffeisen, Komerční, Air Bank), párovanie transakcií s dokladmi (VS/KS/SS), stav úhrady, export, kreditné karty, SEPA XML | S2 `PublicApiOrganizationBankTransaction.pairingStatus`; S1 `v2/bank-transactions/pair-document`, `v1/sepa-xml/convert`; S3 loga | [pozorované] |
| **Konvertor výpisov platobných brán** | Stripe, PayPal, GoPay, Comgate, Barion, Mollie, Revolut, Wise, Global Payments, Packeta, GLS, FHB, PKO → import do účtovníctva | S3 `graphics/converter/*`, docs URL | [pozorované] |
| **Účtovné nastavenia na doklade** | Predkontácia, číselný rad, pokladňa, stredisko, zákazka, činnosť, projekt, členenie DPH (aj KV DPH), poznámky; **pomerné účtovanie** (napr. základ 80/20 + DPH 50/50) | S2 `AccountingSettingsV2`, `RatioAllocation` | [pozorované] |
| **Automatické / prediktívne účtovanie** | Pravidlá (šablóny „predlohy") pre bločky, faktúry, banku; prediktívne návrhy predkontácie | `v1/organization/automatic-accounting/*`, `predictive-accounting-rule/*` | [pozorované]; algoritmus predikcie [neznáme] |
| **Export do účtovných programov** | Pohoda, Omega, Money S3, Helios, MRP, MRP-KS, ABRA Flexi, Business Central, Karat, Garis, Tangram, Vema, MKSoft, Eurofib, esoDoc; desktop „**Mostík**" (agent, ktorý zapisuje do lokálneho účtovného SW); stav exportu | S2 `PublicExportStatus`; S1 `v1/desktop-agent/*`; S3 loga | [pozorované] |
| **Import partnerov** | Partneri (odberatelia/dodávatelia) import/export, lookup podľa IČO, validácia IČ DPH a IBAN | `v1/organization/partner/*`, `v1/vat/validate`, `v1/iban/validate`, `v1/participant/lookup` | [pozorované] |
| **Schvaľovanie** | Viacúrovňové schvaľovacie cesty, pravidlá podľa sumy, auto-schválenie pod limitom; stavy default/approved/rejected/returned | `v1/organization/approval-*`, S2 `ApprovalStatus` | [pozorované] |
| **Vyúčtovanie výdavkov** | Vyúčtovanie zálohy, firemnej karty, vlastných zdrojov zamestnanca; zamykanie; súhrnné PDF | „Vyúčtovanie…", `v1/document-group/*` | [pozorované] |
| **Cestovné** | Položka/kategória „Cestovné" | reťazec „Cestovné" | [odvodené] — rozsah (cestovné príkazy?) [neznáme] |
| **Rozdeľovač** | Zbiera doklady na jednom mieste a sám ich roztriedi do firiem (podľa IČO odberateľa) | „Zbierajte doklady na jednom mieste. Rozdeľovač ich automaticky presunie…", `v1/document-classifier/*` | [pozorované]; logika triedenia [odvodené] |
| **Archív** | Digitálny archív 10 rokov, obnova, ZIP archív | `v1/archived-document/*`, `v1/organization/document-archive/create`, S4 | [pozorované] |
| **Štítky, vlastné filtre, prehľad** | Tagy, uložené filtre, report P&L na dashboarde, súhrnný report | `v1/organization/tag/*`, `v1/custom-filter/*`, `v1/organization/dashboard/profit-loss` | [pozorované] |
| **Multi-firma / účtovník** | Neobmedzené firmy, pozvánky, roly **Majiteľ‑Admin, Účtovník, Schvaľovateľ, Čitateľ**, história zmien dokladu | `v1/organization/*member*`, S2 `DocumentChange` | [pozorované] |
| **Verejné API + webhooky** | API kľúče, usage, webhooky, sapi klienti | S2 celý; `v1/api-key/*`, `v1/organization/web-hook/*` | [pozorované] |
| **Kurzy mien** | Prepočet cudzej meny | `v1/exchange-rates/get`, `exchangeRate/otherCurrency` | [pozorované]; zdroj kurzov [neznáme] |

## 3. Dátový model (z verejnej OpenAPI, S2) [pozorované]

- **Document** (bloček/prijatý doklad): `type, subType, paymentStatus, receiptUID` (UID z eKasy), `issuedAt, taxPointDate, totalPrice, vatCategory, approvalStatus`, dodávateľ (`organizationName/VatId/TaxId`, `address`), `invoiceNumber, paymentType, items[], vatSummary[], accountingSettings, exchangeRate, otherCurrency, otherTotalPrice, ossSettings, note, internalNote`.
- **Invoice** (navyše): `orderReference, deliveryNoteNumber, deliveryDate, dueDate, originalNumber, currency, paymentInfo{iban,bic,vs,ss,ks}`.
- **Item**: `name, price, quantity, unit, vatRate, vatAmount, vatCategory, itemType, accountingSettings`.
- **Vydanie faktúry**: `type ∈ {issued_invoice, issued_credit, issued_debit, issued_advance, issued_tax_document}`, dátumy (vystavenie, splatnosť, dodanie, DUZP), `reverseCharge, paid, discount, servesAsDeliveryNote, language`.
- **Bankový pohyb**: `bookingDate, totalAmount, currency, VS/KS, protistrana+IBAN, pairingStatus, paymentStatus`.
- **Enumy**: `PaymentType` (transfer, card, cash, payment_slip, direct_debit, cash_on_delivery, promissory_note, check, document_balance_offset), `PaymentStatus` (paid, not_paid, in_progress, partially_paid), `VatCategory` (undefined, reverse_charge, tax_exempt), prijaté typy (domestic/foreign × received/credit/advance/debit, corrective, tax_document).

Kompletné schémy: `dokazy/schemas_compact.txt`; zoznam interných endpointov: `dokazy/api_endpoints.txt`; routy UI: `dokazy/routes.txt`.

## 4. Obmedzenia / paywall (S4, ceny bez DPH) [pozorované]

FREE: 7 dokladov + 7 konverzií/mes. · PLUS 9,90 €/mes.: 70 dokladov (+0,20 €/ks), neobmedzene firiem/používateľov, archív 10 r., exporty.
Moduly navyše: Mostík 8 €, banka 1 €/účet, Rozdeľovač 8 € + 0,05 €/doklad, opakovaná fakt./upomienky/auto-účtovanie 1 €/firma, vyúčtovanie a schvaľovanie 10 €/firma, API faktúr 14,90 €.

## 5. Čo sa neoverilo

- Prihlásené obrazovky, presné formuláre, validácie, UX tokov — **[neznáme]** (vyžaduje prístup k tvojmu účtu).
- OCR engine (vlastný vs. Google Document AI a pod.) — [neznáme]; v bundli len klientske volanie `organization-file/process`.
- Logika prediktívneho účtovania a Rozdeľovača — [odvodené] len z názvov.
- REA statická AST analýza `main.dart.js` zlyhala na pamäťovom limite workera (E2, E3); funkčný inventár stojí na extrakcii reťazcov (S1) a OpenAPI (S2).

## 6. Pravidlo pre prevzatie

Preberáme **funkcie a doménový model** (ten je daný slovenskou legislatívou), nie kód, texty UI, grafiku ani značku Doklado.
Účtovníček implementujeme nezávisle; názvy polí/enumov navrhujeme vlastné (nižšie v pláne), Doklado OpenAPI slúži len ako kontrolný zoznam.
