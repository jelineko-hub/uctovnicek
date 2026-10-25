-- E4: bločky z eKasa (koncept P0.3) — surová odpoveď „Over doklad" pri doklade.
alter table uctovnicek.documents add column ekasa_data jsonb;
create index documents_ekasa_uid_idx on uctovnicek.documents(company_id, ekasa_uid) where ekasa_uid is not null;
