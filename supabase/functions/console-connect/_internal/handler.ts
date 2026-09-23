import { createClient } from 'npm:@supabase/supabase-js@2';
import { handleHostedRequest, renderDecisionDocument } from './core.js';

const projectUrl = Deno.env.get('SUPABASE_URL')!;
const publishableKey = Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const githubToken = Deno.env.get('GITHUB_TOKEN');
const admin = createClient(projectUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

function githubRepository(repository: string) {
  const url = new URL(repository);
  const [owner, name] = url.pathname.split('/').filter(Boolean);
  if (!owner || !name || url.protocol !== 'https:' || url.hostname !== 'github.com') throw new Error('Invalid GitHub repository.');
  const api = 'https://api.github.com';
  const graphql = 'https://api.github.com/graphql';
  return { owner, name: name.replace(/\.git$/, ''), api, graphql };
}

async function githubFetch(url: string, init?: RequestInit) {
  if (!githubToken) throw new Error('Configure GITHUB_TOKEN for the hosted workspace.');
  const response = await fetch(url, { ...init, headers: { accept: 'application/vnd.github+json',
    authorization: `Bearer ${githubToken}`, 'user-agent': 'Console-Connect', ...init?.headers } });
  if (!response.ok) throw new Error(`GitHub HTTP ${response.status}`);
  return response.json();
}

const providers = {
  async verifyDecision(repository: string, decision: { id: string; title: string; body: string; proposedBy: string;
    createdAt: string; status: 'proposed' | 'official' | 'superseded'; supersedesId?: string; affectedTaskIds: string[] }, commitSha: string) {
    const repo = githubRepository(repository);
    const path = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/contents/docs/decisions/${decision.id}.md`;
    const file = await githubFetch(`${repo.api}${path}?ref=${encodeURIComponent(commitSha)}`) as { type?: string; encoding?: string; content?: string };
    if (file.type !== 'file' || file.encoding !== 'base64' || !file.content) return false;
    const binary = atob(file.content.replace(/\s/g, ''));
    const actual = new TextDecoder().decode(Uint8Array.from(binary, character => character.charCodeAt(0)));
    return actual === renderDecisionDocument(decision);
  },
  async lookupPullRequest(url: string) {
    const repo = githubRepository(url);
    const result = await githubFetch(repo.graphql, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query: 'query($url:URI!){resource(url:$url){... on PullRequest{url state reviewDecision mergedAt}}}', variables: { url } }) }) as {
      data?: { resource?: { url: string; state: 'OPEN' | 'CLOSED' | 'MERGED'; reviewDecision: string | null; mergedAt: string | null } };
      errors?: unknown[];
    };
    if (result.errors?.length || !result.data?.resource) throw new Error('GitHub did not return this pull request.');
    return result.data.resource;
  },
};

const store = {
  async create(input: { workspaceId: string; memberId: string; userId: string; name: string; repository: string; owner: string }) {
    const { error } = await admin.rpc('console_create_workspace', { p_workspace_id: input.workspaceId,
      p_member_id: input.memberId, p_user_id: input.userId, p_name: input.name,
      p_repository: input.repository, p_owner_name: input.owner });
    if (error) throw error;
  },
  async join(input: { codeHash: string; userId: string; memberId: string; name: string }) {
    const { data, error } = await admin.rpc('console_consume_invite', { p_code_hash: input.codeHash,
      p_user_id: input.userId, p_member_id: input.memberId, p_name: input.name });
    if (error?.message.includes('Invitation expired or used.') || error?.message.includes('Already a member.')) return null;
    if (error) throw error;
    return data as string;
  },
  async read(workspaceId: string, userId: string) {
    const membership = await admin.from('console_members').select('member_id').eq('workspace_id', workspaceId).eq('user_id', userId).maybeSingle();
    if (membership.error) throw membership.error;
    if (!membership.data) return null;
    const workspace = await admin.from('console_workspaces').select('state').eq('id', workspaceId).single();
    if (workspace.error) throw workspace.error;
    return { state: workspace.data.state, memberId: membership.data.member_id as string };
  },
  async invite(input: { workspaceId: string; codeHash: string; role: 'reviewer' | 'contributor'; expiresAt: string }) {
    const { error } = await admin.from('console_invites').insert({ code_hash: input.codeHash,
      workspace_id: input.workspaceId, role: input.role, expires_at: input.expiresAt });
    if (error) throw error;
  },
  async compareAndSwap(workspaceId: string, revision: number, next: unknown) {
    const { data, error } = await admin.rpc('console_compare_and_swap', { p_workspace_id: workspaceId,
      p_revision: revision, p_state: next });
    if (error) throw error;
    return data as boolean;
  },
};

export async function serve(request: Request) {
  const headers = { 'content-type': 'application/json', 'access-control-allow-origin': '*',
    'access-control-allow-headers': 'authorization, apikey, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const authorization = request.headers.get('authorization') ?? '';
  const jwt = authorization.replace(/^Bearer /i, '');
  const client = createClient(projectUrl, publishableKey, { global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false } });
  const { data, error } = await client.auth.getUser(jwt);
  if (error || !data.user) return Response.json({ error: 'Sign in before connecting to a workspace.' }, { status: 401, headers });
  const url = new URL(request.url);
  const path = url.pathname.replace(/^.*?\/console-connect/, '') || '/';
  let body: unknown;
  if (request.method === 'POST') {
    try { body = await request.json(); }
    catch { return Response.json({ error: 'Send valid JSON.' }, { status: 400, headers }); }
  }
  const result = await handleHostedRequest({ method: request.method, path, userId: data.user.id,
    workspaceId: url.searchParams.get('workspaceId'), body }, store, providers);
  return Response.json(result.data, { status: result.status, headers });
}
