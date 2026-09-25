import { RequestError, type Command, type Member, type WorkspaceState } from './protocol';

// Decisions that stay with people (orchestrator ADR Q4): a tool may propose them, only a click sends them.
const clickOnly = new Set<Command['type']>(['accept-package', 'request-changes', 'approve-decision', 'approve-task']);

function checkAssigningRule(state: WorkspaceState, actor: Member) {
  const rule = state.settings?.assigningRule ?? 'anyone';
  const hint = 'Claim the task, or suggest an assignee in its discussion.';
  if (rule === 'leads' && actor.role === 'contributor') throw new RequestError(403, `Only Owners and Reviewers assign work on this team. ${hint}`);
  if (rule === 'owner' && actor.role !== 'owner') throw new RequestError(403, `Only the Owner assigns work on this team. ${hint}`);
}

export function applyCommand(state: WorkspaceState, actor: Member, command: Command) {
  if (command.via && clickOnly.has(command.type)) throw new RequestError(403, 'This needs a click in Console Connect.');
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
    state.tasks.push({ id: command.taskId, title: command.title, description: command.description,
      authorId: actor.id, assigneeId: command.assigneeId, status: command.assigneeId ? 'awaiting_approval' : 'unassigned',
      revision: 1, createdAt: new Date().toISOString(),
      ...(command.assigneeId ? { assignedBy: actor.id, via: command.via } : {}) });
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
    case 'approve-task':
      if (task.status !== 'awaiting_approval') throw new RequestError(409, 'This task is not awaiting your approval.');
      task.status = 'ready';
      break;
    case 'start-task':
      if (task.status !== 'ready') throw new RequestError(409, 'Approve this assignment before starting work.');
      task.status = 'running';
      task.tool = command.tool;
      break;
    case 'save-package':
      if (task.status !== 'running' && task.status !== 'changes_requested') throw new RequestError(409, 'This task is not ready for a draft.');
      task.draftPackage = { summary: command.summary, sourceRef: command.sourceRef, pullRequestUrl: command.pullRequestUrl,
        deliverables: command.deliverables,
        verification: command.verification, questions: command.questions };
      break;
    case 'submit-package':
      if (task.pendingDecisionIds?.length) throw new RequestError(409, 'Acknowledge changed decisions before submitting work.');
      if ((task.status !== 'running' && task.status !== 'changes_requested') || !task.draftPackage) throw new RequestError(409, 'Save a draft before submitting it.');
      task.status = 'submitted';
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
