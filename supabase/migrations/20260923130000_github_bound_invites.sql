alter table public.console_invites add column github_user_id text;

create or replace function public.console_consume_invite(p_code_hash text, p_user_id uuid, p_member_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_invite public.console_invites%rowtype;
  v_workspace public.console_workspaces%rowtype;
begin
  if p_user_id is null or length(trim(p_name)) not between 1 and 80 then raise exception 'Invalid member.'; end if;
  select * into v_invite from public.console_invites where code_hash = p_code_hash and expires_at > now() for update;
  if not found then raise exception 'Invitation expired or used.'; end if;
  if v_invite.github_user_id is not null and not exists (
    select 1 from auth.identities
    where user_id = p_user_id and provider = 'github' and provider_id = v_invite.github_user_id
  ) then raise exception 'GitHub account does not match invitation.'; end if;
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

revoke all on function public.console_consume_invite(text, uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.console_consume_invite(text, uuid, uuid, text) to service_role;
