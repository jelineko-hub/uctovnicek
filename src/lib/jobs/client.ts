/** Prehliadač: sledovanie úlohy (`GET /api/jobs/:id` každé 2 s), vrátane nadväzujúcej úlohy (`result.next_job_id`). */
import { jobFinished, type JobView } from './types';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Čaká na dokončenie úlohy a jej nadväzujúcich úloh; vráti všetky v poradí.
 * Úloha, ktorá zlyhala a ešte sa zopakuje, alebo ktorá nestihla dobehnúť do `timeoutMs`, sa vráti v aktuálnom stave.
 */
export async function waitForJob(id: string, timeoutMs = 4 * 60_000): Promise<JobView[]> {
  const deadline = Date.now() + timeoutMs;
  const chain: JobView[] = [];
  let current = id;
  for (;;) {
    await sleep(2000);
    const res = await fetch(`/api/jobs/${current}`, { cache: 'no-store' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error?.message ?? res.statusText);
    const job = body.job as JobView;
    const next = typeof job.result?.next_job_id === 'string' ? job.result.next_job_id : null;
    if (jobFinished(job) || job.status === 'failed' || Date.now() > deadline) {
      chain.push(job);
      if (job.status === 'done' && next && Date.now() < deadline) {
        current = next;
        continue;
      }
      return chain;
    }
  }
}

/** Založí úlohu cez API (202 `{job}`) a počká na ňu. */
export async function runJobRequest(url: string, body?: unknown): Promise<JobView[]> {
  const res = await fetch(url, {
    method: 'POST',
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error?.message ?? res.statusText);
  return waitForJob(data.job.id);
}

/** Text pre používateľa z poslednej úlohy reťazca. */
export function jobMessage(job: JobView): string | null {
  if (job.status === 'failed') {
    return job.attempts >= 3 ? job.error : `${job.error ?? 'Chyba.'} Skúsim to znova o pár minút.`;
  }
  if (job.status !== 'done') return 'Spracúva sa na pozadí — výsledok uvidíš v zozname dokladov.';
  return null;
}
