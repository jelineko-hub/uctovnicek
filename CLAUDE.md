# Účtovníček — Project Context for Claude Code

Účtovníček je samostatná webová aplikácia pre slovenské firmy a ich účtovníkov: bločky,
prijaté a vydané faktúry, banka, pokladňa, archív a **export do MRP-K/S (XML 2.0)**.
Funkčný vzor: Doklado (analýza v `docs/analyza-doklado.md`) — preberáme funkcie, nie kód, texty ani grafiku.

## Kde hľadať viac
- `docs/plan.md` — fázy F0–F5, dátový model, rozhodnutia.
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
