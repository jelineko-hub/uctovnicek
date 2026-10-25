import { createBrowserClient } from '@supabase/ssr';
import { DB_SCHEMA } from './db';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: DB_SCHEMA } }
  );
}
