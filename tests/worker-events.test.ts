import { expect, test } from 'vitest';
import type { Snapshot, Task } from '../src/coordination';
import { detectWorkerEvents, workerLine } from '../src/orchestrator';

const blair = '11111111-1111-4111-8111-111111111111';
const sam = '22222222-2222-4222-8222-222222222222';
const retry = 'aaaaaaaa-0000-4000-8000-000000000001';

const task = (fields: Partial<Task>): Task => ({ id: retry, title: 'Expired invite retry', description: '', authorId: blair, assigneeId: sam, status: 'running', revision: 3, createdAt: '', ...fields });
const snapshot = (tasks: Task[], messages: Snapshot['messages'] = []): Snapshot => ({
  workspace: { id: 'w', name: 'Smoke team', repository: '' }, revision: 1, memberId: sam, messages, tasks,
  members: [{ id: blair, name: 'Blair', role: 'owner' }, { id: sam, name: 'Sam', role: 'contributor' }],
  decisions: [{ id: 'd1', title: 'Use OAuth', body: 'GitHub sign-in only.', proposedBy: blair, createdAt: '', status: 'official', affectedTaskIds: [retry] }],
});

test('the worker console hears replies, change requests, and decision changes on its own task', () => {
  const before = snapshot([task({})]);
  const after = snapshot([task({ status: 'changes_requested', package: { summary: '', sourceRef: '', deliverables: [], verification: '', questions: '', reviewedBy: blair, reviewNote: 'Also show it for used links.' }, pendingDecisionIds: ['d1'] })], [
    { id: 'm1', taskId: retry, authorId: blair, body: 'In-app notice only, no email.', createdAt: '', via: 'codex' },
    { id: 'm2', taskId: retry, authorId: sam, body: 'My own note.', createdAt: '' },
  ]);
  const events = detectWorkerEvents(before, after, retry);
  expect(events.map(event => event.kind)).toEqual(['changes', 'decision', 'reply']);
  expect(workerLine([events[2]!])).toBe('Blair (via Codex) replied on your task: "In-app notice only, no email." Continue with that in mind.');
  expect(workerLine([events[0]!])).toBe('Blair requested changes: "Also show it for used links." Rework the task, then run console-connect package draft again.');
  expect(workerLine([events[1]!])).toBe('The "Use OAuth" decision changed and you acknowledged it: "GitHub sign-in only." Follow it from now on.');
  expect(detectWorkerEvents(before, after, 'other')).toEqual([]);
});
