begin;

create role cartograph_writer nologin nobypassrls;
grant cartograph_writer to postgres;
grant usage, create on schema public to cartograph_writer;
grant usage on schema private to cartograph_writer;

alter table public.projects add constraint projects_repository_unique unique (organization_id, repository);
alter table public.analyses
  add column is_seed boolean not null default false,
  add column attempt_id uuid not null default gen_random_uuid(),
  add column stage text not null default 'fetch' check (stage in ('fetch', 'select', 'parse', 'store')),
  add column message text not null default 'Waiting to fetch the repository.',
  add column updated_at timestamptz not null default now(),
  add column commit_sha text check (commit_sha ~ '^[a-f0-9]{40}$'),
  add column parser_metadata jsonb;

update public.analyses set is_seed = true
where id::text in (select '20000000-0000-4000-8000-' || lpad(n::text, 12, '0') from generate_series(1, 8) n);
create unique index analyses_one_repository on public.analyses (organization_id, project_id) where not is_seed;

alter table public.files add column node jsonb;
alter table public.edges add column kind text not null default 'import' check (kind in ('import', 're-export', 'dynamic-import'));
create unique index edges_unique_import on public.edges (analysis_id, source_file_id, target_file_id, kind);
grant select, insert, update, delete on public.projects, public.analyses, public.files, public.edges to cartograph_writer;
grant usage on type public.analysis_state to cartograph_writer;

create or replace function private.current_pipeline_organization() returns text
language sql security definer stable set search_path = '' as $$
  select auth.jwt()->'o'->>'id';
$$;
revoke all on function private.current_pipeline_organization() from public, anon, authenticated;
grant execute on function private.current_pipeline_organization() to cartograph_writer;

do $$ declare relation text; begin
  foreach relation in array array['projects', 'analyses', 'files', 'edges'] loop
    execute format('create policy pipeline_organization on public.%I for all to cartograph_writer using (organization_id = (select private.current_pipeline_organization())) with check (organization_id = (select private.current_pipeline_organization()))', relation);
  end loop;
end $$;

create table private.pipeline_credentials (
  credential_hash text primary key check (credential_hash ~ '^[a-f0-9]{64}$')
);
alter table private.pipeline_credentials enable row level security;
revoke all on private.pipeline_credentials from public, anon, authenticated, cartograph_writer;

create function private.require_pipeline_writer(supplied text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if supplied is null or supplied !~ '^[a-f0-9]{64}$' or not exists (
    select 1 from private.pipeline_credentials
    where credential_hash = encode(sha256(convert_to(supplied, 'UTF8')), 'hex')
  ) then raise exception 'A parser-server credential is required.' using errcode = '42501'; end if;
end $$;
revoke all on function private.require_pipeline_writer(text) from public, anon, authenticated;
grant execute on function private.require_pipeline_writer(text) to cartograph_writer;

create function public.ensure_current_organization() returns void
language plpgsql security definer set search_path = '' as $$
declare organization text := auth.jwt()->'o'->>'id';
begin
  if organization is null or organization !~ '^org_[A-Za-z0-9]+$' then raise exception 'A workspace token is required.'; end if;
  insert into private.organizations(id) values (organization) on conflict do nothing;
end $$;
revoke all on function public.ensure_current_organization() from public, anon;
grant execute on function public.ensure_current_organization() to authenticated, cartograph_writer;

create function public.claim_repository(repository_slug text) returns jsonb
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

create function public.restart_analysis(analysis_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare analysis public.analyses; started boolean := false;
begin
  select * into strict analysis from public.analyses where id = analysis_id and not is_seed for update;
  if analysis.state in ('completed', 'failed') or analysis.updated_at < now() - interval '5 minutes' then
    update public.analyses set attempt_id = gen_random_uuid(), state = 'queued', stage = 'fetch', message = 'Waiting to fetch the repository.', updated_at = clock_timestamp()
      where id = analysis_id returning * into analysis;
    started := true;
  end if;
  return jsonb_build_object('id', analysis.id, 'attempt', analysis.attempt_id, 'started', started);
end $$;
alter function public.restart_analysis(uuid) owner to cartograph_writer;
revoke all on function public.restart_analysis(uuid) from public, anon;
grant execute on function public.restart_analysis(uuid) to authenticated;

create function public.advance_analysis(analysis_id uuid, attempt uuid, next_stage text, status_message text, write_secret text, failed boolean default false) returns boolean
language plpgsql security definer set search_path = '' as $$
declare analysis public.analyses; stage_names text[] := array['fetch','select','parse','store'];
begin
  perform private.require_pipeline_writer(write_secret);
  select * into analysis from public.analyses where id = analysis_id and attempt_id = attempt and state in ('queued', 'running') for update;
  if not found then return false; end if;
  if not next_stage = any(stage_names) or array_position(stage_names, next_stage) < array_position(stage_names, analysis.stage)
    or array_position(stage_names, next_stage) > array_position(stage_names, analysis.stage) + 1 then raise exception 'Invalid stage transition.'; end if;
  update public.analyses set state = case when failed then 'failed'::public.analysis_state else 'running'::public.analysis_state end,
    stage = next_stage, message = left(status_message, 500), updated_at = clock_timestamp() where id = analysis_id;
  return true;
end $$;
alter function public.advance_analysis(uuid, uuid, text, text, text, boolean) owner to cartograph_writer;
revoke all on function public.advance_analysis(uuid, uuid, text, text, text, boolean) from public, anon;
grant execute on function public.advance_analysis(uuid, uuid, text, text, text, boolean) to authenticated;

create function public.publish_analysis(analysis_id uuid, attempt uuid, commit_id text, parsed jsonb, write_secret text) returns boolean
language plpgsql security definer set search_path = '' as $$
declare analysis public.analyses;
begin
  perform private.require_pipeline_writer(write_secret);
  select * into analysis from public.analyses where id = analysis_id and attempt_id = attempt for update;
  if not found then return false; end if;
  if analysis.state = 'completed' then return true; end if;
  if analysis.state <> 'running' or analysis.stage <> 'store' then raise exception 'Analysis is not ready to publish.'; end if;
  if commit_id !~ '^[a-f0-9]{40}$' or parsed->>'schemaVersion' <> '1' or jsonb_typeof(parsed->'files') <> 'array'
    or jsonb_typeof(parsed->'edges') <> 'array' or jsonb_array_length(parsed->'files') > 10000
    or jsonb_array_length(parsed->'edges') > 60000 then raise exception 'Invalid or oversized parser result.'; end if;
  delete from public.files where files.analysis_id = publish_analysis.analysis_id;
  insert into public.files(organization_id, analysis_id, path, node)
    select analysis.organization_id, analysis.id, item->>'id', item from jsonb_array_elements(parsed->'files') item;
  if exists (select 1 from jsonb_array_elements(parsed->'edges') item
    where not exists (select 1 from public.files where files.analysis_id = analysis.id and path = item->>'from')
       or not exists (select 1 from public.files where files.analysis_id = analysis.id and path = item->>'to')) then raise exception 'An edge endpoint is absent.'; end if;
  insert into public.edges(organization_id, analysis_id, source_file_id, target_file_id, kind)
    select analysis.organization_id, analysis.id, source.id, target.id, item->>'kind'
    from jsonb_array_elements(parsed->'edges') item
    join public.files source on source.analysis_id = analysis.id and source.path = item->>'from'
    join public.files target on target.analysis_id = analysis.id and target.path = item->>'to';
  update public.analyses set parser_metadata = parsed - 'files' - 'edges', commit_sha = commit_id, state = 'completed',
    message = 'The repository map is ready.', updated_at = clock_timestamp() where id = analysis_id;
  return true;
end $$;
alter function public.publish_analysis(uuid, uuid, text, jsonb, text) owner to cartograph_writer;
revoke all on function public.publish_analysis(uuid, uuid, text, jsonb, text) from public, anon;
grant execute on function public.publish_analysis(uuid, uuid, text, jsonb, text) to authenticated;

create function public.analysis_graph(analysis_id uuid) returns jsonb
language sql security invoker set search_path = '' stable as $$
  select parser_metadata || jsonb_build_object(
    'files', coalesce((select jsonb_agg(node order by path) from public.files where files.analysis_id = analyses.id), '[]'::jsonb),
    'edges', coalesce((select jsonb_agg(jsonb_build_object('from', source.path, 'to', target.path, 'kind', edges.kind) order by source.path, target.path, edges.kind)
      from public.edges join public.files source on source.id = source_file_id join public.files target on target.id = target_file_id
      where edges.analysis_id = analyses.id), '[]'::jsonb))
  from public.analyses where id = analysis_id and state = 'completed' and not is_seed;
$$;
revoke all on function public.analysis_graph(uuid) from public, anon;
grant execute on function public.analysis_graph(uuid) to authenticated;

create table private.progress_channels (pattern text primary key);
alter table private.progress_channels enable row level security;
insert into private.progress_channels values ('analysis:<uuid>'), ('organization:<org_id>');

create function private.broadcast_analysis_progress() returns trigger
language plpgsql security definer set search_path = '' as $$
declare payload jsonb;
begin
  if not exists (select 1 from private.progress_channels where pattern = 'analysis:<uuid>') or
    not exists (select 1 from private.progress_channels where pattern = 'organization:<org_id>') then raise exception 'Progress channel patterns are not registered.'; end if;
  payload := jsonb_build_object('id', new.id, 'state', new.state, 'stage', new.stage, 'message', new.message, 'updatedAt', new.updated_at);
  perform realtime.send(payload, 'progress', 'analysis:' || new.id::text, true);
  perform realtime.send(payload, 'progress', 'organization:' || new.organization_id, true);
  return new;
end $$;
revoke all on function private.broadcast_analysis_progress() from public, anon, authenticated;
create trigger analysis_progress after insert or update of state, stage, message on public.analyses for each row execute function private.broadcast_analysis_progress();

create policy analysis_progress_subscribe on realtime.messages for select to authenticated using (
  extension = 'broadcast' and (
    realtime.topic() = 'organization:' || (select auth.jwt()->'o'->>'id') or
    exists (select 1 from public.analyses where 'analysis:' || id::text = realtime.topic() and not is_seed)
  )
);
revoke create on schema public from cartograph_writer;
revoke cartograph_writer from postgres;
commit;
