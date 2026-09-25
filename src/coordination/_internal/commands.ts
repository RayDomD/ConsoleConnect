import { waitingOn } from '../../blockers';
import { ideaPaths, RequestError, type Command, type Idea, type Member, type WorkspaceState } from './protocol';

// Decisions that stay with people (orchestrator ADR Q4): a tool may propose them, only a click sends them.
// Marking an idea ready is a gated move that waits for a person's click (guided path ADR Q20).
const clickOnly = new Set<Command['type']>(['accept-package', 'request-changes', 'approve-decision', 'approve-task', 'mark-idea-ready']);

type IdeaCommand = Extract<Command, { ideaId: string }>;

function nextStage(idea: Idea): Idea['stage'] {
  if (idea.stage === 'done') return 'done';
  const path = ideaPaths[idea.size];
  return path[path.indexOf(idea.stage) + 1] ?? 'done';
}

/** The gate for leaving the idea's current stage, or null when it is open (ADR Q20). */
function stageGate(state: WorkspaceState, idea: Idea): string | null {
  const linked = state.tasks.filter(task => idea.taskIds.includes(task.id));
  switch (idea.stage) {
    case 'talk': return idea.readyBy ? null : 'An Owner or Reviewer must mark it ready.';
    case 'write': return state.decisions.some(item => item.id === idea.specDecisionId && item.status === 'official')
      ? null : 'Approve the spec as a decision first.';
    case 'split': return linked.length ? null : 'Link at least one task.';
    case 'build':
      if (!linked.length) return 'Link at least one task.';
      return linked.every(task => task.status === 'accepted' || task.status === 'completed') ? null : 'Waiting for every linked task to be accepted.';
    case 'review':
      if (!linked.length) return 'Link at least one task.';
      return linked.every(task => task.status === 'completed') ? null : 'Waiting for every linked task to be completed.';
    case 'done': return 'This idea is done.';
  }
}

function applyIdeaCommand(state: WorkspaceState, actor: Member, command: IdeaCommand) {
  const ideas = state.ideas ??= [];
  if (command.type === 'create-idea') {
    if (ideas.some(item => item.id === command.ideaId)) throw new RequestError(409, 'This idea already exists.');
    ideas.push({ id: command.ideaId, title: command.title, note: command.note ?? '', size: command.size,
      stage: ideaPaths[command.size][0]!, createdBy: actor.id, createdAt: new Date().toISOString(), revision: 1,
      skipped: [], documents: [], taskIds: [] });
    return;
  }
  const idea = ideas.find(item => item.id === command.ideaId);
  if (!idea) throw new RequestError(404, 'Idea not found.');
  if (command.type === 'delete-idea') {
    if (idea.createdBy !== actor.id && actor.role !== 'owner') throw new RequestError(403, 'Only the person who added this idea or the Owner can delete it.');
    state.ideas = ideas.filter(item => item !== idea);
    return;
  }
  if (idea.revision !== command.revision) throw new RequestError(409, 'This idea changed. Refresh it before trying again.');
  switch (command.type) {
    case 'update-idea':
      if (command.title !== undefined) idea.title = command.title;
      if (command.note !== undefined) idea.note = command.note;
      if (command.size && command.size !== idea.size) {
        // Keep what was passed: land on the first stage of the new path this idea has not been through.
        const oldPath = ideaPaths[idea.size];
        const passed = idea.stage === 'done' ? oldPath : oldPath.slice(0, oldPath.indexOf(idea.stage));
        idea.size = command.size;
        idea.stage = ideaPaths[command.size].find(stage => !passed.includes(stage)) ?? 'done';
      }
      break;
    case 'mark-idea-ready':
      if (actor.role === 'contributor') throw new RequestError(403, 'Only an Owner or Reviewer can mark an idea ready.');
      if (idea.stage !== 'talk') throw new RequestError(409, 'Only an idea in Talk it through can be marked ready.');
      idea.readyBy = actor.id;
      break;
    case 'advance-idea': {
      const gate = stageGate(state, idea);
      if (gate) throw new RequestError(409, gate);
      idea.stage = nextStage(idea);
      break;
    }
    case 'skip-idea-stage':
      if (idea.stage === 'done') throw new RequestError(409, 'This idea is done.');
      idea.skipped.push({ stage: idea.stage, reason: command.reason, by: actor.id });
      idea.stage = nextStage(idea);
      break;
    case 'link-idea':
      if (command.taskIds?.some(id => !state.tasks.some(task => task.id === id))) throw new RequestError(400, 'Choose existing tasks.');
      if (command.specDecisionId && !state.decisions.some(item => item.id === command.specDecisionId)) throw new RequestError(400, 'Choose an existing decision.');
      if (command.taskIds) idea.taskIds = [...new Set([...idea.taskIds, ...command.taskIds])];
      if (command.document) {
        const document = command.document;
        idea.documents = [...idea.documents.filter(item => item.stage !== document.stage || item.path !== document.path), document];
      }
      if (command.specDecisionId) idea.specDecisionId = command.specDecisionId;
      break;
  }
  idea.revision += 1;
}

function checkAssigningRule(state: WorkspaceState, actor: Member) {
  const rule = state.settings?.assigningRule ?? 'anyone';
  const hint = 'Claim the task, or suggest an assignee in its discussion.';
  if (rule === 'leads' && actor.role === 'contributor') throw new RequestError(403, `Only Owners and Reviewers assign work on this team. ${hint}`);
  if (rule === 'owner' && actor.role !== 'owner') throw new RequestError(403, `Only the Owner assigns work on this team. ${hint}`);
}

export function applyCommand(state: WorkspaceState, actor: Member, command: Command) {
  if (command.via && clickOnly.has(command.type)) throw new RequestError(403, 'This needs a click in Console Connect.');
  if ('ideaId' in command) { applyIdeaCommand(state, actor, command); return; }
  // Informational: it does not bump the task revision, so it never makes the worker's own commands conflict.
  if (command.type === 'report-session') {
    const task = state.tasks.find(item => item.id === command.taskId);
    if (!task) throw new RequestError(404, 'Task not found.');
    if (task.assigneeId !== actor.id) throw new RequestError(403, 'Only the person working on this task can report its session.');
    if (task.status !== 'running' && task.status !== 'changes_requested') throw new RequestError(409, 'This task has no running session.');
    if (command.state === 'working') delete task.stall;
    else task.stall = { reason: command.state, at: new Date().toISOString() };
    return;
  }
  if (command.type === 'set-assigning-rule') {
    if (actor.role !== 'owner') throw new RequestError(403, 'Only the Owner can change who assigns work.');
    state.settings = { ...state.settings, assigningRule: command.rule };
    return;
  }
  if (command.type === 'propose-decision') {
    if (state.decisions.some(item => item.id === command.decisionId)) throw new RequestError(409, 'This decision already exists.');
    if (command.supersedesId && !state.decisions.some(item => item.id === command.supersedesId && item.status === 'official')) {
      throw new RequestError(409, 'Choose an official decision to replace.');
    }
    if (command.affectedTaskIds?.some(id => !state.tasks.some(task => task.id === id))) throw new RequestError(400, 'Choose existing affected tasks.');
    state.decisions.push({ id: command.decisionId, title: command.title, body: command.body,
      proposedBy: actor.id, createdAt: new Date().toISOString(), status: 'proposed',
      supersedesId: command.supersedesId, affectedTaskIds: [...new Set(command.affectedTaskIds ?? [])] });
    return;
  }
  if (command.type === 'approve-decision') {
    if (actor.role === 'contributor') throw new RequestError(403, 'Only an owner or reviewer can approve decisions.');
    const decision = state.decisions.find(item => item.id === command.decisionId);
    if (!decision) throw new RequestError(404, 'Decision not found.');
    if (decision.status !== 'proposed') throw new RequestError(409, 'This decision is already official.');
    if (decision.supersedesId && !state.decisions.some(item => item.id === decision.supersedesId && item.status === 'official')) {
      throw new RequestError(409, 'The decision being replaced has changed.');
    }
    decision.status = 'official';
    decision.documentCommit = command.commitSha;
    if (decision.supersedesId) state.decisions.find(item => item.id === decision.supersedesId)!.status = 'superseded';
    for (const task of state.tasks) {
      if (decision.affectedTaskIds.includes(task.id) && task.status !== 'completed') {
        task.pendingDecisionIds ??= [];
        task.pendingDecisionIds.push(decision.id);
        task.revision += 1;
      }
    }
    return;
  }
  if (command.type === 'create-task') {
    if (state.tasks.some(task => task.id === command.taskId)) throw new RequestError(409, 'This task already exists.');
    if (command.assigneeId && !state.members.some(member => member.id === command.assigneeId)) throw new RequestError(400, 'Choose a workspace member.');
    if (command.assigneeId && command.assigneeId !== actor.id) checkAssigningRule(state, actor);
    if (command.after?.some(id => !state.tasks.some(task => task.id === id))) throw new RequestError(400, 'Choose existing tasks to wait on.');
    state.tasks.push({ id: command.taskId, title: command.title, description: command.description,
      authorId: actor.id, assigneeId: command.assigneeId, status: command.assigneeId ? 'awaiting_approval' : 'unassigned',
      revision: 1, createdAt: new Date().toISOString(),
      ...(command.assigneeId ? { assignedBy: actor.id, via: command.via } : {}),
      ...(command.after?.length ? { after: [...new Set(command.after)] } : {}) });
    return;
  }
  if (command.type === 'post-message') {
    if (command.taskId && !state.tasks.some(task => task.id === command.taskId)) throw new RequestError(404, 'Task not found.');
    if (command.replyToId) {
      const parent = state.messages.find(message => message.id === command.replyToId);
      if (!parent || parent.deletedAt || parent.taskId !== command.taskId) throw new RequestError(400, 'Reply to a visible message in this conversation.');
    }
    state.messages.push({ id: command.id, taskId: command.taskId, authorId: actor.id,
      replyToId: command.replyToId, body: command.body, createdAt: new Date().toISOString(), version: 1, via: command.via });
    return;
  }
  if (command.type === 'edit-message' || command.type === 'unsend-message') {
    const message = state.messages.find(item => item.id === command.messageId);
    if (!message) throw new RequestError(404, 'Message not found.');
    if (message.authorId !== actor.id) throw new RequestError(403, 'Only the author can change this message.');
    if (message.deletedAt) throw new RequestError(409, 'This message was already unsent.');
    if ((message.version ?? 1) !== command.version) throw new RequestError(409, 'This message changed. Review it before trying again.');
    if (command.type === 'edit-message') {
      message.body = command.body;
      message.editedAt = new Date().toISOString();
    } else {
      message.body = '';
      message.deletedAt = new Date().toISOString();
    }
    message.version = command.version + 1;
    return;
  }
  const task = state.tasks.find(item => item.id === command.taskId);
  if (!task) throw new RequestError(404, 'Task not found.');
  if (command.type === 'claim-task' || command.type === 'assign-task') {
    if (task.revision !== command.revision) throw new RequestError(409, 'This task changed. Refresh it before trying again.');
    if (task.status !== 'unassigned') throw new RequestError(409, 'This task is already assigned.');
    delete task.declinedBy;
    if (command.type === 'claim-task') { task.assigneeId = actor.id; task.status = 'ready'; }
    else {
      if (!state.members.some(member => member.id === command.assigneeId)) throw new RequestError(400, 'Choose a workspace member.');
      if (command.assigneeId !== actor.id) checkAssigningRule(state, actor);
      task.assigneeId = command.assigneeId;
      task.status = command.assigneeId === actor.id ? 'ready' : 'awaiting_approval';
      task.assignedBy = actor.id;
      task.via = command.via;
    }
    task.revision += 1;
    return;
  }
  if (command.type === 'accept-package' || command.type === 'request-changes') {
    if (actor.id === task.assigneeId || actor.role === 'contributor') throw new RequestError(403, 'An independent reviewer must review this package.');
  } else if (task.assigneeId !== actor.id) throw new RequestError(403, 'Only the assigned person can update this task.');
  if (task.revision !== command.revision) throw new RequestError(409, 'This task changed. Refresh it before trying again.');
  switch (command.type) {
    case 'acknowledge-decision':
      if (!task.pendingDecisionIds?.includes(command.decisionId)) throw new RequestError(409, 'This task has no pending acknowledgement for that decision.');
      task.pendingDecisionIds = task.pendingDecisionIds.filter(id => id !== command.decisionId);
      break;
    case 'decline-task':
      if (task.status !== 'awaiting_approval' && task.status !== 'ready') throw new RequestError(409, 'Work has started, so this task can no longer be declined.');
      task.status = 'unassigned';
      task.assigneeId = null;
      task.declinedBy = actor.id;
      if (command.note) state.messages.push({ id: command.id, taskId: task.id, authorId: actor.id, body: command.note,
        createdAt: new Date().toISOString(), version: 1, via: command.via });
      break;
    case 'approve-task':
      if (task.status !== 'awaiting_approval') throw new RequestError(409, 'This task is not awaiting your approval.');
      task.status = 'ready';
      break;
    case 'start-task': {
      if (task.status !== 'ready') throw new RequestError(409, 'Approve this assignment before starting work.');
      const blocker = waitingOn(state.tasks, task);
      if (blocker) throw new RequestError(409, `Waiting on ${blocker.title}.`);
      task.status = 'running';
      task.tool = command.tool;
      break;
    }
    case 'save-package':
      if (task.status !== 'running' && task.status !== 'changes_requested') throw new RequestError(409, 'This task is not ready for a draft.');
      delete task.stall;
      task.draftPackage = { summary: command.summary, sourceRef: command.sourceRef, pullRequestUrl: command.pullRequestUrl,
        deliverables: command.deliverables,
        verification: command.verification, questions: command.questions };
      break;
    case 'submit-package':
      if (task.pendingDecisionIds?.length) throw new RequestError(409, 'Acknowledge changed decisions before submitting work.');
      if ((task.status !== 'running' && task.status !== 'changes_requested') || !task.draftPackage) throw new RequestError(409, 'Save a draft before submitting it.');
      task.status = 'submitted';
      delete task.stall;
      task.package = task.draftPackage;
      delete task.draftPackage;
      delete task.pullRequestStatus;
      task.package.submittedAt = new Date().toISOString();
      break;
    case 'accept-package':
      if (task.pendingDecisionIds?.length) throw new RequestError(409, 'The task owner must acknowledge changed decisions before review.');
      if (task.status !== 'submitted' || !task.package) throw new RequestError(409, 'There is no submitted package to review.');
      task.status = task.pullRequestStatus?.mergedAt ? 'completed' : 'accepted';
      task.package.reviewedBy = actor.id;
      break;
    case 'request-changes':
      if (task.status !== 'submitted' || !task.package) throw new RequestError(409, 'There is no submitted package to review.');
      task.status = 'changes_requested';
      task.package.reviewedBy = actor.id;
      task.package.reviewNote = command.note;
      break;
  }
  task.revision += 1;
}
