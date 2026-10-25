import type { NextRequest } from 'next/server';
import { apiClient, apiError, statusFor, unauthorized } from '@/lib/apiAuth';
import { downloadExport } from '@/lib/export/service';

/** GET /api/companies/:companyId/exports/:exportId/file — stiahnutie XML (prvé stiahnutie → stav „Stiahnutý"). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ companyId: string; exportId: string }> }) {
  const { companyId, exportId } = await params;
  const ctx = await apiClient(req);
  if (!ctx) return unauthorized();
  const res = await downloadExport(ctx.supabase, companyId, exportId);
  if (!res.ok) return apiError(statusFor(res.code), res.code, res.error);
  return new Response(res.body, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Content-Disposition': `attachment; filename="${res.fileName}"`,
      'Cache-Control': 'no-store',
    },
  });
}
