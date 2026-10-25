-- E6: číselníky, pravidlá automatického účtovania, účtovné obdobia (koncept P1.3–P1.5).

-- ── Číselníky firmy ──────────────────────────────────────────────
create table uctovnicek.company_code_lists (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references uctovnicek.companies(id) on delete cascade,
  list        text not null check (list in ('bookkeeping_code','vat_code','cost_centre','project','numeric_series')),
  code        text not null,
  name        text,
  kinds       text[],              -- druhy dokladov, pre ktoré platí; null = všetky
  is_default  boolean not null default false,
  active      boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  unique (company_id, list, code)
);
alter table uctovnicek.company_code_lists enable row level security;
create policy company_code_lists_select on uctovnicek.company_code_lists for select
  using (uctovnicek.is_company_member(company_id));
create policy company_code_lists_write on uctovnicek.company_code_lists for all
  using (uctovnicek.is_company_member(company_id, array['owner','accountant']))
  with check (uctovnicek.is_company_member(company_id, array['owner','accountant']));

-- Presun nastavenia exportu (E3) do číselníkov ako predvolené hodnoty.
insert into uctovnicek.company_code_lists (company_id, list, code, name, kinds, is_default)
select c.id, v.list, v.code, v.name, array[v.kind], true
from uctovnicek.companies c
cross join lateral (values
  ('numeric_series', c.settings #>> '{mrp,prefix_received}', 'Prijaté faktúry', 'received_invoice'),
  ('numeric_series', c.settings #>> '{mrp,prefix_issued}',   'Vydané faktúry',  'issued_invoice'),
  ('vat_code',       c.settings #>> '{mrp,tax_code_received}', 'Tuzemské prijaté', 'received_invoice'),
  ('vat_code',       c.settings #>> '{mrp,tax_code_issued}',   'Tuzemské uskutočnené', 'issued_invoice')
) as v(list, code, name, kind)
where c.settings ? 'mrp' and coalesce(v.code, '') <> ''
on conflict (company_id, list, code) do nothing;
update uctovnicek.companies set settings = settings - 'mrp' where settings ? 'mrp';

-- ── Pravidlá automatického účtovania ─────────────────────────────
alter table uctovnicek.accounting_rules
  add column name text,
  add column active boolean not null default true;
create index accounting_rules_company_idx on uctovnicek.accounting_rules(company_id, priority);

-- ── Účtovné obdobia ──────────────────────────────────────────────
alter table uctovnicek.documents add column evidence_date date;

create table uctovnicek.accounting_periods (
  company_id  uuid not null references uctovnicek.companies(id) on delete cascade,
  year        int not null check (year between 2000 and 2100),
  month       int not null check (month between 1 and 12),
  status      text not null default 'closed' check (status in ('open','closed')),
  closed_by   uuid references auth.users(id) default auth.uid(),
  closed_at   timestamptz not null default now(),
  primary key (company_id, year, month)
);
alter table uctovnicek.accounting_periods enable row level security;
create policy accounting_periods_select on uctovnicek.accounting_periods for select
  using (uctovnicek.is_company_member(company_id));
create policy accounting_periods_write on uctovnicek.accounting_periods for all
  using (uctovnicek.is_company_member(company_id, array['owner','accountant']))
  with check (uctovnicek.is_company_member(company_id, array['owner','accountant']));

-- Zatvoriť smie majiteľ aj účtovník, otvoriť len účtovník.
create or replace function uctovnicek.accounting_periods_reopen_guard()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.status = 'closed' and new.status = 'open'
     and not uctovnicek.is_company_member(new.company_id, array['accountant']) then
    raise exception 'Uzavreté obdobie môže otvoriť len účtovník.' using errcode = '42501';
  end if;
  if tg_op = 'DELETE' and old.status = 'closed' and pg_trigger_depth() = 1
     and not uctovnicek.is_company_member(old.company_id, array['accountant']) then
    raise exception 'Uzavreté obdobie môže otvoriť len účtovník.' using errcode = '42501';
  end if;
  if tg_op <> 'DELETE' and new.status = 'closed' and (tg_op = 'INSERT' or old.status = 'open') then
    new.closed_by := (select auth.uid());
    new.closed_at := now();
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger accounting_periods_reopen_guard before insert or update or delete on uctovnicek.accounting_periods
  for each row execute function uctovnicek.accounting_periods_reopen_guard();

-- Je obdobie dokladu uzavreté? (dátum evidencie → DUZP → vystavenie; rovnako ako lib/accounting/periods.ts)
create or replace function uctovnicek.period_closed(p_company uuid, p_date date)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_date is not null and exists (
    select 1 from uctovnicek.accounting_periods p
    where p.company_id = p_company
      and p.year = extract(year from p_date)::int
      and p.month = extract(month from p_date)::int
      and p.status = 'closed'
  );
$$;
revoke execute on function uctovnicek.period_closed(uuid, date) from public, anon;
grant execute on function uctovnicek.period_closed(uuid, date) to authenticated, service_role;

-- Doklad v uzavretom období: nemení sa (okrem stavu a technických polí), nepridá sa ako spracovaný.
-- Nespracované doklady (fronta majiteľa) sa nahrať dajú — pri potvrdení dostanú dátum evidencie v otvorenom období.
create or replace function uctovnicek.documents_period_lock()
returns trigger language plpgsql set search_path = ''
as $$
declare
  allowed constant text[] := array['status','internal_note','updated_at','locked_at','exported_at','export_id',
                                  'duplicate_of','duplicate_ignored'];
  old_closed boolean := false;
  new_closed boolean := false;
  data_changed boolean := true;
begin
  if tg_op in ('UPDATE','DELETE') and old.status <> 'unprocessed' then
    old_closed := uctovnicek.period_closed(old.company_id, coalesce(old.evidence_date, old.tax_point_date, old.issue_date));
  end if;
  if tg_op = 'DELETE' then
    if old_closed and pg_trigger_depth() = 1 then
      raise exception 'Doklad patrí do uzavretého obdobia — nedá sa zmazať.' using errcode = 'check_violation';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    data_changed := (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed);
  end if;
  if old_closed and data_changed then
    raise exception 'Doklad patrí do uzavretého obdobia — nedá sa meniť.' using errcode = 'check_violation';
  end if;
  if new.status not in ('unprocessed','rejected')
     and (tg_op = 'INSERT' or data_changed or old.status in ('unprocessed','rejected')) then
    new_closed := uctovnicek.period_closed(new.company_id, coalesce(new.evidence_date, new.tax_point_date, new.issue_date));
    if new_closed then
      raise exception 'Obdobie dokladu je uzavreté — zaeviduj ho do otvoreného obdobia (dátum evidencie).'
        using errcode = 'check_violation';
    end if;
  end if;
  return new;
end;
$$;
create trigger documents_period_lock before insert or update or delete on uctovnicek.documents
  for each row execute function uctovnicek.documents_period_lock();

-- Položky: zámok exportu (E2) + uzavreté obdobie spracovaného dokladu.
create or replace function uctovnicek.document_lines_lock()
returns trigger language plpgsql set search_path = ''
as $$
declare
  doc_id uuid := case when tg_op = 'DELETE' then old.document_id else new.document_id end;
begin
  if pg_trigger_depth() = 1 and exists (
    select 1 from uctovnicek.documents d
    where d.id = doc_id
      and (d.status in ('exported','archived')
           or (d.status <> 'unprocessed'
               and uctovnicek.period_closed(d.company_id, coalesce(d.evidence_date, d.tax_point_date, d.issue_date))))
  ) then
    raise exception 'Doklad je exportovaný alebo v uzavretom období — položky sa nedajú meniť.' using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

-- ── Prehľad firiem: + posledné uzavreté obdobie ──────────────────
drop function uctovnicek.company_overview();
create function uctovnicek.company_overview()
returns table(
  company_id uuid, name text, ico text, role text,
  unprocessed int, ready int, approved int, rejected int,
  overdue_received int, overdue_issued int,
  last_export_at timestamptz, last_export_status text,
  last_closed_period text
)
language sql stable security invoker set search_path = ''
as $$
  select c.id, c.name, c.ico, m.role,
    count(d.id) filter (where d.status = 'unprocessed')::int,
    count(d.id) filter (where d.status = 'ready')::int,
    count(d.id) filter (where d.status = 'approved')::int,
    count(d.id) filter (where d.status = 'rejected')::int,
    count(d.id) filter (where d.kind = 'received_invoice' and d.payment_status <> 'paid'
                          and d.due_date < current_date and d.status not in ('rejected','unprocessed'))::int,
    count(d.id) filter (where d.kind = 'issued_invoice' and d.payment_status <> 'paid'
                          and d.due_date < current_date and d.status not in ('rejected','unprocessed'))::int,
    e.created_at, e.status,
    p.period
  from uctovnicek.company_members m
  join uctovnicek.companies c on c.id = m.company_id
  left join uctovnicek.documents d on d.company_id = c.id
  left join lateral (
    select x.created_at, x.status from uctovnicek.exports x
    where x.company_id = c.id and x.status <> 'cancelled'
    order by x.created_at desc limit 1
  ) e on true
  left join lateral (
    select ap.year || '-' || lpad(ap.month::text, 2, '0') as period from uctovnicek.accounting_periods ap
    where ap.company_id = c.id and ap.status = 'closed'
    order by ap.year desc, ap.month desc limit 1
  ) p on true
  where m.user_id = (select auth.uid())
  group by c.id, c.name, c.ico, m.role, e.created_at, e.status, p.period
  order by c.name;
$$;
revoke execute on function uctovnicek.company_overview() from public, anon;
grant execute on function uctovnicek.company_overview() to authenticated;
