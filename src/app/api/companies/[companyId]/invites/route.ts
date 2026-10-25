import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { apiClient, apiError, statusFor, unauthorized } from '@/lib/apiAuth';
import { createInvite, inviteUrl, listInvites, listMembers } from '@/lib/members/service';

type Params = { params: Promise<{ companyId: string }> };

/** GET /api/companies/:companyId/invites — členovia firmy a nevybavené pozvánky. */
export async function GET(req: NextRequest, { params }: Params) {
  const { companyId } = await params;
  const ctx = await apiClient(req);
  if (!ctx) return unauthorized();
  const [members, invites] = await Promise.all([listMembers(ctx.supabase, companyId), listInvites(ctx.supabase, companyId)]);
  return NextResponse.json({
    members,
    invites: invites.map((i) => ({ ...i, invite_url: inviteUrl(req.nextUrl.origin, i.token) })),
  });
}

const body = z.object({ email: z.string().max(320), role: z.enum(['owner', 'accountant', 'approver', 'viewer']) });

/** POST /api/companies/:companyId/invites — {email, role} → odkaz pozvánky (pošle ho používateľ). */
export async function POST(req: NextRequest, { params }: Params) {
  const { companyId } = await params;
  const ctx = await apiClient(req);
  if (!ctx) return unauthorized();
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return apiError(400, 'invalid_input', 'Očakáva sa {email, role}.');
  const res = await createInvite(ctx.supabase, companyId, parsed.data.email, parsed.data.role);
  if (!res.ok) return apiError(statusFor(res.code), res.code, res.error);
  return NextResponse.json({ token: res.token, invite_url: inviteUrl(req.nextUrl.origin, res.token) }, { status: 201 });
}
