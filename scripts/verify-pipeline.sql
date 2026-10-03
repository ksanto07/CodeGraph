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
  perform set_config('request.jwt.claims','{"o":{"id":"org_CartographMigrationTestB"}}',true);
  if public.analysis_graph(aid) is not null then raise exception 'Cross-workspace graph was visible'; end if;
  if public.advance_analysis(aid,attempt,'store','smoke',repeat('1',64)) then raise exception 'Cross-workspace write succeeded'; end if;
  if public.publish_analysis(aid,attempt,repeat('a',40),'{}'::jsonb,repeat('1',64)) then raise exception 'Cross-workspace publication succeeded'; end if;
  begin perform public.restart_analysis(aid); raise exception 'Cross-workspace restart succeeded'; exception when no_data_found then null; end;
end $$;
rollback;
select 'Pipeline, routes, require edges and workspace isolation passed; test data rolled back.' as verification;
