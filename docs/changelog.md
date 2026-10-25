# Changelog

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
