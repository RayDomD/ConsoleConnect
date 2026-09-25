import { expect, test } from 'vitest';
import type { MemberPresence, Snapshot, Task } from '../src/coordination';
import { officeRooms } from '../src/office';

const ids = { blair: 'b', sam: 's', casey: 'c', riley: 'r', kai: 'k', jo: 'j' };
const task = (id: string, fields: Partial<Task>): Task => ({ id, title: id, description: '', authorId: ids.blair, assigneeId: ids.sam, status: 'running', revision: 1, createdAt: '', ...fields });
const snapshot: Snapshot = {
  workspace: { id: 'w', name: 'Smoke team', repository: '' }, revision: 1, memberId: ids.blair, messages: [], decisions: [],
  members: Object.entries(ids).map(([name, id]) => ({ id, name: name[0]!.toUpperCase() + name.slice(1), role: id === 'b' ? 'owner' as const : 'contributor' as const })),
  tasks: [task('retry', {}), task('copy', { assigneeId: ids.casey }), task('review-me', { assigneeId: ids.riley, status: 'submitted', assignedBy: ids.blair })],
};
const presence = (memberId: string, fields: Partial<MemberPresence>): MemberPresence => ({ memberId, status: 'here', console: null, at: 'now', ...fields });

test('each person sits in the room that matches what they are doing', () => {
  const rooms = officeRooms(snapshot, [
    presence(ids.sam, { console: { kind: 'task', taskId: 'retry', tool: 'claude', needsInput: false, shared: true, glimpse: ['npm test'] } }),
    presence(ids.casey, { console: { kind: 'task', taskId: 'copy', tool: 'antigravity', needsInput: true, shared: false } }),
    presence(ids.blair, { watching: 'retry', console: null }),
    presence(ids.riley, { status: 'away' }),
    presence(ids.kai, { console: { kind: 'orchestrator', tool: 'codex', needsInput: false, shared: false } }),
    presence(ids.jo, { status: 'offline' }),
  ]);
  expect(rooms.building.map(card => [card.name, card.task?.title, card.glimpse, card.watchers])).toEqual([['Sam', 'retry', ['npm test'], ['Blair']]]);
  expect(rooms.needsHand.map(card => [card.name, card.shared])).toEqual([['Casey', false]]);
  expect(rooms.planning.map(card => card.name)).toEqual(['Kai']);
  expect(rooms.reviewing.map(card => [card.name, card.reviewCount])).toEqual([['Blair', 1]]);
  expect(rooms.around.map(card => [card.name, card.status])).toEqual([['Riley', 'away']]);
  expect(rooms.offline.map(card => card.name)).toEqual(['Jo']);
  expect(rooms.here).toBe(4);
});
