'use server';

import { revalidatePath } from 'next/cache';
import { isExportKind, type ExportKind } from '@/lib/export/mrpDocument';
import { setPeriodStatus } from '@/lib/accounting/service';
import { cancelExport, createExport, setExportStatus, type Problem } from '@/lib/export/service';
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

export async function setPeriodStatusAction(companyId: string, period: string, status: 'open' | 'closed'): Promise<Result> {
  const res = await setPeriodStatus(await createClient(), companyId, period, status);
  if (!res.ok) return { ok: false, error: res.error };
  done(companyId);
  return { ok: true };
}
