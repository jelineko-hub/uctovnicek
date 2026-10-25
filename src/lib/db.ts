/**
 * Účtovníček beží v zdieľanom Supabase projekte (zkw planner) vo vlastnej schéme.
 * Všetci klienti musia ísť cez túto schému — nikdy nie cez `public`.
 */
export const DB_SCHEMA = 'uctovnicek';

/** Storage bucket pre súbory dokladov; cesta `<company_id>/<document_id>/<súbor>`. */
export const DOCUMENTS_BUCKET = 'uctovnicek-documents';
