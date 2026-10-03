alter table public.explanations drop constraint explanations_cache_shape;
alter table public.explanations add constraint explanations_cache_shape check (
  (target_kind is null and target_path is null and content_key is null and model is null and prompt_version is null and analyzed_commit is null and expected_attempt is null)
  or (target_kind is not null and target_kind in ('file','folder') and target_path is not null and length(target_path) between 1 and 4096
    and content_key is not null and content_key ~ '^[a-f0-9]{64}$'
    and model is not null and model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
    and prompt_version is not null and length(prompt_version) between 1 and 100
    and analyzed_commit is not null and analyzed_commit ~ '^[a-f0-9]{40}$' and expected_attempt is not null
    and octet_length(body) between 1 and 100000 and length(btrim(body)) > 0)
);

alter table public.file_roles drop constraint file_roles_cache_shape;
alter table public.file_roles add constraint file_roles_cache_shape check (
  (content_key is null and model is null and prompt_version is null and analyzed_commit is null and expected_attempt is null and source is null)
  or (content_key is not null and content_key ~ '^[a-f0-9]{64}$'
    and model is not null and model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,199}$'
    and prompt_version is not null and length(prompt_version) between 1 and 100
    and analyzed_commit is not null and analyzed_commit ~ '^[a-f0-9]{40}$' and expected_attempt is not null
    and source is not null and source = 'ai' and role in ('service','repository','model','util','config','component','hook'))
);
