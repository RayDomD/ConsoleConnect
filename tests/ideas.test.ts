import { afterEach, expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { startHost } from '../src/coordination';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

async function team() {
  const directory = await mkdtemp(join(tmpdir(), 'console-connect-ideas-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const host = await startHost({ directory, name: 'Team', repository: 'https://github.com/example/project', owner: 'Alex' });
  cleanup.push(host.close);
  const call = async (token: string, path: string, body?: unknown) => {
    const response = await fetch(`${host.url}${path}`, { method: body ? 'POST' : 'GET',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, data: await response.json() };
  };
  const invite = await call(host.token, '/invites', { role: 'contributor' });
  const sam = (await call('', '/join', { code: invite.data.code, name: 'Sam' })).data as { token: string; memberId: string };
  const send = (token: string, command: object) => call(token, '/commands', { id: randomUUID(), ...command });
  const idea = async (token: string, ideaId: string) => (await call(token, '/state')).data.ideas.find((item: { id: string }) => item.id === ideaId);
  return { host, sam, send, idea, call };
}

test('the size sets the path, and an idea starts at its first stage', async () => {
  const { host, send, idea } = await team();
  const [quick, feature, big] = [randomUUID(), randomUUID(), randomUUID()];
  for (const [ideaId, size] of [[quick, 'quick'], [feature, 'feature'], [big, 'big']]) {
    expect((await send(host.token, { type: 'create-idea', ideaId, title: `A ${size} idea`, size })).status).toBe(200);
  }
  expect((await idea(host.token, quick)).stage).toBe('build');
  expect((await idea(host.token, feature)).stage).toBe('talk');
  expect((await idea(host.token, big)).stage).toBe('talk');
});

test('gates hold an idea until the right role or evidence moves it; skipping is recorded', async () => {
  const { host, sam, send, idea } = await team();
  const ideaId = randomUUID();
  await send(sam.token, { type: 'create-idea', ideaId, title: 'Invite links that expire', size: 'feature' });
  expect((await send(sam.token, { type: 'advance-idea', ideaId, revision: 1 })).data.error).toContain('An Owner or Reviewer must mark it ready');
  expect((await send(sam.token, { type: 'mark-idea-ready', ideaId, revision: 1 })).status).toBe(403);
  expect((await send(host.token, { type: 'mark-idea-ready', ideaId, revision: 1 })).status).toBe(200);
  expect((await send(sam.token, { type: 'advance-idea', ideaId, revision: 2 })).status).toBe(200);
  expect((await idea(host.token, ideaId)).stage).toBe('split');
  expect((await send(sam.token, { type: 'advance-idea', ideaId, revision: 3 })).data.error).toContain('Link at least one task');
  const taskId = randomUUID();
  await send(host.token, { type: 'create-task', taskId, title: 'Expiry check', description: '', assigneeId: sam.memberId });
  expect((await send(sam.token, { type: 'link-idea', ideaId, revision: 3, taskIds: [taskId], document: { stage: 'talk', path: 'docs/ideas/invite-expiry.md' } })).status).toBe(200);
  expect((await send(sam.token, { type: 'advance-idea', ideaId, revision: 4 })).status).toBe(200);
  expect((await send(sam.token, { type: 'advance-idea', ideaId, revision: 5 })).data.error).toContain('Waiting for every linked task to be accepted');
  expect((await send(sam.token, { type: 'skip-idea-stage', ideaId, revision: 5, reason: 'Shipped by hand' })).status).toBe(200);
  const skipped = await idea(host.token, ideaId);
  expect(skipped).toMatchObject({ stage: 'review', skipped: [{ stage: 'build', reason: 'Shipped by hand', by: sam.memberId }],
    documents: [{ stage: 'talk', path: 'docs/ideas/invite-expiry.md' }], taskIds: [taskId] });
});

test('changing the size keeps what was passed; Write it up needs an approved spec decision; the creator or Owner deletes', async () => {
  const { host, sam, send, idea } = await team();
  const ideaId = randomUUID();
  await send(sam.token, { type: 'create-idea', ideaId, title: 'Session timeout', size: 'feature' });
  await send(host.token, { type: 'mark-idea-ready', ideaId, revision: 1 });
  await send(sam.token, { type: 'advance-idea', ideaId, revision: 2 });
  expect((await send(sam.token, { type: 'update-idea', ideaId, revision: 3, size: 'big' })).status).toBe(200);
  expect((await idea(host.token, ideaId)).stage).toBe('write');
  const decisionId = randomUUID();
  await send(sam.token, { type: 'propose-decision', decisionId, title: 'Session timeout spec', body: 'Twelve hours.' });
  await send(sam.token, { type: 'link-idea', ideaId, revision: 4, specDecisionId: decisionId });
  expect((await send(sam.token, { type: 'advance-idea', ideaId, revision: 5 })).data.error).toContain('Approve the spec as a decision first');
  expect((await send(sam.token, { type: 'update-idea', ideaId, revision: 5, size: 'quick' })).status).toBe(200);
  expect((await idea(host.token, ideaId)).stage).toBe('build');
  const other = randomUUID();
  await send(host.token, { type: 'create-idea', ideaId: other, title: 'Owner idea', size: 'quick' });
  expect((await send(sam.token, { type: 'delete-idea', ideaId: other })).status).toBe(403);
  expect((await send(sam.token, { type: 'delete-idea', ideaId })).status).toBe(200);
  expect(await idea(host.token, ideaId)).toBeUndefined();
});

test('a task with blockers waits to start until each blocker is accepted', async () => {
  const { host, sam, send, call } = await team();
  const [schema, api] = [randomUUID(), randomUUID()];
  await send(host.token, { type: 'create-task', taskId: schema, title: 'Expiry column', description: '', assigneeId: sam.memberId });
  expect((await send(host.token, { type: 'create-task', taskId: randomUUID(), title: 'Bad', description: '', assigneeId: null, after: [randomUUID()] })).status).toBe(400);
  await send(host.token, { type: 'create-task', taskId: api, title: 'Expiry check', description: '', assigneeId: sam.memberId, after: [schema] });
  const task = async (id: string) => (await call(host.token, '/state')).data.tasks.find((item: { id: string }) => item.id === id);
  expect((await task(api)).after).toEqual([schema]);
  await send(sam.token, { type: 'approve-task', taskId: api, revision: 1 });
  const refused = await send(sam.token, { type: 'start-task', taskId: api, revision: 2, tool: 'codex' });
  expect(refused).toMatchObject({ status: 409, data: { error: 'Waiting on Expiry column.' } });
  await send(sam.token, { type: 'approve-task', taskId: schema, revision: 1 });
  await send(sam.token, { type: 'start-task', taskId: schema, revision: 2, tool: 'codex' });
  await send(sam.token, { type: 'save-package', taskId: schema, revision: 3, summary: 'Added', sourceRef: 'abc', deliverables: [], verification: '', questions: '' });
  await send(sam.token, { type: 'submit-package', taskId: schema, revision: 4 });
  expect((await send(host.token, { type: 'accept-package', taskId: schema, revision: 5 })).status).toBe(200);
  expect((await send(sam.token, { type: 'start-task', taskId: api, revision: 2, tool: 'codex' })).status).toBe(200);
});

test('the sample idea is marked and deletes like any other', async () => {
  const { host, send, idea } = await team();
  const ideaId = randomUUID();
  await send(host.token, { type: 'create-idea', ideaId, title: 'Add a welcome note to the README', size: 'feature', sample: true });
  expect(await idea(host.token, ideaId)).toMatchObject({ sample: true, stage: 'talk' });
  expect((await send(host.token, { type: 'delete-idea', ideaId })).status).toBe(200);
  expect(await idea(host.token, ideaId)).toBeUndefined();
});
