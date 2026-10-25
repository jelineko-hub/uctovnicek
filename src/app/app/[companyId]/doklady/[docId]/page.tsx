import { notFound } from 'next/navigation';
import { DocumentEditor, type EditorDocument } from '@/components/DocumentEditor';
import { DOCUMENTS_BUCKET } from '@/lib/db';
import { createClient } from '@/lib/supabase-server';

export default async function DocumentPage({ params }: { params: Promise<{ companyId: string; docId: string }> }) {
  const { companyId, docId } = await params;
  const supabase = await createClient();
  const [{ data: doc }, { data: lines }, { data: files }] = await Promise.all([
    supabase
      .from('documents')
      .select(
        'id, company_id, kind, subtype, status, partner_snapshot, original_number, variable_symbol, constant_symbol, ekasa_uid, issue_date, tax_point_date, due_date, currency, total_amount, payment_method, vat_mode, note, internal_note, ocr_raw, ocr_confidence',
      )
      .eq('id', docId)
      .eq('company_id', companyId)
      .maybeSingle(),
    supabase.from('document_lines').select('name, quantity, unit, unit_price, vat_rate').eq('document_id', docId).order('position'),
    supabase.from('document_files').select('storage_path, mime').eq('document_id', docId).order('created_at'),
  ]);
  if (!doc) notFound();

  const file = files?.[0];
  const signed = file
    ? (await supabase.storage.from(DOCUMENTS_BUCKET).createSignedUrl(file.storage_path, 3600)).data?.signedUrl
    : null;

  const raw = (doc.ocr_raw ?? null) as { vat_summary?: { rate: number; base: number; vat: number }[]; notes?: string | null } | null;
  const editorDoc: EditorDocument = {
    ...doc,
    total_amount: doc.total_amount == null ? null : Number(doc.total_amount),
    ocr_confidence: doc.ocr_confidence == null ? null : Number(doc.ocr_confidence),
    printed_vat: raw?.vat_summary ?? [],
    ocr_notes: raw?.notes ?? null,
    lines: (lines ?? []).map((l) => ({
      name: l.name,
      quantity: Number(l.quantity),
      unit: l.unit,
      unit_price: Number(l.unit_price),
      vat_rate: Number(l.vat_rate),
    })),
  };

  return <DocumentEditor doc={editorDoc} file={signed && file ? { url: signed, mime: file.mime ?? '' } : null} />;
}
