import type { Snapshot } from '../../coordination';

// What reaches a worker's own task console (orchestrator ADR Q10). Replies may be automatic;
// change requests always wait for the worker, and a decision change needs acknowledgement in the app first.
export type WorkerEvent =
  | { kind: 'reply'; person: string; body: string; via?: string }
  | { kind: 'changes'; person: string; note: string }
  | { kind: 'decision'; decisionId: string; title: string; body: string };

const toolNames: Record<string, string> = { codex: 'Codex', claude: 'Claude Code', antigravity: 'Antigravity' };
const oneLine = (text: string, limit = 400) => text.replace(/\s+/g, ' ').trim().slice(0, limit);

export function detectWorkerEvents(before: Snapshot | null, after: Snapshot, taskId: string): WorkerEvent[] {
  const previous = before?.tasks.find(task => task.id === taskId);
  const task = after.tasks.find(item => item.id === taskId);
  if (!before || !previous || !task || task.assigneeId !== after.memberId) return [];
  const name = (id: string | null | undefined) => after.members.find(member => member.id === id)?.name ?? 'A teammate';
  const events: WorkerEvent[] = [];
  if (task.status === 'changes_requested' && previous.status !== 'changes_requested') {
    events.push({ kind: 'changes', person: name(task.package?.reviewedBy), note: oneLine(task.package?.reviewNote ?? '') });
  }
  for (const decisionId of task.pendingDecisionIds ?? []) {
    if (previous.pendingDecisionIds?.includes(decisionId)) continue;
    const decision = after.decisions.find(item => item.id === decisionId);
    if (decision) events.push({ kind: 'decision', decisionId, title: decision.title, body: oneLine(decision.body) });
  }
  const known = new Set(before.messages.map(message => message.id));
  for (const message of after.messages) {
    if (known.has(message.id) || message.taskId !== taskId || message.authorId === after.memberId || message.deletedAt) continue;
    events.push({ kind: 'reply', person: name(message.authorId), body: oneLine(message.body), via: message.via });
  }
  return events;
}

function sentence(event: WorkerEvent) {
  if (event.kind === 'reply') return `${event.person}${event.via ? ` (via ${toolNames[event.via] ?? event.via})` : ''} replied on your task: "${event.body}"`;
  if (event.kind === 'changes') return `${event.person} requested changes: "${event.note}"`;
  return `The "${event.title}" decision changed and you acknowledged it: "${event.body}"`;
}

// One line, typed into the worker's console without Enter.
export function workerLine(events: WorkerEvent[]) {
  if (events.length > 1) return `${events.length} updates on your task: ${events.map(sentence).join('; ')}. Take them into account.`;
  const event = events[0]!;
  if (event.kind === 'reply') return `${sentence(event)} Continue with that in mind.`;
  if (event.kind === 'changes') return `${sentence(event)} Rework the task, then run console-connect package draft again.`;
  return `${sentence(event)} Follow it from now on.`;
}
