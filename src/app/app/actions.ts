'use server';

import { revalidatePath } from 'next/cache';
import { createClient } from '@/lib/supabase-server';

export async function createCompany(formData: FormData) {
  const name = String(formData.get('name') ?? '').trim();
  const ico = String(formData.get('ico') ?? '').replace(/\s+/g, '');
  if (!name) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  const { error } = await supabase.from('companies').insert({ name, ico: ico || null, created_by: user.id });
  if (error) throw new Error(error.message);
  revalidatePath('/app');
}
