-- E5: pozvánky do firmy, správa členov, prehľad firiem (koncept P1.1, P1.2).

-- ── Pozvánky ─────────────────────────────────────────────────────
create table uctovnicek.company_invites (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references uctovnicek.companies(id) on delete cascade,
  email       text not null,
  role        text not null check (role in ('owner','accountant','approver','viewer')),
  token       text not null unique
              default replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''),
  invited_by  uuid references auth.users(id) default auth.uid(),
  expires_at  timestamptz not null default now() + interval '14 days',
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
create index company_invites_company_idx on uctovnicek.company_invites(company_id, created_at desc);
alter table uctovnicek.company_invites enable row level security;

-- Pozývať smie majiteľ aj účtovník (účtovníčka pozve majiteľa a naopak); prijatie len cez accept_invite().
create policy company_invites_select on uctovnicek.company_invites for select
  using (uctovnicek.is_company_member(company_id, array['owner','accountant']));
create policy company_invites_insert on uctovnicek.company_invites for insert
  with check (uctovnicek.is_company_member(company_id, array['owner','accountant'])
              and invited_by = (select auth.uid()));
create policy company_invites_delete on uctovnicek.company_invites for delete
  using (uctovnicek.is_company_member(company_id, array['owner','accountant']));

-- Náhľad pozvánky pred prijatím (pozvaný ešte nie je členom, RLS by mu nič neukázala).
create or replace function uctovnicek.invite_preview(p_token text)
returns table(company_name text, role text, email text, expired boolean, accepted boolean)
language sql stable security definer set search_path = ''
as $$
  select c.name, i.role, i.email, i.expires_at < now(), i.accepted_at is not null
  from uctovnicek.company_invites i
  join uctovnicek.companies c on c.id = i.company_id
  where i.token = p_token;
$$;

create or replace function uctovnicek.accept_invite(p_token text)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  inv uctovnicek.company_invites;
  uid uuid := (select auth.uid());
  mail text;
begin
  if uid is null then
    raise exception 'Najprv sa prihlás.' using errcode = '28000';
  end if;
  select * into inv from uctovnicek.company_invites where token = p_token for update;
  if not found then
    raise exception 'Pozvánka neexistuje.' using errcode = 'P0002';
  end if;
  if inv.accepted_at is not null then
    raise exception 'Pozvánka už bola použitá.' using errcode = '22023';
  end if;
  if inv.expires_at < now() then
    raise exception 'Platnosť pozvánky vypršala — požiadaj o novú.' using errcode = '22023';
  end if;
  select email into mail from auth.users where id = uid;
  if lower(coalesce(mail, '')) <> lower(inv.email) then
    raise exception 'Pozvánka je pre e-mail %. Prihlás sa týmto e-mailom.', inv.email using errcode = '42501';
  end if;
  -- Kto už je členom, ponechá si svoju rolu.
  insert into uctovnicek.company_members(company_id, user_id, role)
  values (inv.company_id, uid, inv.role)
  on conflict (company_id, user_id) do nothing;
  update uctovnicek.company_invites set accepted_at = now(), accepted_by = uid where id = inv.id;
  return inv.company_id;
end;
$$;

-- ── Členovia ─────────────────────────────────────────────────────
-- E-maily členov sú v auth.users (bez RLS prístupu) → zoznam len pre členov firmy.
create or replace function uctovnicek.company_member_list(p_company uuid)
returns table(user_id uuid, email text, role text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
  select m.user_id, u.email::text, m.role, m.created_at
  from uctovnicek.company_members m
  join auth.users u on u.id = m.user_id
  where m.company_id = p_company
    and uctovnicek.is_company_member(p_company)
  order by m.created_at;
$$;

-- Firma nesmie ostať bez majiteľa (kaskádové zmazanie firmy áno).
create or replace function uctovnicek.company_members_keep_owner()
returns trigger language plpgsql set search_path = ''
as $$
begin
  if pg_trigger_depth() = 1
     and old.role = 'owner'
     and (tg_op = 'DELETE' or new.role <> 'owner')
     and not exists (
       select 1 from uctovnicek.company_members m
       where m.company_id = old.company_id and m.role = 'owner' and m.user_id <> old.user_id
     ) then
    raise exception 'Firma musí mať aspoň jedného majiteľa.' using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create trigger company_members_keep_owner before update or delete on uctovnicek.company_members
  for each row execute function uctovnicek.company_members_keep_owner();

-- ── Prehľad firiem (jeden dotaz pre stránku „Moje firmy") ─────────
create or replace function uctovnicek.company_overview()
returns table(
  company_id uuid, name text, ico text, role text,
  unprocessed int, ready int, approved int, rejected int,
  overdue_received int, overdue_issued int,
  last_export_at timestamptz, last_export_status text
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
    e.created_at, e.status
  from uctovnicek.company_members m
  join uctovnicek.companies c on c.id = m.company_id
  left join uctovnicek.documents d on d.company_id = c.id
  left join lateral (
    select x.created_at, x.status from uctovnicek.exports x
    where x.company_id = c.id and x.status <> 'cancelled'
    order by x.created_at desc limit 1
  ) e on true
  where m.user_id = (select auth.uid())
  group by c.id, c.name, c.ico, m.role, e.created_at, e.status
  order by c.name;
$$;

revoke execute on function uctovnicek.invite_preview(text) from public, anon;
revoke execute on function uctovnicek.accept_invite(text) from public, anon;
revoke execute on function uctovnicek.company_member_list(uuid) from public, anon;
revoke execute on function uctovnicek.company_overview() from public, anon;
grant execute on function uctovnicek.invite_preview(text) to authenticated;
grant execute on function uctovnicek.accept_invite(text) to authenticated;
grant execute on function uctovnicek.company_member_list(uuid) to authenticated;
grant execute on function uctovnicek.company_overview() to authenticated;
