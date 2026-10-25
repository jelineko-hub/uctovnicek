import { NextResponse, type NextRequest } from 'next/server';
import { safeNext } from '@/lib/safeNext';
import { createClient } from '@/lib/supabase-server';

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get('code');
  if (code) {
    const supabase = await createClient();
    await supabase.auth.exchangeCodeForSession(code);
  }
  const target = safeNext(request.nextUrl.searchParams.get('next')) ?? '/app';
  return NextResponse.redirect(new URL(target, request.url));
}
