begin;
alter table public.routes add column method text not null default 'GET';
grant usage, create on schema public to cartograph_writer;
grant select, insert, delete on public.routes to cartograph_writer;
create policy route_writer_organization on public.routes for all to cartograph_writer
  using (organization_id = (select auth.jwt()->'o'->>'id')) with check (organization_id = (select auth.jwt()->'o'->>'id'));

create function public.store_framework_routes() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.state <> 'completed' then return new; end if;
  delete from public.routes where analysis_id = new.id;
  if exists (select 1 from jsonb_array_elements(coalesce(new.parser_metadata->'frameworkMetadata'->'routes', '[]'::jsonb)) route
    where not exists (select 1 from public.files where analysis_id = new.id and path = route->>'file')) then raise exception 'A route file is absent from the graph.'; end if;
  insert into public.routes(organization_id, analysis_id, file_id, path, method)
    select new.organization_id, new.id, file.id, route->>'path', route->>'method'
    from jsonb_array_elements(coalesce(new.parser_metadata->'frameworkMetadata'->'routes', '[]'::jsonb)) route
    join public.files file on file.analysis_id = new.id and file.path = route->>'file';
  return new;
end $$;
alter function public.store_framework_routes() owner to cartograph_writer;
revoke all on function public.store_framework_routes() from public, anon, authenticated;
create trigger store_routes after update of state on public.analyses for each row when (new.state = 'completed') execute function public.store_framework_routes();
revoke create on schema public from cartograph_writer;
commit;
