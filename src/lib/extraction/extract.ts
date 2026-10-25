import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { extractedDocument, type ExtractedDocument } from './schema';

/** Typy súborov, ktoré vie Claude priamo čítať. */
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
export const PDF_TYPE = 'application/pdf';

// Haiku 5.5: najlacnejší aktuálny model ($0,10 / $0,50 za 1M tokenov vstup/výstup pri promptoch do 100K),
// určený práve na vyťažovanie. Haiku nemá server-side fallback pri odmietnutí — chyba sa ukáže používateľovi.
export const EXTRACTION_MODEL = 'claude-haiku-5-5';

export interface ExtractionContext {
  /** Firma, pre ktorú sa doklad spracúva — podľa nej sa určí prijatý vs. vydaný doklad. */
  companyName: string;
  companyIco: string | null;
}

export class ExtractionError extends Error {}

const SYSTEM = `Vyťažuješ údaje zo slovenských a českých účtovných dokladov (pokladničné bločky eKasa, faktúry, zálohové faktúry, dobropisy, pokladničné doklady) pre účtovnú aplikáciu.

Pravidlá:
- Prepisuj len to, čo je na doklade. Čo nie je čitateľné alebo uvedené, vráť ako null a spomeň to v "notes". Nič nedopočítavaj ani neodhaduj, okrem prepočtu ceny položky na cenu bez DPH (nižšie).
- Dátumy vo formáte YYYY-MM-DD. Sumy ako čísla s desatinnou bodkou.
- "unit_price" je cena za mernú jednotku BEZ DPH. Ak doklad uvádza ceny s DPH (typicky bloček), prepočítaj: s DPH / (1 + sadzba/100), na 6 desatinných miest.
- "vat_summary" je rekapitulácia DPH presne tak, ako je vytlačená na doklade (základ a DPH podľa sadzieb). Ak na doklade nie je, vráť prázdne pole.
- "total_amount" je celková suma na úhradu s DPH.
- Bloček z registračnej pokladnice: kind "receipt", dodávateľ je predajca, "ekasa_uid" je UID/kód dokladu eKasa (napr. "O-…"), ak je vytlačený.
- Faktúra: ak je odberateľom firma zadaná nižšie, kind "received_invoice"; ak je dodávateľom ona, kind "issued_invoice".
- "subtype": invoice (bežná faktúra/bloček), advance (zálohová), proforma (predfaktúra), credit (dobropis), debit (ťarchopis), tax_payment (daňový doklad k prijatej platbe), corrective (opravná faktúra).
- "vat_mode": reverse_charge pri prenesení daňovej povinnosti, exempt pri oslobodení, non_vat ak dodávateľ nie je platiteľ DPH, inak standard.
- IČO a DIČ len číslice; IČ DPH s predponou krajiny. IBAN bez medzier.`;

/**
 * Pošle súbor dokladu Claudovi a vráti štruktúrované údaje.
 * Volá sa len zo servera (API route) — kľúč ANTHROPIC_API_KEY nesmie ísť do prehliadača.
 */
export async function extractDocument(
  file: { data: Buffer; mime: string },
  ctx: ExtractionContext,
): Promise<{ data: ExtractedDocument; model: string }> {
  const b64 = file.data.toString('base64');
  let source: Anthropic.ContentBlockParam;
  if (file.mime === PDF_TYPE) {
    source = { type: 'document', source: { type: 'base64', media_type: PDF_TYPE, data: b64 } };
  } else if ((IMAGE_TYPES as readonly string[]).includes(file.mime)) {
    source = {
      type: 'image',
      source: { type: 'base64', media_type: file.mime as (typeof IMAGE_TYPES)[number], data: b64 },
    };
  } else {
    throw new ExtractionError(`Typ súboru ${file.mime} sa nedá vyťažiť (podporované: PDF, JPG, PNG, WebP).`);
  }

  const client = new Anthropic();
  const response = await client.messages.parse({
    model: EXTRACTION_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: zodOutputFormat(extractedDocument) },
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          source,
          {
            type: 'text',
            text: `Firma používateľa: ${ctx.companyName}${ctx.companyIco ? `, IČO ${ctx.companyIco}` : ''}.\nVyťaž údaje z tohto dokladu.`,
          },
        ],
      },
    ],
  });

  if (response.stop_reason === 'refusal') {
    throw new ExtractionError('Model odmietol doklad spracovať.');
  }
  if (response.stop_reason === 'max_tokens') {
    throw new ExtractionError('Doklad je príliš dlhý na jedno vyťaženie (prekročený limit výstupu).');
  }
  if (!response.parsed_output) {
    throw new ExtractionError('Výstup modelu sa nepodarilo načítať.');
  }
  return { data: response.parsed_output, model: response.model };
}
