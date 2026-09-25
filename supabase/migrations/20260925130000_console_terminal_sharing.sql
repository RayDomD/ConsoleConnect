-- View-only console sharing on Supabase-hosted workspaces (roadmap 3.2). Output travels over Realtime
-- broadcast on private topics named "console-terminal:<workspace_id>:<task_id>". Members of the workspace
-- may listen; only the task's assignee may send, and only while the task is being worked on.

create function public.console_terminal_listener(p_topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.console_members m
    where m.user_id = auth.uid() and m.workspace_id::text = pg_catalog.split_part(p_topic, ':', 2)
  );
$$;

create function public.console_terminal_sender(p_topic text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.console_members m
    join public.console_workspaces w on w.id = m.workspace_id
    cross join lateral pg_catalog.jsonb_array_elements(w.state->'tasks') as t(task)
    where m.user_id = auth.uid()
      and w.id::text = pg_catalog.split_part(p_topic, ':', 2)
      and t.task->>'id' = pg_catalog.split_part(p_topic, ':', 3)
      and t.task->>'assigneeId' = m.member_id::text
      and t.task->>'status' in ('running', 'changes_requested')
  );
$$;

revoke all on function public.console_terminal_listener(text) from public, anon;
revoke all on function public.console_terminal_sender(text) from public, anon;
grant execute on function public.console_terminal_listener(text) to authenticated;
grant execute on function public.console_terminal_sender(text) to authenticated;

create policy console_terminal_listen on realtime.messages for select to authenticated
  using (realtime.messages.extension = 'broadcast' and realtime.topic() like 'console-terminal:%'
    and public.console_terminal_listener(realtime.topic()));

create policy console_terminal_send on realtime.messages for insert to authenticated
  with check (realtime.messages.extension = 'broadcast' and realtime.topic() like 'console-terminal:%'
    and public.console_terminal_sender(realtime.topic()));
