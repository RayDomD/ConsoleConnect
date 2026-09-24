import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';
import { oauthCallbackUrl } from './oauth';

export interface SupabaseConnection {
  mode: 'supabase'; projectUrl: string; publishableKey: string; workspaceId: string;
  shareUrl?: never; localOnly?: never;
}

let active: { projectUrl: string; publishableKey: string; client: SupabaseClient } | null = null;

function getClient(projectUrl: string, publishableKey: string) {
  const url = new URL(projectUrl);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) {
    throw new Error('Use an HTTPS Supabase project URL.');
  }
  if (!publishableKey.trim()) throw new Error('Enter the Supabase publishable key.');
  if (!active || active.projectUrl !== url.origin || active.publishableKey !== publishableKey) {
    active = { projectUrl: url.origin, publishableKey,
      client: createClient(url.origin, publishableKey, { auth: { persistSession: true, autoRefreshToken: true,
        flowType: 'pkce', detectSessionInUrl: false } }) };
  }
  return active.client;
}

async function session(projectUrl: string, publishableKey: string) {
  const client = getClient(projectUrl, publishableKey);
  const existing = await client.auth.getSession();
  if (existing.error) throw existing.error;
  if (existing.data.session) return existing.data.session;
  const signed = await client.auth.signInAnonymously();
  if (signed.error || !signed.data.session) {
    throw new Error('Anonymous sign-in is unavailable. Enable it in this Supabase project.');
  }
  return signed.data.session;
}

export async function hostedAccessToken(connection: SupabaseConnection) {
  return (await session(connection.projectUrl, connection.publishableKey)).access_token;
}

export async function hostedSignIn(projectUrl: string, publishableKey: string, provider: 'github' | 'google',
  openBrowser: (url: string) => Promise<string>) {
  const client = getClient(projectUrl, publishableKey);
  const existing = await client.auth.getSession();
  if (existing.error) throw existing.error;
  if (existing.data.session?.user.identities?.some(identity => identity.provider === provider)) {
    return existing.data.session.user.user_metadata.name ?? existing.data.session.user.email ?? 'Signed in';
  }
  const options = { redirectTo: oauthCallbackUrl, skipBrowserRedirect: true };
  const started = existing.data.session
    ? await client.auth.linkIdentity({ provider, options })
    : await client.auth.signInWithOAuth({ provider, options });
  if (started.error || !started.data.url) throw started.error ?? new Error('Could not start sign-in. Check this provider in Supabase.');
  const callback = new URL(await openBrowser(started.data.url));
  const code = callback.searchParams.get('code');
  if (!code) throw new Error(callback.searchParams.get('error_description') ?? 'Sign-in did not return a code.');
  const exchanged = await client.auth.exchangeCodeForSession(code);
  if (exchanged.error || !exchanged.data.user) throw exchanged.error ?? new Error('Could not finish sign-in.');
  const user = exchanged.data.user;
  return user.user_metadata.name ?? user.user_metadata.full_name ?? user.user_metadata.user_name ?? user.email ?? 'Signed in';
}

export async function hostedProjects(projectUrl: string, publishableKey: string) {
  const existing = await getClient(projectUrl, publishableKey).auth.getSession();
  if (existing.error) throw existing.error;
  if (!existing.data.session) return [];
  const response = await hostedRequest({ projectUrl, publishableKey, path: '/workspaces' });
  if (response.status >= 400) throw new Error(response.data.error ?? 'Could not load your hosted projects.');
  return response.data.workspaces as Array<{ id: string; name: string; repository: string }>;
}

export async function hostedRequest(input: { projectUrl: string; publishableKey: string; workspaceId?: string;
  path: string; body?: unknown }) {
  const token = (await session(input.projectUrl, input.publishableKey)).access_token;
  const url = new URL(`/functions/v1/console-connect${input.path}`, input.projectUrl);
  if (input.workspaceId) url.searchParams.set('workspaceId', input.workspaceId);
  const response = await fetch(url, { method: input.body === undefined ? 'GET' : 'POST',
    headers: { apikey: input.publishableKey, authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: input.body === undefined ? undefined : JSON.stringify(input.body) });
  const data = await response.json();
  return { status: response.status, data };
}

export async function watchHostedWorkspace(connection: SupabaseConnection,
  onRevision: (revision: number) => void, onConnected: () => void, onError: (message: string) => void) {
  const client = getClient(connection.projectUrl, connection.publishableKey);
  const token = await hostedAccessToken(connection);
  client.realtime.setAuth(token);
  const authSubscription = client.auth.onAuthStateChange((_event, next) => {
    if (next?.access_token) client.realtime.setAuth(next.access_token);
  });
  let channel: RealtimeChannel;
  channel = client.channel(`console-revisions-${connection.workspaceId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'console_revisions',
      filter: `workspace_id=eq.${connection.workspaceId}` }, payload => {
      const revision = Number(payload.new.revision);
      if (Number.isFinite(revision)) onRevision(revision);
    })
    .subscribe(status => {
      if (status === 'SUBSCRIBED') onConnected();
      else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') onError('Live updates disconnected. Periodic checks will continue.');
    });
  return () => {
    authSubscription.data.subscription.unsubscribe();
    void client.removeChannel(channel);
  };
}
