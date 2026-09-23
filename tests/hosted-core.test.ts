import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { handleHostedRequest, type HostedProviders, type HostedStore } from '../src/hosted-core';
import type { WorkspaceState } from '../src/coordination/_internal/protocol';

function memoryHostedStore(): HostedStore {
  const workspaces = new Map<string, WorkspaceState>();
  const memberships = new Map<string, string>();
  const invites = new Map<string, { workspaceId: string; role: 'reviewer' | 'contributor'; expiresAt: string }>();
  return {
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
      if (memberships.has(`${invite.workspaceId}:${input.userId}`)) return null;
      const state = workspaces.get(invite.workspaceId)!;
      state.members.push({ id: input.memberId, name: input.name, role: invite.role });
      state.revision += 1;
      memberships.set(`${invite.workspaceId}:${input.userId}`, input.memberId);
      invites.delete(input.codeHash);
      return invite.workspaceId;
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
};

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
  expect((await handleHostedRequest({ method: 'GET', path: '/state', userId: samUser, workspaceId }, store, providers)).status).toBe(403);
  const invite = await handleHostedRequest({ method: 'POST', path: '/invites', userId: ownerUser, workspaceId,
    body: { role: 'reviewer' } }, store, providers);
  const code = (invite.data as { code: string }).code;
  expect((await handleHostedRequest({ method: 'POST', path: '/join', userId: samUser,
    body: { code, name: 'Sam' } }, store, providers)).status).toBe(200);
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
