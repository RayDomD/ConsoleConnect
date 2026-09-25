import type { CommandInput, Member, Snapshot, Task, Tool } from '../../coordination';

// What the app lends the command runner: the current snapshot and a way to send a command as the person.
// `send` receives a task id for task-revision commands (the app adds the task's revision) and null otherwise.
export interface WorkspaceApi {
  snapshot(): Snapshot | null;
  send(taskId: string | null, fields: CommandInput): Promise<void>;
  /** Queues a review for the person to confirm with a click; it must never send anything itself. */
  propose(proposal: ReviewProposal): void;
}
export interface ReviewProposal { id: string; taskId: string; action: 'accept' | 'changes'; note: string; via?: Tool }
// `tool` is the AI tool the caller runs in, when known; commands are marked with it ("via Codex").
export interface CliContext { cwd: string; taskId: string | null; tool?: Tool }
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

const memberName = (state: Snapshot, id: string | null | undefined) => state.members.find(member => member.id === id)?.name;
const openTasks = (state: Snapshot) => state.tasks.filter(task => task.status !== 'completed');

function taskSummary(state: Snapshot, task: Task) {
  return { id: task.id, title: task.title, status: task.status, assignee: memberName(state, task.assigneeId) ?? null, revision: task.revision };
}

function taskLine(state: Snapshot, task: Task) {
  const assignee = memberName(state, task.assigneeId);
  return `${shortId(task.id)}  ${sentenceCase(task.status)}  ${task.title}${assignee ? ` · ${assignee}` : ''}`;
}

function brief(state: Snapshot, me: Member): CliResult {
  const tasks = openTasks(state);
  const text = [
    `${state.workspace.name} (${state.workspace.repository}). You are ${me.name}, ${sentenceCase(me.role)}.`,
    `Team: ${state.members.map(member => `${member.name} (${sentenceCase(member.role)})`).join(', ')}`,
    `Open tasks: ${tasks.length}`,
    ...tasks.map(task => `  ${taskLine(state, task)}`),
    'Run console-connect help for the commands.',
  ].join('\n');
  return { text, data: { workspace: state.workspace, you: me, members: state.members, tasks: tasks.map(task => taskSummary(state, task)) } };
}

export async function runCliCommand(argv: string[], context: CliContext, api: WorkspaceApi): Promise<CliResult> {
  const state = api.snapshot();
  if (!state) throw new CliError('Open a project in Console Connect first.');
  const send: WorkspaceApi['send'] = (taskId, fields) => api.send(taskId, context.tool ? { ...fields, via: context.tool } as CommandInput : fields);
  const me = state.members.find(member => member.id === state.memberId)!;
  const [group, verb, ...rest] = argv;
  const { positional, named } = options(group === 'ask' ? [] : rest);

  if (group === 'brief') return brief(state, me);
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
      const taskId = crypto.randomUUID();
      await send(null, { type: 'create-task', taskId, title, description: named.description ?? '', assigneeId: assignee?.id ?? null });
      return { text: `Created ${shortId(taskId)} "${title}" as ${me.name}${assignee ? `, assigned to ${assignee.name}` : ''}.`, data: { taskId } };
    }
    if (verb === 'assign') {
      const task = findTask(state, positional[0]);
      const assignee = findMember(state, positional[1]);
      await send(task.id, { type: 'assign-task', assigneeId: assignee.id } as CommandInput);
      return { text: `Assigned "${task.title}" to ${assignee.name}.`, data: { taskId: task.id, assigneeId: assignee.id } };
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
