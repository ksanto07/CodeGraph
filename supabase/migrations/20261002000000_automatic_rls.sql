begin;

create or replace function public.enable_rls_on_new_tables()
returns event_trigger
language plpgsql
security definer
set search_path = pg_catalog
as $$
declare
  command record;
begin
  for command in
    select c.oid, n.nspname, c.relname
    from pg_event_trigger_ddl_commands() as ddl
    join pg_class as c on c.oid = ddl.objid
    join pg_namespace as n on n.oid = c.relnamespace
    where ddl.classid = 'pg_class'::regclass
      and n.nspname = 'public'
      and c.relkind in ('r', 'p')
  loop
    execute format(
      'alter table %I.%I enable row level security',
      command.nspname,
      command.relname
    );
  end loop;
end;
$$;

revoke all on function public.enable_rls_on_new_tables() from public;

create event trigger ensure_rls
on ddl_command_end
when tag in ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
execute function public.enable_rls_on_new_tables();

commit;
