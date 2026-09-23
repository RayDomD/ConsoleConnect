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
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;
grant usage on schema auth to authenticated;
grant execute on function auth.uid() to authenticated;
create publication supabase_realtime;
'@
  $seedFile = Join-Path $directory 'seed.sql'
  Set-Content -LiteralPath $seedFile -Value $seed
  & (Join-Path $pgBin 'psql.exe') -v ON_ERROR_STOP=1 -f $seedFile | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Supabase test roles failed.' }
  & (Join-Path $pgBin 'psql.exe') -v ON_ERROR_STOP=1 -f (Join-Path (Get-Location).Path 'supabase\migrations\20260923120000_console_connect.sql') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'Supabase migration failed.' }
  $test = @'
select public.console_create_workspace('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333', 'Team', 'https://github.com/example/repo', 'Alex');
insert into public.console_invites(code_hash, workspace_id, role, expires_at)
  values ('test-hash', '11111111-1111-4111-8111-111111111111', 'reviewer', now() + interval '1 hour');
select public.console_consume_invite('test-hash', '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555', 'Sam');
do $$
declare v_state jsonb;
begin
  select state into v_state from public.console_workspaces where id = '11111111-1111-4111-8111-111111111111';
  if v_state->>'revision' <> '2' or jsonb_array_length(v_state->'members') <> 2 then
    raise exception 'Join state was not committed.';
  end if;
  if public.console_compare_and_swap('11111111-1111-4111-8111-111111111111', 1,
    jsonb_set(v_state, '{revision}', '2'::jsonb)) then raise exception 'Stale update succeeded.'; end if;
  if not public.console_compare_and_swap('11111111-1111-4111-8111-111111111111', 2,
    jsonb_set(v_state, '{revision}', '3'::jsonb)) then raise exception 'Current update failed.'; end if;
end;
$$;
set role authenticated;
set request.jwt.claim.sub = '44444444-4444-4444-8444-444444444444';
do $$ begin
  if (select count(*) from public.console_revisions) <> 1 then raise exception 'Member cannot read revisions.'; end if;
end $$;
set request.jwt.claim.sub = '66666666-6666-4666-8666-666666666666';
do $$ begin
  if (select count(*) from public.console_revisions) <> 0 then raise exception 'Nonmember can read revisions.'; end if;
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
