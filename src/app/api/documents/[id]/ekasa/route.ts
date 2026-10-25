import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { apiClient, apiError, statusFor, unauthorized } from '@/lib/apiAuth';
import { normalizeEkasaUid } from '@/lib/ekasa/uid';
import { startEkasa } from '@/lib/jobs/service';

export const maxDuration = 300;

const body = z.object({ uid: z.string().max(64).nullish(), fallback_extract: z.boolean().nullish() }).nullish();

/**
 * POST /api/documents/:id/ekasa — {uid?, fallback_extract?} založí úlohu doplnenia bločku z eKasa
 * (bez UID použije uložené `ekasa_uid`). S `fallback_extract` sa pri chybe eKasa doklad vyťaží z fotky
 * (`job.result.next_job_id`). Odpoveď 202 `{ job }`, stav cez `GET /api/jobs/:id`.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await apiClient(req);
  if (!ctx) return unauthorized();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_input', 'Očakáva sa {uid?, fallback_extract?}.');
  const raw = parsed.data?.uid;
  if (raw && !normalizeEkasaUid(raw)) return apiError(400, 'invalid_uid', 'Neplatné UID bločku (očakáva sa O- a 32 znakov).');
  const res = await startEkasa(ctx.supabase, id, raw ?? null, !!parsed.data?.fallback_extract);
  if (!res.ok) return apiError(res.code === 'not_editable' ? 409 : statusFor(res.code), res.code, res.error);
  return NextResponse.json({ job: res.job }, { status: 202 });
}
