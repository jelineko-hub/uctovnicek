import { NextResponse, type NextRequest } from 'next/server';
import { apiClient, unauthorized } from '@/lib/apiAuth';
import { loadCodeItems, loadRules } from '@/lib/accounting/service';

/** GET /api/companies/:companyId/code-lists — číselníky firmy a pravidlá automatického účtovania. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const ctx = await apiClient(req);
  if (!ctx) return unauthorized();
  const [items, rules] = await Promise.all([loadCodeItems(ctx.supabase, companyId), loadRules(ctx.supabase, companyId)]);
  return NextResponse.json({ items, rules });
}
