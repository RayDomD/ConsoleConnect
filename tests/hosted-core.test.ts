import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { handleHostedRequest, type HostedProviders, type HostedStore } from '../src/hosted-core';
import type { PresenceRecord, WorkspaceState } from '../src/coordination/_internal/protocol';

function memoryHostedStore(): HostedStore {
  const workspaces = new Map<string, WorkspaceState>();
  const memberships = new Map<string, string>();
  const invites = new Map<string, { workspaceId: string; role: 'reviewer' | 'contributor'; expiresAt: string; githubUserId?: string }>();
  const presence = new Map<string, PresenceRecord>();
  return {
    async setPresence(workspaceId, record) { presence.set(`${workspaceId}:${record.memberId}`, record); },
    async listPresence(workspaceId) { return [...presence.entries()].filter(([key]) => key.startsWith(`${workspaceId}:`)).map(([, record]) => record); },
    async create(input) {
      const state: WorkspaceState = { workspace: { id: input.workspaceId, name: input.name, repository: input.repository },
        revision: 1, members: [{ id: input.memberId, name: input.owner, role: 'owner' }], tasks: [], messages: [], decisions: [],
        credentials: {}, invites: {}, appliedCommands: {} };
      workspaces.set(input.workspaceId, state);
      memberships.set(`${input.workspaceId}:${input.userId}`, input.memberId);
    },
    async join(input) {
      const invite = invites.get(input.codeHash);
      if (!invite || new Date(invite.expiresAt).getTime() < Date.now()) return null;
      if (invite.githubUserId && invite.githubUserId !== input.githubUserId) {
        throw new Error('Sign in with the invited GitHub account before joining.');
      }
      if (memberships.has(`${invite.workspaceId}:${input.userId}`)) return null;
      const state = workspaces.get(invite.workspaceId)!;
      state.members.push({ id: input.memberId, name: input.name, role: invite.role });
      state.revision += 1;
      memberships.set(`${invite.workspaceId}:${input.userId}`, input.memberId);
      invites.delete(input.codeHash);
      return invite.workspaceId;
    },
    async list(userId) {
      return [...workspaces.entries()].filter(([id]) => memberships.has(`${id}:${userId}`))
        .map(([id, state]) => ({ id, name: state.workspace.name, repository: state.workspace.repository }));
    },
    async read(workspaceId, userId) {
      const memberId = memberships.get(`${workspaceId}:${userId}`);
      const state = workspaces.get(workspaceId);
      return memberId && state ? { state: structuredClone(state), memberId } : null;
    },
    async invite(input) { invites.set(input.codeHash, input); },
    async compareAndSwap(workspaceId, revision, next) {
      if (workspaces.get(workspaceId)?.revision !== revision) return false;
      workspaces.set(workspaceId, structuredClone(next));
      return true;
    },
  };
}

const providers: HostedProviders = {
  verifyDecision: async () => true,
  lookupPullRequest: async url => ({ url, state: 'OPEN', reviewDecision: null, mergedAt: null }),
  resolveGithubUser: async username => ({ id: '12345', login: username }),
  inviteCollaborator: async () => 'pending',
};

test('hosted chat applies the same reply, edit, and unsend rules', async () => {
  const store = memoryHostedStore();
  const ownerUser = randomUUID();
  const samUser = randomUUID();
  const create = await handleHostedRequest({ method: 'POST', path: '/create', userId: ownerUser,
    body: { name: 'Team', repository: 'https://github.com/example/repo', owner: 'Alex' } }, store, providers);
  const workspaceId = (create.data as { workspaceId: string }).workspaceId;
  const invite = await handleHostedRequest({ method: 'POST', path: '/invites', userId: ownerUser, workspaceId,
    body: { role: 'reviewer' } }, store, providers);
  await handleHostedRequest({ method: 'POST', path: '/join', userId: samUser,
    body: { code: (invite.data as { code: string }).code, name: 'Sam' } }, store, providers);
  const send = (userId: string, command: object) => handleHostedRequest({ method: 'POST', path: '/commands',
    userId, workspaceId, body: { id: randomUUID(), ...command } }, store, providers);
  const messageId = randomUUID();
  expect((await handleHostedRequest({ method: 'POST', path: '/commands', userId: ownerUser, workspaceId,
    body: { id: messageId, type: 'post-message', body: 'Please review' } }, store, providers)).status).toBe(200);
  expect((await send(samUser, { type: 'edit-message', messageId, version: 1, body: 'Changed' })).status).toBe(403);
  expect((await send(samUser, { type: 'post-message', replyToId: messageId, body: 'On it' })).status).toBe(200);
  expect((await send(ownerUser, { type: 'edit-message', messageId, version: 1, body: 'Please review today' })).status).toBe(200);
  expect((await send(ownerUser, { type: 'unsend-message', messageId, version: 2 })).status).toBe(200);
  const state = await handleHostedRequest({ method: 'GET', path: '/state', userId: samUser, workspaceId }, store, providers);
  const messages = (state.data as { messages: Array<{ id: string; body: string; deletedAt?: string; replyToId?: string }> }).messages;
  expect(messages[0]).toMatchObject({ id: messageId, body: '' });
  expect(messages[0]?.deletedAt).toBeTruthy();
  expect(messages[1]?.replyToId).toBe(messageId);
});

test('GitHub-bound workspace invitations require the invited identity and report repository access separately', async () => {
  const store = memoryHostedStore();
  const ownerUser = randomUUID();
  const create = await handleHostedRequest({ method: 'POST', path: '/create', userId: ownerUser,
    body: { name: 'Team', repository: 'https://github.com/example/repo', owner: 'Alex' } }, store, providers);
  const workspaceId = (create.data as { workspaceId: string }).workspaceId;
  const invalid = await handleHostedRequest({ method: 'POST', path: '/invites', userId: ownerUser, workspaceId,
    body: { role: 'reviewer', githubUsername: 'sam', repositoryAccess: true } }, store, providers);
  expect(invalid.status).toBe(400);
  const unknown = await handleHostedRequest({ method: 'POST', path: '/invites', userId: ownerUser, workspaceId,
    body: { role: 'reviewer', githubUsername: 'missing' } }, store,
    { ...providers, resolveGithubUser: async () => null });
  expect(unknown.status).toBe(400);
  const invite = await handleHostedRequest({ method: 'POST', path: '/invites', userId: ownerUser, workspaceId,
    body: { role: 'contributor', githubUsername: 'sam', repositoryAccess: true } }, store, providers);
  expect(invite.status).toBe(200);
  expect(invite.data).toMatchObject({ githubUsername: 'sam', repositoryInvite: 'pending' });
  const code = (invite.data as { code: string }).code;
  const join = (githubUserId?: string) => handleHostedRequest({ method: 'POST', path: '/join',
    userId: randomUUID(), githubUserId, body: { code, name: 'Sam' } }, store, providers);
  expect((await join()).status).toBe(403);
  expect((await join('wrong')).status).toBe(403);
  expect((await join('12345')).status).toBe(200);
  const failed = await handleHostedRequest({ method: 'POST', path: '/invites', userId: ownerUser, workspaceId,
    body: { role: 'contributor', githubUsername: 'sam', repositoryAccess: true } }, store,
    { ...providers, inviteCollaborator: async () => { throw new Error('unavailable'); } });
  expect(failed.data).toMatchObject({ repositoryInvite: 'failed' });
});

test('hosted workspace shares the assignment, approval, retry, and draft privacy rules', async () => {
  const store = memoryHostedStore();
  const ownerUser = randomUUID();
  const samUser = randomUUID();
  expect((await handleHostedRequest({ method: 'POST', path: '/create', userId: ownerUser,
    body: { name: 'Unsafe', repository: 'https://example.net/owner/repo', owner: 'Alex' } }, store, providers)).status).toBe(400);
  const create = await handleHostedRequest({ method: 'POST', path: '/create', userId: ownerUser,
    body: { name: 'Team', repository: 'https://github.com/example/repo', owner: 'Alex' } }, store, providers);
  expect(create.status).toBe(200);
  const workspaceId = (create.data as { workspaceId: string }).workspaceId;
  expect((await handleHostedRequest({ method: 'GET', path: '/workspaces', userId: ownerUser }, store, providers)).data)
    .toEqual({ workspaces: [{ id: workspaceId, name: 'Team', repository: 'https://github.com/example/repo' }] });
  expect((await handleHostedRequest({ method: 'GET', path: '/workspaces', userId: samUser }, store, providers)).data)
    .toEqual({ workspaces: [] });
  expect((await handleHostedRequest({ method: 'GET', path: '/state', userId: samUser, workspaceId }, store, providers)).status).toBe(403);
  const invite = await handleHostedRequest({ method: 'POST', path: '/invites', userId: ownerUser, workspaceId,
    body: { role: 'reviewer' } }, store, providers);
  const code = (invite.data as { code: string }).code;
  expect((await handleHostedRequest({ method: 'POST', path: '/join', userId: samUser,
    body: { code, name: 'Sam' } }, store, providers)).status).toBe(200);
  expect((await handleHostedRequest({ method: 'GET', path: '/workspaces', userId: samUser }, store, providers)).data)
    .toEqual({ workspaces: [{ id: workspaceId, name: 'Team', repository: 'https://github.com/example/repo' }] });
  expect((await handleHostedRequest({ method: 'POST', path: '/join', userId: randomUUID(),
    body: { code, name: 'Other' } }, store, providers)).status).toBe(403);
  const samState = await handleHostedRequest({ method: 'GET', path: '/state', userId: samUser, workspaceId }, store, providers);
  const samMemberId = (samState.data as { memberId: string }).memberId;
  const taskId = randomUUID();
  const createTask = { id: randomUUID(), type: 'create-task', taskId, title: 'Build login', description: '', assigneeId: samMemberId };
  expect((await handleHostedRequest({ method: 'POST', path: '/commands', userId: ownerUser, workspaceId,
    body: createTask }, store, providers)).status).toBe(200);
  expect((await handleHostedRequest({ method: 'POST', path: '/commands', userId: ownerUser, workspaceId,
    body: createTask }, store, providers)).status).toBe(200);
  const start = { id: randomUUID(), type: 'start-task', taskId, revision: 1, tool: 'codex' };
  expect((await handleHostedRequest({ method: 'POST', path: '/commands', userId: samUser, workspaceId,
    body: start }, store, providers)).status).toBe(409);
  expect((await handleHostedRequest({ method: 'POST', path: '/commands', userId: samUser, workspaceId,
    body: { id: randomUUID(), type: 'approve-task', taskId, revision: 1 } }, store, providers)).status).toBe(200);
  expect((await handleHostedRequest({ method: 'POST', path: '/commands', userId: samUser, workspaceId,
    body: { ...start, revision: 2 } }, store, providers)).status).toBe(200);
  const pullRequestUrl = 'https://github.com/example/repo/pull/42';
  expect((await handleHostedRequest({ method: 'POST', path: '/commands', userId: samUser, workspaceId,
    body: { id: randomUUID(), type: 'save-package', taskId, revision: 3,
      summary: 'Login added', sourceRef: 'branch', pullRequestUrl, deliverables: [], verification: '', questions: '' } }, store, providers)).status).toBe(200);
  const ownerState = await handleHostedRequest({ method: 'GET', path: '/state', userId: ownerUser, workspaceId }, store, providers);
  expect((ownerState.data as { tasks: Array<{ draftPackage?: unknown }> }).tasks[0]?.draftPackage).toBeUndefined();
  expect((await handleHostedRequest({ method: 'POST', path: '/commands', userId: samUser, workspaceId,
    body: { id: randomUUID(), type: 'submit-package', taskId, revision: 4 } }, store, providers)).status).toBe(200);
  expect((await handleHostedRequest({ method: 'POST', path: '/commands', userId: samUser, workspaceId,
    body: { id: randomUUID(), type: 'accept-package', taskId, revision: 5 } }, store, providers)).status).toBe(403);
  expect((await handleHostedRequest({ method: 'POST', path: '/commands', userId: ownerUser, workspaceId,
    body: { id: randomUUID(), type: 'accept-package', taskId, revision: 5 } }, store, providers)).status).toBe(200);
  const accepted = await handleHostedRequest({ method: 'GET', path: '/state', userId: ownerUser, workspaceId }, store, providers);
  expect((accepted.data as { tasks: Array<{ status: string }> }).tasks[0]?.status).toBe('accepted');
  const mergedProviders: HostedProviders = { ...providers,
    lookupPullRequest: async url => ({ url, state: 'MERGED', reviewDecision: 'APPROVED', mergedAt: '2026-09-23T00:00:00Z' }) };
  expect((await handleHostedRequest({ method: 'GET', path: `/pull-request/${taskId}`, userId: ownerUser, workspaceId },
    store, mergedProviders)).status).toBe(200);
  const completed = await handleHostedRequest({ method: 'GET', path: '/state', userId: samUser, workspaceId }, store, providers);
  expect((completed.data as { tasks: Array<{ status: string }> }).tasks[0]?.status).toBe('completed');
});

test('hosted presence is kept outside the workspace state, and a shared console is listed for watchers', async () => {
  const store = memoryHostedStore();
  const owner = 'owner-user';
  const created = await handleHostedRequest({ method: 'POST', path: '/create', userId: owner, body: { name: 'Team', repository: 'https://github.com/example/project', owner: 'Alex' } }, store, providers);
  const workspaceId = (created.data as { workspaceId: string }).workspaceId;
  const call = (method: string, path: string, body?: unknown) => handleHostedRequest({ method, path, userId: owner, workspaceId, body }, store, providers);
  const before = ((await call('GET', '/state')).data as { revision: number }).revision;
  const taskId = randomUUID();
  expect((await call('POST', '/presence', { status: 'here', console: { kind: 'task', taskId, tool: 'codex', needsInput: false, shared: true, glimpse: ['npm test'] } })).status).toBe(200);
  expect((await call('POST', '/presence', { status: 'gone', console: null })).status).toBe(400);
  const state = (await call('GET', '/state')).data as { revision: number; presence: Array<{ status: string; console: { glimpse?: string[] } }>; sharedTerminalTaskIds: string[] };
  expect(state.revision).toBe(before);
  expect(state.presence[0]).toMatchObject({ status: 'here', console: { glimpse: ['npm test'] } });
  expect(state.sharedTerminalTaskIds).toEqual([taskId]);
});
