import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startHost } from '../src/coordination';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function workspace() {
  const directory = await mkdtemp(join(tmpdir(), 'console-connect-test-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const host = await startHost({ directory, name: 'Team', repository: 'https://github.com/example/project', owner: 'Alex' });
  cleanup.push(host.close);
  return { ...host, directory };
}

async function api(url: string, token: string, path: string, body?: unknown) {
  const response = await fetch(`${url}${path}`, {
    method: body ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, data: await response.json() };
}

async function teammate(url: string, token: string, role: 'reviewer' | 'contributor' = 'reviewer') {
  const invite = await api(url, token, '/invites', { role });
  const joined = await api(url, '', '/join', { code: invite.data.code, name: 'Sam' });
  expect(joined.status).toBe(200);
  return joined.data as { token: string; memberId: string };
}

test('an assignment requires its recipient to approve before work can start', async () => {
  const host = await workspace();
  const sam = await teammate(host.url, host.token);
  const taskId = randomUUID();
  const send = (token: string, command: object) => api(host.url, token, '/commands', { id: randomUUID(), ...command });
  expect((await send(host.token, { type: 'create-task', taskId, title: 'Build login', description: 'Add a login form', assigneeId: sam.memberId })).status).toBe(200);
  expect((await send(sam.token, { type: 'start-task', taskId, revision: 1, tool: 'codex' })).status).toBe(409);
  expect((await send(host.token, { type: 'approve-task', taskId, revision: 1 })).status).toBe(403);
  expect((await send(sam.token, { type: 'approve-task', taskId, revision: 1 })).status).toBe(200);
  expect((await send(sam.token, { type: 'start-task', taskId, revision: 2, tool: 'codex' })).status).toBe(200);
  const state = await api(host.url, host.token, '/state');
  expect(state.data.tasks[0]).toMatchObject({ id: taskId, status: 'running', tool: 'codex', assigneeId: sam.memberId });
});

test('members and accepted assignments survive a host restart', async () => {
  const host = await workspace();
  const sam = await teammate(host.url, host.token);
  const taskId = randomUUID();
  await api(host.url, host.token, '/commands', { id: randomUUID(), type: 'create-task', taskId,
    title: 'Build login', description: 'Add the login form', assigneeId: sam.memberId });
  await api(host.url, sam.token, '/commands', { id: randomUUID(), type: 'approve-task', taskId, revision: 1 });
  await host.close();
  const restarted = await startHost({ directory: host.directory, name: 'Ignored on restart', repository: 'unchanged', owner: 'Alex' });
  cleanup.push(restarted.close);
  const result = await api(restarted.url, sam.token, '/state');
  expect(result.status).toBe(200);
  expect(result.data.workspace.name).toBe('Team');
  expect(result.data.tasks[0]).toMatchObject({ id: taskId, status: 'ready', revision: 2 });
});

test('the owner submits a package for independent review, and command retries are safe', async () => {
  const host = await workspace();
  const sam = await teammate(host.url, host.token);
  const taskId = randomUUID();
  const send = (token: string, command: object) => api(host.url, token, '/commands', { id: randomUUID(), ...command });
  await send(host.token, { type: 'create-task', taskId, title: 'Build login', description: 'Add login', assigneeId: sam.memberId });
  await send(sam.token, { type: 'approve-task', taskId, revision: 1 });
  await send(sam.token, { type: 'start-task', taskId, revision: 2, tool: 'codex' });
  const draft = { type: 'save-package', taskId, revision: 3, summary: 'Login added', sourceRef: `console-connect/${taskId}`, deliverables: ['login.ts'], verification: 'Tests pass', questions: '' };
  expect((await send(host.token, draft)).status).toBe(403);
  expect((await send(sam.token, draft)).status).toBe(200);
  const beforeSubmit = await api(host.url, host.token, '/state');
  expect(beforeSubmit.data.tasks[0].draftPackage).toBeUndefined();
  expect(beforeSubmit.data.tasks[0].package).toBeUndefined();
  const ownerDraft = await api(host.url, sam.token, '/state');
  expect(ownerDraft.data.tasks[0].draftPackage.summary).toBe('Login added');
  const submit = { id: randomUUID(), type: 'submit-package', taskId, revision: 4 };
  expect((await api(host.url, sam.token, '/commands', submit)).status).toBe(200);
  expect((await api(host.url, sam.token, '/commands', submit)).status).toBe(200);
  expect((await send(sam.token, { type: 'accept-package', taskId, revision: 5 })).status).toBe(403);
  expect((await send(host.token, { type: 'accept-package', taskId, revision: 5 })).status).toBe(200);
  const state = await api(host.url, host.token, '/state');
  expect(state.data.tasks[0]).toMatchObject({ status: 'accepted', revision: 6, package: { summary: 'Login added' } });
});

test('a second client receives committed revisions through the live event stream', async () => {
  const host = await workspace();
  const sam = await teammate(host.url, host.token);
  const controller = new AbortController();
  const stream = await fetch(`${host.url}/events`, { headers: { authorization: `Bearer ${sam.token}` }, signal: controller.signal });
  expect(stream.status).toBe(200);
  const reader = stream.body!.getReader();
  const taskId = randomUUID();
  await api(host.url, host.token, '/commands', { id: randomUUID(), type: 'create-task', taskId,
    title: 'Build login', description: '', assigneeId: sam.memberId });
  const { value } = await reader.read();
  expect(new TextDecoder().decode(value)).toContain('"revision":3');
  controller.abort();
});

test('review changes can be requested and a retried submission survives restart', async () => {
  const host = await workspace();
  const sam = await teammate(host.url, host.token);
  const taskId = randomUUID();
  const send = (token: string, command: object) => api(host.url, token, '/commands', { id: randomUUID(), ...command });
  await send(host.token, { type: 'create-task', taskId, title: 'Build login', description: '', assigneeId: sam.memberId });
  await send(sam.token, { type: 'approve-task', taskId, revision: 1 });
  await send(sam.token, { type: 'start-task', taskId, revision: 2, tool: 'claude' });
  await send(sam.token, { type: 'save-package', taskId, revision: 3, summary: 'First pass', sourceRef: `console-connect/${taskId}`, deliverables: [], verification: '', questions: '' });
  const submit = { id: randomUUID(), type: 'submit-package', taskId, revision: 4 };
  await api(host.url, sam.token, '/commands', submit);
  await host.close();
  const restarted = await startHost({ directory: host.directory, name: 'Ignored', repository: '', owner: 'Alex' });
  cleanup.push(restarted.close);
  expect((await api(restarted.url, sam.token, '/commands', submit)).status).toBe(200);
  const changes = await api(restarted.url, restarted.token, '/commands', { id: randomUUID(), type: 'request-changes', taskId, revision: 5, note: 'Add an error state' });
  expect(changes.status).toBe(200);
  const state = await api(restarted.url, sam.token, '/state');
  expect(state.data.tasks[0]).toMatchObject({ status: 'changes_requested', revision: 6, package: { reviewNote: 'Add an error state' } });
});

test('members can discuss a task and everyone sees the message', async () => {
  const host = await workspace();
  const sam = await teammate(host.url, host.token);
  const taskId = randomUUID();
  await api(host.url, host.token, '/commands', { id: randomUUID(), type: 'create-task', taskId, title: 'Build login', description: '', assigneeId: sam.memberId });
  const posted = await api(host.url, sam.token, '/commands', { id: randomUUID(), type: 'post-message', taskId, body: 'Should the form support SSO?' });
  expect(posted.status).toBe(200);
  const state = await api(host.url, host.token, '/state');
  expect(state.data.messages).toMatchObject([{ authorId: sam.memberId, taskId, body: 'Should the form support SSO?' }]);
});

test('members can post and read workspace-wide messages without a task', async () => {
  const host = await workspace();
  const sam = await teammate(host.url, host.token);
  const posted = await api(host.url, sam.token, '/commands', { id: randomUUID(), type: 'post-message', body: 'Who can review today?' });
  expect(posted.status).toBe(200);
  const state = await api(host.url, host.token, '/state');
  expect(state.data.messages).toMatchObject([{ authorId: sam.memberId, body: 'Who can review today?' }]);
  expect(state.data.messages[0].taskId).toBeUndefined();
});

test('replies, edits, and unsends keep authorship and conversation boundaries', async () => {
  const host = await workspace();
  const sam = await teammate(host.url, host.token);
  const send = (token: string, command: object) => api(host.url, token, '/commands', { id: randomUUID(), ...command });
  const messageId = randomUUID();
  expect((await api(host.url, host.token, '/commands', { id: messageId, type: 'post-message', body: 'First draft' })).status).toBe(200);
  expect((await send(sam.token, { type: 'edit-message', messageId, version: 1, body: 'Changed by Sam' })).status).toBe(403);
  expect((await send(host.token, { type: 'edit-message', messageId, version: 1, body: 'Updated draft' })).status).toBe(200);
  expect((await send(host.token, { type: 'edit-message', messageId, version: 1, body: 'Stale draft' })).status).toBe(409);
  const replyId = randomUUID();
  expect((await api(host.url, sam.token, '/commands', { id: replyId, type: 'post-message', replyToId: messageId,
    body: 'I can review it.' })).status).toBe(200);
  const taskId = randomUUID();
  await send(host.token, { type: 'create-task', taskId, title: 'Check chat', description: '', assigneeId: null });
  expect((await send(sam.token, { type: 'post-message', taskId, replyToId: messageId, body: 'Wrong thread' })).status).toBe(400);
  expect((await send(host.token, { type: 'unsend-message', messageId, version: 2 })).status).toBe(200);
  expect((await send(host.token, { type: 'edit-message', messageId, version: 3, body: 'Bring it back' })).status).toBe(409);
  const state = await api(host.url, sam.token, '/state');
  expect(state.data.messages).toMatchObject([
    { id: messageId, body: '', authorId: state.data.members[0].id, version: 3 },
    { id: replyId, replyToId: messageId, body: 'I can review it.', authorId: sam.memberId },
  ]);
  expect(state.data.messages[0].deletedAt).toBeTruthy();
});

test('unassigned work can be claimed or assigned with recipient approval', async () => {
  const host = await workspace();
  const sam = await teammate(host.url, host.token);
  const first = randomUUID();
  const second = randomUUID();
  const send = (token: string, command: object) => api(host.url, token, '/commands', { id: randomUUID(), ...command });
  await send(host.token, { type: 'create-task', taskId: first, title: 'Claim me', description: '', assigneeId: null });
  expect((await send(sam.token, { type: 'claim-task', taskId: first, revision: 1 })).status).toBe(200);
  expect((await send(sam.token, { type: 'start-task', taskId: first, revision: 2, tool: 'codex' })).status).toBe(200);
  await send(host.token, { type: 'create-task', taskId: second, title: 'Assign me', description: '', assigneeId: null });
  expect((await send(host.token, { type: 'assign-task', taskId: second, revision: 1, assigneeId: sam.memberId })).status).toBe(200);
  expect((await send(sam.token, { type: 'start-task', taskId: second, revision: 2, tool: 'codex' })).status).toBe(409);
  expect((await send(sam.token, { type: 'approve-task', taskId: second, revision: 2 })).status).toBe(200);
});

test('an accepted coding task completes only after its linked pull request merges', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'console-connect-pr-test-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const pullRequestUrl = 'https://github.com/example/project/pull/42';
  let mergedAt: string | null = null;
  const lookupPullRequest = async () => ({ url: pullRequestUrl, state: mergedAt ? 'MERGED' as const : 'OPEN' as const,
    reviewDecision: mergedAt ? 'APPROVED' : 'REVIEW_REQUIRED', mergedAt });
  const host = await startHost({ directory, name: 'Team', repository: 'https://github.com/example/project',
    owner: 'Alex', lookupPullRequest });
  cleanup.push(host.close);
  const sam = await teammate(host.url, host.token);
  const taskId = randomUUID();
  const send = (token: string, command: object) => api(host.url, token, '/commands', { id: randomUUID(), ...command });
  await send(host.token, { type: 'create-task', taskId, title: 'Build login', description: '', assigneeId: sam.memberId });
  await send(sam.token, { type: 'approve-task', taskId, revision: 1 });
  await send(sam.token, { type: 'start-task', taskId, revision: 2, tool: 'codex' });
  await send(sam.token, { type: 'save-package', taskId, revision: 3, summary: 'Done', sourceRef: `console-connect/${taskId}`,
    pullRequestUrl, deliverables: [], verification: '', questions: '' });
  await send(sam.token, { type: 'submit-package', taskId, revision: 4 });
  expect((await api(host.url, host.token, `/pull-request/${taskId}`)).data.state).toBe('OPEN');
  expect((await send(host.token, { type: 'accept-package', taskId, revision: 6 })).status).toBe(200);
  expect((await api(host.url, host.token, '/state')).data.tasks[0].status).toBe('accepted');
  mergedAt = '2026-09-23T01:00:00Z';
  expect((await api(host.url, host.token, `/pull-request/${taskId}`)).data.state).toBe('MERGED');
  expect((await api(host.url, host.token, '/state')).data.tasks[0].status).toBe('completed');
});

test('a pull request from another repository cannot complete a task', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'console-connect-pr-boundary-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  let lookedUp = false;
  const host = await startHost({ directory, name: 'Team', repository: 'https://github.com/example/project', owner: 'Alex',
    lookupPullRequest: async url => { lookedUp = true; return { url, state: 'MERGED', reviewDecision: '', mergedAt: '2026-09-23T01:00:00Z' }; } });
  cleanup.push(host.close);
  const sam = await teammate(host.url, host.token);
  const taskId = randomUUID();
  const send = (token: string, command: object) => api(host.url, token, '/commands', { id: randomUUID(), ...command });
  await send(host.token, { type: 'create-task', taskId, title: 'Build login', description: '', assigneeId: sam.memberId });
  await send(sam.token, { type: 'approve-task', taskId, revision: 1 });
  await send(sam.token, { type: 'start-task', taskId, revision: 2, tool: 'codex' });
  await send(sam.token, { type: 'save-package', taskId, revision: 3, summary: 'Done', sourceRef: `console-connect/${taskId}`,
    pullRequestUrl: 'https://github.com/other/project/pull/1', deliverables: [], verification: '', questions: '' });
  await send(sam.token, { type: 'submit-package', taskId, revision: 4 });
  expect((await api(host.url, host.token, `/pull-request/${taskId}`)).status).toBe(409);
  expect(lookedUp).toBe(false);
});

test('a member can propose a shared decision without making it official', async () => {
  const host = await workspace();
  const sam = await teammate(host.url, host.token);
  const decisionId = randomUUID();
  const proposed = await api(host.url, sam.token, '/commands', { id: randomUUID(), type: 'propose-decision', decisionId,
    title: 'Use OAuth', body: 'Use OAuth for sign-in.' });
  expect(proposed.status).toBe(200);
  const state = await api(host.url, host.token, '/state');
  expect(state.data.decisions).toMatchObject([{ id: decisionId, title: 'Use OAuth', status: 'proposed', proposedBy: sam.memberId }]);
});

test('a decision becomes official only after its exact Markdown is verified on GitHub', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'console-connect-decision-host-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  let published = false;
  const host = await startHost({ directory, name: 'Team', repository: 'https://github.com/example/project', owner: 'Alex',
    verifyDecisionDocument: async () => published });
  cleanup.push(host.close);
  const sam = await teammate(host.url, host.token, 'contributor');
  const decisionId = randomUUID();
  const send = (token: string, command: object) => api(host.url, token, '/commands', { id: randomUUID(), ...command });
  await send(sam.token, { type: 'propose-decision', decisionId, title: 'Use OAuth', body: 'Use OAuth for sign-in.' });
  const commitSha = 'a'.repeat(40);
  expect((await send(sam.token, { type: 'approve-decision', decisionId, commitSha })).status).toBe(403);
  expect((await send(host.token, { type: 'approve-decision', decisionId, commitSha })).status).toBe(409);
  expect((await api(host.url, host.token, '/state')).data.decisions[0].status).toBe('proposed');
  published = true;
  expect((await send(host.token, { type: 'approve-decision', decisionId, commitSha })).status).toBe(200);
  expect((await api(host.url, sam.token, '/state')).data.decisions[0]).toMatchObject({ status: 'official', documentCommit: commitSha });
});

test('a changed decision requires affected task owners to acknowledge before submission', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'console-connect-decision-change-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const host = await startHost({ directory, name: 'Team', repository: 'https://github.com/example/project', owner: 'Alex',
    verifyDecisionDocument: async () => true });
  cleanup.push(host.close);
  const sam = await teammate(host.url, host.token);
  const send = (token: string, command: object) => api(host.url, token, '/commands', { id: randomUUID(), ...command });
  const taskId = randomUUID();
  await send(host.token, { type: 'create-task', taskId, title: 'Build login', description: '', assigneeId: sam.memberId });
  await send(sam.token, { type: 'approve-task', taskId, revision: 1 });
  await send(sam.token, { type: 'start-task', taskId, revision: 2, tool: 'codex' });
  await send(sam.token, { type: 'save-package', taskId, revision: 3, summary: 'Done', sourceRef: `console-connect/${taskId}`,
    deliverables: [], verification: '', questions: '' });
  const first = randomUUID();
  await send(host.token, { type: 'propose-decision', decisionId: first, title: 'Use passwords', body: 'Use passwords.' });
  await send(host.token, { type: 'approve-decision', decisionId: first, commitSha: 'a'.repeat(40) });
  const changed = randomUUID();
  await send(host.token, { type: 'propose-decision', decisionId: changed, title: 'Use OAuth', body: 'Use OAuth instead.',
    supersedesId: first, affectedTaskIds: [taskId] });
  await send(host.token, { type: 'approve-decision', decisionId: changed, commitSha: 'b'.repeat(40) });
  expect((await send(sam.token, { type: 'submit-package', taskId, revision: 5 })).status).toBe(409);
  expect((await send(host.token, { type: 'acknowledge-decision', taskId, revision: 5, decisionId: changed })).status).toBe(403);
  expect((await send(sam.token, { type: 'acknowledge-decision', taskId, revision: 5, decisionId: changed })).status).toBe(200);
  expect((await send(sam.token, { type: 'submit-package', taskId, revision: 6 })).status).toBe(200);
  const state = await api(host.url, sam.token, '/state');
  expect(state.data.decisions.find((item: { id: string }) => item.id === first).status).toBe('superseded');
  expect(state.data.tasks[0].pendingDecisionIds).toEqual([]);
});

test('terminal output is shared only after the session owner opts in, and viewers cannot write', async () => {
  const host = await workspace();
  const sam = await teammate(host.url, host.token);
  const taskId = randomUUID();
  const send = (token: string, command: object) => api(host.url, token, '/commands', { id: randomUUID(), ...command });
  await send(host.token, { type: 'create-task', taskId, title: 'Build login', description: '', assigneeId: sam.memberId });
  await send(sam.token, { type: 'approve-task', taskId, revision: 1 });
  await send(sam.token, { type: 'start-task', taskId, revision: 2, tool: 'codex' });
  expect((await api(host.url, host.token, `/terminal/${taskId}/share`, { enabled: true })).status).toBe(403);
  expect((await fetch(`${host.url}/terminal/${taskId}/events`, { headers: { authorization: `Bearer ${host.token}` } })).status).toBe(409);
  expect((await api(host.url, sam.token, `/terminal/${taskId}/share`, { enabled: true })).status).toBe(200);
  const controller = new AbortController();
  const stream = await fetch(`${host.url}/terminal/${taskId}/events`, { headers: { authorization: `Bearer ${host.token}` }, signal: controller.signal });
  expect(stream.status).toBe(200);
  expect((await api(host.url, host.token, `/terminal/${taskId}/output`, { chunk: 'forged' })).status).toBe(403);
  expect((await api(host.url, sam.token, `/terminal/${taskId}/output`, { chunk: 'hello' })).status).toBe(200);
  const { value } = await stream.body!.getReader().read();
  expect(new TextDecoder().decode(value)).toContain('hello');
  controller.abort();
  await api(host.url, sam.token, `/terminal/${taskId}/share`, { enabled: false });
});
