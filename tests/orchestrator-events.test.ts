import { expect, test } from 'vitest';
import type { Snapshot, Task } from '../src/coordination';
import { detectEvents, eventLine } from '../src/orchestrator';

const blair = '11111111-1111-4111-8111-111111111111';
const sam = '22222222-2222-4222-8222-222222222222';
const casey = '33333333-3333-4333-8333-333333333333';
const retry = 'aaaaaaaa-0000-4000-8000-000000000001';
const copy = 'bbbbbbbb-0000-4000-8000-000000000002';
const mine = 'cccccccc-0000-4000-8000-000000000003';

function task(id: string, title: string, fields: Partial<Task>): Task {
  return { id, title, description: '', authorId: blair, assigneeId: sam, status: 'running', revision: 3, createdAt: '', assignedBy: blair, ...fields };
}

function snapshot(tasks: Task[], messages: Snapshot['messages'] = []): Snapshot {
  return { workspace: { id: 'w', name: 'Smoke team', repository: '' }, revision: 1, memberId: blair, decisions: [], messages, tasks,
    members: [{ id: blair, name: 'Blair', role: 'owner' }, { id: sam, name: 'Sam', role: 'contributor' }, { id: casey, name: 'Casey', role: 'contributor' }] };
}

test('the orchestrator hears about submissions, questions, stalls, and declines on work its person handed out', () => {
  const before = snapshot([task(retry, 'Expired invite retry', {}), task(copy, 'Invite email copy', { assigneeId: casey }), task(mine, 'Own notes', { assignedBy: sam })]);
  const after = snapshot([
    task(retry, 'Expired invite retry', { status: 'submitted' }),
    task(copy, 'Invite email copy', { assigneeId: casey, stall: { reason: 'needs_input', at: '' } }),
    task(mine, 'Own notes', { assignedBy: sam, status: 'submitted' }),
  ], [
    { id: 'm1', taskId: copy, authorId: casey, body: 'Should the email mention the 24-hour limit?', createdAt: '', via: 'antigravity' },
    { id: 'm2', taskId: copy, authorId: blair, body: 'Own reply', createdAt: '' },
  ]);
  const events = detectEvents(before, after);
  expect(events.map(event => event.kind)).toEqual(['submitted', 'stalled', 'question']);
  expect(eventLine(events.slice(0, 1))).toBe('Sam submitted "Expired invite retry" (aaaaaaaa). Read the package with console-connect package show aaaaaaaa and suggest a review.');
  expect(eventLine(events.slice(2))).toBe('Casey asked on "Invite email copy" (bbbbbbbb): "Should the email mention the 24-hour limit?" Answer with console-connect task reply bbbbbbbb.');
  expect(eventLine(events)).toMatch(/^3 updates: Sam submitted "Expired invite retry"; Casey's session on "Invite email copy" is waiting for them; Casey asked on "Invite email copy"\. Handle them with console-connect\.$/);
  const declined = detectEvents(before, snapshot([task(retry, 'Expired invite retry', { assigneeId: null, status: 'unassigned', declinedBy: sam })]));
  expect(declined).toEqual([{ kind: 'declined', taskId: retry, title: 'Expired invite retry', person: 'Sam' }]);
  expect(detectEvents(null, after)).toEqual([]);
  const own = task(mine, 'Own notes', { assigneeId: blair });
  expect(detectEvents(snapshot([own]), snapshot([{ ...own, stall: { reason: 'exited', at: 'now' } }]))).toEqual([]);
});
