import { DOC_COLUMNS, DocumentTable, type DocumentRow } from '@/components/DocumentTable';
import { UploadDocuments } from '@/components/UploadDocuments';
import { createClient } from '@/lib/supabase-server';

export default async function InboxPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from('documents')
    .select(DOC_COLUMNS)
    .eq('company_id', companyId)
    .eq('status', 'unprocessed')
    .order('created_at', { ascending: false });

  return (
    <>
      <section className="card" style={{ marginBottom: 16 }}>
        <UploadDocuments companyId={companyId} />
      </section>
      <h2>Nespracované doklady</h2>
      <p className="muted small">Skontroluj vyťažené údaje a potvrď — doklad sa presunie do svojej agendy.</p>
      <DocumentTable companyId={companyId} rows={(data ?? []) as DocumentRow[]} showKind />
    </>
  );
}
