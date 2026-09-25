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
  pullRequestStatus?: PullRequestStatus; pendingDecisionIds?: string[];
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
export interface Snapshot {
  workspace: { id: string; name: string; repository: string };
  revision: number; members: Member[]; tasks: Task[]; messages: Message[]; decisions: Decision[];
  sharedTerminalTaskIds?: string[]; memberId: string; settings?: WorkspaceSettings;
}
const identifier = z.string().uuid();
const revision = z.number().int().positive();
// `via` names the AI tool a person acted through (the CLI sets it); people's clicks never carry it.
const commandBase = { id: identifier, via: toolSchema.optional() };
export const commandSchema = z.discriminatedUnion('type', [
  z.object({ ...commandBase, type: z.literal('create-task'), taskId: identifier,
    title: z.string().trim().min(1).max(160), description: z.string().max(32000), assigneeId: identifier.nullable() }),
  z.object({ ...commandBase, type: z.literal('approve-task'), taskId: identifier, revision }),
  z.object({ ...commandBase, type: z.literal('set-assigning-rule'), rule: assigningRuleSchema }),
  z.object({ ...commandBase, type: z.literal('decline-task'), taskId: identifier, revision, note: z.string().trim().max(8000).optional() }),
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
]);
export type Command = z.infer<typeof commandSchema>;
export type CommandInput = Command extends infer C ? C extends Command ? Omit<C, 'id'> : never : never;
export interface WorkspaceState {
  workspace: Snapshot['workspace']; revision: number; members: Member[]; tasks: Task[]; messages: Message[]; decisions: Decision[];
  settings?: WorkspaceSettings;
  credentials: Record<string, string>;
  invites: Record<string, { role: Exclude<Role, 'owner'>; expiresAt: number }>;
  appliedCommands: Record<string, { actorId: string; digest: string }>;
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
  return { workspace: state.workspace, revision: state.revision, members: state.members, tasks, messages: state.messages, decisions: state.decisions, memberId,
    settings: { assigningRule: state.settings?.assigningRule ?? 'anyone' } };
}
