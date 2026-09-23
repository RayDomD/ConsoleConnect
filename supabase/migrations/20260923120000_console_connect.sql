create schema if not exists console_connect_private;

create table public.console_workspaces (
  id uuid primary key,
  name text not null check (length(name) between 1 and 160),
  repository text not null,
  revision bigint not null check (revision > 0),
  state jsonb not null,
  created_at timestamptz not null default now()
);

create table public.console_members (
  workspace_id uuid not null references public.console_workspaces(id) on delete cascade,
  user_id uuid not null,
  member_id uuid not null,
  role text not null check (role in ('owner', 'reviewer', 'contributor')),
  primary key (workspace_id, user_id),
  unique (workspace_id, member_id)
);

create table public.console_invites (
  code_hash text primary key,
  workspace_id uuid not null references public.console_workspaces(id) on delete cascade,
  role text not null check (role in ('reviewer', 'contributor')),
  expires_at timestamptz not null
);

create table public.console_revisions (
  workspace_id uuid primary key references public.console_workspaces(id) on delete cascade,
  revision bigint not null
);

alter table public.console_workspaces enable row level security;
alter table public.console_members enable row level security;
alter table public.console_invites enable row level security;
alter table public.console_revisions enable row level security;

revoke all on public.console_workspaces, public.console_members, public.console_invites, public.console_revisions from anon, authenticated;
grant all on public.console_workspaces, public.console_members, public.console_invites, public.console_revisions to service_role;
grant select on public.console_revisions to authenticated;

create function console_connect_private.is_member(p_workspace_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.console_members m
    where m.workspace_id = p_workspace_id and m.user_id = (select auth.uid())
  );
$$;
revoke all on function console_connect_private.is_member(uuid) from public, anon;
grant usage on schema console_connect_private to authenticated;
grant execute on function console_connect_private.is_member(uuid) to authenticated;

create policy console_member_revision_read on public.console_revisions
  for select to authenticated using ((select console_connect_private.is_member(workspace_id)));

create function console_connect_private.publish_revision()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.console_revisions(workspace_id, revision)
    values (new.id, new.revision)
    on conflict (workspace_id) do update set revision = excluded.revision;
  return new;
end;
$$;
revoke all on function console_connect_private.publish_revision() from public, anon, authenticated;
create trigger console_workspace_revision after insert or update of revision on public.console_workspaces
  for each row execute function console_connect_private.publish_revision();

create function public.console_create_workspace(
  p_workspace_id uuid, p_member_id uuid, p_user_id uuid, p_name text, p_repository text, p_owner_name text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_state jsonb;
begin
  if p_user_id is null or length(trim(p_name)) not between 1 and 160 or length(trim(p_owner_name)) not between 1 and 80 then
    raise exception 'Invalid workspace or owner.';
  end if;
  v_state := pg_catalog.jsonb_build_object(
    'workspace', pg_catalog.jsonb_build_object('id', p_workspace_id, 'name', trim(p_name), 'repository', p_repository),
    'revision', 1,
    'members', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', p_member_id, 'name', trim(p_owner_name), 'role', 'owner')),
    'tasks', '[]'::jsonb, 'messages', '[]'::jsonb, 'decisions', '[]'::jsonb,
    'credentials', '{}'::jsonb, 'invites', '{}'::jsonb, 'appliedCommands', '{}'::jsonb
  );
  insert into public.console_workspaces(id, name, repository, revision, state)
    values (p_workspace_id, trim(p_name), p_repository, 1, v_state);
  insert into public.console_members(workspace_id, user_id, member_id, role)
    values (p_workspace_id, p_user_id, p_member_id, 'owner');
end;
$$;

create function public.console_consume_invite(p_code_hash text, p_user_id uuid, p_member_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_invite public.console_invites%rowtype;
  v_workspace public.console_workspaces%rowtype;
begin
  if p_user_id is null or length(trim(p_name)) not between 1 and 80 then raise exception 'Invalid member.'; end if;
  select * into v_invite from public.console_invites where code_hash = p_code_hash and expires_at > now() for update;
  if not found then raise exception 'Invitation expired or used.'; end if;
  select * into v_workspace from public.console_workspaces where id = v_invite.workspace_id for update;
  if exists (select 1 from public.console_members where workspace_id = v_workspace.id and user_id = p_user_id) then
    raise exception 'Already a member.';
  end if;
  insert into public.console_members(workspace_id, user_id, member_id, role)
    values (v_workspace.id, p_user_id, p_member_id, v_invite.role);
  update public.console_workspaces
    set revision = revision + 1,
        state = pg_catalog.jsonb_set(
          pg_catalog.jsonb_set(state, '{members}', state->'members' ||
            pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('id', p_member_id, 'name', trim(p_name), 'role', v_invite.role))),
          '{revision}', pg_catalog.to_jsonb(revision + 1))
    where id = v_workspace.id;
  delete from public.console_invites where code_hash = p_code_hash;
  return v_workspace.id;
end;
$$;

create function public.console_compare_and_swap(p_workspace_id uuid, p_revision bigint, p_state jsonb)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if (p_state->'workspace'->>'id')::uuid is distinct from p_workspace_id
    or (p_state->>'revision')::bigint is distinct from p_revision + 1 then
    raise exception 'Invalid workspace revision.';
  end if;
  update public.console_workspaces
    set state = p_state, revision = p_revision + 1
    where id = p_workspace_id and revision = p_revision;
  return found;
end;
$$;

revoke all on function public.console_create_workspace(uuid, uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.console_consume_invite(text, uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.console_compare_and_swap(uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.console_create_workspace(uuid, uuid, uuid, text, text, text) to service_role;
grant execute on function public.console_consume_invite(text, uuid, uuid, text) to service_role;
grant execute on function public.console_compare_and_swap(uuid, bigint, jsonb) to service_role;

do $$
begin
  if not exists (select 1 from pg_catalog.pg_publication_tables where pubname = 'supabase_realtime'
    and schemaname = 'public' and tablename = 'console_revisions') then
    alter publication supabase_realtime add table public.console_revisions;
  end if;
end;
$$;
