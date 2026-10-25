'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { isExportKind, type ExportKind } from '@/lib/export/mrpDocument';
import { cancelExport, createExport, saveMrpSettings, setExportStatus, type Problem } from '@/lib/export/service';
import { createClient } from '@/lib/supabase-server';

type Result = { ok: true; message?: string } | { ok: false; error: string; problems?: Problem[] };

const done = (companyId: string) => revalidatePath(`/app/${companyId}`, 'layout');

export async function createExportAction(companyId: string, kind: ExportKind, period: string, documentIds: string[]): Promise<Result> {
  if (!isExportKind(kind)) return { ok: false, error: 'Neplatný druh exportu.' };
  const res = await createExport(await createClient(), { companyId, kind, period, documentIds });
  if (!res.ok) return { ok: false, error: res.error, problems: res.problems };
  done(companyId);
  return { ok: true, message: `Export vytvorený (${res.count} dokladov). Stiahni ho v zozname exportov nižšie.` };
}

export async function cancelExportAction(companyId: string, exportId: string): Promise<Result> {
  const res = await cancelExport(await createClient(), companyId, exportId);
  if (!res.ok) return { ok: false, error: res.error };
  done(companyId);
  return { ok: true, message: 'Export zrušený, doklady sú znova schválené a odomknuté.' };
}

export async function setExportStatusAction(
  companyId: string,
  exportId: string,
  status: 'imported' | 'failed',
  error?: string | null,
): Promise<Result> {
  const res = await setExportStatus(await createClient(), companyId, exportId, status, error);
  if (!res.ok) return { ok: false, error: res.error };
  done(companyId);
  return { ok: true };
}

const optCode = z.string().trim().max(10).transform((s) => s || null);
const optTax = z.string().trim().transform((s) => (s ? Number(s) : null)).refine((n) => n == null || (Number.isInteger(n) && n > 0), 'kód');
const settingsInput = z.object({
  prefix_received: optCode,
  prefix_issued: optCode,
  tax_code_received: optTax,
  tax_code_issued: optTax,
});

export async function saveMrpSettingsAction(companyId: string, input: z.input<typeof settingsInput>): Promise<Result> {
  const parsed = settingsInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Prefix má najviac 10 znakov, Typ DPH je kladné celé číslo.' };
  const res = await saveMrpSettings(await createClient(), companyId, parsed.data);
  if (!res.ok) return { ok: false, error: res.error };
  done(companyId);
  return { ok: true, message: 'Nastavenie uložené.' };
}
