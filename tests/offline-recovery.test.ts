import { afterEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startHost } from '../src/coordination';
import { flushPending, loadPending, savePending } from '../src/offline';

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); }, clear: () => data.clear(), key: index => [...data.keys()][index] ?? null,
    get length() { return data.size; } };
}

async function api(url: string, token: string, path: string, payload?: object) {
  const response = await fetch(`${url}${path}`, { method: payload ? 'POST' : 'GET',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined });
  return { status: response.status, data: await response.json() };
}

test('a queued update survives host downtime and restart, then applies exactly once', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'console-connect-recovery-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const host = await startHost({ directory, name: 'Team', repository: 'https://github.com/example/repo', owner: 'Alex' });
  cleanup.push(host.close);
  const initial = await api(host.url, host.token, '/state');
  const taskId = randomUUID();
  expect((await api(host.url, host.token, '/commands', { id: randomUUID(), type: 'create-task', taskId,
    title: 'Restore updates', description: '', assigneeId: null })).status).toBe(200);
  const command = { id: randomUUID(), type: 'post-message' as const, taskId, body: 'Saved while offline' };
  const storage = memoryStorage();
  savePending(storage, [{ workspaceId: initial.data.workspace.id, memberId: initial.data.memberId, command }]);
  await host.close();
  await expect(flushPending(storage, initial.data.workspace.id, initial.data.memberId, async item => {
    await api(host.url, host.token, '/commands', item);
  })).rejects.toThrow();
  expect(loadPending(storage)).toHaveLength(1);
  const restarted = await startHost({ directory, name: 'Ignored', repository: 'ignored', owner: 'Alex' });
  cleanup.push(restarted.close);
  await flushPending(storage, initial.data.workspace.id, initial.data.memberId, async item => {
    const result = await api(restarted.url, host.token, '/commands', item);
    if (result.status !== 200) throw new Error(result.data.error);
  });
  expect(loadPending(storage)).toEqual([]);
  expect((await api(restarted.url, host.token, '/commands', command)).status).toBe(200);
  const state = await api(restarted.url, host.token, '/state');
  expect(state.data.messages.filter((message: { id: string }) => message.id === command.id)).toHaveLength(1);
});

test('a stale queued assignment stays visible and cannot replace a newer claim', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'console-connect-conflict-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  const host = await startHost({ directory, name: 'Team', repository: 'https://github.com/example/repo', owner: 'Alex' });
  cleanup.push(host.close);
  const invite = await api(host.url, host.token, '/invites', { role: 'reviewer' });
  const sam = await api(host.url, '', '/join', { code: invite.data.code, name: 'Sam' });
  const taskId = randomUUID();
  await api(host.url, host.token, '/commands', { id: randomUUID(), type: 'create-task', taskId,
    title: 'Choose an owner', description: '', assigneeId: null });
  const owner = await api(host.url, host.token, '/state');
  const command = { id: randomUUID(), type: 'assign-task' as const, taskId, revision: 1, assigneeId: owner.data.memberId };
  const storage = memoryStorage();
  savePending(storage, [{ workspaceId: owner.data.workspace.id, memberId: owner.data.memberId, command }]);
  await api(host.url, sam.data.token, '/commands', { id: randomUUID(), type: 'claim-task', taskId, revision: 1 });
  await expect(flushPending(storage, owner.data.workspace.id, owner.data.memberId, async item => {
    const result = await api(host.url, host.token, '/commands', item);
    if (result.status !== 200) throw new Error(result.data.error);
  })).rejects.toThrow('changed');
  expect(loadPending(storage)).toHaveLength(1);
  expect((await api(host.url, host.token, '/state')).data.tasks[0].assigneeId).toBe(sam.data.memberId);
});
