/**
 * Vyhľadanie bločku v eKasa podľa UID — verejné rozhranie Finančnej správy „Over doklad".
 * Nie je oficiálne dokumentované pre tretie strany (bez SLA): krátky timeout, chyby sa logujú
 * a volajúci vždy padá späť na vyťaženie z fotky. Bez User-Agent prehliadača ho firewall FS odmietne.
 * Len server.
 */
import type { EkasaReceipt, EkasaResponse } from './types';

const ENDPOINT = 'https://ekasa.financnasprava.sk/mdu/api/v1/opd/receipt/find';
const TIMEOUT_MS = 5000;

export type EkasaLookup =
  | { ok: true; receipt: EkasaReceipt }
  | { ok: false; code: 'not_found' | 'unavailable'; message: string };

export async function lookupEkasaReceipt(uid: string): Promise<EkasaLookup> {
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (compatible; Uctovnicek/1.0)',
      },
      body: JSON.stringify({ receiptId: uid }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    });
    const type = res.headers.get('content-type') ?? '';
    if (!res.ok || !type.includes('json')) {
      console.error('ekasa lookup failed', res.status, type);
      return { ok: false, code: 'unavailable', message: `eKasa neodpovedá (HTTP ${res.status}).` };
    }
    const body = (await res.json()) as EkasaResponse;
    if (!body.receipt) return { ok: false, code: 'not_found', message: 'Bloček s týmto UID sa v eKasa nenašiel.' };
    return { ok: true, receipt: body.receipt };
  } catch (e) {
    console.error('ekasa lookup error', e);
    return { ok: false, code: 'unavailable', message: 'eKasa je nedostupná alebo neodpovedala včas.' };
  }
}
