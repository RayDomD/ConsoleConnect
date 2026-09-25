import { expect, test } from 'vitest';
import { presenceView } from '../src/coordination';

test('anyone silent for over a minute is offline, and unknown members are left out', () => {
  const now = Date.parse('2026-09-25T12:00:00Z');
  const records = [
    { memberId: 'a', status: 'here' as const, console: null, at: '2026-09-25T11:59:30Z' },
    { memberId: 'b', status: 'away' as const, console: { kind: 'task' as const, taskId: undefined, tool: 'codex' as const, needsInput: false, shared: true, glimpse: ['x'] }, at: '2026-09-25T11:58:00Z' },
  ];
  expect(presenceView(records, ['a', 'b', 'c'], now)).toEqual([
    { memberId: 'a', status: 'here', console: null, at: '2026-09-25T11:59:30Z' },
    { memberId: 'b', status: 'offline', console: null, at: '2026-09-25T11:58:00Z' },
    { memberId: 'c', status: 'offline', console: null, at: null },
  ]);
});
