/**
 * Detekcia duplicitných dokladov.
 *  (a) rovnaký súbor: SHA-256 súboru v `document_files.sha256` (počíta prehliadač pred uploadom),
 *  (b) rovnaký doklad: IČO partnera + číslo dokladu + suma + dátum vystavenia (po vyťažení / uložení).
 * Novší doklad ukazuje na starší cez `documents.duplicate_of`; `duplicate_ignored` = „nie je to duplikát".
 */

export interface DuplicateKeySource {
  partner_snapshot?: { ico?: string | null } | null;
  original_number: string | null;
  total_amount: number | string | null;
  issue_date: string | null;
}

const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, '').toUpperCase();

/** Kľúč dokladu (b), alebo null, ak chýba číslo alebo suma — vtedy sa duplicita nehľadá. */
export function duplicateKey(d: DuplicateKeySource): string | null {
  const number = clean(d.original_number);
  if (!number || d.total_amount == null || d.total_amount === '') return null;
  const total = Number(d.total_amount);
  if (!Number.isFinite(total)) return null;
  return [clean(d.partner_snapshot?.ico), number, total.toFixed(2), d.issue_date ?? ''].join('|');
}

export function isSameDocument(a: DuplicateKeySource, b: DuplicateKeySource): boolean {
  const ka = duplicateKey(a);
  return ka != null && ka === duplicateKey(b);
}

/** SHA-256 súboru ako hex (prehliadač aj Node 20+ cez Web Crypto). */
export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Minimálne rozhranie Supabase klienta, aby sa dal použiť serverový aj prehliadačový.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = { from: (table: string) => any };

/**
 * Nájde staršie doklady firmy s rovnakým kľúčom (b) a zapíše `duplicate_of` (alebo ho zruší).
 * Vráti id originálu alebo null.
 */
export async function refreshDuplicateOf(supabase: Db, docId: string): Promise<string | null> {
  const { data: doc } = await supabase
    .from('documents')
    .select('id, company_id, created_at, partner_snapshot, original_number, total_amount, issue_date, duplicate_of')
    .eq('id', docId)
    .maybeSingle();
  if (!doc) return null;

  let original: string | null = null;
  if (duplicateKey(doc)) {
    const { data: candidates } = await supabase
      .from('documents')
      .select('id, partner_snapshot, original_number, total_amount, issue_date')
      .eq('company_id', doc.company_id)
      .eq('original_number', doc.original_number)
      .eq('total_amount', doc.total_amount)
      .neq('id', doc.id)
      .lt('created_at', doc.created_at)
      .order('created_at')
      .limit(20);
    original = (candidates as (DuplicateKeySource & { id: string })[] | null)?.find((c) => isSameDocument(doc, c))?.id ?? null;
  }
  if (original !== doc.duplicate_of) {
    await supabase.from('documents').update({ duplicate_of: original }).eq('id', doc.id);
  }
  return original;
}
