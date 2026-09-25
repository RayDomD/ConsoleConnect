import type { Task } from './coordination';

/** The first blocker not yet accepted or completed, or undefined when the task may start (guided path ADR Q21). */
export function waitingOn(tasks: Task[], task: Task) {
  return task.after?.map(id => tasks.find(item => item.id === id))
    .find(blocker => blocker && blocker.status !== 'accepted' && blocker.status !== 'completed');
}
