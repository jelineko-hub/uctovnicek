/**
 * Zberný e-mail nad DB: nastavenie schránky (klient používateľa, RLS), príjem webhooku a spracovanie
 * e-mailu ako úlohy `inbound_email` (service role — dotazy vždy filtrujú firmu z úlohy).
 */
import { createHash, randomUUID } from 'node:crypto';
import { safeFileName } from '../compressImage';
import { DOCUMENTS_BUCKET } from '../db';
import { enqueueJob } from '../jobs/queue';
import { JobError, type Job, type JobView } from '../jobs/types';
import { listMembers } from '../members/service';
import { memberRole, type Db } from '../membership';
import {
  inboxSlugsFor,
  makeSlug,
  MAX_ATTACHMENT_BYTES,
  parseAddress,
  parseSenders,
  pickAttachments,
  senderAllowed,
  type InboundEmail,
  type Inbox,
} from './mail';
import { downloadAttachment, listAttachments, type ReceivedEmailEvent } from './resend';

export { INBOUND_STATUSES, type Inbox, type InboundEmail, type InboundStatus } from './mail';

type Result<T = object> = ({ ok: true } & T) | { ok: false; code: string; error: string };
const fail = (code: string, error: string) => ({ ok: false as const, code, error });

async function requireManager(db: Db, companyId: string) {
  const role = await memberRole(db, companyId);
  return role === 'owner' || role === 'accountant' ? null : fail('forbidden', 'Zberný e-mail nastavuje majiteľ alebo účtovník.');
}

// ── Nastavenie schránky ──────────────────────────────────────────

export async function getInbox(db: Db, companyId: string): Promise<Inbox | null> {
  const { data } = await db
    .from('company_inboxes')
    .select('company_id, slug, allow_all, allowed_senders')
    .eq('company_id', companyId)
    .maybeSingle();
  return (data as Inbox | null) ?? null;
}

/** Založí adresu; povolení odosielatelia sú na začiatok e-maily členov firmy (preposielajú faktúry). */
export async function createInbox(db: Db, companyId: string): Promise<Result<{ inbox: Inbox }>> {
  const denied = await requireManager(db, companyId);
  if (denied) return denied;
  const existing = await getInbox(db, companyId);
  if (existing) return { ok: true, inbox: existing };
  const { data: company } = await db.from('companies').select('name').eq('id', companyId).single();
  const members = await listMembers(db, companyId);
  const allowed = [...new Set(members.map((m) => m.email?.toLowerCase()).filter((e): e is string => !!e))];
  for (let i = 0; i < 3; i++) {
    const { data, error } = await db
      .from('company_inboxes')
      .insert({ company_id: companyId, slug: makeSlug(company?.name ?? ''), allowed_senders: allowed })
      .select('company_id, slug, allow_all, allowed_senders')
      .single();
    if (!error) return { ok: true, inbox: data as Inbox };
    if (error.code !== '23505') return fail('db', error.message);
  }
  return fail('db', 'Adresu sa nepodarilo vytvoriť, skús znova.');
}

export async function updateInbox(db: Db, companyId: string, input: { allowAll: boolean; senders: string }): Promise<Result> {
  const denied = await requireManager(db, companyId);
  if (denied) return denied;
  const { senders, invalid } = parseSenders(input.senders);
  if (invalid.length) return fail('invalid_input', `Neplatný odosielateľ: ${invalid.join(', ')} (zadaj e-mail alebo @domena.sk).`);
  const { error } = await db
    .from('company_inboxes')
    .update({ allow_all: input.allowAll, allowed_senders: senders })
    .eq('company_id', companyId);
  return error ? fail('db', error.message) : { ok: true };
}

export async function listInboundEmails(db: Db, companyId: string, limit = 20): Promise<InboundEmail[]> {
  const { data } = await db
    .from('inbound_emails')
    .select('id, from_address, subject, received_at, status, note, document_ids')
    .eq('company_id', companyId)
    .order('received_at', { ascending: false })
    .limit(limit);
  return (data ?? []) as InboundEmail[];
}

/** Spracovať odmietnutý / bezprílohový e-mail znova (voliteľne povoliť odosielateľa natrvalo). */
export async function reprocessInboundEmail(
  db: Db,
  companyId: string,
  emailId: string,
  opts: { allowSender?: boolean } = {},
): Promise<Result<{ job: JobView }>> {
  const denied = await requireManager(db, companyId);
  if (denied) return denied;
  const { data: email } = await db
    .from('inbound_emails')
    .select('id, from_address')
    .eq('id', emailId)
    .eq('company_id', companyId)
    .maybeSingle();
  if (!email) return fail('not_found', 'E-mail neexistuje.');
  if (opts.allowSender) {
    const inbox = await getInbox(db, companyId);
    const sender = parseAddress(email.from_address);
    if (inbox && sender && !inbox.allowed_senders.includes(sender)) {
      await db
        .from('company_inboxes')
        .update({ allowed_senders: [...inbox.allowed_senders, sender] })
        .eq('company_id', companyId);
    }
  }
  const res = await enqueueJob(db, { companyId, type: 'inbound_email', payload: { inbound_email_id: emailId, force: true } });
  return res.ok ? { ok: true, job: res.job } : res;
}

export async function deleteInboundEmail(db: Db, companyId: string, emailId: string): Promise<Result> {
  const denied = await requireManager(db, companyId);
  if (denied) return denied;
  const { error } = await db.from('inbound_emails').delete().eq('id', emailId).eq('company_id', companyId);
  return error ? fail('db', error.message) : { ok: true };
}

// ── Webhook (service role) ───────────────────────────────────────

/** Uloží prijatý e-mail a založí úlohu. Neznáma adresa alebo opakované doručenie → null (webhook vráti 200). */
export async function receiveInboundEmail(admin: Db, event: ReceivedEmailEvent): Promise<string | null> {
  const d = event.data;
  const slugs = inboxSlugsFor([...(d.to ?? []), ...(d.cc ?? []), ...(d.bcc ?? []), ...(d.received_for ?? [])]);
  if (!slugs.length) return null;
  const { data: inbox } = await admin.from('company_inboxes').select('company_id').in('slug', slugs).limit(1).maybeSingle();
  if (!inbox) return null;

  const { data: row, error } = await admin
    .from('inbound_emails')
    .upsert(
      {
        company_id: inbox.company_id,
        provider_id: d.email_id,
        from_address: (d.from ?? '').slice(0, 320),
        subject: d.subject?.slice(0, 500) ?? null,
        received_at: d.created_at ?? new Date().toISOString(),
      },
      { onConflict: 'provider_id', ignoreDuplicates: true },
    )
    .select('id')
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!row) return null; // už prijatý (Resend opakuje doručenie)

  const job = await enqueueJob(admin, {
    companyId: inbox.company_id,
    type: 'inbound_email',
    payload: { inbound_email_id: row.id },
  });
  if (!job.ok) throw new Error(job.error);
  return job.job.id;
}

// ── Spracovanie (úloha inbound_email) ────────────────────────────

const sha256 = (buf: Buffer) => createHash('sha256').update(buf).digest('hex');

export async function processInboundEmail(db: Db, job: Job): Promise<{ result: Record<string, unknown>; next?: string[] }> {
  const emailId = String(job.payload.inbound_email_id ?? '');
  const force = job.payload.force === true;
  const { data: email } = await db
    .from('inbound_emails')
    .select('id, company_id, provider_id, from_address, subject, document_ids')
    .eq('id', emailId)
    .eq('company_id', job.company_id)
    .maybeSingle();
  if (!email) throw new JobError('Prijatý e-mail neexistuje.', false);
  const setEmail = (patch: Record<string, unknown>) =>
    db.from('inbound_emails').update(patch).eq('id', email.id).eq('company_id', job.company_id);

  const { data: inbox } = await db
    .from('company_inboxes')
    .select('allow_all, allowed_senders')
    .eq('company_id', job.company_id)
    .maybeSingle();
  if (!force && (!inbox || !senderAllowed(email.from_address, inbox))) {
    await setEmail({ status: 'rejected', note: 'Odosielateľ nie je medzi povolenými — doklady sa nevytvorili.' });
    return { result: { status: 'rejected' } };
  }

  let list;
  try {
    list = await listAttachments(email.provider_id);
  } catch (e) {
    await setEmail({ status: 'failed', note: e instanceof Error ? e.message : String(e) });
    throw new JobError(e instanceof Error ? e.message : String(e));
  }
  const { use, skipped } = pickAttachments(list);
  if (!use.length) {
    await setEmail({
      status: 'needs_review',
      note: ['E-mail nemá prílohu s dokladom (PDF, JPG, PNG) — pozri ho a nahraj doklad ručne.', ...skipped].join(' '),
    });
    return { result: { status: 'needs_review', skipped } };
  }

  const already = new Set<string>(email.document_ids ?? []);
  const documentIds: string[] = [];
  const next: string[] = [];
  for (const a of use) {
    const name = a.filename || `priloha.${a.mime.split('/')[1]}`;
    const buf = await downloadAttachment(a.download_url).catch((e: unknown) => {
      throw new JobError(e instanceof Error ? e.message : String(e));
    });
    if (buf.length > MAX_ATTACHMENT_BYTES) {
      skipped.push(`${name}: väčšia ako 20 MB`);
      continue;
    }
    const hash = sha256(buf);
    const { data: same } = await db
      .from('document_files')
      .select('document_id')
      .eq('company_id', job.company_id)
      .eq('sha256', hash)
      .not('document_id', 'is', null)
      .limit(1)
      .maybeSingle();
    if (same?.document_id) {
      // Pri opakovaní úlohy je doklad z tohto e-mailu už založený; inak je to rovnaký súbor ako starší doklad.
      if (already.has(same.document_id)) documentIds.push(same.document_id);
      else skipped.push(`${name}: rovnaký súbor už je medzi dokladmi`);
      continue;
    }

    const docId = randomUUID();
    const { error: docError } = await db.from('documents').insert({
      id: docId,
      company_id: job.company_id,
      kind: 'other',
      status: 'unprocessed',
      source: 'email',
      internal_note: `E-mail od ${email.from_address}${email.subject ? `: ${email.subject}` : ''}`.slice(0, 1000),
    });
    if (docError) throw new JobError(docError.message);
    const path = `${job.company_id}/${docId}/${Date.now()}-${safeFileName(name)}`;
    const { error: upError } = await db.storage
      .from(DOCUMENTS_BUCKET)
      .upload(path, buf, { contentType: a.mime, upsert: false });
    if (upError) {
      await db.from('documents').delete().eq('id', docId).eq('company_id', job.company_id);
      throw new JobError(upError.message);
    }
    const { error: fileError } = await db.from('document_files').insert({
      document_id: docId,
      company_id: job.company_id,
      storage_path: path,
      mime: a.mime,
      size_bytes: buf.length,
      sha256: hash,
    });
    if (fileError) throw new JobError(fileError.message);
    documentIds.push(docId);
    await setEmail({ document_ids: [...already, ...documentIds.filter((id) => !already.has(id))] });

    const extract = await enqueueJob(db, { companyId: job.company_id, type: 'extract', documentId: docId });
    if (extract.ok) next.push(extract.job.id);
  }

  await setEmail({
    status: documentIds.length ? 'processed' : 'needs_review',
    note: skipped.length ? skipped.join(' ') : null,
    document_ids: [...new Set([...already, ...documentIds])],
  });
  return { result: { status: documentIds.length ? 'processed' : 'needs_review', document_ids: documentIds, skipped }, next };
}
