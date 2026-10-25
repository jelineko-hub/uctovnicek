import { NextResponse, type NextRequest } from 'next/server';
import { apiClient, apiError, statusFor, unauthorized } from '@/lib/apiAuth';
import { cancelExport } from '@/lib/export/service';

/** POST /api/companies/:companyId/exports/:exportId/cancel — zruší posledný export, doklady → schválené. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ companyId: string; exportId: string }> }) {
  const { companyId, exportId } = await params;
  const ctx = await apiClient(req);
  if (!ctx) return unauthorized();
  const res = await cancelExport(ctx.supabase, companyId, exportId);
  return res.ok ? NextResponse.json({ ok: true }) : apiError(statusFor(res.code), res.code, res.error);
}
