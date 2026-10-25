import { NextResponse, type NextRequest } from 'next/server';
import { apiClient, unauthorized } from '@/lib/apiAuth';
import { companyOverview } from '@/lib/members/service';

/** GET /api/overview — firmy prihláseného používateľa s počtami dokladov podľa stavu a posledným exportom. */
export async function GET(req: NextRequest) {
  const ctx = await apiClient(req);
  if (!ctx) return unauthorized();
  return NextResponse.json({ companies: await companyOverview(ctx.supabase) });
}
