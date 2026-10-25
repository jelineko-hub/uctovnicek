-- Účtovníček — základná schéma (F0 + F1 jadro).
-- Multi-firma: používateľ môže byť členom viacerých firiem (majiteľ aj účtovník).
-- Prístup k dátam firmy = členstvo v company_members (RLS cez is_company_member).

-- Beží v zdieľanom Supabase projekte (zkw planner) → všetko je v samostatnej schéme
-- `uctovnicek`, aby sa nemiešalo s tabuľkami iných aplikácií v `public`.
-- Spoločné zostáva len auth.users (prihlasovanie) a storage (vlastný bucket `uctovnicek-documents`).
create schema if not exists uctovnicek;
grant usage on schema uctovnicek to anon, authenticated, service_role;

-- ── Firmy a členstvá ─────────────────────────────────────────────
create table uctovnicek.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  ico         text,
  dic         text,
  ic_dph      text,
  vat_payer   boolean not null default false,
  address     jsonb not null default '{}'::jsonb,   -- {street, city, zip, country}
  iban        text,
  settings    jsonb not null default '{}'::jsonb,   -- číselné rady, MRP kódy (TaxCode, CostCentre…)
  created_by  uuid references auth.users(id) default auth.uid(),
  created_at  timestamptz not null default now()
);

create table uctovnicek.company_members (
  company_id  uuid not null references uctovnicek.companies(id) on delete cascade,
  user_id     uuid not null references auth.users(id) on delete cascade,
  role        text not null check (role in ('owner','accountant','approver','viewer')),
  created_at  timestamptz not null default now(),
  primary key (company_id, user_id)
);
create index company_members_user_idx on uctovnicek.company_members(user_id);

create or replace function uctovnicek.is_company_member(cid uuid, roles text[] default null)
returns boolean
language sql stable security definer set search_path = uctovnicek
as $$
  select exists (
    select 1 from uctovnicek.company_members m
    where m.company_id = cid
      and m.user_id = (select auth.uid())
      and (roles is null or m.role = any(roles))
  );
$$;

-- Zakladateľ firmy sa automaticky stane majiteľom.
create or replace function uctovnicek.add_company_owner()
returns trigger language plpgsql security definer set search_path = uctovnicek
as $$
begin
  if new.created_by is not null then
    insert into uctovnicek.company_members(company_id, user_id, role)
    values (new.id, new.created_by, 'owner')
    on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger companies_add_owner after insert on uctovnicek.companies
  for each row execute function uctovnicek.add_company_owner();

-- ── Partneri ─────────────────────────────────────────────────────
create table uctovnicek.partners (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references uctovnicek.companies(id) on delete cascade,
  name        text not null,
  ico         text,
  dic         text,
  ic_dph      text,
  address     jsonb not null default '{}'::jsonb,
  iban        text,
  email       text,
  natural_person boolean not null default false,
  created_at  timestamptz not null default now()
);
create index partners_company_ico_idx on uctovnicek.partners(company_id, ico);

-- ── Doklady ──────────────────────────────────────────────────────
create table uctovnicek.documents (
  id               uuid primary key default gen_random_uuid(),
  company_id       uuid not null references uctovnicek.companies(id) on delete cascade,
  kind             text not null check (kind in ('receipt','received_invoice','issued_invoice','cash','other')),
  subtype          text not null default 'invoice'
                   check (subtype in ('invoice','advance','credit','debit','tax_payment','corrective','proforma')),
  status           text not null default 'unprocessed'
                   check (status in ('unprocessed','ready','approved','rejected','exported','archived')),
  partner_id       uuid references uctovnicek.partners(id) on delete set null,
  partner_snapshot jsonb not null default '{}'::jsonb,  -- údaje partnera tak, ako sú na doklade
  number           text,           -- interné číslo dokladu (MRP DocumentNumber, max 10 zn.)
  original_number  text,           -- číslo dokladu dodávateľa
  variable_symbol  text,
  constant_symbol  text,
  ekasa_uid        text,
  issue_date       date,
  tax_point_date   date,
  due_date         date,
  delivery_date    date,
  currency         text not null default 'EUR',
  fx_rate          numeric(15,6) not null default 1,
  total_amount     numeric(15,2),  -- s DPH, v mene dokladu
  vat_mode         text not null default 'standard'
                   check (vat_mode in ('standard','reverse_charge','exempt','oss','non_vat')),
  prices_with_vat  boolean not null default false,
  payment_method   text check (payment_method in ('transfer','card','cash','cash_on_delivery','offset','other')),
  payment_status   text not null default 'unpaid' check (payment_status in ('unpaid','partial','paid')),
  accounting       jsonb not null default '{}'::jsonb,  -- predkontácia, stredisko, zákazka, členenie DPH, pomer
  ocr_raw          jsonb,
  ocr_confidence   numeric(4,3),
  note             text,
  internal_note    text,
  exported_at      timestamptz,
  created_by       uuid references auth.users(id) default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index documents_company_kind_idx on uctovnicek.documents(company_id, kind, issue_date desc);
create index documents_company_status_idx on uctovnicek.documents(company_id, status);

create table uctovnicek.document_lines (
  id          uuid primary key default gen_random_uuid(),
  document_id uuid not null references uctovnicek.documents(id) on delete cascade,
  company_id  uuid not null references uctovnicek.companies(id) on delete cascade,
  position    int not null default 0,
  name        text not null,
  quantity    numeric(15,6) not null default 1,
  unit        text,
  unit_price  numeric(15,6) not null default 0,   -- bez DPH
  vat_rate    numeric(5,2) not null default 0,
  discount_percent numeric(5,2) not null default 0,
  accounting  jsonb not null default '{}'::jsonb
);
create index document_lines_doc_idx on uctovnicek.document_lines(document_id, position);

create table uctovnicek.document_files (
  id           uuid primary key default gen_random_uuid(),
  document_id  uuid references uctovnicek.documents(id) on delete cascade,
  company_id   uuid not null references uctovnicek.companies(id) on delete cascade,
  storage_path text not null,
  mime         text,
  size_bytes   bigint,
  sha256       text,
  created_at   timestamptz not null default now()
);
create index document_files_doc_idx on uctovnicek.document_files(document_id);

create table uctovnicek.document_history (
  id          bigserial primary key,
  document_id uuid not null references uctovnicek.documents(id) on delete cascade,
  company_id  uuid not null references uctovnicek.companies(id) on delete cascade,
  changed_by  uuid references auth.users(id) default auth.uid(),
  changed_at  timestamptz not null default now(),
  diff        jsonb not null
);

-- ── Banka ────────────────────────────────────────────────────────
create table uctovnicek.bank_accounts (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references uctovnicek.companies(id) on delete cascade,
  name        text,
  iban        text not null,
  currency    text not null default 'EUR'
);

create table uctovnicek.bank_transactions (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references uctovnicek.companies(id) on delete cascade,
  bank_account_id   uuid not null references uctovnicek.bank_accounts(id) on delete cascade,
  booking_date      date not null,
  amount            numeric(15,2) not null,
  currency          text not null default 'EUR',
  variable_symbol   text,
  constant_symbol   text,
  specific_symbol   text,
  counterparty_name text,
  counterparty_iban text,
  message           text,
  pairing_status    text not null default 'not_paired'
                    check (pairing_status in ('not_paired','paired','paired_manually','no_document')),
  document_ids      uuid[] not null default '{}',
  created_at        timestamptz not null default now()
);
create index bank_transactions_company_date_idx on uctovnicek.bank_transactions(company_id, booking_date desc);

-- ── Štítky, pravidlá, exporty ───────────────────────────────────
create table uctovnicek.tags (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references uctovnicek.companies(id) on delete cascade,
  name        text not null,
  color       text
);
create table uctovnicek.document_tags (
  document_id uuid not null references uctovnicek.documents(id) on delete cascade,
  tag_id      uuid not null references uctovnicek.tags(id) on delete cascade,
  company_id  uuid not null references uctovnicek.companies(id) on delete cascade,
  primary key (document_id, tag_id)
);

create table uctovnicek.accounting_rules (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references uctovnicek.companies(id) on delete cascade,
  priority    int not null default 100,
  match       jsonb not null,   -- napr. {"partner_ico":"12345678","kind":"received_invoice"}
  apply       jsonb not null,   -- napr. {"accounting":{"mrp_bookkeeping_code":"501.001"}}
  created_at  timestamptz not null default now()
);

create table uctovnicek.exports (
  id           uuid primary key default gen_random_uuid(),
  company_id   uuid not null references uctovnicek.companies(id) on delete cascade,
  target       text not null check (target in ('mrp_ks_xml2')),
  period       text,             -- 'YYYY-MM'
  document_ids uuid[] not null default '{}',
  status       text not null default 'created' check (status in ('created','downloaded','imported','failed')),
  storage_path text,
  created_by   uuid references auth.users(id) default auth.uid(),
  created_at   timestamptz not null default now()
);

-- ── RLS ─────────────────────────────────────────────────────────
alter table uctovnicek.companies         enable row level security;
alter table uctovnicek.company_members   enable row level security;
alter table uctovnicek.partners          enable row level security;
alter table uctovnicek.documents         enable row level security;
alter table uctovnicek.document_lines    enable row level security;
alter table uctovnicek.document_files    enable row level security;
alter table uctovnicek.document_history  enable row level security;
alter table uctovnicek.bank_accounts     enable row level security;
alter table uctovnicek.bank_transactions enable row level security;
alter table uctovnicek.tags              enable row level security;
alter table uctovnicek.document_tags     enable row level security;
alter table uctovnicek.accounting_rules  enable row level security;
alter table uctovnicek.exports           enable row level security;

create policy companies_select on uctovnicek.companies for select
  using (uctovnicek.is_company_member(id) or created_by = (select auth.uid()));
create policy companies_insert on uctovnicek.companies for insert
  with check (created_by = (select auth.uid()));
create policy companies_update on uctovnicek.companies for update
  using (uctovnicek.is_company_member(id, array['owner','accountant']));
create policy companies_delete on uctovnicek.companies for delete
  using (uctovnicek.is_company_member(id, array['owner']));

create policy members_select on uctovnicek.company_members for select
  using (uctovnicek.is_company_member(company_id));
create policy members_manage on uctovnicek.company_members for all
  using (uctovnicek.is_company_member(company_id, array['owner']))
  with check (uctovnicek.is_company_member(company_id, array['owner']));

-- Spoločný vzor pre company-scoped tabuľky:
--   čítať smie každý člen, zapisovať owner/accountant/approver (viewer len číta).
do $$
declare t text;
begin
  foreach t in array array['partners','documents','document_lines','document_files','document_history',
                           'bank_accounts','bank_transactions','tags','document_tags','accounting_rules','exports']
  loop
    execute format('create policy %1$s_select on uctovnicek.%1$s for select using (uctovnicek.is_company_member(company_id))', t);
    execute format('create policy %1$s_write on uctovnicek.%1$s for all
                    using (uctovnicek.is_company_member(company_id, array[''owner'',''accountant'',''approver'']))
                    with check (uctovnicek.is_company_member(company_id, array[''owner'',''accountant'',''approver'']))', t);
  end loop;
end $$;

-- updated_at na dokladoch
create or replace function uctovnicek.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end;
$$;
create trigger documents_touch before update on uctovnicek.documents
  for each row execute function uctovnicek.touch_updated_at();

-- Storage bucket pre súbory dokladov (cesta: <company_id>/<document_id>/<súbor>)
-- storage.objects je spoločná so zkw plannerom → žiadne priame ::uuid v politikách
-- (Postgres nezaručuje poradie vyhodnotenia AND; pretypovanie cudzej cesty by zhodilo dotaz).
create or replace function uctovnicek.path_company_id(object_name text)
returns uuid language sql immutable set search_path = ''
as $$
  select case
    when split_part(object_name, '/', 1) ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    then split_part(object_name, '/', 1)::uuid
  end;
$$;

insert into storage.buckets (id, name, public) values ('uctovnicek-documents', 'uctovnicek-documents', false)
  on conflict (id) do nothing;

create policy uctovnicek_documents_select on storage.objects for select
  using (bucket_id = 'uctovnicek-documents' and uctovnicek.is_company_member(uctovnicek.path_company_id(name)));
create policy uctovnicek_documents_insert on storage.objects for insert
  with check (bucket_id = 'uctovnicek-documents'
              and uctovnicek.is_company_member(uctovnicek.path_company_id(name), array['owner','accountant','approver']));
create policy uctovnicek_documents_delete on storage.objects for delete
  using (bucket_id = 'uctovnicek-documents'
         and uctovnicek.is_company_member(uctovnicek.path_company_id(name), array['owner','accountant']));

-- Práva pre PostgREST roly (RLS ostáva hlavná ochrana).
grant select, insert, update, delete on all tables in schema uctovnicek to authenticated, service_role;
grant usage, select on all sequences in schema uctovnicek to authenticated, service_role;
grant execute on all functions in schema uctovnicek to authenticated, service_role;
alter default privileges in schema uctovnicek grant select, insert, update, delete on tables to authenticated, service_role;
alter default privileges in schema uctovnicek grant usage, select on sequences to authenticated, service_role;
alter default privileges in schema uctovnicek grant execute on functions to authenticated, service_role;
