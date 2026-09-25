import type { Snapshot, Task } from '../../coordination';

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim();
const descriptionLimit = 1_500;

// Typed into a worker's tool without pressing Enter (orchestrator ADR Q6), so it must stay on one line:
// a newline would send it.
export function taskBrief(state: Snapshot, task: Task) {
  const assignee = state.members.find(member => member.id === task.assigneeId)?.name ?? 'you';
  const description = oneLine(task.description).slice(0, descriptionLimit);
  const decisions = state.decisions.filter(decision => decision.status === 'official' && decision.affectedTaskIds.includes(task.id));
  return [
    `Task "${oneLine(task.title)}" (${task.id.slice(0, 8)}) for ${assignee}${description ? `: ${description}` : '.'}`,
    ...decisions.map(decision => `Follow the decision "${oneLine(decision.title)}".`),
    'When the work is ready, run console-connect package draft --summary "<what changed>" --checks "<how you verified it>" --questions "<anything still open>".',
    'Ask the team with console-connect ask "<question>".',
    `For the team and the rules, run console-connect brief --task ${task.id.slice(0, 8)}.`,
  ].join(' ');
}
