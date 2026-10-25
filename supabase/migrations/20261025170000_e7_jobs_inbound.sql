-- E7: úlohy na pozadí (koncept §4.2) a zberný e-mail per firma (P1.6).

-- ── Úlohy ────────────────────────────────────────────────────────
create table uctovnicek.jobs (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references uctovnicek.companies(id) on delete cascade,
  type        text not null check (type in ('extract','ekasa_lookup','export','bank_import','inbound_email')),
  status      text not null default 'pending' check (status in ('pending','running','done','failed')),
  document_id uuid references uctovnicek.documents(id) on delete cascade,
  payload     jsonb not null default '{}',
  result      jsonb,
  error       text,
  attempts    int not null default 0,
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz
);
create index jobs_queue_idx on uctovnicek.jobs(created_at) where status in ('pending','running','failed');
create index jobs_document_idx on uctovnicek.jobs(document_id, created_at desc) where document_id is not null;
create index jobs_company_idx on uctovnicek.jobs(company_id, created_at desc);
alter table uctovnicek.jobs enable row level security;

-- Členovia vidia úlohy firmy; zakladá ich ten, kto smie meniť doklady. Spracovanie (update) len service role.
create policy jobs_select on uctovnicek.jobs for select
  using (uctovnicek.is_company_member(company_id));
create policy jobs_insert on uctovnicek.jobs for insert
  with check (uctovnicek.is_company_member(company_id, array['owner','accountant','approver'])
              and status = 'pending' and attempts = 0 and result is null
              and created_by = (select auth.uid()));

-- Prevzatie úloh na spracovanie (ochrana pred dvojitým spustením: skip locked).
-- Berie pending, failed s attempts < max (najskôr 2 min po chybe) a „zaseknuté" running (> 10 min, timeout funkcie).
create or replace function uctovnicek.claim_jobs(p_ids uuid[] default null, p_limit int default 5, p_max_attempts int default 3)
returns setof uctovnicek.jobs
language sql volatile security definer set search_path = ''
as $$
  update uctovnicek.jobs j
  set status = 'running', attempts = j.attempts + 1, started_at = now(), finished_at = null, error = null
  where j.id in (
    select q.id from uctovnicek.jobs q
    where (p_ids is null or q.id = any(p_ids))
      and q.attempts < p_max_attempts
      and (q.status = 'pending'
           or (q.status = 'failed' and q.finished_at < now() - interval '2 minutes')
           or (q.status = 'running' and q.started_at < now() - interval '10 minutes'))
    order by q.created_at
    for update skip locked
    limit p_limit
  )
  returning j.*;
$$;
revoke execute on function uctovnicek.claim_jobs(uuid[], int, int) from public, anon, authenticated;
grant execute on function uctovnicek.claim_jobs(uuid[], int, int) to service_role;

-- ── Zberný e-mail ────────────────────────────────────────────────
create table uctovnicek.company_inboxes (
  company_id      uuid primary key references uctovnicek.companies(id) on delete cascade,
  slug            text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{2,40}$'),
  allow_all       boolean not null default false,
  -- e-mail (jan@firma.sk) alebo celá doména (@firma.sk)
  allowed_senders text[] not null default '{}',
  created_at      timestamptz not null default now()
);
alter table uctovnicek.company_inboxes enable row level security;
create policy company_inboxes_select on uctovnicek.company_inboxes for select
  using (uctovnicek.is_company_member(company_id));
create policy company_inboxes_insert on uctovnicek.company_inboxes for insert
  with check (uctovnicek.is_company_member(company_id, array['owner','accountant']));
create policy company_inboxes_update on uctovnicek.company_inboxes for update
  using (uctovnicek.is_company_member(company_id, array['owner','accountant']))
  with check (uctovnicek.is_company_member(company_id, array['owner','accountant']));

create table uctovnicek.inbound_emails (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references uctovnicek.companies(id) on delete cascade,
  provider_id  text not null unique,
  from_address text not null,
  subject      text,
  received_at  timestamptz not null default now(),
  status       text not null default 'received'
               check (status in ('received','processed','rejected','needs_review','failed')),
  note         text,
  document_ids uuid[] not null default '{}',
  created_at   timestamptz not null default now()
);
create index inbound_emails_company_idx on uctovnicek.inbound_emails(company_id, received_at desc);
alter table uctovnicek.inbound_emails enable row level security;
-- Zapisuje len webhook a spracovanie (service role); členovia čítajú, majiteľ/účtovník môže záznam zmazať.
create policy inbound_emails_select on uctovnicek.inbound_emails for select
  using (uctovnicek.is_company_member(company_id));
create policy inbound_emails_delete on uctovnicek.inbound_emails for delete
  using (uctovnicek.is_company_member(company_id, array['owner','accountant']));
