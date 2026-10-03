\set ON_ERROR_STOP on
\if :{?org_a}
\else
do $$ begin raise exception 'Supply org_a with an actual Clerk organization ID.'; end; $$;
\endif
\if :{?org_b}
\else
do $$ begin raise exception 'Supply org_b with an actual Clerk organization ID.'; end; $$;
\endif

begin;
create temporary table seed_organizations (
  org_a text not null check (org_a ~ '^org_[A-Za-z0-9]+$'),
  org_b text not null check (org_b ~ '^org_[A-Za-z0-9]+$'),
  check (org_a <> org_b)
) on commit drop;
insert into seed_organizations values (:'org_a', :'org_b');

do $$
begin
  if exists (
    select 1 from public.projects p cross join seed_organizations s
    where (p.id = '10000000-0000-4000-8000-000000000001' and p.organization_id <> s.org_a)
       or (p.id = '10000000-0000-4000-8000-000000000002' and p.organization_id <> s.org_b)
  ) or exists (
    select 1 from public.analyses a cross join seed_organizations s
    where (a.id in (
      '20000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000004'
    ) and a.organization_id <> s.org_a)
    or (a.id in (
      '20000000-0000-4000-8000-000000000005',
      '20000000-0000-4000-8000-000000000006',
      '20000000-0000-4000-8000-000000000007',
      '20000000-0000-4000-8000-000000000008'
    ) and a.organization_id <> s.org_b)
  ) then
    raise exception 'Fixture IDs already belong to a different organization. Keep the original org_a and org_b inputs.';
  end if;
end;
$$;

insert into private.organizations (id)
select org_a from seed_organizations union all select org_b from seed_organizations
on conflict (id) do nothing;

insert into public.projects (id, organization_id, repository)
select '10000000-0000-4000-8000-000000000001'::uuid, org_a, 'vercel/next.js' from seed_organizations
union all
select '10000000-0000-4000-8000-000000000002'::uuid, org_b, 'vercel/next.js' from seed_organizations
on conflict (id) do update set repository = excluded.repository;

insert into public.analyses (id, organization_id, project_id, state, created_at)
select '20000000-0000-4000-8000-000000000001'::uuid, org_a, '10000000-0000-4000-8000-000000000001'::uuid, 'queued'::public.analysis_state, '2026-10-01 12:00:00+00'::timestamptz from seed_organizations
union all
select '20000000-0000-4000-8000-000000000002'::uuid, org_a, '10000000-0000-4000-8000-000000000001'::uuid, 'running'::public.analysis_state, '2026-10-01 13:00:00+00'::timestamptz from seed_organizations
union all
select '20000000-0000-4000-8000-000000000003'::uuid, org_a, '10000000-0000-4000-8000-000000000001'::uuid, 'completed'::public.analysis_state, '2026-10-01 14:00:00+00'::timestamptz from seed_organizations
union all
select '20000000-0000-4000-8000-000000000004'::uuid, org_a, '10000000-0000-4000-8000-000000000001'::uuid, 'failed'::public.analysis_state, '2026-10-01 15:00:00+00'::timestamptz from seed_organizations
union all
select '20000000-0000-4000-8000-000000000005'::uuid, org_b, '10000000-0000-4000-8000-000000000002'::uuid, 'completed'::public.analysis_state, '2026-10-02 12:00:00+00'::timestamptz from seed_organizations
union all
select '20000000-0000-4000-8000-000000000006'::uuid, org_b, '10000000-0000-4000-8000-000000000002'::uuid, 'failed'::public.analysis_state, '2026-10-02 13:00:00+00'::timestamptz from seed_organizations
union all
select '20000000-0000-4000-8000-000000000007'::uuid, org_b, '10000000-0000-4000-8000-000000000002'::uuid, 'queued'::public.analysis_state, '2026-10-02 14:00:00+00'::timestamptz from seed_organizations
union all
select '20000000-0000-4000-8000-000000000008'::uuid, org_b, '10000000-0000-4000-8000-000000000002'::uuid, 'running'::public.analysis_state, '2026-10-02 15:00:00+00'::timestamptz from seed_organizations
on conflict (id) do update set
  project_id = excluded.project_id,
  state = excluded.state,
  created_at = excluded.created_at;

commit;
