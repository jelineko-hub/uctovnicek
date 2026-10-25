import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { apiClient, apiError, unauthorized } from '@/lib/apiAuth';
import { applyEkasa } from '@/lib/ekasa/service';

const body = z.object({ uid: z.string().max(64).nullish() }).nullish();

const STATUS = { not_found: 404, unavailable: 502, invalid_uid: 400, not_editable: 409, db: 500 } as const;

/** POST /api/documents/:id/ekasa — {uid?} doplní nespracovaný bloček z eKasa (bez UID použije uložené `ekasa_uid`). */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await apiClient(req);
  if (!ctx) return unauthorized();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_input', 'Očakáva sa {uid?}.');
  const res = await applyEkasa(ctx.supabase, id, parsed.data?.uid);
  if (!res.ok) return apiError(STATUS[res.code], res.code, res.error);
  return NextResponse.json({ ok: true, warnings: res.warnings });
}
