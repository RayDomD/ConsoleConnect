import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

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
      client: createClient(url.origin, publishableKey, { auth: { persistSession: true, autoRefreshToken: true } }) };
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
