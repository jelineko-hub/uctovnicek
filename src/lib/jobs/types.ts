/** Úlohy na pozadí (koncept §4.2) — typy a stavy = CHECK v `uctovnicek.jobs`. */
export const JOB_TYPES = ['extract', 'ekasa_lookup', 'export', 'bank_import', 'inbound_email'] as const;
export type JobType = (typeof JOB_TYPES)[number];
export type JobStatus = 'pending' | 'running' | 'done' | 'failed';

export const MAX_ATTEMPTS = 3;

export interface Job {
  id: string;
  company_id: string;
  type: JobType;
  status: JobStatus;
  document_id: string | null;
  payload: Record<string, unknown>;
  result: Record<string, unknown> | null;
  error: string | null;
  attempts: number;
  created_at: string;
}

/** Čo vidí klient pri sledovaní úlohy (`GET /api/jobs/:id`). */
export type JobView = Pick<Job, 'id' | 'type' | 'status' | 'document_id' | 'result' | 'error' | 'attempts'>;
export const JOB_VIEW_COLUMNS = 'id, type, status, document_id, result, error, attempts';

/** Chyba spracovania. `retry: false` = opakovanie nepomôže (zlý typ súboru, doklad už nie je nespracovaný…). */
export class JobError extends Error {
  constructor(message: string, readonly retry = true) {
    super(message);
  }
}

/** Úloha je dokončená, keď je `done`, alebo `failed` a už sa nebude opakovať. */
export const jobFinished = (j: Pick<Job, 'status' | 'attempts'>) =>
  j.status === 'done' || (j.status === 'failed' && j.attempts >= MAX_ATTEMPTS);
