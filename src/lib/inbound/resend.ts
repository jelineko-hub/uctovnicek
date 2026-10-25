/**
 * Resend Inbound: overenie podpisu webhooku (Svix) a sťahovanie príloh cez API.
 * Webhook `email.received` nesie len metadáta — prílohy sa sťahujú cez `download_url` (platí 1 h),
 * takže telo webhooku je malé (limit serverless funkcie ~4,5 MB sa netýka príloh).
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AttachmentMeta } from './mail';

const API = 'https://api.resend.com';
/** Tolerancia času podpisu (ochrana pred prehratím starej požiadavky). */
const TOLERANCE_S = 5 * 60;

export interface SvixHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

/** Podpis Svix: base64(HMAC-SHA256(`${id}.${timestamp}.${body}`, base64decode(secret bez `whsec_`))). */
export function verifyWebhook(secret: string, h: SvixHeaders, body: string, nowS = Math.floor(Date.now() / 1000)): boolean {
  if (!secret || !h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowS - ts) > TOLERANCE_S) return false;
  const key = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', key).update(`${h.id}.${h.timestamp}.${body}`).digest();
  return h.signature.split(' ').some((part) => {
    const sig = part.startsWith('v1,') ? part.slice(3) : null;
    if (!sig) return false;
    const got = Buffer.from(sig, 'base64');
    return got.length === expected.length && timingSafeEqual(got, expected);
  });
}

export interface ReceivedEmailEvent {
  type: string;
  data: {
    email_id: string;
    from: string;
    to?: string[];
    cc?: string[];
    bcc?: string[];
    received_for?: string[];
    subject?: string | null;
    created_at?: string;
    attachments?: AttachmentMeta[];
  };
}

function apiKey(): string {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) throw new Error('Chýba RESEND_API_KEY.');
  return key;
}

export interface ReceivedAttachment extends AttachmentMeta {
  download_url: string;
}

export async function listAttachments(emailId: string): Promise<ReceivedAttachment[]> {
  const res = await fetch(`${API}/emails/receiving/${encodeURIComponent(emailId)}/attachments`, {
    headers: { Authorization: `Bearer ${apiKey()}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Resend: prílohy sa nepodarilo načítať (${res.status}).`);
  const body = (await res.json()) as { data?: ReceivedAttachment[] };
  return body.data ?? [];
}

export async function downloadAttachment(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`Resend: prílohu sa nepodarilo stiahnuť (${res.status}).`);
  return Buffer.from(await res.arrayBuffer());
}
