-- E2: zdroj dokladu, zámok po exporte, detekcia duplicít (koncept P0.1, P0.2, §4.3).

-- ── Nové stĺpce dokladu ──────────────────────────────────────────
alter table uctovnicek.documents
  add column source text not null default 'upload'
    check (source in ('upload','camera','email','einvoice','manual')),
  add column locked_at timestamptz,
  add column duplicate_of uuid references uctovnicek.documents(id) on delete set null,
  add column duplicate_ignored boolean not null default false;

create index documents_dup_key_idx on uctovnicek.documents(company_id, original_number, total_amount);
create index documents_duplicate_of_idx on uctovnicek.documents(duplicate_of) where duplicate_of is not null;
create index document_files_sha_idx on uctovnicek.document_files(company_id, sha256) where sha256 is not null;

-- ── Zámok: exportovaný / archivovaný doklad ─────────────────────
-- Povolené zmeny na zamknutom doklade: stav (napr. archivácia, zrušenie exportu), interná poznámka
-- a technické polia exportu a duplicity (on delete set null). Mazanie len kaskádou (zmazanie firmy), nie priamo.
create or replace function uctovnicek.documents_lock()
returns trigger language plpgsql set search_path = '' as $$
declare
  allowed constant text[] := array['status','internal_note','updated_at','locked_at','exported_at','export_id',
                                  'duplicate_of','duplicate_ignored'];
begin
  if tg_op = 'DELETE' then
    if old.status in ('exported','archived') and pg_trigger_depth() = 1 then
      raise exception 'Doklad je exportovaný a zamknutý — nedá sa zmazať.' using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if old.status in ('exported','archived')
     and (to_jsonb(new) - allowed) is distinct from (to_jsonb(old) - allowed) then
    raise exception 'Doklad je exportovaný a zamknutý — nedá sa meniť.' using errcode = 'check_violation';
  end if;

  if new.status in ('exported','archived') then
    new.locked_at := coalesce(old.locked_at, now());
  else
    new.locked_at := null;
  end if;
  return new;
end;
$$;

create trigger documents_reject_locked_update before update or delete on uctovnicek.documents
  for each row execute function uctovnicek.documents_lock();

-- Položky zamknutého dokladu sa nedajú meniť (kaskádové mazanie áno).
create or replace function uctovnicek.document_lines_lock()
returns trigger language plpgsql set search_path = '' as $$
declare
  doc_id uuid := case when tg_op = 'DELETE' then old.document_id else new.document_id end;
begin
  if pg_trigger_depth() = 1 and exists (
    select 1 from uctovnicek.documents d where d.id = doc_id and d.status in ('exported','archived')
  ) then
    raise exception 'Doklad je exportovaný a zamknutý — položky sa nedajú meniť.' using errcode = 'check_violation';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create trigger document_lines_reject_locked before insert or update or delete on uctovnicek.document_lines
  for each row execute function uctovnicek.document_lines_lock();
