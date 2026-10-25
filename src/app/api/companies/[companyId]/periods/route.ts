import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { apiClient, apiError, statusFor, unauthorized } from '@/lib/apiAuth';
import { closedPeriods, setPeriodStatus } from '@/lib/accounting/service';

type Params = { params: Promise<{ companyId: string }> };

/** GET /api/companies/:companyId/periods — uzavreté mesiace ('YYYY-MM'). */
export async function GET(req: NextRequest, { params }: Params) {
  const { companyId } = await params;
  const ctx = await apiClient(req);
  if (!ctx) return unauthorized();
  return NextResponse.json({ closed: [...(await closedPeriods(ctx.supabase, companyId))].sort() });
}

const body = z.object({ period: z.string().regex(/^\d{4}-\d{2}$/), status: z.enum(['open', 'closed']) });

/** POST /api/companies/:companyId/periods — {period: 'YYYY-MM', status: closed|open} (otvoriť len účtovník). */
export async function POST(req: NextRequest, { params }: Params) {
  const { companyId } = await params;
  const ctx = await apiClient(req);
  if (!ctx) return unauthorized();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_input', 'Očakáva sa {period: "RRRR-MM", status: "closed" | "open"}.');
  const res = await setPeriodStatus(ctx.supabase, companyId, parsed.data.period, parsed.data.status);
  return res.ok ? NextResponse.json({ ok: true }) : apiError(statusFor(res.code), res.code, res.error);
}
