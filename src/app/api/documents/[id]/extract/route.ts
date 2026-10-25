import { NextResponse, type NextRequest } from 'next/server';
import { apiClient, apiError, statusFor, unauthorized } from '@/lib/apiAuth';
import { startExtraction } from '@/lib/jobs/service';

// Úloha beží po odpovedi (after) — vyťaženie trvá desiatky sekúnd, e-mail s viacerými prílohami dlhšie.
export const maxDuration = 300;

/**
 * POST /api/documents/:id/extract — založí úlohu vyťaženia nespracovaného dokladu a hneď ju spustí.
 * Odpoveď 202 `{ job }`; stav sleduj cez `GET /api/jobs/:id` (výsledok v `job.result`).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await apiClient(req);
  if (!ctx) return unauthorized();
  const res = await startExtraction(ctx.supabase, id);
  if (!res.ok) return apiError(res.code === 'not_editable' ? 409 : statusFor(res.code), res.code, res.error);
  return NextResponse.json({ job: res.job }, { status: 202 });
}
