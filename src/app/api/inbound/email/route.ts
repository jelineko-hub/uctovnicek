import { NextResponse, type NextRequest } from 'next/server';
import { apiError } from '@/lib/apiAuth';
import { verifyWebhook, type ReceivedEmailEvent } from '@/lib/inbound/resend';
import { receiveInboundEmail } from '@/lib/inbound/service';
import { kickJobs } from '@/lib/jobs/runner';
import { createAdminClient } from '@/lib/supabase-admin';

export const maxDuration = 300;

/**
 * POST /api/inbound/email — webhook Resend `email.received` (podpis Svix, RESEND_WEBHOOK_SECRET).
 * Uloží e-mail k firme podľa adresy príjemcu a spustí úlohu `inbound_email` (prílohy → doklady → vyťaženie).
 * Neznáma adresa / opakované doručenie → 200, aby Resend neopakoval.
 */
export async function POST(req: NextRequest) {
  const body = await req.text();
  const ok = verifyWebhook(
    process.env.RESEND_WEBHOOK_SECRET?.trim() ?? '',
    {
      id: req.headers.get('svix-id'),
      timestamp: req.headers.get('svix-timestamp'),
      signature: req.headers.get('svix-signature'),
    },
    body,
  );
  if (!ok) return apiError(401, 'invalid_signature', 'Neplatný podpis webhooku.');

  let event: ReceivedEmailEvent;
  try {
    event = JSON.parse(body);
  } catch {
    return apiError(400, 'invalid_input', 'Neplatný JSON.');
  }
  if (event.type !== 'email.received' || !event.data?.email_id) return NextResponse.json({ ignored: true });

  const jobId = await receiveInboundEmail(createAdminClient(), event);
  if (jobId) kickJobs([jobId]);
  return NextResponse.json({ ok: true, job_id: jobId });
}
