# Účtovníček

Doklady, faktúry a banka pre slovenské firmy — export do MRP-K/S.

## Spustenie

```bash
cp .env.example .env.local   # doplň Supabase URL a anon key
npm install
npm run dev
```

Databáza: `supabase/migrations/` (aplikuj cez Supabase CLI alebo MCP).

## Skripty
- `npm run typecheck` — TypeScript
- `npm test` — testy (vitest)
- `npm run build` — produkčný build
