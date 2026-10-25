# Analýza aplikácie Doklado (REA)

**Cieľ:** Doklado (`app.doklado.sk`, verzia 2.25.0) som analyzoval ako podklad pre funkcie, ktoré chceš mať v Účtovníčku.
**Dátum:** 25. 10. 2026
**Nástroj:** REA 6.7.0 (`rea-agents`). Pripojenie išlo cez CDP na samostatné okno Chrome s tvojím prihláseným TRIAL účtom.
**Rozsah:** analyzoval som webovú aplikáciu: statický JS bundle, pasívny záznam stránky a REA scenár, ktorý iba navigoval. Nič som neukladal, neodosielal ani nemenil. Mobilnú aplikáciu (iOS/Android) ani backend som neanalyzoval.

Označenie istoty pri tvrdeniach:
- **[pozorované]**: priamo v REA dôkaze alebo v kóde bundlu.
- **[odvodené]**: logický záver z pozorovaní.
- **[neznáme]**: nedá sa overiť z klienta.

## Evidence (REA)

| ID | Čo obsahuje |
|---|---|
| `ev_93b35352…` | `list-browser-targets`: cieľová stránka `app.doklado.sk/home/organizations` |
| `ev_d011ac71…` | `inspect-web-page`: DOM, 7 skriptov so zdrojom, kľúče storage (bez hodnôt) |
| `ev_a4894794…` | `export-web-scripts`: export skriptov na statickú analýzu |
| `ev_49185cc1…` | `analyze-javascript-application`: 6 malých skriptov. Pri `main.dart.js` došla analyzéru pamäť (**čiastočné**) |
| `ev_abb849f7…` | `capture-browser-scenario`: 5 navigácií, 1204 sieťových a WebSocket udalostí (bez tiel a hlavičiek) |

Odkazy typu `main.dart.js@N` znamenajú pozíciu znaku v bundli `main.dart.js` (sha256 `b189cad8fa86451a…`). Pri dart2js je extrakcia reťazcov z tohto bundlu (lokalizácia, modely, endpointy) presnejšia ako AST analýza, ktorá na 15 MB súbore zlyhala.

---

## 1. Architektúra a technológie

| Vrstva | Technológia | Istota / dôkaz |
|---|---|---|
| Frontend | **Flutter Web** (dart2js, CanvasKit renderer). Jeden kód pre web aj mobil | [pozorované] `flutter_bootstrap.js`, `main.dart.js` 14,9 MB, kľúče `flutter.*` v localStorage (`ev_d011ac71`), požiadavky na `flutter-canvaskit` (`ev_abb849f7`) |
| Auth | **Firebase Auth** (email/heslo) + prihlásenie cez **Tatra banka ID** (`/tid/*`) | [pozorované] `identitytoolkit`/`securetoken` (`ev_abb849f7`), routy `/tid/response`, endpointy `v1/tid/login`, `v1/tid/authorize` |
| Databáza | **Cloud Firestore** (real-time `Listen` + `runAggregationQuery`), projekt `sk-smartlab-doklado` | [pozorované] `ev_abb849f7` |
| Ďalšie Firebase služby | Realtime DB (počítadlá využitia), Storage, Remote Config, Analytics | [pozorované] kľúče sessionStorage `flutterfire-*` (`ev_d011ac71`), `.dv("customer_product_usage/…")` |
| Backend API | **Google API Gateway** → pravdepodobne Cloud Functions alebo Cloud Run. Všetko je `POST /v1/...` s JSON telom | [pozorované] `api-gateway-prod-europe-west-1….gateway.dev/v1/organization/search` atď. (`ev_abb849f7`). Typ backendu za gateway je [odvodené] |
| Asynchrónne úlohy | Klient zapíše príkaz do kolekcie `asynchronous_command` a sleduje jeho stav (vzor „command + listener“) | [pozorované] 14× `cv("asynchronous_command")`. Vzor je [odvodené] |
| Vyhľadávanie | Search endpointy vracajú `hits`, stránkujú `itemsPerPage` (full-text index, napr. Typesense, Algolia alebo Elastic) | [pozorované] tvar odpovede. Konkrétny engine [neznáme] |
| OCR/AI | **AWS Textract AnalyzeExpense** + **OpenAI** (vyťaženie položiek) + zlúčenie výsledkov | [pozorované] polia `awsExpenseAnalysisData`, `open_ai_items`, `textAnalysisData`, `mergedResults` v modeli spracovania (`main.dart.js@9816232`) |
| PDF | `pdfrx` (PDFium cez WASM) na náhľad a render PDF v prehliadači | [pozorované] `pdfium.wasm`, `pdfium_worker.js` |
| Obrázky | `pica` (zmenšenie fotky v klientovi pred uploadom), Uploadcare CDN | [pozorované] `cdn.jsdelivr.net/npm/pica@9.0.1`, `ucarecdn.com` |
| Upload | `flutter_dropzone` (drag & drop) | [pozorované] |
| Platby | **Stripe** (checkout, billing portal, predplatné, faktúry) | [pozorované] `v1/stripe/*` |
| Podpora | Brevo Conversations (chat widget), Exponea/Bloomreach (marketing) | [pozorované] |
| Desktop „Mostík“ | Lokálny agent na PC účtovníka. Importuje doklady do Pohoda, Omega, Helios, MRP. Komunikuje cez kolekciu `desktop_agent_command` | [pozorované] `v1/desktop-agent/*`, `desktop_agent_health_checks/`. Implementácia agenta [neznáme] |
| Lokalizácia | 8 jazykov: sk, cs, en, de, hu, pl, sl, uk. Spolu ~3 940 textov | [pozorované] `main.dart.js@6283705–8924707` |

## 2. Hlavné funkcie (moduly)

Zoznam vychádza zo 41 rout (`main.dart.js@14757279`), 213 API endpointov a slovenskej lokalizácie.

### 2.1 Zber dokladov
- **Mobilná appka:** foto bločku alebo faktúry a sken **eKasa QR kódu**. Párovanie s webom cez QR (`v1/device-pair/create` → mobil naskenuje → `v1/device-pair/finish`, kolekcia `device_pairing_request`). [pozorované] Na skenovanie eKasa v mobile ukazuje model bločku s poliami eKasa, nižšie. [odvodené]
- **Web upload:** drag & drop na `organization/:organizationId/upload`. [pozorované]
- **Email inbox:** každá firma má vlastnú zbernú adresu. Prílohy prichádzajú do `unprocessed_email` → „Nespracované doklady“. Odosielateľov možno obmedziť whitelistom (`allowAllEmailCollection`, `user_email_alias`). [pozorované]
- **Rozdeľovač (Document classifier):** jedna spoločná zberná schránka pre viac firiem. Doklady automaticky presúva do správnej firmy. Prístup majú pozvaní členovia (role `owner`, `accountant`). [pozorované] Smerovanie podľa IČO/IBAN dokladu je [odvodené] z textu „Obsahuje údaje viazané na jednu firmu (IČO / IBAN)“.

### 2.2 Vyťaženie dát (OCR/AI)
- Pipeline: `document_process_request` → AWS AnalyzeExpense + text analysis + OpenAI pre položky → `mergedResults` → doklad. [pozorované] Poradie krokov je [odvodené].
- Doklady s eKasa ID sa dotiahnu z eKasa (polia `receiptId`, `okp`, `pkp`, `cashRegisterCode`, `paragon`, `ico`, `dic`, `icDph`, DPH rozpad), nie z OCR. [pozorované] Model je v `main.dart.js@898698`. Volanie eKasa API z backendu je [odvodené].
- **Detekcia duplicít** („Bol nájdený duplicitný doklad“, `ignoredDuplicityCheck`). [pozorované] Algoritmus beží na serveri [neznáme].
- Dátumy na doklade: dátum vystavenia, dátum zdaniteľného plnenia (DUZP) a dátum evidencie. [pozorované]

### 2.3 Typy dokladov
- Bločky (eKasa aj manuálne), prijaté faktúry, vystavené faktúry, iné doklady (vlastné kategórie), súhrnné vyúčtovania (`document_group`), výdavky (`expense`), bankové pohyby, archív. [pozorované] Routy `accounting_documents/*`, `other_documents/:type`, `archived_documents`.

### 2.4 Fakturácia
- Vystavenie faktúry, ďalšie číslo v rade (`v1/invoice/fetch-next-invoice-number`), PDF, odoslanie emailom s vlastnými šablónami (`email_template`), vlastné SMTP (`v1/organization/smtp/*`). [pozorované]
- **Opakované faktúry** (`recurring_invoice_data`): frekvencia, počet opakovaní, vystavenie k poslednému dňu mesiaca, automatické odoslanie, splatnosť N dní. [pozorované] Model je v `main.dart.js@907346`.
- **Automatické upomienky** (`remindersSent`, `dontSendAutomaticReminders`). [pozorované]
- **Prenesenie daňovej povinnosti** (`reverseCharge`, `taxRule`), zľava, dodací list (`servesAsDeliveryNote`), cudzia mena a kurz (`v1/exchange-rates/get`). [pozorované]
- **Platobné QR, platobné brány** (`payment_request`, `v1/payment-request/init-payment`). [pozorované]

### 2.5 e-Faktúra / Peppol
- „Doklado Poštár“ je Peppol Access Point pre príjem a odosielanie e-Faktúr. Aktivácia ide cez portál FS (`/peppol_activate/*`), formát **Peppol BIS 3.0 XML**, validácia (`e_invoice_validation`, `v1/invoice/validate`), stavy doručenia. Prílohy sa vkladajú do XML. [pozorované]

### 2.6 Banka
- Pripojenie účtov (PSD2 cez Tatra banka / RBI, `v1/rbi/*`), sťahovanie pohybov, **párovanie pohybu s dokladom** (`v2/bank-transactions/pair-document`, `unpair-document`), manuálne úhrady, IBAN validácia. [pozorované]
- Logika automatického párovania beží na serveri. Kritériá (VS, suma, IBAN) sú [odvodené] / [neznáme].
- **Automatické určenie typu faktúry podľa firemných IBANov** (prijatá alebo vystavená). [pozorované] Text lokalizácie.

### 2.7 Konvertor výpisov platobných brán
- Výpisy zo Stripe, PayPal, GoPay, Comgate, Barion, Mollie, Revolut, Global Payments a Packeta konvertuje do **SEPA XML** (camt) na import do účtovníctva (`v1/sepa-xml/convert`, route `converter`). Cena 0,01 € za transakciu nad limit. [pozorované] Odkazy na docs.doklado.sk a texty lokalizácie.

### 2.8 Účtovanie
- **Predkontácie a kódy operácií**, číselné rady, pokladne, strediská, zákazky, činnosti, projekty, klasifikácia DPH a KV DPH, účtovné účty. Všetko sa synchronizuje z účtovného programu (`v1/organization/accounting-settings/sync`). [pozorované] Model organizácie je v `main.dart.js@814107`.
- **Automatické účtovanie:** pravidlá podľa partnera alebo používateľa priradia predkontáciu. Sú zvlášť pre bločky, faktúry a banku, vrátane „predlôh“. [pozorované]
- **Prediktívne účtovanie:** pravidlo `{name, type, predictiveAccountingAgenda, inputData, outputData, items, periodDate}` sa učí z histórie. [pozorované] Payload je v `main.dart.js` (`predictive-accounting-rule/create`). Algoritmus je [neznáme].
- **Tagy**, vlastné filtre (`custom_filter`), uzamknutie dokladov. [pozorované]

### 2.9 Schvaľovanie (viacúrovňové)
- **Schvaľovacie procesy** (fázy so schvaľovateľmi), **pravidlá** (podľa typu dokladu, partnera, krajiny, agendy, `isDefault`, `minimumApprovalAmount`) a **hranice podľa sumy** (`approval_by_amount`). [pozorované]
- Firestore: `organization/{id}/approval_process|approval_rules|approval_by_amount`, filter `active == true`. [pozorované]
- Stavy: schválený, vrátený, zamietnutý. Dashboard počíta neschválené doklady podľa typu (`notApprovedReceipts` …). [pozorované] Model je v `main.dart.js@884576`.

### 2.10 Export do účtovníctva
- **Mostík** (desktop agent): Pohoda, Omega, Helios, MRP. **API**: ABRA Flexi, MRP K/S, MRP Vizuálny systém. Ďalej súbory CSV, XLSX a PDF a archív ZIP. [pozorované]
- Stavy exportu (úspech, chyba, bez prílohy, manuálne označený). Pri importe do Pohody voľba „Nekontrolovať duplicity“. [pozorované]
- **Verejné API** pre ERP/BI: API kľúče, história, využitie a webhooky (`v1/api-key/*`, `v1/organization/web-hook/*`, `sapi-*`). [pozorované]

### 2.11 Vyúčtovanie výdavkov zamestnancov
- `document_group` = súhrnné vyúčtovanie za obdobie. Pridávanie dokladov, PDF súhrn (`regenerate-summary-pdf`), uzamknutie a odomknutie, export. `expense` = výdavok zamestnanca (výdavkový doklad, PDF, archív). [pozorované]

### 2.12 Firmy, používatelia, roly
- Viac firiem na jeden účet (účtovník spravuje klientov), pozvánky a roly **Majiteľ → Účtovník → Zamestnanec**, prehľad „Ne-exportované bločky / Nespracované doklady“. [pozorované] Screenshot a lokalizácia.
- Lookup firmy podľa názvu alebo IČO pri registrácii (`v1/public-organization/search`). [pozorované] Overenie IČ DPH (`v1/vat/validate`). [pozorované]
- Notifikácie, dashboard zisk/strata (`v1/organization/dashboard/profit-loss`). [pozorované]
- AI Asistent: tlačidlo existuje, ale jeho implementáciu som neidentifikoval. [neznáme]

## 3. Dátový model (Firestore)

Kolekcie [pozorované] (`.cv()` = collection, `.dv()` = doc):

```
organization/{orgId}
  ├─ approval_process, approval_rules, approval_by_amount
  ├─ automatic_accounting
  ├─ bank_accounts, bank_transactions
  └─ user_email_alias
user, user_organization            # členstvo a rola používateľa vo firme
organization_file                  # nahraté súbory (faktúry) na spracovanie
organization_document              # iné doklady
organization_document_archive, archived_document
invoice, recurring_invoice_data, email_template
expense, document_group            # výdavky, súhrnné vyúčtovania
partner                            # adresár dodávateľov/odberateľov
unprocessed_email, document_process_request
document_classifier, document_classifier_document, user_document_classifier   # Rozdeľovač
payment_request, payment_entry
asynchronous_command, desktop_agent_command, user_desktop_agent, synchronization_history
device_pairing_request, notification, chat_room, custom_filter, api_key, organization_invite, history
```

Realtime DB (počítadlá a limity) [pozorované]: `customer_product_usage/`, `trial/`, `free_plan/`, `billing_change/`.

### Kľúčové entity (polia) [pozorované]

**Bloček (eKasa)**, `main.dart.js@898698`:
`receiptId, ico, dic, icDph, okp, pkp, cashRegisterCode, paragon, paragonNumber, receiptNumber, issueDate, createDate, evidenceDate, items[], exemption, freeTaxAmount, taxBaseBasic, taxBaseReduced, vatAmountBasic, vatAmountReduced, vatRateBasic, vatRateReduced, totalPrice, otherCurrency, exchangeRate, organization{…}, unit{…}`

**Manuálny bloček**, `@894371`:
`manualReceiptType, app_paymentType, app_accountingItemId (predkontácia), app_numericCodeId (číselný rad), app_cashRegisterId (pokladňa), taxBase*/vatAmount*/vatRate*, totalPrice, currency, homeCurrency, homeTotalPrice, vatSummary, taxPointDate, attachments, note`

**Faktúra**, `@783073`:
`number, type, issueDate, dueDate, deliveryDate, supplier, customer, items[], summary, paymentInfo, orderReference, customerReference, isIssuedByUs, taxRule, reverseCharge, customVatReverseChargeText, discount, language, emailRecipients/Cc/Bcc, remindersSent, dontSendAutomaticReminders, servesAsDeliveryNote, deliveryNoteNumber, peppolUUID, ignoredDuplicityCheck, originalNumber (dobropis)`

**Firma (organizácia)**, `@814107`:
`identificationNumber (IČO), dic, icDph, vatPayer, vatRegistrationType, adresa, accountingSoftware, accountingItems, numericCodes, cashRegisters, expenditureCenters, projects, orders, activities, paymentMethods, defaultCodes, approvalProcesses, documentsApprovalEnabled, automaticAccountingEnabled, desktopAgentId, bankAccountsInfo, allowAllEmailCollection`

**Spracovanie dokladu**, `@9816232`:
`status, jobs, items, emailSubject, sourceEmailAddress, open_ai_items, awsExpenseAnalysisData, textAnalysisData, mergedResults, additionalInfoData, accountingSettings`

**Opakovaná faktúra**, `@907346`:
`recurringFrequency, recurringInvoicingAt, lastInvoicingAt, numberOfRepetitions, issueInvoiceOnLastDayOfTheMonth, sendInvoiceByMailAutomatically, dueDateNumberOfDays, deliveryDateType, isActive, customer, items, summary`

## 4. API

Všetko je `POST https://<api-gateway>/v1/<resource>/<action>` s JSON telom `{organizationId, …}` a Firebase ID tokenom. [pozorované] Spolu je ich 213 [pozorované]. Hlavné skupiny:

| Skupina | Príklady |
|---|---|
| organization (56) | `create, update, search, members/get, assign-member, permission/change, tag/*, partner/*, approval-*/*, automatic-accounting/*, predictive-accounting-rule/*, accounting-settings/sync, smtp/*, web-hook/*, dashboard/profit-loss` |
| doklady | `organization-file/{process,update,export,batch-update,…}`, `organization-document/*`, `receipt/update`, `manual-receipt/*`, `archived-document/*` |
| faktúry | `invoice/{create,issue,send,validate,finalize-einvoice,generate-payment-pdf,fetch-next-invoice-number}`, `recurring-invoice-data/*` |
| banka | `bank-accounts/*`, `bank-transactions/{search,update,export}`, `v2/bank-transactions/{pair,unpair}-document`, `rbi/*` |
| email | `unprocessed-email/{process,delete}`, `unprocessed-email-attachment/process` |
| rozdeľovač | `document-classifier/{register,assign-member,aggregation,validate-files}`, `document-classifier-document/{move,delete}` |
| vyúčtovanie | `expense/*`, `document-group/*` |
| konverzie | `sepa-xml/convert`, `accounting-software-export/convert` |
| billing | `stripe/{checkout-session,billing-portal-session,subscription/update}`, `promo-code/*`, `user/trial/cancel` |
| integrácie | `desktop-agent/*`, `api-key/*`, `sapi-client/*`, `sapi-webhook/*`, `premium-api/*` |

## 5. Obmedzenia a paywall [pozorované]

- **TRIAL** 30 dní: 70 dokladov a 70 konverzií. Potom **FREE** (neobmedzene dlho, bez banky) alebo **PLUS** (platený, doplnkové moduly). Z PLUS sa nedá prejsť na nižší program.
- Spracovanie dokladu nad limit stojí 0,20 €, konverzia transakcie 0,01 €.
- Počítadlá limitov (`@9175734`): `receipt_count, conversion_rows_count, bank_accounts_count, predictive_accounting_count, recurring_invoicing_count, automatic_reminder_count, document_group_user_count, multi_level_approval_count, mrp_api_usage, abra_api_usage, api_usage_count`.
- Platené moduly: Mostík, Automatické účtovanie, Rozdeľovač, Viacúrovňové schvaľovanie, Opakovaná fakturácia, Automatické upomienky, API.
- Partnerstvo s Tatra bankou: prihlásenie cez TB ID a 70 dokladov mesačne zadarmo pre klientov TB.

## 6. Čo sa neoverilo

- **Algoritmy na serveri:** OCR merge, detekcia duplicít, automatické párovanie banky, prediktívne účtovanie, smerovanie v Rozdeľovači. Klient vidí iba vstupy a výstupy. [neznáme]
- **Telá odpovedí API:** zámerne som ich nezachytával (citlivé dáta). Tvary modelov pochádzajú z klientskych `fromJson`.
- **Mobilná aplikácia a desktop Mostík:** neanalyzované. Na to by bolo treba APK/IPA alebo inštalátor agenta.
- **AST analýza `main.dart.js`:** REA analyzéru došla pamäť (`ev_49185cc1`, limitation). Nahradil som ju extrakciou reťazcov.
- **Prechod sekciami:** prešiel som iba sekcie mimo firmy (zoznam firiem, programy, konvertor, validácia e-faktúry). Detail firmy a dokladov runtime nepozoroval, tie pokrýva iba statická analýza.

---

## 7. Odporúčania pre Účtovníček (nezávislá implementácia)

Opis je funkčný. Kód Doklado sa nekopíruje, iba sa preberajú koncepty, ktoré sú bežné v doméne SK účtovníctva.

**Priorita A, najväčšia hodnota pri malej práci:**
1. **eKasa import bločku cez QR.** Z QR bločku prečítaš `receiptId` (formát `O-…`) a dotiahneš kompletné dáta z verejného eKasa API Finančnej správy. Dostaneš presné IČO, DIČ, sumy a DPH rozpad bez OCR. Model nižšie zodpovedá štruktúre eKasa.
2. **Zberný email per firma.** Unikátna adresa (napr. `<slug>@inbox.uctovnicek.sk`), inbound webhook (Mailgun, Postmark alebo SES), prílohy idú do fronty „Nespracované“ a whitelist odosielateľov.
3. **OCR faktúr: hybrid.** Štruktúrované vyťaženie hlavičky (AWS Textract AnalyzeExpense alebo Azure Document Intelligence „invoice“), položky cez LLM s JSON schémou a zlúčenie s pravidlami (IČO z registra má prednosť, sumy musia sedieť na DPH rozpad).
4. **Detekcia duplicít.** Hash súboru a kľúč `(IČO dodávateľa, číslo dokladu, suma, dátum)`. Pri zhode ponúknuť „aj tak uložiť“.
5. **Stavový automat dokladu:** `nespracovaný → spracovaný → (schválený) → exportovaný`, s uzamknutím po exporte.

**Priorita B:**
6. **Automatické účtovanie:** pravidlo `ak partner = X (a/alebo používateľ = Y, typ = bloček/faktúra/banka) → predkontácia, stredisko, zákazka, DPH klasifikácia`. Následne „predikcia“, teda návrh z posledných N dokladov toho istého partnera.
7. **Párovanie banky:** import pohybov (CSV, camt.053 alebo PSD2 agregátor), automatický návrh párovania podľa VS, sumy a IBAN-u a manuálne potvrdenie a rozpárovanie.
8. **Konvertor platobných brán → camt/SEPA XML:** parsery CSV exportov Stripe, PayPal, GoPay a Comgate do jednotného formátu pre import do účtovníctva.
9. **Opakované faktúry a upomienky:** cron job, frekvencia, počet opakovaní, „posledný deň mesiaca“, automatický email a upomienky X dní po splatnosti.

**Priorita C (väčšie):**
10. **Viacúrovňové schvaľovanie:** procesy, fázy, schvaľovatelia, pravidlá podľa typu, partnera a sumy (hranice) a predvolené pravidlo.
11. **Peppol e-Faktúra:** generovanie a validácia Peppol BIS 3.0 (UBL 2.1). Na príjem a odoslanie treba certifikovaného Access Point providera, Doklado ním sám je.
12. **Rozdeľovač:** jedna schránka pre viac firiem a smerovanie podľa IČO odberateľa alebo IBAN-u na doklade.
13. **Export:** Pohoda XML (dataPack), Money S3 XML, CSV/XLSX. Desktop agenta (ako Mostík) robiť iba vtedy, ak ho cieľový program vyžaduje.

**Architektonické vzory, ktoré sa oplatí prevziať:**
- **Príkaz + listener** pre dlhé úlohy (OCR, export). Klient zapíše `command{status:'pending'}`, worker ho spracuje a UI reaguje real-time na zmenu `status`.
- **Počítadlá limitov** oddelene od dát (pre freemium model).
- **Multi-tenant cez `organizationId`** v každej požiadavke a v každom dokumente a rola používateľa vo firme v samostatnej entite `user_organization`.
