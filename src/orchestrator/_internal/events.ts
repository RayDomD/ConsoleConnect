import type { IdeaSize, IdeaStage, Snapshot } from '../../coordination';
import { stageNames } from './playbooks';
import { recommendNext, stageAction } from './recommend';

// Updates the orchestrator hears about (orchestrator ADR Q8), found by comparing snapshots of the work its person handed out.
export type OrchestratorEvent =
  | { kind: 'submitted' | 'declined' | 'stalled'; taskId: string; title: string; person: string; reason?: 'needs_input' | 'exited' }
  | { kind: 'question'; taskId: string; title: string; person: string; body: string }
  // Guided path ADR Q16: an idea reached a new stage, told with what fits next.
  | { kind: 'idea-stage'; ideaId: string; title: string; size: IdeaSize; stage: IdeaStage | 'done' };

const shortId = (id: string) => id.slice(0, 8);
const questionLimit = 300;

export function detectEvents(before: Snapshot | null, after: Snapshot): OrchestratorEvent[] {
  if (!before) return [];
  const me = after.memberId;
  const name = (id: string | null | undefined) => after.members.find(member => member.id === id)?.name ?? 'A teammate';
  const events: OrchestratorEvent[] = [];
  // Only work handed to someone else: a person's own tasks are not updates for their orchestrator.
  for (const task of after.tasks.filter(item => item.assignedBy === me && item.assigneeId !== me)) {
    const previous = before.tasks.find(item => item.id === task.id);
    if (!previous) continue;
    const base = { taskId: task.id, title: task.title };
    if (task.status === 'submitted' && previous.status !== 'submitted') events.push({ kind: 'submitted', ...base, person: name(task.assigneeId) });
    if (task.declinedBy && !previous.declinedBy) events.push({ kind: 'declined', ...base, person: name(task.declinedBy) });
    if (task.stall && task.stall.at !== previous.stall?.at) events.push({ kind: 'stalled', ...base, person: name(task.assigneeId), reason: task.stall.reason });
  }
  const known = new Set(before.messages.map(message => message.id));
  for (const message of after.messages) {
    const task = after.tasks.find(item => item.id === message.taskId);
    if (known.has(message.id) || !task || task.assignedBy !== me || task.assigneeId === me || message.authorId !== task.assigneeId || message.deletedAt) continue;
    events.push({ kind: 'question', taskId: task.id, title: task.title, person: name(message.authorId), body: message.body.replace(/\s+/g, ' ').slice(0, questionLimit) });
  }
  for (const idea of after.ideas ?? []) {
    const previous = before.ideas?.find(item => item.id === idea.id);
    if (previous && previous.stage !== idea.stage) events.push({ kind: 'idea-stage', ideaId: idea.id, title: idea.title, size: idea.size, stage: idea.stage });
  }
  return events;
}

function summary(event: OrchestratorEvent) {
  if (event.kind === 'idea-stage') return event.stage === 'done' ? `"${event.title}" is done` : `"${event.title}" reached ${stageNames[event.stage]}`;
  if (event.kind === 'submitted') return `${event.person} submitted "${event.title}"`;
  if (event.kind === 'declined') return `${event.person} declined "${event.title}"`;
  if (event.kind === 'question') return `${event.person} asked on "${event.title}"`;
  return event.reason === 'exited' ? `${event.person}'s session on "${event.title}" ended without a package` : `${event.person}'s session on "${event.title}" is waiting for them`;
}

// One line, typed into the orchestrator console without Enter; several updates combine into one.
export function eventLine(events: OrchestratorEvent[]) {
  if (events.length > 1) return `${events.length} updates: ${events.map(summary).join('; ')}. Handle them with console-connect.`;
  const event = events[0]!;
  if (event.kind === 'idea-stage') {
    const id = shortId(event.ideaId);
    if (event.stage === 'done') return `${summary(event)} (${id}). Write the session summary if it is missing.`;
    const action = stageAction(event.stage, { id: event.ideaId });
    const next = recommendNext({ id: event.ideaId, size: event.size, stage: event.stage });
    return `${summary(event)} (${id}). ${action.charAt(0).toUpperCase()}${action.slice(1)}${next ? `, then ${next.text}` : '.'}`;
  }
  const id = shortId(event.taskId);
  if (event.kind === 'submitted') return `${summary(event)} (${id}). Read the package with console-connect package show ${id} and suggest a review.`;
  if (event.kind === 'question') return `${summary(event)} (${id}): "${event.body}" Answer with console-connect task reply ${id}.`;
  if (event.kind === 'declined') return `${summary(event)} (${id}). Suggest who could take it instead.`;
  return `${summary(event)} (${id}). Suggest a next step with console-connect task reply ${id}.`;
}
