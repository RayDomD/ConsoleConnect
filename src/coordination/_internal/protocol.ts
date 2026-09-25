import { z } from 'zod';
import type { PullRequestStatus } from '../../github';

export const toolSchema = z.enum(['claude', 'codex', 'antigravity']);
export type Tool = z.infer<typeof toolSchema>;
export type Role = 'owner' | 'reviewer' | 'contributor';
// Who may hand work to someone else (orchestrator ADR Q11). Claiming and self-assignment stay open to everyone.
export const assigningRuleSchema = z.enum(['anyone', 'leads', 'owner']);
export type AssigningRule = z.infer<typeof assigningRuleSchema>;
export interface WorkspaceSettings { assigningRule: AssigningRule }
export interface Member { id: string; name: string; role: Role }
export interface Task {
  id: string; title: string; description: string; authorId: string; assigneeId: string | null;
  status: 'unassigned' | 'awaiting_approval' | 'ready' | 'running' | 'submitted' | 'changes_requested' | 'accepted' | 'completed';
  revision: number; tool?: Tool; createdAt: string; package?: WorkPackage; draftPackage?: WorkPackage;
  /** Who handed the task to its assignee, and the tool they acted through. */
  assignedBy?: string; via?: Tool;
  /** Set when the recipient declined; cleared when the task is handed out again. */
  declinedBy?: string;
  /** Reported by the worker's app when its session waits on the person or exits without a package. */
  stall?: { reason: 'needs_input' | 'exited'; at: string };
  pullRequestStatus?: PullRequestStatus; pendingDecisionIds?: string[];
  /** Tasks that must be accepted or completed before this one starts (guided path ADR Q21). */
  after?: string[];
}
export interface WorkPackage {
  summary: string; sourceRef: string; pullRequestUrl?: string;
  deliverables: string[]; verification: string; questions: string;
  submittedAt?: string; reviewedBy?: string; reviewNote?: string;
}
export interface Message {
  id: string; taskId?: string; authorId: string; body: string; createdAt: string;
  replyToId?: string; version?: number; editedAt?: string; deletedAt?: string; via?: Tool;
}
export interface Decision {
  id: string; title: string; body: string; proposedBy: string; createdAt: string;
  status: 'proposed' | 'official' | 'superseded'; documentCommit?: string;
  supersedesId?: string; affectedTaskIds: string[];
}
// The guided path (ADR Q15, Q19, Q20): an idea moves through the stages its size puts on its path.
export const ideaSizeSchema = z.enum(['quick', 'feature', 'big']);
export type IdeaSize = z.infer<typeof ideaSizeSchema>;
export const ideaStageSchema = z.enum(['talk', 'write', 'split', 'build', 'review']);
export type IdeaStage = z.infer<typeof ideaStageSchema>;
export const ideaStages: IdeaStage[] = ['talk', 'write', 'split', 'build', 'review'];
export const ideaPaths: Record<IdeaSize, IdeaStage[]> = {
  quick: ['build', 'review'], feature: ['talk', 'split', 'build', 'review'], big: ideaStages,
};
export interface Idea {
  id: string; title: string; note: string; size: IdeaSize; stage: IdeaStage | 'done';
  createdBy: string; createdAt: string; revision: number; readyBy?: string;
  skipped: { stage: IdeaStage; reason: string; by: string }[];
  documents: { stage: IdeaStage; path: string }[];
  taskIds: string[]; specDecisionId?: string; sample?: boolean;
}
export function nextStage(idea: Idea): Idea['stage'] {
  if (idea.stage === 'done') return 'done';
  const path = ideaPaths[idea.size];
  return path[path.indexOf(idea.stage) + 1] ?? 'done';
}

/** The gate for leaving the idea's current stage, or null when it is open (ADR Q20). The host enforces it; cards show it. */
export function ideaGate(idea: Idea, tasks: Task[], decisions: Decision[]): string | null {
  const linked = tasks.filter(task => idea.taskIds.includes(task.id));
  switch (idea.stage) {
    case 'talk': return idea.readyBy ? null : 'An Owner or Reviewer must mark it ready.';
    case 'write': return decisions.some(item => item.id === idea.specDecisionId && item.status === 'official')
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

export interface Snapshot {
  workspace: { id: string; name: string; repository: string };
  revision: number; members: Member[]; tasks: Task[]; messages: Message[]; decisions: Decision[]; ideas?: Idea[];
  sharedTerminalTaskIds?: string[]; memberId: string; settings?: WorkspaceSettings; presence?: MemberPresence[];
}
const identifier = z.string().uuid();
const revision = z.number().int().positive();
// `via` names the AI tool a person acted through (the CLI sets it); people's clicks never carry it.
const commandBase = { id: identifier, via: toolSchema.optional() };
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ ...commandBase, type: z.literal('create-task'), taskId: identifier,
    title: z.string().trim().min(1).max(160), description: z.string().max(32000), assigneeId: identifier.nullable(),
    after: z.array(identifier).max(100).optional() }),
  z.object({ ...commandBase, type: z.literal('approve-task'), taskId: identifier, revision }),
  z.object({ ...commandBase, type: z.literal('set-assigning-rule'), rule: assigningRuleSchema }),
  z.object({ ...commandBase, type: z.literal('decline-task'), taskId: identifier, revision, note: z.string().trim().max(8000).optional() }),
  z.object({ ...commandBase, type: z.literal('report-session'), taskId: identifier, state: z.enum(['needs_input', 'exited', 'working']) }),
  z.object({ ...commandBase, type: z.literal('claim-task'), taskId: identifier, revision }),
  z.object({ ...commandBase, type: z.literal('assign-task'), taskId: identifier, revision, assigneeId: identifier }),
  z.object({ ...commandBase, type: z.literal('start-task'), taskId: identifier, revision, tool: toolSchema }),
  z.object({ ...commandBase, type: z.literal('save-package'), taskId: identifier, revision,
    summary: z.string().trim().min(1).max(8000), sourceRef: z.string().trim().min(1).max(1000),
    pullRequestUrl: z.string().url().refine(value => new URL(value).protocol === 'https:' && /\/pull\/\d+\/?$/.test(new URL(value).pathname)).optional(),
    deliverables: z.array(z.string().trim().min(1).max(2000)).max(100),
    verification: z.string().max(8000), questions: z.string().max(8000) }),
  z.object({ ...commandBase, type: z.literal('submit-package'), taskId: identifier, revision }),
  z.object({ ...commandBase, type: z.literal('accept-package'), taskId: identifier, revision }),
  z.object({ ...commandBase, type: z.literal('request-changes'), taskId: identifier, revision, note: z.string().trim().min(1).max(8000) }),
  z.object({ ...commandBase, type: z.literal('post-message'), taskId: identifier.optional(),
    replyToId: identifier.optional(), body: z.string().trim().min(1).max(8000) }),
  z.object({ ...commandBase, type: z.literal('edit-message'), messageId: identifier,
    version: revision, body: z.string().trim().min(1).max(8000) }),
  z.object({ ...commandBase, type: z.literal('unsend-message'), messageId: identifier, version: revision }),
  z.object({ ...commandBase, type: z.literal('propose-decision'), decisionId: identifier,
    title: z.string().trim().min(1).max(160).regex(/^[^\r\n]+$/), body: z.string().trim().min(1).max(32000),
    supersedesId: identifier.optional(), affectedTaskIds: z.array(identifier).max(100).optional() }),
  z.object({ ...commandBase, type: z.literal('approve-decision'), decisionId: identifier,
    commitSha: z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i) }),
  z.object({ ...commandBase, type: z.literal('acknowledge-decision'), taskId: identifier, revision, decisionId: identifier }),
  z.object({ ...commandBase, type: z.literal('create-idea'), ideaId: identifier,
    title: z.string().trim().min(1).max(160), note: z.string().max(32000).optional(), size: ideaSizeSchema,
    /** The worked example a new workspace starts with (guided path ADR Q24). */
    sample: z.literal(true).optional() }),
  z.object({ ...commandBase, type: z.literal('update-idea'), ideaId: identifier, revision,
    title: z.string().trim().min(1).max(160).optional(), note: z.string().max(32000).optional(), size: ideaSizeSchema.optional() }),
  z.object({ ...commandBase, type: z.literal('mark-idea-ready'), ideaId: identifier, revision }),
  z.object({ ...commandBase, type: z.literal('advance-idea'), ideaId: identifier, revision }),
  z.object({ ...commandBase, type: z.literal('skip-idea-stage'), ideaId: identifier, revision, reason: z.string().trim().min(1).max(200) }),
  z.object({ ...commandBase, type: z.literal('link-idea'), ideaId: identifier, revision,
    taskIds: z.array(identifier).max(100).optional(),
    document: z.object({ stage: ideaStageSchema, path: z.string().trim().min(1).max(500) }).optional(),
    specDecisionId: identifier.optional() }),
  z.object({ ...commandBase, type: z.literal('delete-idea'), ideaId: identifier }),
]);
export type Command = z.infer<typeof commandSchema>;
export type CommandInput = Command extends infer C ? C extends Command ? Omit<C, 'id'> : never : never;
export interface WorkspaceState {
  workspace: Snapshot['workspace']; revision: number; members: Member[]; tasks: Task[]; messages: Message[]; decisions: Decision[];
  /** Absent in states saved before the guided path; read as empty. */
  ideas?: Idea[];
  settings?: WorkspaceSettings;
  credentials: Record<string, string>;
  invites: Record<string, { role: Exclude<Role, 'owner'>; expiresAt: number }>;
  appliedCommands: Record<string, { actorId: string; digest: string }>;
}
// Presence (Office, roadmap 3.1): heartbeats from each app. Ephemeral, never part of the revisioned state.
// A glimpse is the last lines of a console, kept only while its owner shares it.
export const presenceOfflineMs = 60_000;
export const presenceSchema = z.object({
  status: z.enum(['here', 'away']),
  console: z.object({
    kind: z.enum(['task', 'orchestrator']), taskId: identifier.optional(), tool: toolSchema,
    needsInput: z.boolean(), shared: z.boolean(), glimpse: z.array(z.string().max(300)).max(3).optional(),
  }).nullable(),
  /** The task whose shared console this person is watching, for huddles in the Office. */
  watching: identifier.optional(),
});
export type PresenceInput = z.infer<typeof presenceSchema>;
export interface PresenceRecord extends PresenceInput { memberId: string; at: string }
export interface MemberPresence { memberId: string; status: 'here' | 'away' | 'offline'; console: PresenceInput['console']; watching?: string; at: string | null }

export function presenceView(records: PresenceRecord[], memberIds: string[], now: number): MemberPresence[] {
  return memberIds.map(memberId => {
    const record = records.find(item => item.memberId === memberId);
    if (!record) return { memberId, status: 'offline', console: null, at: null };
    if (now - Date.parse(record.at) > presenceOfflineMs) return { memberId, status: 'offline', console: null, at: record.at };
    const console = record.console && !record.console.shared ? { ...record.console, glimpse: undefined } : record.console;
    return { memberId, status: record.status, console, ...(record.watching ? { watching: record.watching } : {}), at: record.at };
  });
}

export class RequestError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function snapshot(state: WorkspaceState, memberId: string): Snapshot {
  const tasks = state.tasks.map(task => {
    if (task.assigneeId === memberId) return task;
    const { draftPackage: _private, ...shared } = task;
    return shared;
  });
  return { workspace: state.workspace, revision: state.revision, members: state.members, tasks, messages: state.messages, decisions: state.decisions, ideas: state.ideas ?? [], memberId,
    settings: { assigningRule: state.settings?.assigningRule ?? 'anyone' } };
}
