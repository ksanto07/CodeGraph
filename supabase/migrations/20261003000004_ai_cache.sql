begin;

grant cartograph_writer to postgres;
grant usage, create on schema public to cartograph_writer;

alter table public.explanations
  add column target_kind text,
  add column target_path text,
  add column content_key text,
  add column model text,
  add column prompt_version text,
  add column analyzed_commit text,
  add column expected_attempt uuid,
  add column created_at timestamptz not null default now(),
  add constraint explanations_cache_shape check (
    (target_kind is null and target_path is null and content_key is null and model is null and prompt_version is null and analyzed_commit is null and expected_attempt is null)
    or (target_kind is not null and target_kind in ('file','folder') and target_path is not null and length(target_path) between 1 and 4096
      and content_key is not null and content_key ~ '^[a-f0-9]{64}$'
      and model is not null and model ~ '^.+-[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and prompt_version is not null and length(prompt_version) between 1 and 100
      and analyzed_commit is not null and analyzed_commit ~ '^[a-f0-9]{40}$' and expected_attempt is not null
      and octet_length(body) between 1 and 100000 and length(btrim(body)) > 0)
  ),
  add constraint explanations_analysis_content_unique unique (analysis_id, content_key);

alter table public.file_roles
  add column content_key text,
  add column model text,
  add column prompt_version text,
  add column analyzed_commit text,
  add column expected_attempt uuid,
  add column source text,
  add column created_at timestamptz not null default now(),
  add constraint file_roles_cache_shape check (
    (content_key is null and model is null and prompt_version is null and analyzed_commit is null and expected_attempt is null and source is null)
    or (content_key is not null and content_key ~ '^[a-f0-9]{64}$'
      and model is not null and model ~ '^.+-[0-9]{4}-[0-9]{2}-[0-9]{2}$'
      and prompt_version is not null and length(prompt_version) between 1 and 100
      and analyzed_commit is not null and analyzed_commit ~ '^[a-f0-9]{40}$' and expected_attempt is not null
      and source is not null and source = 'ai' and role in ('service','repository','model','util','config','component','hook'))
  ),
  add constraint file_roles_analysis_file_content_unique unique (analysis_id, file_id, content_key);

grant select, insert on public.explanations, public.file_roles to cartograph_writer;
create policy explanation_writer_organization on public.explanations for all to cartograph_writer
  using (organization_id = (select private.current_pipeline_organization()))
  with check (organization_id = (select private.current_pipeline_organization()));
create policy file_role_writer_organization on public.file_roles for all to cartograph_writer
  using (organization_id = (select private.current_pipeline_organization()))
  with check (organization_id = (select private.current_pipeline_organization()));

create function public.write_explanation(
  analysis_id uuid, expected_attempt uuid, target_kind text, target_path text, target_members text[],
  content_key text, model text, prompt_version text, analyzed_commit text, body text, write_secret text
) returns text
language plpgsql security definer set search_path = '' as $$
declare analysis public.analyses; canonical text;
begin
  perform private.require_pipeline_writer(write_secret);
  select * into strict analysis from public.analyses a
    where a.id = write_explanation.analysis_id and a.attempt_id = write_explanation.expected_attempt
      and a.commit_sha = write_explanation.analyzed_commit and a.state = 'completed' and not a.is_seed for update;
  if target_kind is null or target_kind not in ('file','folder') or target_path is null
    or target_members is null or array_ndims(target_members) is distinct from 1 or cardinality(target_members) < 1 or cardinality(target_members) > 10000
    or cardinality(target_members) <> (select count(distinct member) from unnest(target_members) member)
    or exists (select 1 from unnest(target_members) member where member is null or not exists (
      select 1 from public.files f where f.analysis_id = analysis.id and f.path = member))
    or (target_kind = 'file' and (cardinality(target_members) <> 1 or target_members[1] <> target_path))
    or (target_kind = 'folder' and exists (select 1 from unnest(target_members) member
      where target_path <> '.' and left(member, length(target_path) + 1) <> target_path || '/'))
    then raise exception 'The explanation target is absent from the current graph.'; end if;
  insert into public.explanations(organization_id, analysis_id, target_kind, target_path, content_key, model, prompt_version, analyzed_commit, expected_attempt, body)
    values (analysis.organization_id, analysis.id, target_kind, target_path, content_key, model, prompt_version, analyzed_commit, expected_attempt, body)
    on conflict on constraint explanations_analysis_content_unique do nothing;
  select e.body into strict canonical from public.explanations e
    where e.analysis_id = analysis.id and e.content_key = write_explanation.content_key;
  return canonical;
end $$;
alter function public.write_explanation(uuid, uuid, text, text, text[], text, text, text, text, text, text) owner to cartograph_writer;
revoke all on function public.write_explanation(uuid, uuid, text, text, text[], text, text, text, text, text, text) from public, anon;
grant execute on function public.write_explanation(uuid, uuid, text, text, text[], text, text, text, text, text, text) to authenticated;

create function public.write_file_role(
  analysis_id uuid, expected_attempt uuid, file_path text, content_key text,
  model text, prompt_version text, analyzed_commit text, role text, write_secret text
) returns text
language plpgsql security definer set search_path = '' as $$
declare analysis public.analyses; file_uuid uuid; canonical text;
begin
  perform private.require_pipeline_writer(write_secret);
  select * into strict analysis from public.analyses a
    where a.id = write_file_role.analysis_id and a.attempt_id = write_file_role.expected_attempt
      and a.commit_sha = write_file_role.analyzed_commit and a.state = 'completed' and not a.is_seed for update;
  select f.id into strict file_uuid from public.files f where f.analysis_id = analysis.id and f.path = file_path;
  insert into public.file_roles(organization_id, analysis_id, file_id, content_key, model, prompt_version, analyzed_commit, expected_attempt, source, role)
    values (analysis.organization_id, analysis.id, file_uuid, content_key, model, prompt_version, analyzed_commit, expected_attempt, 'ai', role)
    on conflict on constraint file_roles_analysis_file_content_unique do nothing;
  select r.role into strict canonical from public.file_roles r
    where r.analysis_id = analysis.id and r.file_id = file_uuid and r.content_key = write_file_role.content_key;
  return canonical;
end $$;
alter function public.write_file_role(uuid, uuid, text, text, text, text, text, text, text) owner to cartograph_writer;
revoke all on function public.write_file_role(uuid, uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.write_file_role(uuid, uuid, text, text, text, text, text, text, text) to authenticated;

revoke create on schema public from cartograph_writer;
revoke cartograph_writer from postgres;
commit;
