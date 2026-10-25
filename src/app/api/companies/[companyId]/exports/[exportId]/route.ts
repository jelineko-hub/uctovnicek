import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { apiClient, apiError, statusFor, unauthorized } from '@/lib/apiAuth';
import { setExportStatus } from '@/lib/export/service';

const body = z.object({ status: z.enum(['imported', 'failed']), error: z.string().max(2000).nullish() });

/** PATCH /api/companies/:companyId/exports/:exportId — {status: imported|failed, error?} po importe do MRP. */
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ companyId: string; exportId: string }> }) {
  const { companyId, exportId } = await params;
  const ctx = await apiClient(req);
  if (!ctx) return unauthorized();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_input', 'Očakáva sa {status: "imported" | "failed", error?}.');
  const res = await setExportStatus(ctx.supabase, companyId, exportId, parsed.data.status, parsed.data.error);
  return res.ok ? NextResponse.json({ ok: true }) : apiError(statusFor(res.code), res.code, res.error);
}
