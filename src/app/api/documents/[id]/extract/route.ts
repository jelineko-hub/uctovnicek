import { NextResponse, type NextRequest } from 'next/server';
import { DOCUMENTS_BUCKET } from '@/lib/db';
import { applyAccountingRules } from '@/lib/accounting/service';
import { refreshDuplicateOf } from '@/lib/duplicates';
import { applyEkasa } from '@/lib/ekasa/service';
import { normalizeEkasaUid } from '@/lib/ekasa/uid';
import { ExtractionError, extractDocument } from '@/lib/extraction/extract';
import { toDocument } from '@/lib/extraction/toDocument';
import { createClient } from '@/lib/supabase-server';

// Vyťaženie jedného dokladu trvá desiatky sekúnd (model číta obrázok/PDF).
export const maxDuration = 120;

const MAX_BYTES = 20 * 1024 * 1024;

/**
 * POST /api/documents/:id/extract — vyťaží prvý súbor dokladu a prepíše údaje dokladu.
 * Beží s klientom používateľa (RLS): k dokladu cudzej firmy sa nedostane.
 * Stav ostáva `unprocessed`, kým používateľ údaje nepotvrdí.
 */
export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Neprihlásený používateľ.' }, { status: 401 });

  const { data: doc } = await supabase
    .from('documents')
    .select('id, company_id, status')
    .eq('id', id)
    .maybeSingle();
  if (!doc) return NextResponse.json({ error: 'Doklad neexistuje.' }, { status: 404 });
  if (doc.status !== 'unprocessed') {
    return NextResponse.json({ error: 'Vyťažiť sa dá len nespracovaný doklad.' }, { status: 409 });
  }

  const [{ data: company }, { data: file }, { data: accounts }] = await Promise.all([
    supabase.from('companies').select('name, ico, iban').eq('id', doc.company_id).single(),
    supabase
      .from('document_files')
      .select('storage_path, mime, size_bytes')
      .eq('document_id', id)
      .order('created_at')
      .limit(1)
      .maybeSingle(),
    supabase.from('bank_accounts').select('iban').eq('company_id', doc.company_id),
  ]);
  if (!company || !file) return NextResponse.json({ error: 'Doklad nemá súbor.' }, { status: 400 });
  if (Number(file.size_bytes) > MAX_BYTES) {
    return NextResponse.json({ error: 'Súbor je väčší ako 20 MB.' }, { status: 413 });
  }

  const { data: blob, error: dlError } = await supabase.storage.from(DOCUMENTS_BUCKET).download(file.storage_path);
  if (dlError || !blob) return NextResponse.json({ error: 'Súbor sa nepodarilo načítať.' }, { status: 500 });

  let result;
  try {
    result = await extractDocument(
      { data: Buffer.from(await blob.arrayBuffer()), mime: file.mime || blob.type },
      { companyName: company.name, companyIco: company.ico },
    );
  } catch (e) {
    const message = e instanceof ExtractionError ? e.message : 'Vyťaženie zlyhalo, skús to znova.';
    if (!(e instanceof ExtractionError)) console.error('extract failed', e);
    return NextResponse.json({ error: message }, { status: 502 });
  }

  const { patch, lines } = toDocument(result.data, company.ico, [company.iban, ...(accounts ?? []).map((a) => a.iban)]);
  const { error: upError } = await supabase
    .from('documents')
    .update({ ...patch, ocr_raw: { ...result.data, model: result.model } })
    .eq('id', id);
  if (upError) return NextResponse.json({ error: upError.message }, { status: 500 });

  await supabase.from('document_lines').delete().eq('document_id', id);
  if (lines.length) {
    const { error: lineError } = await supabase
      .from('document_lines')
      .insert(lines.map((l) => ({ ...l, document_id: id, company_id: doc.company_id })));
    if (lineError) return NextResponse.json({ error: lineError.message }, { status: 500 });
  }
  await supabase.from('document_history').insert({
    document_id: id,
    company_id: doc.company_id,
    diff: { action: 'extracted', model: result.model },
  });
  // Model prečítal UID bločku → presné údaje z eKasa majú prednosť (pri chybe ostáva vyťaženie).
  let ekasa: { ok: boolean; error?: string } | null = null;
  if (patch.kind === 'receipt' && normalizeEkasaUid(patch.ekasa_uid)) {
    const res = await applyEkasa(supabase, id, patch.ekasa_uid);
    ekasa = res.ok ? { ok: true } : { ok: false, error: res.error };
  }
  const duplicateOf = await refreshDuplicateOf(supabase, id);
  await applyAccountingRules(supabase, id);

  return NextResponse.json({
    ok: true,
    kind: patch.kind,
    notes: ekasa?.ok ? 'Údaje doplnené z eKasa.' : result.data.notes,
    ekasa,
    duplicate_of: duplicateOf,
  });
}
