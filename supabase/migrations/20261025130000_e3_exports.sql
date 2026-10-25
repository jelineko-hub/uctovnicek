-- E3: export do MRP-K/S — druh exportu, chyba, zrušenie, väzba dokladu na export (koncept P0.4).

alter table uctovnicek.exports
  add column kind text check (kind in ('received_invoice','issued_invoice')),
  add column error text,
  add column file_name text;

alter table uctovnicek.exports drop constraint exports_status_check;
alter table uctovnicek.exports add constraint exports_status_check
  check (status in ('created','downloaded','imported','failed','cancelled'));

create index exports_company_idx on uctovnicek.exports(company_id, created_at desc);

alter table uctovnicek.documents
  add column export_id uuid references uctovnicek.exports(id) on delete set null;
create index documents_export_idx on uctovnicek.documents(export_id) where export_id is not null;
