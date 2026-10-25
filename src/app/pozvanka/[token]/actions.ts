'use server';

import { redirect } from 'next/navigation';
import { acceptInvite } from '@/lib/members/service';
import { createClient } from '@/lib/supabase-server';

export async function acceptInviteAction(token: string): Promise<{ ok: false; error: string }> {
  const res = await acceptInvite(await createClient(), token);
  if (!res.ok) return { ok: false, error: res.error };
  redirect(`/app/${res.companyId}`);
}
