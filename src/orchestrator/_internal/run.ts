import type { CommandInput, Idea, Member, Snapshot, Task, Tool } from '../../coordination';
import { taskBrief } from './brief';
import { playbookPath, playbookStage, playbookText, sizeNames, stageNames } from './playbooks';

// What the app lends the command runner: the current snapshot and a way to send a command as the person.
// `send` receives a task id for task-revision commands (the app adds the task's revision) and null otherwise.
export interface WorkspaceApi {
  snapshot(): Snapshot | null;
  send(taskId: string | null, fields: CommandInput): Promise<void>;
  /** Queues a review for the person to confirm with a click; it must never send anything itself. */
  propose(proposal: ReviewProposal): void;
  /** Saves a private draft package: these words plus the Git facts the app reads from the task worktree. */
  draftPackage(draft: PackageDraft): Promise<void>;
  /** Keeps a hand-out from an automatic run for the person to send or discard (orchestrator ADR Q9). */
  hold(item: { argv: string[]; summary: string }): void;
  /** The caller's automatic-handling state for the brief, e.g. "Auto: questions"; absent means off. */
  autoSummary?(): string;
  /** The project map and heads-ups, read from main (taskId null) or from the task's branch. */
  projectKnowledge?(taskId: string | null): Promise<{ source: string; lines: string[]; flags: string[] } | null>;
  /** The repo's docs/playbooks/<stage>.md, from main (taskId null) or the task's branch; null when absent. */
  readPlaybook?(stage: string, taskId: string | null): Promise<string | null>;
}

function knowledgeText(knowledge: { source: string; lines: string[]; flags: string[] } | null) {
  if (!knowledge) return [];
  return [`Project map (docs/README.md @ ${knowledge.source}):`, ...knowledge.lines.map(line => `  ${line}`), ...knowledge.flags.map(flag => `Heads-up: ${flag}`)];
}
export interface PackageDraft { taskId: string; summary: string; checks: string; questions: string; via?: Tool }
export interface ReviewProposal { id: string; taskId: string; action: 'accept' | 'changes'; note: string; via?: Tool }
// `tool` is the AI tool the caller runs in, when known; commands are marked with it ("via Codex").
// `holdAssignments` is set while the orchestrator handles updates automatically: new hand-outs wait for the person.
export interface CliContext { cwd: string; taskId: string | null; tool?: Tool; holdAssignments?: boolean }
export interface CliResult { text: string; data: unknown }
export class CliError extends Error {}

const sentenceCase = (value: string) => { const text = value.replaceAll('_', ' '); return text.charAt(0).toUpperCase() + text.slice(1); };
const shortId = (id: string) => id.slice(0, 8);

function options(args: string[]) {
  const positional: string[] = [];
  const named: Record<string, string> = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!;
    if (!arg.startsWith('--')) { positional.push(arg); continue; }
    const [key, inline] = arg.slice(2).split(/=(.*)/s, 2) as [string, string | undefined];
    // A flag followed by another flag (or nothing) is a switch, like --accept.
    const next = args[index + 1];
    named[key] = inline ?? (next !== undefined && !next.startsWith('--') ? args[++index]! : '');
  }
  return { positional, named };
}

function findTask(state: Snapshot, ref: string | undefined) {
  if (!ref) throw new CliError('Give a task id.');
  const matches = state.tasks.filter(task => task.id === ref || task.id.startsWith(ref.toLowerCase()));
  if (matches.length > 1 && !matches.some(task => task.id === ref)) throw new CliError(`More than one task starts with "${ref}". Use more of the id.`);
  const task = matches.find(item => item.id === ref) ?? matches[0];
  if (!task) throw new CliError(`No task matches "${ref}". Run task list to see ids.`);
  return task;
}

function findMember(state: Snapshot, name: string | undefined) {
  if (!name) throw new CliError('Give a teammate\'s name.');
  const lower = name.toLowerCase();
  const exact = state.members.filter(member => member.name.toLowerCase() === lower);
  const matches = exact.length ? exact : state.members.filter(member => member.name.toLowerCase().startsWith(lower));
  if (matches.length !== 1) throw new CliError(matches.length ? `More than one teammate matches "${name}".` : `No teammate named "${name}".`);
  return matches[0]!;
}

function findIdea(state: Snapshot, ref: string | undefined) {
  if (!ref) throw new CliError('Give an idea id.');
  const ideas = state.ideas ?? [];
  const matches = ideas.filter(idea => idea.id === ref || idea.id.startsWith(ref.toLowerCase()));
  if (matches.length > 1 && !matches.some(idea => idea.id === ref)) throw new CliError(`More than one idea starts with "${ref}". Use more of the id.`);
  const idea = matches.find(item => item.id === ref) ?? matches[0];
  if (!idea) throw new CliError(`No idea matches "${ref}". Run idea list to see ids.`);
  return idea;
}

const stageLabel = (idea: Idea) => idea.stage === 'done' ? 'Done' : stageNames[idea.stage];
const ideaLine = (idea: Idea) => `${shortId(idea.id)}  ${stageLabel(idea)}  ${idea.title} · ${sizeNames[idea.size]}`;
const ideaSummary = (idea: Idea) => ({ id: idea.id, title: idea.title, size: idea.size, stage: idea.stage, revision: idea.revision });

const memberName = (state: Snapshot, id: string | null | undefined) => state.members.find(member => member.id === id)?.name;
const openTasks = (state: Snapshot) => state.tasks.filter(task => task.status !== 'completed');

function taskSummary(state: Snapshot, task: Task) {
  return { id: task.id, title: task.title, status: task.status, assignee: memberName(state, task.assigneeId) ?? null, revision: task.revision };
}

function taskLine(state: Snapshot, task: Task) {
  const assignee = memberName(state, task.assigneeId);
  return `${shortId(task.id)}  ${sentenceCase(task.status)}  ${task.title}${assignee ? ` · ${assignee}` : ''}`;
}

const assigningRules = {
  anyone: 'Anyone assigns to anyone',
  leads: 'Owners and Reviewers assign, Contributors claim or suggest',
  owner: 'Only the Owner assigns, everyone else claims or suggests',
} as const;

function canAssign(state: Snapshot, me: Member) {
  const rule = state.settings?.assigningRule ?? 'anyone';
  return rule === 'anyone' || (rule === 'leads' && me.role !== 'contributor') || me.role === 'owner';
}

// Read live, so it is the same for every tool and never goes stale (orchestrator ADR Q12).
function brief(state: Snapshot, me: Member, auto: string): CliResult {
  const tasks = openTasks(state);
  const reviews = me.role === 'contributor' ? 0 : tasks.filter(task => task.status === 'submitted' && task.assigneeId !== me.id).length;
  const assign = canAssign(state, me);
  const rule = assigningRules[state.settings?.assigningRule ?? 'anyone'];
  const commands = ['task list/show/create', ...(assign ? ['task assign'] : []), 'task claim/decline/reply', 'ask', 'package draft/show',
    'idea list/show/create/link', 'playbook <stage> [idea]',
    ...(me.role === 'contributor' ? [] : ['review propose']), 'brief --task <id>'];
  const text = [
    `${state.workspace.name} (${state.workspace.repository}). You are ${me.name}, ${sentenceCase(me.role)}.`,
    `Team: ${state.members.map(member => `${member.name} (${sentenceCase(member.role)})`).join(', ')}`,
    `Assigning: ${rule}. ${assign ? 'You can assign.' : 'You cannot assign: claim unassigned tasks, or suggest an assignee with task reply.'}`,
    `Open: ${tasks.length} tasks${reviews ? ` · ${reviews} waiting for your review` : ''} · ${auto}`,
    ...tasks.map(task => `  ${taskLine(state, task)}`),
    `You can: ${commands.map(command => `console-connect ${command}`).join(', ')}.`,
    'Needs your click in Console Connect: accepting work, requesting changes, approving decisions, approving your own incoming tasks.',
    'Run console-connect help for the details.',
  ].join('\n');
  return { text, data: { workspace: state.workspace, you: me, members: state.members, assigningRule: state.settings?.assigningRule ?? 'anyone', canAssign: assign,
    tasks: tasks.map(task => taskSummary(state, task)), waitingForYourReview: reviews, auto } };
}

export async function runCliCommand(argv: string[], context: CliContext, api: WorkspaceApi): Promise<CliResult> {
  const state = api.snapshot();
  if (!state) throw new CliError('Open a project in Console Connect first.');
  const hold = (summary: string): CliResult => {
    api.hold({ argv, summary });
    return { text: `Held for ${me.name} to send: ${summary}. Automatic runs never hand out work.`, data: { held: summary } };
  };
  const send: WorkspaceApi['send'] = (taskId, fields) => api.send(taskId, context.tool ? { ...fields, via: context.tool } as CommandInput : fields);
  const me = state.members.find(member => member.id === state.memberId)!;
  const [group, verb, ...rest] = argv;
  const { positional, named } = options(group === 'ask' ? [] : group === 'brief' ? [verb, ...rest].filter((item): item is string => item !== undefined) : rest);

  if (group === 'brief') {
    if (named.task) {
      const task = findTask(state, named.task);
      const knowledge = await api.projectKnowledge?.(task.id) ?? null;
      return { text: [taskBrief(state, task), ...knowledgeText(knowledge)].join('\n'), data: { task: taskSummary(state, task), knowledge } };
    }
    const result = brief(state, me, api.autoSummary?.() ?? 'Auto: off');
    const knowledge = await api.projectKnowledge?.(null) ?? null;
    return { text: [result.text, ...knowledgeText(knowledge)].join('\n'), data: { ...(result.data as object), knowledge } };
  }
  if (group === 'ask') {
    if (!context.taskId) throw new CliError('Run ask inside a task console, or use task reply <id> <message>.');
    const body = [verb, ...rest].filter(Boolean).join(' ').trim();
    if (!body) throw new CliError('Write the question after ask.');
    await send(null, { type: 'post-message', taskId: context.taskId, body });
    return { text: `Asked on "${findTask(state, context.taskId).title}" as ${me.name}.`, data: { taskId: context.taskId } };
  }
  if (group === 'task') {
    if (verb === 'list') {
      const tasks = openTasks(state);
      return { text: tasks.length ? tasks.map(task => taskLine(state, task)).join('\n') : 'No open tasks.', data: { tasks: tasks.map(task => taskSummary(state, task)) } };
    }
    if (verb === 'show') {
      const task = findTask(state, positional[0]);
      const messages = state.messages.filter(message => message.taskId === task.id && !message.deletedAt);
      const text = [taskLine(state, task), task.description || '(No description.)',
        ...messages.map(message => `${memberName(state, message.authorId) ?? 'Teammate'}: ${message.body}`)].join('\n');
      return { text, data: { task: { ...taskSummary(state, task), description: task.description, package: task.package ?? null }, messages } };
    }
    if (verb === 'create') {
      const title = named.title?.trim();
      if (!title) throw new CliError('Give the task a --title.');
      const assignee = named.assignee ? findMember(state, named.assignee) : null;
      const after = named.after ? named.after.split(',').filter(ref => ref.trim()).map(ref => findTask(state, ref.trim()).id) : [];
      if (assignee && context.holdAssignments) return hold(`Create "${title}" for ${assignee.name}`);
      const taskId = crypto.randomUUID();
      await send(null, { type: 'create-task', taskId, title, description: named.description ?? '', assigneeId: assignee?.id ?? null,
        ...(after.length ? { after } : {}) });
      return { text: `Created ${shortId(taskId)} "${title}" as ${me.name}${assignee ? `, assigned to ${assignee.name}` : ''}.`, data: { taskId } };
    }
    if (verb === 'assign') {
      const task = findTask(state, positional[0]);
      const assignee = findMember(state, positional[1]);
      if (context.holdAssignments) return hold(`Assign "${task.title}" to ${assignee.name}`);
      await send(task.id, { type: 'assign-task', assigneeId: assignee.id } as CommandInput);
      return { text: `Assigned "${task.title}" to ${assignee.name}.`, data: { taskId: task.id, assigneeId: assignee.id } };
    }
    if (verb === 'decline') {
      const task = findTask(state, positional[0]);
      if (task.assigneeId !== me.id) throw new CliError('Only the person it was assigned to can decline it.');
      const note = named.note?.trim();
      await send(task.id, { type: 'decline-task', ...(note ? { note } : {}) } as CommandInput);
      return { text: `Declined "${task.title}".`, data: { taskId: task.id } };
    }
    if (verb === 'claim') {
      const task = findTask(state, positional[0]);
      await send(task.id, { type: 'claim-task' } as CommandInput);
      return { text: `Claimed "${task.title}".`, data: { taskId: task.id } };
    }
    if (verb === 'reply') {
      const task = findTask(state, positional[0]);
      const body = positional.slice(1).join(' ').trim();
      if (!body) throw new CliError('Write the reply after the task id.');
      await send(null, { type: 'post-message', taskId: task.id, body });
      return { text: `Replied on "${task.title}" as ${me.name}.`, data: { taskId: task.id } };
    }
  }
  if (group === 'playbook') {
    const stage = playbookStage(verb);
    if (!stage) throw new CliError('Choose a stage: talk, write, split, build, or review.');
    const idea = positional[0] ? findIdea(state, positional[0]) : undefined;
    const override = await api.readPlaybook?.(stage, context.taskId) ?? null;
    const source = override?.trim() ? playbookPath(stage) : 'built-in';
    return { text: playbookText(stage, override, idea), data: { stage, source, ideaId: idea?.id ?? null } };
  }
  if (group === 'idea') {
    if (verb === 'list') {
      const ideas = (state.ideas ?? []).filter(idea => idea.stage !== 'done');
      return { text: ideas.length ? ideas.map(ideaLine).join('\n') : 'No open ideas.', data: { ideas: ideas.map(ideaSummary) } };
    }
    if (verb === 'show') {
      const idea = findIdea(state, positional[0]);
      const tasks = state.tasks.filter(task => idea.taskIds.includes(task.id));
      const text = [ideaLine(idea), idea.note || '(No note.)',
        ...idea.documents.map(item => `${stageNames[item.stage]}: ${item.path}`),
        ...tasks.map(task => `Task ${taskLine(state, task)}`),
        ...idea.skipped.map(item => `Skipped ${stageNames[item.stage]} (${memberName(state, item.by) ?? 'Teammate'}): ${item.reason}`)].join('\n');
      return { text, data: { idea } };
    }
    if (verb === 'create') {
      const title = named.title?.trim();
      if (!title) throw new CliError('Give the idea a --title.');
      const size = named.size?.toLowerCase();
      if (size !== 'quick' && size !== 'feature' && size !== 'big') throw new CliError('Choose --size quick, feature, or big.');
      const ideaId = crypto.randomUUID();
      await send(null, { type: 'create-idea', ideaId, title, size, ...(named.note ? { note: named.note } : {}) });
      const first = size === 'quick' ? 'build' : 'talk';
      return { text: `Created idea ${shortId(ideaId)} "${title}", ${sizeNames[size]}, at ${stageNames[first]}.`, data: { ideaId } };
    }
    if (verb === 'link') {
      const idea = findIdea(state, positional[0]);
      const taskIds = named.task ? named.task.split(',').filter(ref => ref.trim()).map(ref => findTask(state, ref.trim()).id) : [];
      const path = named.doc?.trim();
      const stage = named.stage ? playbookStage(named.stage) : idea.stage === 'done' ? null : idea.stage;
      if (path && !stage) throw new CliError('Say which stage the document belongs to with --stage.');
      const spec = named.spec?.trim();
      if (!taskIds.length && !path && !spec) throw new CliError('Link something: --task <id,id>, --doc <path>, or --spec <decision id>.');
      await send(null, { type: 'link-idea', ideaId: idea.id, revision: idea.revision,
        ...(taskIds.length ? { taskIds } : {}), ...(path && stage ? { document: { stage, path } } : {}), ...(spec ? { specDecisionId: spec } : {}) });
      return { text: `Linked to "${idea.title}".`, data: { ideaId: idea.id } };
    }
  }
  if (group === 'package' && verb === 'draft') {
    const taskId = named.task ? findTask(state, named.task).id : context.taskId;
    if (!taskId) throw new CliError('Run package draft in the task console, or add --task <id>.');
    const task = findTask(state, taskId);
    const summary = (named.summary ?? '').trim();
    if (!summary) throw new CliError('Give the package a --summary.');
    if (task.assigneeId !== me.id) throw new CliError('Only the person working on this task can draft its package.');
    if (task.status !== 'running' && task.status !== 'changes_requested') throw new CliError('This task is not ready for a draft. Start its console first.');
    await api.draftPackage({ taskId: task.id, summary, checks: (named.checks ?? '').trim(), questions: (named.questions ?? '').trim(), ...(context.tool ? { via: context.tool } : {}) });
    return { text: `Drafted the work package for "${task.title}". Only you can see it until you submit it in Console Connect.`, data: { taskId: task.id } };
  }
  if (group === 'package' && verb === 'show') {
    const task = findTask(state, positional[0]);
    const pack = task.package ?? (task.assigneeId === me.id ? task.draftPackage : undefined);
    if (!pack) throw new CliError(`"${task.title}" has no work package yet.`);
    const text = [`${task.title} · ${sentenceCase(task.status)}${task.package ? '' : ' (your draft)'}`, `Summary: ${pack.summary}`, `Source: ${pack.sourceRef}`,
      ...(pack.pullRequestUrl ? [`Pull request: ${pack.pullRequestUrl}`] : []), 'Deliverables:', ...pack.deliverables.map(item => `  ${item}`),
      `Verification: ${pack.verification || '(none)'}`, `Open questions: ${pack.questions || '(none)'}`].join('\n');
    return { text, data: { taskId: task.id, status: task.status, package: pack } };
  }
  if (group === 'review' && verb === 'propose') {
    const task = findTask(state, positional[0]);
    const action = 'accept' in named ? 'accept' : 'changes' in named ? 'changes' : null;
    if (!action) throw new CliError('Choose --accept or --changes.');
    if (task.status !== 'submitted' || !task.package) throw new CliError('There is no submitted package to review.');
    if (task.assigneeId === me.id || me.role === 'contributor') throw new CliError('An independent Owner or Reviewer must review this package.');
    const note = (named.note ?? '').trim();
    if (action === 'changes' && !note) throw new CliError('Say what needs to change with --note.');
    api.propose({ id: crypto.randomUUID(), taskId: task.id, action, note, ...(context.tool ? { via: context.tool } : {}) });
    return { text: `Proposed ${action === 'accept' ? 'accepting' : 'changes to'} "${task.title}". It waits for ${me.name}'s click in Console Connect.`, data: { taskId: task.id, action } };
  }
  throw new CliError(`Unknown command "${argv.slice(0, 2).join(' ')}". Run console-connect help.`);
}
