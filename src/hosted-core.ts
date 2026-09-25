import { z } from 'zod';
import { applyCommand } from './coordination/_internal/commands';
import { commandSchema, presenceSchema, presenceView, RequestError, snapshot, type Decision, type PresenceRecord, type WorkspaceState } from './coordination/_internal/protocol';
import { repositoryIdentity } from './repository';
import type { PullRequestStatus } from './github';
export { renderDecisionDocument } from './decision-document';

export interface HostedStore {
  create(input: { workspaceId: string; memberId: string; userId: string; name: string; repository: string; owner: string }): Promise<void>;
  join(input: { codeHash: string; userId: string; memberId: string; name: string; githubUserId?: string }): Promise<string | null>;
  list(userId: string): Promise<Array<{ id: string; name: string; repository: string }>>;
  read(workspaceId: string, userId: string): Promise<{ state: WorkspaceState; memberId: string } | null>;
  invite(input: { workspaceId: string; codeHash: string; role: 'reviewer' | 'contributor'; expiresAt: string; githubUserId?: string }): Promise<void>;
  compareAndSwap(workspaceId: string, revision: number, next: WorkspaceState): Promise<boolean>;
  /** Presence heartbeats live outside the revisioned state (roadmap 3.1). */
  setPresence(workspaceId: string, record: PresenceRecord): Promise<void>;
  listPresence(workspaceId: string): Promise<PresenceRecord[]>;
}

export interface HostedProviders {
  verifyDecision(repository: string, decision: Decision, commitSha: string): Promise<boolean>;
  lookupPullRequest(url: string): Promise<PullRequestStatus>;
  resolveGithubUser(username: string): Promise<{ id: string; login: string } | null>;
  inviteCollaborator(repository: string, username: string): Promise<'pending' | 'already-member'>;
}

export interface HostedRequest {
  method: string; path: string; userId: string; githubUserId?: string; workspaceId?: string | null; body?: unknown;
}

async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function invitationCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

const workspaceIdSchema = z.string().uuid();
const createSchema = z.object({ name: z.string().trim().min(1).max(160), repository: z.string().trim().min(1), owner: z.string().trim().min(1).max(80) });
const joinSchema = z.object({ code: z.string().min(1).max(100), name: z.string().trim().min(1).max(80) });
const inviteSchema = z.object({ role: z.enum(['reviewer', 'contributor']),
  githubUsername: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/).optional(),
  repositoryAccess: z.boolean().default(false) });

export async function handleHostedRequest(request: HostedRequest, store: HostedStore, providers: HostedProviders): Promise<{ status: number; data: unknown }> {
  try {
    if (!request.userId) throw new RequestError(401, 'Sign in before connecting to a workspace.');
    if (request.method === 'POST' && request.path === '/create') {
      const input = createSchema.parse(request.body);
      let repositoryUrl: URL;
      try { repositoryUrl = new URL(input.repository); }
      catch { throw new RequestError(400, 'Choose an HTTPS github.com repository URL for hosted workspaces.'); }
      if (repositoryUrl.protocol !== 'https:' || repositoryUrl.hostname !== 'github.com'
        || repositoryUrl.pathname.split('/').filter(Boolean).length !== 2 || !repositoryIdentity(input.repository)) {
        throw new RequestError(400, 'Choose an HTTPS github.com repository URL for hosted workspaces.');
      }
      const workspaceId = crypto.randomUUID();
      const memberId = crypto.randomUUID();
      await store.create({ ...input, workspaceId, memberId, userId: request.userId });
      return { status: 200, data: { workspaceId, memberId } };
    }
    if (request.method === 'POST' && request.path === '/join') {
      const input = joinSchema.parse(request.body);
      const workspaceId = await store.join({ codeHash: await digest(input.code), userId: request.userId,
        memberId: crypto.randomUUID(), name: input.name, githubUserId: request.githubUserId });
      if (!workspaceId) throw new RequestError(403, 'This invitation has expired or has already been used.');
      return { status: 200, data: { workspaceId } };
    }
    if (request.method === 'GET' && request.path === '/workspaces') {
      return { status: 200, data: { workspaces: await store.list(request.userId) } };
    }
    const workspaceId = workspaceIdSchema.parse(request.workspaceId);
    const current = await store.read(workspaceId, request.userId);
    if (!current) throw new RequestError(403, 'You are not a member of this workspace.');
    const actor = current.state.members.find(member => member.id === current.memberId);
    if (!actor) throw new RequestError(403, 'Workspace membership is invalid.');
    if (request.method === 'GET' && request.path === '/state') {
      const presence = presenceView(await store.listPresence(workspaceId), current.state.members.map(member => member.id), Date.now());
      return { status: 200, data: { ...snapshot(current.state, actor.id), sharedTerminalTaskIds: presence.flatMap(item => item.console?.shared && item.console.taskId ? [item.console.taskId] : []), presence } };
    }
    if (request.method === 'POST' && request.path === '/presence') {
      await store.setPresence(workspaceId, { ...presenceSchema.parse(request.body), memberId: actor.id, at: new Date().toISOString() });
      return { status: 200, data: { ok: true } };
    }
    if (request.method === 'POST' && request.path === '/invites') {
      if (actor.role !== 'owner') throw new RequestError(403, 'Only the host can invite members.');
      const input = inviteSchema.parse(request.body);
      if (input.repositoryAccess && (input.role !== 'contributor' || !input.githubUsername)) {
        throw new RequestError(400, 'Repository access requires a contributor and GitHub username.');
      }
      const githubUser = input.githubUsername ? await providers.resolveGithubUser(input.githubUsername) : null;
      if (input.githubUsername && !githubUser) throw new RequestError(400, 'GitHub username not found.');
      const code = invitationCode();
      await store.invite({ workspaceId, codeHash: await digest(code), role: input.role,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), githubUserId: githubUser?.id });
      let repositoryInvite: 'not-requested' | 'pending' | 'already-member' | 'failed' = 'not-requested';
      if (input.repositoryAccess && githubUser) {
        try { repositoryInvite = await providers.inviteCollaborator(current.state.workspace.repository, githubUser.login); }
        catch { repositoryInvite = 'failed'; }
      }
      return { status: 200, data: { code, githubUsername: githubUser?.login, repositoryInvite } };
    }
    if (request.method === 'POST' && request.path === '/commands') {
      const command = commandSchema.parse(request.body);
      for (let attempt = 0; attempt < 4; attempt++) {
        const latest = attempt === 0 ? current : await store.read(workspaceId, request.userId);
        if (!latest) throw new RequestError(403, 'You are not a member of this workspace.');
        const member = latest.state.members.find(item => item.id === latest.memberId);
        if (!member) throw new RequestError(403, 'Workspace membership is invalid.');
        const commandDigest = await digest(JSON.stringify(command));
        const prior = latest.state.appliedCommands[command.id];
        if (prior) {
          if (prior.actorId !== member.id || prior.digest !== commandDigest) throw new RequestError(409, 'This operation ID was already used.');
          return { status: 200, data: { revision: latest.state.revision } };
        }
        if (command.type === 'approve-decision') {
          if (member.role === 'contributor') throw new RequestError(403, 'Only an owner or reviewer can approve decisions.');
          const decision = latest.state.decisions.find(item => item.id === command.decisionId);
          if (!decision || decision.status !== 'proposed') throw new RequestError(409, 'Decision proposal not found.');
          if (!await providers.verifyDecision(latest.state.workspace.repository, decision, command.commitSha)) {
            throw new RequestError(409, 'The published decision file does not match the proposal.');
          }
        }
        const next = structuredClone(latest.state);
        applyCommand(next, member, command);
        next.revision += 1;
        next.appliedCommands[command.id] = { actorId: member.id, digest: commandDigest };
        if (await store.compareAndSwap(workspaceId, latest.state.revision, next)) return { status: 200, data: { revision: next.revision } };
      }
      throw new RequestError(409, 'The workspace changed. Try this update again.');
    }
    const pullRequest = /^\/pull-request\/([0-9a-f-]{36})$/i.exec(request.path);
    if (request.method === 'GET' && pullRequest) {
      for (let attempt = 0; attempt < 4; attempt++) {
        const latest = attempt === 0 ? current : await store.read(workspaceId, request.userId);
        if (!latest) throw new RequestError(403, 'You are not a member of this workspace.');
        const task = latest.state.tasks.find(item => item.id === pullRequest[1]);
        if (!task) throw new RequestError(404, 'Task not found.');
        const url = task.package?.pullRequestUrl;
        if (!url) throw new RequestError(409, 'This package has no linked pull request.');
        if (repositoryIdentity(url) !== repositoryIdentity(latest.state.workspace.repository)) {
          throw new RequestError(409, 'The pull request belongs to a different repository.');
        }
        const status = await providers.lookupPullRequest(url);
        if (status.url !== url) throw new RequestError(503, 'GitHub returned a different pull request.');
        if (JSON.stringify(task.pullRequestStatus) === JSON.stringify(status)) return { status: 200, data: { ...status, taskStatus: task.status } };
        const next = structuredClone(latest.state);
        const updated = next.tasks.find(item => item.id === task.id)!;
        updated.pullRequestStatus = status;
        if (status.mergedAt && updated.status === 'accepted') updated.status = 'completed';
        updated.revision += 1;
        next.revision += 1;
        if (await store.compareAndSwap(workspaceId, latest.state.revision, next)) {
          return { status: 200, data: { ...status, taskStatus: updated.status } };
        }
      }
      throw new RequestError(409, 'The workspace changed. Check again.');
    }
    throw new RequestError(404, 'Unknown workspace operation.');
  } catch (error) {
    if (error instanceof RequestError) return { status: error.status, data: { error: error.message } };
    if (error instanceof z.ZodError) return { status: 400, data: { error: 'The update has invalid fields.' } };
    if (error instanceof Error && error.message === 'Sign in with the invited GitHub account before joining.') {
      return { status: 403, data: { error: error.message } };
    }
    return { status: 503, data: { error: 'The hosted workspace is unavailable.' } };
  }
}
