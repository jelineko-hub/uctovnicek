/**
 * Vyťaženie dokladu modelom → údaje dokladu (beží ako úloha `extract`, `lib/jobs/`).
 * Klient je service role → dotazy vždy filtrujú doklad/firmu z úlohy.
 */
import { applyAccountingRules } from '../accounting/service';
import { DOCUMENTS_BUCKET } from '../db';
import { refreshDuplicateOf } from '../duplicates';
import { applyEkasa } from '../ekasa/service';
import { normalizeEkasaUid } from '../ekasa/uid';
import { JobError } from '../jobs/types';
import type { Db } from '../membership';
import { ExtractionError, extractDocument } from './extract';
import { toDocument } from './toDocument';

const MAX_BYTES = 20 * 1024 * 1024;

export interface ExtractionResult {
  kind: string;
  notes: string | null;
  ekasa: { ok: boolean; error?: string } | null;
  duplicate_of: string | null;
}

export async function runExtraction(db: Db, docId: string): Promise<ExtractionResult> {
  const { data: doc } = await db.from('documents').select('id, company_id, status').eq('id', docId).maybeSingle();
  if (!doc) throw new JobError('Doklad neexistuje.', false);
  if (doc.status !== 'unprocessed') throw new JobError('Vyťažiť sa dá len nespracovaný doklad.', false);

  const [{ data: company }, { data: file }, { data: accounts }] = await Promise.all([
    db.from('companies').select('name, ico, iban').eq('id', doc.company_id).single(),
    db
      .from('document_files')
      .select('storage_path, mime, size_bytes')
      .eq('document_id', docId)
      .order('created_at')
      .limit(1)
      .maybeSingle(),
    db.from('bank_accounts').select('iban').eq('company_id', doc.company_id),
  ]);
  if (!company || !file) throw new JobError('Doklad nemá súbor.', false);
  if (Number(file.size_bytes) > MAX_BYTES) throw new JobError('Súbor je väčší ako 20 MB.', false);

  const { data: blob, error: dlError } = await db.storage.from(DOCUMENTS_BUCKET).download(file.storage_path);
  if (dlError || !blob) throw new JobError('Súbor sa nepodarilo načítať.');

  let result;
  try {
    result = await extractDocument(
      { data: Buffer.from(await blob.arrayBuffer()), mime: file.mime || blob.type },
      { companyName: company.name, companyIco: company.ico },
    );
  } catch (e) {
    if (e instanceof ExtractionError) throw new JobError(e.message, false);
    console.error('extract failed', e);
    throw new JobError('Vyťaženie zlyhalo, skúsim to znova.');
  }

  const { patch, lines } = toDocument(result.data, company.ico, [company.iban, ...(accounts ?? []).map((a) => a.iban)]);
  const { error: upError } = await db
    .from('documents')
    .update({ ...patch, ocr_raw: { ...result.data, model: result.model } })
    .eq('id', docId)
    .eq('status', 'unprocessed');
  if (upError) throw new JobError(upError.message);

  await db.from('document_lines').delete().eq('document_id', docId);
  if (lines.length) {
    const { error: lineError } = await db
      .from('document_lines')
      .insert(lines.map((l) => ({ ...l, document_id: docId, company_id: doc.company_id })));
    if (lineError) throw new JobError(lineError.message);
  }
  await db.from('document_history').insert({
    document_id: docId,
    company_id: doc.company_id,
    diff: { action: 'extracted', model: result.model },
  });
  // Model prečítal UID bločku → presné údaje z eKasa majú prednosť (pri chybe ostáva vyťaženie).
  let ekasa: ExtractionResult['ekasa'] = null;
  if (patch.kind === 'receipt' && normalizeEkasaUid(patch.ekasa_uid)) {
    const res = await applyEkasa(db, docId, patch.ekasa_uid);
    ekasa = res.ok ? { ok: true } : { ok: false, error: res.error };
  }
  const duplicateOf = await refreshDuplicateOf(db, docId);
  await applyAccountingRules(db, docId);

  return {
    kind: patch.kind,
    notes: ekasa?.ok ? 'Údaje doplnené z eKasa.' : result.data.notes ?? null,
    ekasa,
    duplicate_of: duplicateOf,
  };
}
