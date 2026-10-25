/**
 * Service-role klient (obchádza RLS!) — len na serveri pre spracovanie úloh bez prihláseného používateľa
 * (`lib/jobs/`, webhook zberného e-mailu, cron). Každý dotaz musí filtrovať firmu/doklad z úlohy.
 */
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { DB_SCHEMA } from './db';
import type { Db } from './membership';

export class AdminConfigError extends Error {}

export function createAdminClient(): Db {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new AdminConfigError('Chýba SUPABASE_SERVICE_ROLE_KEY (Vercel → Settings → Environment Variables).');
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, key, {
    db: { schema: DB_SCHEMA },
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as Db;
}
