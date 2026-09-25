import type { MemberPresence, Snapshot, Task } from './coordination';

// The Office (ADR Q17): rooms that arrange themselves from presence and task state. Nobody drags anything.
export interface OfficeCard {
  memberId: string; name: string; status: MemberPresence['status'];
  task: Task | null; tool: string | null; shared: boolean; glimpse: string[]; watchers: string[]; reviewCount: number;
}
export interface OfficeRooms {
  needsHand: OfficeCard[]; building: OfficeCard[]; reviewing: OfficeCard[]; planning: OfficeCard[]; around: OfficeCard[]; offline: OfficeCard[];
  here: number; away: number;
}

export function officeRooms(state: Snapshot, presence: MemberPresence[]): OfficeRooms {
  const rooms: OfficeRooms = { needsHand: [], building: [], reviewing: [], planning: [], around: [], offline: [], here: 0, away: 0 };
  for (const member of state.members) {
    const seen = presence.find(item => item.memberId === member.id) ?? { memberId: member.id, status: 'offline' as const, console: null, at: null };
    const console = seen.console;
    const task = console?.taskId ? state.tasks.find(item => item.id === console.taskId) ?? null : null;
    const watchers = task ? presence.filter(item => item.watching === task.id && item.status !== 'offline')
      .map(item => state.members.find(other => other.id === item.memberId)?.name ?? 'A teammate') : [];
    const reviewCount = state.tasks.filter(item => item.status === 'submitted' && item.assignedBy === member.id && item.assigneeId !== member.id).length;
    const card: OfficeCard = { memberId: member.id, name: member.name, status: seen.status, task, tool: console?.tool ?? null,
      shared: Boolean(console?.shared), glimpse: console?.shared ? console.glimpse ?? [] : [], watchers, reviewCount };
    if (seen.status === 'offline') { rooms.offline.push(card); continue; }
    if (seen.status === 'here') rooms.here += 1; else rooms.away += 1;
    if (console?.needsInput) rooms.needsHand.push(card);
    else if (console?.kind === 'task') rooms.building.push(card);
    else if (console?.kind === 'orchestrator') rooms.planning.push(card);
    else if (reviewCount) rooms.reviewing.push(card);
    else rooms.around.push(card);
  }
  return rooms;
}
