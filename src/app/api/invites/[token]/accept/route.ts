import { NextResponse, type NextRequest } from 'next/server';
import { apiClient, apiError, statusFor, unauthorized } from '@/lib/apiAuth';
import { acceptInvite } from '@/lib/members/service';

/** POST /api/invites/:token/accept — prihlásený používateľ s e-mailom z pozvánky sa stane členom firmy. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const ctx = await apiClient(req);
  if (!ctx) return unauthorized();
  const res = await acceptInvite(ctx.supabase, token);
  return res.ok ? NextResponse.json({ company_id: res.companyId }) : apiError(statusFor(res.code), res.code, res.error);
}
