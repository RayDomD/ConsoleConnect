-- Presence heartbeats for the Office (roadmap 3.1). Ephemeral and outside the revisioned workspace state.
-- Only the Edge Function (service role) reads and writes; members see presence through /state.
create table public.console_presence (
  workspace_id uuid not null references public.console_workspaces(id) on delete cascade,
  member_id uuid not null,
  record jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (workspace_id, member_id)
);

alter table public.console_presence enable row level security;
revoke all on table public.console_presence from public, anon, authenticated;
grant select, insert, update, delete on table public.console_presence to service_role;
