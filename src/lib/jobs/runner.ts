/**
 * Spracovanie úloh: prevezme ich `claim_jobs` (skip locked), spustí handler a zapíše výsledok.
 * Spúšťa sa hneď po zápise úlohy (`kickJobs` → `after()`) a záložne cronom každých 5 min
 * (`/api/cron/jobs`), ktorý dobehne pending, failed s attempts < 3 a zaseknuté running.
 */
import { after } from 'next/server';
import { applyEkasa } from '../ekasa/service';
import { runExtraction } from '../extraction/service';
import { processInboundEmail } from '../inbound/service';
import type { Db } from '../membership';
import { createAdminClient } from '../supabase-admin';
import { enqueueJob } from './queue';
import { JobError, MAX_ATTEMPTS, type Job, type JobType } from './types';

interface Outcome {
  result: Record<string, unknown>;
  /** Úlohy, ktoré táto úloha založila a majú bežať hneď po nej (napr. vyťaženie príloh e-mailu). */
  next?: string[];
}
type Handler = (db: Db, job: Job) => Promise<Outcome>;

const requireDocument = (job: Job) => {
  if (!job.document_id) throw new JobError('Úloha nemá doklad.', false);
  return job.document_id;
};

const HANDLERS: Partial<Record<JobType, Handler>> = {
  async extract(db, job) {
    return { result: { ...(await runExtraction(db, requireDocument(job))) } };
  },

  /** eKasa podľa UID; s `fallback_extract` pri chybe založí vyťaženie z fotky (nahratie bločku s QR). */
  async ekasa_lookup(db, job) {
    const docId = requireDocument(job);
    const uid = typeof job.payload.uid === 'string' ? job.payload.uid : null;
    const res = await applyEkasa(db, docId, uid);
    if (res.ok) return { result: { ok: true, warnings: res.warnings } };
    if (!job.payload.fallback_extract) throw new JobError(res.error, false);
    const next = await enqueueJob(db, { companyId: job.company_id, type: 'extract', documentId: docId });
    if (!next.ok) throw new JobError(next.error);
    return { result: { ok: false, error: res.error, next_job_id: next.job.id }, next: [next.job.id] };
  },

  async inbound_email(db, job) {
    return processInboundEmail(db, job);
  },
};

async function finish(db: Db, job: Job, outcome: { result?: Record<string, unknown>; error?: string; retry?: boolean }) {
  const failed = outcome.error != null;
  await db
    .from('jobs')
    .update({
      status: failed ? 'failed' : 'done',
      result: outcome.result ?? null,
      error: outcome.error ?? null,
      finished_at: new Date().toISOString(),
      ...(failed && !outcome.retry ? { attempts: Math.max(job.attempts, MAX_ATTEMPTS) } : {}),
    })
    .eq('id', job.id);
}

async function runOne(db: Db, job: Job): Promise<string[]> {
  const handler = HANDLERS[job.type];
  if (!handler) {
    await finish(db, job, { error: `Typ úlohy ${job.type} sa zatiaľ nespracúva.`, retry: false });
    return [];
  }
  try {
    const out = await handler(db, job);
    await finish(db, job, { result: out.result });
    return out.next ?? [];
  } catch (e) {
    const retry = !(e instanceof JobError) || e.retry;
    if (!(e instanceof JobError)) console.error(`job ${job.type} ${job.id} failed`, e);
    await finish(db, job, { error: e instanceof Error ? e.message : String(e), retry });
    return [];
  }
}

async function claim(db: Db, ids: string[] | null, limit: number): Promise<Job[]> {
  const { data, error } = await db.rpc('claim_jobs', { p_ids: ids, p_limit: limit, p_max_attempts: MAX_ATTEMPTS });
  if (error) throw new Error(`claim_jobs: ${error.message}`);
  return (data ?? []) as Job[];
}

/** Spracuje úlohy (konkrétne `ids`, inak najstaršie z fronty) po dve naraz, kým neuplynie čas. */
export async function runJobs(db: Db, opts: { ids?: string[]; limit?: number; budgetMs?: number } = {}) {
  const deadline = Date.now() + (opts.budgetMs ?? 240_000);
  let processed = 0;
  let ids: string[] | null = opts.ids ?? null;
  // Cron: dávky z fronty; kick: zadané úlohy + úlohy, ktoré z nich vznikli.
  while (Date.now() < deadline - 60_000) {
    const jobs = await claim(db, ids, ids ? ids.length : opts.limit ?? 4);
    if (!jobs.length) break;
    const next: string[] = [];
    const queue = [...jobs];
    const worker = async () => {
      for (let job = queue.shift(); job; job = queue.shift()) next.push(...(await runOne(db, job)));
    };
    await Promise.all([worker(), worker()]);
    processed += jobs.length;
    if (opts.ids) {
      if (!next.length) break;
      ids = next;
    }
  }
  return { processed };
}

/** Spustí úlohy hneď po odpovedi (Vercel `waitUntil`); čo nestihne, dobehne cron. */
export function kickJobs(ids: string[]) {
  if (!ids.length) return;
  after(async () => {
    try {
      await runJobs(createAdminClient(), { ids });
    } catch (e) {
      console.error('kickJobs failed', e);
    }
  });
}
