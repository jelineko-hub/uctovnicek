import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { apiClient, apiError, statusFor, unauthorized } from '@/lib/apiAuth';
import { createExport, listExports } from '@/lib/export/service';

type Params = { params: Promise<{ companyId: string }> };

/** GET /api/companies/:companyId/exports — posledné exporty firmy. */
export async function GET(req: NextRequest, { params }: Params) {
  const { companyId } = await params;
  const ctx = await apiClient(req);
  if (!ctx) return unauthorized();
  return NextResponse.json({ exports: await listExports(ctx.supabase, companyId) });
}

const body = z.object({
  kind: z.enum(['received_invoice', 'issued_invoice']),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  document_ids: z.array(z.string().uuid()).optional(),
});

/** POST /api/companies/:companyId/exports — {kind, period, document_ids?} → XML do MRP-K/S, doklady sa zamknú. */
export async function POST(req: NextRequest, { params }: Params) {
  const { companyId } = await params;
  const ctx = await apiClient(req);
  if (!ctx) return unauthorized();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_input', 'Očakáva sa {kind, period: "RRRR-MM", document_ids?}.');
  const res = await createExport(ctx.supabase, {
    companyId,
    kind: parsed.data.kind,
    period: parsed.data.period,
    documentIds: parsed.data.document_ids,
  });
  if (!res.ok) return apiError(statusFor(res.code), res.code, res.error, res.problems ? { problems: res.problems } : undefined);
  return NextResponse.json({ export_id: res.exportId, file_name: res.fileName, count: res.count }, { status: 201 });
}
