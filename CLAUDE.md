# Účtovníček — Project Context for Claude Code

Účtovníček je samostatná webová aplikácia pre slovenské firmy a ich účtovníkov: bločky,
prijaté a vydané faktúry, banka, pokladňa, archív a **export do MRP-K/S (XML 2.0)**.
Funkčný vzor: Doklado (analýza v `docs/analyza-doklado.md`) — preberáme funkcie, nie kód, texty ani grafiku.

## Kde hľadať viac
- `docs/koncept-roadmapa.md` — koncept, priority P0–P3 (§3), architektonické rozhodnutia (§4), etapy E1–E11 (§5).
- `docs/plan.md` — stack, pôvodný dátový model, rozhodnutia (fázy → koncept-roadmapa).
- `docs/changelog.md` — história zmien (nový záznam na začiatok).
- `docs/mrp/` — oficiálna dokumentácia a vzory MRP-K/S XML 2.0 (vydané `_fv`, prijaté `_fp`).
- `docs/doklado-dokazy/` — zoznam API/rout/schém Doklado (len kontrolný zoznam funkcií).

## Pracovný postup (povinné)
- Komunikácia so userom **po slovensky**.
- Pri KAŽDOM commite bumpni `APP_VERSION` v `src/lib/version.ts`.
- Pred commitom: `npm run typecheck` a `npm test`.
- Záznam o zmene na začiatok `docs/changelog.md`; do CLAUDE.md len nové trvalé pravidlo.
- Supabase: SQL/migrácie cez Supabase MCP, migračný súbor ulož aj do `supabase/migrations/`.

## Stack
- Next.js 15 App Router + React 19 + TypeScript, Supabase (Postgres + Auth + RLS + Storage), Vercel.
- `src/lib/supabase-server.ts` (SSR), `supabase-browser.ts`. Service role len v API routes, nikdy v klientovi.

## Trvalé pravidlá a pasce
- DB je v zdieľanom Supabase projekte **zkw planner** (`whtnfgxirblxkcmkphhz`) v schéme **`uctovnicek`**.
  Všetky tabuľky/funkcie len v tejto schéme (nikdy `public`), klienti cez `DB_SCHEMA` z `src/lib/db.ts`.
  `storage.objects` a `auth.users` sú spoločné so zkw plannerom → storage politiky len pre bucket
  `uctovnicek-documents` a bez priameho `::uuid` (použi `uctovnicek.path_company_id`).
- Multi-firma: prístup k dátam = členstvo v `company_members`; RLS cez `is_company_member(company_id, roles)`.
  Každá company-scoped tabuľka má `company_id` a pri inserte ho posielaj explicitne.
- Roly: `owner`, `accountant`, `approver`, `viewer` (viewer len číta). Nová rola = aj CHECK constraint.
- Nová hodnota stavu / typu = aj DB CHECK constraint.
- NIKDY `.update()` / `.delete()` bez `.eq(...)` filtra.
- Nové RLS politiky s `(select auth.uid())`.
- `numeric` z PostgREST prichádza ako string → `Number(x)` pred výpočtom.
- Ceny položiek dokladu ukladáme **bez DPH** (`unit_price`), DPH sa počíta zo sadzby; zaokrúhlenie per sadzba.
- SK sadzby DPH od 2025: 23 % základná, 19 % a 5 % znížené → MRP export vždy posiela rozpis `SumValues`.
- MRP-K/S: databáza je Windows-1250 → texty cez `toCp1250Safe`; `DocumentNumber` max 10 znakov, jedinečné;
  vydané a prijaté faktúry sa v jednom XML nemiešajú; kódy „Typ DPH" (SK 10/40) sú nastaviteľné per firma.
- Vyťaženie dokladov: len server (`lib/extraction/extract.ts`, kľúč `ANTHROPIC_API_KEY` na Verceli), model
  `claude-haiku-5-5` (lacný, user ho výslovne chce — drahší model len na jeho pokyn); výstup cez `toDocument` (čistá funkcia) — nová kolónka = schema.ts + toDocument + editor.
- Názvy druhov/stavov len z `lib/documentKinds.ts`; DPH výpočty len cez `lib/vat.ts`.
- Body serverless funkcie ~4,5 MB → súbory dokladov nahrávať priamo do Storage (`uctovnicek-documents/<company_id>/<document_id>/…`).
- API-first (kvôli mobilnej appke): mutácie, ktoré bude potrebovať mobil (upload, založenie a potvrdenie dokladu,
  vyťaženie, eKasa, zoznamy), musia existovať ako route handlers `/api/*` s autentifikáciou Supabase JWT
  (`Authorization: Bearer`), nie len ako server actions; zdieľaná logika v `lib/`. Odpoveď JSON, chyba `{error: {code, message}}`.
- Externé volania (Claude, eKasa, e-mail provider) idú cez tabuľku `jobs` (`pending → running → done|failed`,
  `attempts`, dobeh cez Vercel Cron); synchrónne ostáva len export XML a párovanie banky.
- `documents.source` je povinný: `upload | camera | email | einvoice | manual` — každé založenie dokladu ho nastaví.
- Stavy dokladu: prechody a oprávnenia len cez `lib/documentStatus.ts`; exportovaný/archivovaný doklad je zamknutý
  (DB trigger povolí len stav, internú poznámku a technické polia) — nový stĺpec, ktorý sa smie meniť po exporte, pridaj do triggera.
- Duplicity: `lib/duplicates.ts` (`refreshDuplicateOf` po každej zmene čísla/sumy/dátumu/partnera); hash súboru pri každom novom zdroji.
- API route handlers: autentifikácia a chyby cez `lib/apiAuth.ts` (`apiClient`, `apiError`, `statusFor`); logika v `lib/<modul>/service.ts`,
  ktorú volajú aj server actions. Export do MRP len cez `lib/export/` (Účtovníček nečísluje — prefix radu + UUID, číslo pridelí MRP).
- eKasa len cez `lib/ekasa/` (neoficiálne API FS — vždy fallback na vyťaženie); bločky majú `prices_with_vat = true`
  → DPH vždy `totals(lines, { pricesWithVat })` podľa dokladu, inak vyjde o cent iná DPH než na bločku.
- Členstvo len cez pozvánky (`lib/members/`, RPC `accept_invite` — e-mail účtu = e-mail pozvánky); e-maily členov len cez
  RPC `company_member_list` (auth.users nie je cez RLS). Presmerovanie po prihlásení len cez `safeNext`.
