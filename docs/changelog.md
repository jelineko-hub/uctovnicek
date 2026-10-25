# Changelog

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
