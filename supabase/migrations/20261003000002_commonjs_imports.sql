begin;
alter table public.edges drop constraint edges_kind_check;
alter table public.edges add constraint edges_kind_check check (kind in ('import', 're-export', 'dynamic-import', 'require'));
commit;
