begin;

create schema if not exists private;

create table private.organizations (id text primary key);

create type public.analysis_state as enum ('queued', 'running', 'completed', 'failed');

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references private.organizations(id) on delete cascade,
  repository text not null check (repository ~ '^[^/[:space:]]+/[^/[:space:]]+$'),
  unique (organization_id, id)
);

create index projects_organization_idx on public.projects (organization_id);

alter table public.projects enable row level security;

create policy projects_organization_select on public.projects for select to authenticated
  using (organization_id = (select auth.jwt()->'o'->>'id'));

revoke all on public.projects from anon, authenticated;

grant select on public.projects to authenticated;

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references private.organizations(id) on delete cascade,
  project_id uuid not null,
  state public.analysis_state not null default 'queued',
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  constraint analyses_project_fk foreign key (organization_id, project_id) references public.projects (organization_id, id) on delete cascade
);

create index analyses_organization_created_idx on public.analyses (organization_id, created_at desc, id desc);

create index analyses_project_fk_idx on public.analyses (organization_id, project_id);

alter table public.analyses enable row level security;

create policy analyses_organization_select on public.analyses for select to authenticated
  using (organization_id = (select auth.jwt()->'o'->>'id'));

revoke all on public.analyses from anon, authenticated;

grant select on public.analyses to authenticated;

create table public.files (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references private.organizations(id) on delete cascade,
  analysis_id uuid not null,
  path text not null,
  unique (organization_id, analysis_id, id),
  unique (organization_id, analysis_id, path),
  constraint files_analysis_fk foreign key (organization_id, analysis_id) references public.analyses (organization_id, id) on delete cascade
);

alter table public.files enable row level security;

create policy files_organization_select on public.files for select to authenticated
  using (organization_id = (select auth.jwt()->'o'->>'id'));

revoke all on public.files from anon, authenticated;

grant select on public.files to authenticated;

create table public.edges (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references private.organizations(id) on delete cascade,
  analysis_id uuid not null,
  source_file_id uuid not null,
  target_file_id uuid not null,
  constraint edges_analysis_fk foreign key (organization_id, analysis_id) references public.analyses (organization_id, id) on delete cascade,
  constraint edges_source_file_fk foreign key (organization_id, analysis_id, source_file_id) references public.files (organization_id, analysis_id, id) on delete cascade,
  constraint edges_target_file_fk foreign key (organization_id, analysis_id, target_file_id) references public.files (organization_id, analysis_id, id) on delete cascade
);

create index edges_analysis_fk_idx on public.edges (organization_id, analysis_id);

create index edges_source_file_fk_idx on public.edges (organization_id, analysis_id, source_file_id);

create index edges_target_file_fk_idx on public.edges (organization_id, analysis_id, target_file_id);

alter table public.edges enable row level security;

create policy edges_organization_select on public.edges for select to authenticated
  using (organization_id = (select auth.jwt()->'o'->>'id'));

revoke all on public.edges from anon, authenticated;

grant select on public.edges to authenticated;

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references private.organizations(id) on delete cascade,
  analysis_id uuid not null,
  file_id uuid not null,
  path text not null,
  constraint routes_analysis_fk foreign key (organization_id, analysis_id) references public.analyses (organization_id, id) on delete cascade,
  constraint routes_file_fk foreign key (organization_id, analysis_id, file_id) references public.files (organization_id, analysis_id, id) on delete cascade
);

create index routes_analysis_fk_idx on public.routes (organization_id, analysis_id);

create index routes_file_fk_idx on public.routes (organization_id, analysis_id, file_id);

alter table public.routes enable row level security;

create policy routes_organization_select on public.routes for select to authenticated
  using (organization_id = (select auth.jwt()->'o'->>'id'));

revoke all on public.routes from anon, authenticated;

grant select on public.routes to authenticated;

create table public.explanations (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references private.organizations(id) on delete cascade,
  analysis_id uuid not null,
  body text not null,
  constraint explanations_analysis_fk foreign key (organization_id, analysis_id) references public.analyses (organization_id, id) on delete cascade
);

create index explanations_analysis_fk_idx on public.explanations (organization_id, analysis_id);

alter table public.explanations enable row level security;

create policy explanations_organization_select on public.explanations for select to authenticated
  using (organization_id = (select auth.jwt()->'o'->>'id'));

revoke all on public.explanations from anon, authenticated;

grant select on public.explanations to authenticated;

create table public.file_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references private.organizations(id) on delete cascade,
  analysis_id uuid not null,
  file_id uuid not null,
  role text not null,
  constraint file_roles_analysis_fk foreign key (organization_id, analysis_id) references public.analyses (organization_id, id) on delete cascade,
  constraint file_roles_file_fk foreign key (organization_id, analysis_id, file_id) references public.files (organization_id, analysis_id, id) on delete cascade
);

create index file_roles_analysis_fk_idx on public.file_roles (organization_id, analysis_id);

create index file_roles_file_fk_idx on public.file_roles (organization_id, analysis_id, file_id);

alter table public.file_roles enable row level security;

create policy file_roles_organization_select on public.file_roles for select to authenticated
  using (organization_id = (select auth.jwt()->'o'->>'id'));

revoke all on public.file_roles from anon, authenticated;

grant select on public.file_roles to authenticated;

create table public.insights (
  id uuid primary key default gen_random_uuid(),
  organization_id text not null references private.organizations(id) on delete cascade,
  analysis_id uuid not null,
  body text not null,
  constraint insights_analysis_fk foreign key (organization_id, analysis_id) references public.analyses (organization_id, id) on delete cascade
);

create index insights_analysis_fk_idx on public.insights (organization_id, analysis_id);

alter table public.insights enable row level security;

create policy insights_organization_select on public.insights for select to authenticated
  using (organization_id = (select auth.jwt()->'o'->>'id'));

revoke all on public.insights from anon, authenticated;

grant select on public.insights to authenticated;

alter table private.organizations enable row level security;

revoke all on schema private from public, anon, authenticated;

revoke all on private.organizations from public, anon, authenticated;

commit;
