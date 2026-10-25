/**
 * Autentifikácia API route handlers (API-first, CLAUDE.md): mobil posiela Supabase JWT
 * v `Authorization: Bearer <access_token>`, web ide cez session cookies. RLS platí v oboch prípadoch.
 * Chyby API vždy v tvare `{ error: { code, message } }`.
 */
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { DB_SCHEMA } from './db';
import { createClient } from './supabase-server';

type Db = Awaited<ReturnType<typeof createClient>>;

export async function apiClient(req: Request): Promise<{ supabase: Db; userId: string } | null> {
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) {
    const token = auth.slice(7).trim();
    const supabase = createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      db: { schema: DB_SCHEMA },
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }) as unknown as Db;
    const { data: { user } } = await supabase.auth.getUser(token);
    return user ? { supabase, userId: user.id } : null;
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return user ? { supabase, userId: user.id } : null;
}

export function apiError(status: number, code: string, message: string, extra?: object) {
  return NextResponse.json({ error: { code, message, ...extra } }, { status });
}

export const unauthorized = () => apiError(401, 'unauthorized', 'Neprihlásený používateľ.');

/** HTTP status pre kód chyby zo služieb v `lib/`. */
export function statusFor(code: string): number {
  if (code === 'forbidden') return 403;
  if (code === 'not_found') return 404;
  if (code === 'db' || code === 'storage') return 500;
  if (code === 'stale' || code === 'cancelled' || code === 'imported' || code === 'not_latest' || code === 'archived') return 409;
  return 400;
}
