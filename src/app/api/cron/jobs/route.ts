import { NextResponse, type NextRequest } from 'next/server';
import { apiError } from '@/lib/apiAuth';
import { runJobs } from '@/lib/jobs/runner';
import { createAdminClient } from '@/lib/supabase-admin';

export const maxDuration = 300;

/** Vercel Cron (vercel.json, každých 5 min): dobehne úlohy, ktoré nestihol okamžitý beh alebo zlyhali. */
export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return apiError(401, 'unauthorized', 'Neplatný CRON_SECRET.');
  }
  const res = await runJobs(createAdminClient(), { limit: 4, budgetMs: 270_000 });
  return NextResponse.json(res);
}
