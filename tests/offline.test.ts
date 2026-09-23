import { expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import { flushPending, loadPending, savePending } from '../src/offline';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return { getItem: key => data.get(key) ?? null, setItem: (key, value) => { data.set(key, value); },
    removeItem: key => { data.delete(key); }, clear: () => data.clear(), key: index => [...data.keys()][index] ?? null,
    get length() { return data.size; } };
}

test('queued commands survive reload and a conflict leaves the update for review', async () => {
  const storage = memoryStorage();
  const command = { id: randomUUID(), type: 'post-message' as const, taskId: randomUUID(), body: 'Question for the team' };
  savePending(storage, [{ workspaceId: 'team', memberId: 'sam', command }]);
  const attempted: string[] = [];
  await expect(flushPending(storage, 'team', 'sam', async item => { attempted.push(item.id); throw new Error('Conflict'); })).rejects.toThrow('Conflict');
  expect(attempted).toEqual([command.id]);
  expect(loadPending(storage)).toHaveLength(1);
  await flushPending(storage, 'team', 'sam', async item => { attempted.push(item.id); });
  expect(attempted).toEqual([command.id, command.id]);
  expect(loadPending(storage)).toEqual([]);
});
