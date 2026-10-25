import { NextResponse, type NextRequest } from 'next/server';
import { apiClient, apiError, unauthorized } from '@/lib/apiAuth';
import { getJob } from '@/lib/jobs/queue';

/** GET /api/jobs/:id — stav úlohy `{ job: { id, type, status, result, error, attempts } }` (RLS: členovia firmy). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await apiClient(req);
  if (!ctx) return unauthorized();
  const job = await getJob(ctx.supabase, id);
  if (!job) return apiError(404, 'not_found', 'Úloha neexistuje.');
  return NextResponse.json({ job }, { headers: { 'Cache-Control': 'no-store' } });
}
