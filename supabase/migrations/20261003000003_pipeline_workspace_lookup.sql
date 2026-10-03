begin;
create or replace function private.current_pipeline_organization() returns text
language sql security definer stable set search_path = '' as $$
  select auth.jwt()->'o'->>'id';
$$;
revoke all on function private.current_pipeline_organization() from public, anon, authenticated;
grant execute on function private.current_pipeline_organization() to cartograph_writer;

do $$ declare relation text; begin
  foreach relation in array array['projects','analyses','files','edges'] loop
    execute format('alter policy pipeline_organization on public.%I using (organization_id = (select private.current_pipeline_organization())) with check (organization_id = (select private.current_pipeline_organization()))', relation);
  end loop;
end $$;
alter policy route_writer_organization on public.routes using (organization_id = (select private.current_pipeline_organization())) with check (organization_id = (select private.current_pipeline_organization()));

create or replace function public.claim_repository(repository_slug text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare organization text := private.current_pipeline_organization(); project uuid; analysis public.analyses; started boolean := false;
begin
  if repository_slug !~ '^[a-z0-9][a-z0-9-]{0,38}/[a-z0-9_.-]+$' then raise exception 'Invalid repository.'; end if;
  perform public.ensure_current_organization();
  insert into public.projects(organization_id, repository) values (organization, repository_slug) on conflict (organization_id, repository) do nothing;
  select id into strict project from public.projects where repository = repository_slug;
  insert into public.analyses(organization_id, project_id) values (organization, project)
    on conflict (organization_id, project_id) where not is_seed do nothing returning * into analysis;
  started := found;
  if not started then select * into strict analysis from public.analyses where project_id = project and not is_seed; end if;
  return jsonb_build_object('id', analysis.id, 'attempt', analysis.attempt_id, 'started', started);
end $$;
alter function public.claim_repository(text) owner to cartograph_writer;
revoke all on function public.claim_repository(text) from public, anon;
grant execute on function public.claim_repository(text) to authenticated;

commit;
