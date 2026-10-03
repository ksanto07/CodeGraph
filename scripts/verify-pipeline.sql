begin;
insert into private.pipeline_credentials(credential_hash)
values (encode(sha256(convert_to(repeat('1',64),'UTF8')),'hex')) on conflict do nothing;
select set_config('request.jwt.claims','{"o":{"id":"org_CartographMigrationTestA"}}',true);
set local role authenticated;
do $$ declare claimed jsonb; aid uuid; attempt uuid; graph jsonb; begin
  claimed := public.claim_repository('cartograph-check/migration-smoke');
  aid := (claimed->>'id')::uuid; attempt := (claimed->>'attempt')::uuid;
  if not (claimed->>'started')::boolean then raise exception 'Smoke analysis already exists'; end if;
  begin
    perform public.advance_analysis(aid,attempt,'fetch','smoke',repeat('0',64));
    raise exception 'Wrong credential was accepted';
  exception when insufficient_privilege then null; end;
  if not public.advance_analysis(aid,attempt,'fetch','smoke',repeat('1',64)) then raise exception 'Fetch failed'; end if;
  perform public.advance_analysis(aid,attempt,'select','smoke',repeat('1',64));
  perform public.advance_analysis(aid,attempt,'parse','smoke',repeat('1',64));
  perform public.advance_analysis(aid,attempt,'store','smoke',repeat('1',64));
  if not public.publish_analysis(aid,attempt,repeat('a',40),
    '{"schemaVersion":1,"files":[{"id":"source.ts"},{"id":"target.ts"}],"edges":[{"from":"source.ts","to":"target.ts","kind":"require"}],"frameworkMetadata":{"routes":[{"file":"source.ts","path":"/smoke","method":"GET"}]}}'::jsonb,
    repeat('1',64)) then raise exception 'Publication failed'; end if;
  graph := public.analysis_graph(aid);
  if jsonb_array_length(graph->'files')<>2 or jsonb_array_length(graph->'edges')<>1 then raise exception 'Graph round trip failed'; end if;
  if not exists(select 1 from public.routes where analysis_id=aid and path='/smoke' and method='GET') then raise exception 'Route publication failed'; end if;
  if public.write_explanation(aid,attempt,'file','source.ts',array['source.ts'],repeat('b',64),
    'fixture-2026-01-01','explain-smoke',repeat('a',40),'First explanation',repeat('1',64)) is distinct from 'First explanation'
    then raise exception 'Explanation publication failed'; end if;
  if public.write_explanation(aid,attempt,'file','source.ts',array['source.ts'],repeat('b',64),
    'fixture-2026-01-01','explain-smoke',repeat('a',40),'Racing explanation',repeat('1',64)) is distinct from 'First explanation'
    then raise exception 'Explanation conflict did not preserve the canonical first writer'; end if;
  if public.write_explanation(aid,attempt,'folder','.',array['source.ts','target.ts'],repeat('c',64),
    'fixture-2026-01-01','explain-smoke',repeat('a',40),'Folder explanation',repeat('1',64)) is distinct from 'Folder explanation'
    then raise exception 'Folder explanation publication failed'; end if;
  if public.write_file_role(aid,attempt,'source.ts',repeat('d',64),'fixture-2026-01-01','classify-smoke',
    repeat('a',40),'service',repeat('1',64)) is distinct from 'service' then raise exception 'Role publication failed'; end if;
  if public.write_file_role(aid,attempt,'source.ts',repeat('d',64),'fixture-2026-01-01','classify-smoke',
    repeat('a',40),'util',repeat('1',64)) is distinct from 'service'
    then raise exception 'Role conflict did not preserve the canonical first writer'; end if;
  if (select count(*) from public.explanations where analysis_id=aid)<>2
    or (select count(*) from public.file_roles where analysis_id=aid)<>1 then raise exception 'Cache writes created duplicate rows'; end if;
  if not exists(select 1 from public.explanations where analysis_id=aid and content_key=repeat('b',64) and body='First explanation')
    or not exists(select 1 from public.file_roles where analysis_id=aid and content_key=repeat('d',64) and role='service')
    then raise exception 'Canonical cache reads failed'; end if;
  begin
    perform public.write_explanation(aid,attempt,'file','source.ts',array['source.ts'],repeat('e',64),
      'fixture-2026-01-01','explain-smoke',repeat('a',40),'Denied',repeat('0',64));
    raise exception 'Wrong explanation credential was accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.write_file_role(aid,attempt,'source.ts',repeat('e',64),'fixture-2026-01-01','classify-smoke',
      repeat('a',40),'service',repeat('0',64));
    raise exception 'Wrong role credential was accepted';
  exception when insufficient_privilege then null; end;
  begin
    perform public.write_explanation(aid,attempt,'file','missing.ts',array['missing.ts'],repeat('e',64),
      'fixture-2026-01-01','explain-smoke',repeat('a',40),'Denied',repeat('1',64));
    raise exception 'Missing explanation target was accepted';
  exception when raise_exception then
    if sqlerrm <> 'The explanation target is absent from the current graph.' then raise; end if;
  end;
  begin
    perform public.write_explanation(aid,attempt,'folder','missing',array['source.ts'],repeat('e',64),
      'fixture-2026-01-01','explain-smoke',repeat('a',40),'Denied',repeat('1',64));
    raise exception 'Invalid folder members were accepted';
  exception when raise_exception then
    if sqlerrm <> 'The explanation target is absent from the current graph.' then raise; end if;
  end;
  begin
    perform public.write_file_role(aid,attempt,'missing.ts',repeat('e',64),'fixture-2026-01-01','classify-smoke',
      repeat('a',40),'service',repeat('1',64));
    raise exception 'Missing role target was accepted';
  exception when no_data_found then null; end;
  begin
    perform public.write_file_role(aid,attempt,'source.ts',repeat('e',64),'fixture-2026-01-01','classify-smoke',
      repeat('a',40),'route',repeat('1',64));
    raise exception 'Structural role was accepted';
  exception when check_violation then null; end;
  begin
    perform public.write_explanation(aid,gen_random_uuid(),'file','source.ts',array['source.ts'],repeat('e',64),
      'fixture-2026-01-01','explain-smoke',repeat('a',40),'Denied',repeat('1',64));
    raise exception 'Stale explanation attempt was accepted';
  exception when no_data_found then null; end;
  begin
    perform public.write_file_role(aid,gen_random_uuid(),'source.ts',repeat('e',64),'fixture-2026-01-01','classify-smoke',
      repeat('a',40),'service',repeat('1',64));
    raise exception 'Stale role attempt was accepted';
  exception when no_data_found then null; end;
  begin
    perform public.write_explanation(aid,attempt,'file','source.ts',array['source.ts'],repeat('e',64),
      'fixture-2026-01-01','explain-smoke',repeat('f',40),'Denied',repeat('1',64));
    raise exception 'Stale explanation commit was accepted';
  exception when no_data_found then null; end;
  begin
    perform public.write_file_role(aid,attempt,'source.ts',repeat('e',64),'fixture-2026-01-01','classify-smoke',
      repeat('f',40),'service',repeat('1',64));
    raise exception 'Stale role commit was accepted';
  exception when no_data_found then null; end;
  if (select count(*) from public.explanations where analysis_id=aid)<>2
    or (select count(*) from public.file_roles where analysis_id=aid)<>1 then raise exception 'Rejected cache writes changed stored rows'; end if;
  perform set_config('request.jwt.claims','{"o":{"id":"org_CartographMigrationTestB"}}',true);
  if public.analysis_graph(aid) is not null then raise exception 'Cross-workspace graph was visible'; end if;
  if exists(select 1 from public.explanations where analysis_id=aid)
    or exists(select 1 from public.file_roles where analysis_id=aid) then raise exception 'Cross-workspace cache was visible'; end if;
  begin
    perform public.write_explanation(aid,attempt,'file','source.ts',array['source.ts'],repeat('b',64),
      'fixture-2026-01-01','explain-smoke',repeat('a',40),'Denied',repeat('1',64));
    raise exception 'Cross-workspace explanation write succeeded';
  exception when no_data_found then null; end;
  begin
    perform public.write_file_role(aid,attempt,'source.ts',repeat('d',64),'fixture-2026-01-01','classify-smoke',
      repeat('a',40),'util',repeat('1',64));
    raise exception 'Cross-workspace role write succeeded';
  exception when no_data_found then null; end;

  if public.advance_analysis(aid,attempt,'store','smoke',repeat('1',64)) then raise exception 'Cross-workspace write succeeded'; end if;
  if public.publish_analysis(aid,attempt,repeat('a',40),'{}'::jsonb,repeat('1',64)) then raise exception 'Cross-workspace publication succeeded'; end if;
  begin perform public.restart_analysis(aid); raise exception 'Cross-workspace restart succeeded'; exception when no_data_found then null; end;
end $$;
rollback;
select 'Pipeline, routes, require edges, immutable AI caches, credential/target/role/attempt/commit checks and workspace isolation passed; test data rolled back.' as verification;
