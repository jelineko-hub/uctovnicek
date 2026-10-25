/**
 * Zberný e-mail (koncept P1.6) — čisté funkcie: adresa schránky, povolení odosielatelia, výber príloh.
 * Adresa = `<slug>@<INBOUND_EMAIL_DOMAIN>`; doménu prijíma Resend (MX záznam na subdoméne).
 */
import { fold } from '../searchText';

export const DEFAULT_INBOUND_DOMAIN = 'in.uctovnicek.sk';
export const inboundDomain = () => (process.env.INBOUND_EMAIL_DOMAIN?.trim() || DEFAULT_INBOUND_DOMAIN).toLowerCase();
export const inboxAddress = (slug: string, domain = inboundDomain()) => `${slug}@${domain}`;

// ── Typy (zdieľané so stránkou nastavení — tento súbor nesmie importovať serverové moduly) ──

export interface Inbox {
  company_id: string;
  slug: string;
  allow_all: boolean;
  allowed_senders: string[];
}

export const INBOUND_STATUSES = {
  received: 'Spracúva sa',
  processed: 'Spracovaný',
  rejected: 'Neznámy odosielateľ',
  needs_review: 'Bez dokladu',
  failed: 'Chyba',
} as const;
export type InboundStatus = keyof typeof INBOUND_STATUSES;

export interface InboundEmail {
  id: string;
  from_address: string;
  subject: string | null;
  received_at: string;
  status: InboundStatus;
  note: string | null;
  document_ids: string[];
}

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

/** `"Ján <Jan@Firma.sk>"` → `jan@firma.sk`; bez platnej adresy null. */
export function parseAddress(s: string | null | undefined): string | null {
  const raw = (s ?? '').trim();
  const inner = /<([^<>]+)>\s*$/.exec(raw)?.[1] ?? raw;
  const email = inner.trim().toLowerCase();
  return EMAIL.test(email) ? email : null;
}

/** Slug schránky z adries príjemcov (to/cc/received_for), ktoré patria našej doméne. */
export function inboxSlugsFor(addresses: (string | null | undefined)[], domain = inboundDomain()): string[] {
  const out = new Set<string>();
  for (const a of addresses) {
    const email = parseAddress(a);
    if (!email) continue;
    const at = email.lastIndexOf('@');
    if (email.slice(at + 1) === domain) out.add(email.slice(0, at));
  }
  return [...out];
}

/** Nový slug: názov firmy bez diakritiky + náhodná prípona (adresa sa nedá uhádnuť len z názvu/IČO). */
export function makeSlug(companyName: string, random: () => number = Math.random): string {
  const base = fold(companyName).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24).replace(/-+$/, '') || 'firma';
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let suffix = '';
  for (let i = 0; i < 5; i++) suffix += alphabet[Math.floor(random() * alphabet.length)];
  return `${base.length < 3 ? `firma-${base}` : base}-${suffix}`.replace(/^-/, '');
}

/** Zoznam povolených odosielateľov z textu (riadky/čiarky): e-mail alebo `@domena.sk`. */
export function parseSenders(text: string): { senders: string[]; invalid: string[] } {
  const senders = new Set<string>();
  const invalid: string[] = [];
  for (const part of text.split(/[\n,;]+/)) {
    const v = part.trim().toLowerCase();
    if (!v) continue;
    if (/^@[^\s@]+\.[^\s@]+$/.test(v) || EMAIL.test(v)) senders.add(v);
    else invalid.push(part.trim());
  }
  return { senders: [...senders], invalid };
}

export function senderAllowed(from: string | null, inbox: { allow_all: boolean; allowed_senders: string[] }): boolean {
  if (inbox.allow_all) return true;
  const email = parseAddress(from);
  if (!email) return false;
  const domain = email.slice(email.lastIndexOf('@'));
  return inbox.allowed_senders.some((s) => {
    const v = s.trim().toLowerCase();
    return v === email || (v.startsWith('@') && v === domain);
  });
}

export interface AttachmentMeta {
  id: string;
  filename: string | null;
  content_type: string | null;
  content_disposition?: string | null;
  size?: number | null;
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
/** Menšie vložené obrázky sú takmer vždy logá a ikony v podpise e-mailu. */
const MIN_INLINE_IMAGE_BYTES = 30 * 1024;

/** Typ prílohy, ktorý vieme vyťažiť (podľa content-type, inak podľa prípony), alebo null. */
export function attachmentMime(a: AttachmentMeta): string | null {
  const ct = (a.content_type ?? '').split(';')[0].trim().toLowerCase();
  if (Object.values(MIME_BY_EXT).includes(ct)) return ct;
  const ext = (a.filename ?? '').toLowerCase().split('.').pop() ?? '';
  return MIME_BY_EXT[ext] ?? null;
}

/** Prílohy, z ktorých vzniknú doklady, a dôvody, prečo sa ostatné preskočili. */
export function pickAttachments<T extends AttachmentMeta>(list: T[]): { use: (T & { mime: string })[]; skipped: string[] } {
  const use: (T & { mime: string })[] = [];
  const skipped: string[] = [];
  for (const a of list) {
    const mime = attachmentMime(a);
    const name = a.filename || 'príloha';
    if (!mime) {
      skipped.push(`${name}: nepodporovaný typ`);
      continue;
    }
    const size = a.size ?? null;
    if (size != null && size > MAX_ATTACHMENT_BYTES) {
      skipped.push(`${name}: väčšia ako 20 MB`);
      continue;
    }
    if (mime.startsWith('image/') && a.content_disposition === 'inline' && (size == null || size < MIN_INLINE_IMAGE_BYTES)) {
      continue; // logo/ikona v podpise — ticho preskočiť
    }
    use.push({ ...a, mime });
  }
  return { use, skipped };
}
