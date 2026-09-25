$ErrorActionPreference = 'Stop'
$pgBin = 'C:\Program Files\PostgreSQL\18\bin'
$temporaryRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$directory = Join-Path $temporaryRoot ("console-connect-schema-" + [guid]::NewGuid().ToString('N'))
$directory = [IO.Path]::GetFullPath($directory)
if (-not $directory.StartsWith($temporaryRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Unsafe temporary path.' }
$listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
$listener.Start()
$port = $listener.LocalEndpoint.Port
$listener.Stop()
$data = Join-Path $directory 'data'
$log = Join-Path $directory 'postgres.log'
New-Item -ItemType Directory -Path $directory | Out-Null
$started = $false
try {
  & (Join-Path $pgBin 'initdb.exe') -D $data -A trust -U postgres --no-instructions | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Postgres initialization failed.' }
  & (Join-Path $pgBin 'pg_ctl.exe') -D $data -l $log -o "-h 127.0.0.1 -p $port" -w start
  if ($LASTEXITCODE -ne 0) { throw 'Postgres start failed.' }
  $started = $true
  $env:PGHOST = '127.0.0.1'
  $env:PGPORT = [string]$port
  $env:PGUSER = 'postgres'
  $env:PGDATABASE = 'postgres'
  $seed = @'
create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;
create schema auth;
create table auth.identities (user_id uuid not null, provider text not null, provider_id text not null);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
create publication supabase_realtime;
create schema realtime;
create table realtime.messages (id bigserial primary key, topic text not null, extension text not null, payload jsonb);
alter table realtime.messages enable row level security;
create function realtime.topic() returns text language sql stable as $$ select current_setting('realtime.topic', true) $$;
grant usage on schema realtime to authenticated;
grant select, insert on realtime.messages to authenticated;
grant usage on sequence realtime.messages_id_seq to authenticated;
grant execute on function realtime.topic() to authenticated;
'@
  $seedFile = Join-Path $directory 'seed.sql'
  Set-Content -LiteralPath $seedFile -Value $seed
  & (Join-Path $pgBin 'psql.exe') -v ON_ERROR_STOP=1 -f $seedFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Supabase test roles failed.' }
  & (Join-Path $pgBin 'psql.exe') -v ON_ERROR_STOP=1 -f (Join-Path (Get-Location).Path 'supabase\migrations\20260923120000_console_connect.sql') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Supabase migration failed.' }
  & (Join-Path $pgBin 'psql.exe') -v ON_ERROR_STOP=1 -f (Join-Path (Get-Location).Path 'supabase\migrations\20260923130000_github_bound_invites.sql') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'GitHub invitation migration failed.' }
  & (Join-Path $pgBin 'psql.exe') -v ON_ERROR_STOP=1 -f (Join-Path (Get-Location).Path 'supabase\migrations\20260925120000_console_presence.sql') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Presence migration failed.' }
  & (Join-Path $pgBin 'psql.exe') -v ON_ERROR_STOP=1 -f (Join-Path (Get-Location).Path 'supabase\migrations\20260925130000_console_terminal_sharing.sql') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Console sharing migration failed.' }
  $test = @'
select public.console_create_workspace('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333', 'Team', 'https://github.com/example/repo', 'Alex');
insert into public.console_invites(code_hash, workspace_id, role, expires_at)
  values ('test-hash', '11111111-1111-4111-8111-111111111111', 'reviewer', now() + interval '1 hour');
select public.console_consume_invite('test-hash', '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555', 'Sam');
insert into public.console_invites(code_hash, workspace_id, role, expires_at, github_user_id)
  values ('bound-hash', '11111111-1111-4111-8111-111111111111', 'contributor', now() + interval '1 hour', '12345');
do $$ begin
  begin
    perform public.console_consume_invite('bound-hash', '66666666-6666-4666-8666-666666666666',
      '77777777-7777-4777-8777-777777777777', 'Wrong');
    raise exception 'Wrong GitHub account joined.';
  exception when others then
    if sqlerrm <> 'GitHub account does not match invitation.' then raise; end if;
  end;
end $$;
insert into auth.identities(user_id, provider, provider_id)
  values ('66666666-6666-4666-8666-666666666666', 'github', '12345');
select public.console_consume_invite('bound-hash', '66666666-6666-4666-8666-666666666666',
  '77777777-7777-4777-8777-777777777777', 'Contributor');
do $$
declare v_state jsonb;
begin
  select state into v_state from public.console_workspaces where id = '11111111-1111-4111-8111-111111111111';
  if v_state->>'revision' <> '3' or jsonb_array_length(v_state->'members') <> 3 then
    raise exception 'Join state was not committed.';
  end if;
  if public.console_compare_and_swap('11111111-1111-4111-8111-111111111111', 1,
    jsonb_set(v_state, '{revision}', '2'::jsonb)) then raise exception 'Stale update succeeded.'; end if;
  if not public.console_compare_and_swap('11111111-1111-4111-8111-111111111111', 3,
    jsonb_set(v_state, '{revision}', '4'::jsonb)) then raise exception 'Current update failed.'; end if;
end;
$$;
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$ begin
  if (select count(*) from public.console_revisions) <> 1 then raise exception 'Member cannot read revisions.'; end if;
end $$;
set request.jwt.claim.sub = '88888888-8888-4888-8888-888888888888';
do $$ begin
  if (select count(*) from public.console_revisions) <> 0 then raise exception 'Nonmember can read revisions.'; end if;
end $$;
-- Console sharing: the assignee sends, members listen, nonmembers get nothing.
reset role;
update public.console_workspaces set state = jsonb_set(state, '{tasks}',
  '[{"id": "aaaaaaaa-0000-4000-8000-000000000001", "assigneeId": "22222222-2222-4222-8222-222222222222", "status": "running"}]'::jsonb)
  where id = '11111111-1111-4111-8111-111111111111';
set role authenticated;
select set_config('realtime.topic', 'console-terminal:11111111-1111-4111-8111-111111111111:aaaaaaaa-0000-4000-8000-000000000001', false);
set request.jwt.claim.sub = '33333333-3333-4333-8333-333333333333';
insert into realtime.messages(topic, extension) values (realtime.topic(), 'broadcast');
set request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$ begin
  if (select count(*) from realtime.messages) <> 1 then raise exception 'A member cannot watch a shared console.'; end if;
  begin
    insert into realtime.messages(topic, extension) values (realtime.topic(), 'broadcast');
    raise exception 'A member who is not the assignee could send console output.';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claim.sub = '88888888-8888-4888-8888-888888888888';
do $$ begin
  if (select count(*) from realtime.messages) <> 0 then raise exception 'A nonmember can watch a shared console.'; end if;
end $$;
do $$ begin
  begin
    perform count(*) from public.console_presence;
    raise exception 'Members can read presence directly.';
  exception when insufficient_privilege then null;
  end;
end $$;
'@
  $testFile = Join-Path $directory 'test.sql'
  Set-Content -LiteralPath $testFile -Value $test
  & (Join-Path $pgBin 'psql.exe') -v ON_ERROR_STOP=1 -f $testFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Supabase permission and transaction checks failed.' }
  Write-Output 'Supabase migration and permission checks passed.'
} finally {
  if ($started) { & (Join-Path $pgBin 'pg_ctl.exe') -D $data -m immediate -w stop }
  Remove-Item Env:PGHOST,Env:PGPORT,Env:PGUSER,Env:PGDATABASE -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $directory) { Remove-Item -LiteralPath $directory -Recurse -Force }
}
